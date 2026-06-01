import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";
import type { ApprovalCategory } from "../types";

export const maestroRouter = new Hono();

// Named action allowlist — never execute a URL from stored data
const APPROVE_HANDLERS: Record<string, (payload: unknown) => Promise<void>> = {
  send_email: async (_p) => { /* stub: would call email service */ },
  send_sms: async (_p) => { /* stub: would call SMS service */ },
  create_task: async (_p) => { /* stub: would create ERPNext task */ },
  update_order: async (_p) => { /* stub: would update order status */ },
  post_social: async (_p) => { /* stub: would post to social */ },
  factory_release: async (_p) => { /* stub: would release factory order */ },
  noop: async (_p) => { /* explicit no-op for items needing only human sign-off */ },
};

// ── POST /api/maestro/brief ── Maestro webhook receiver
// Destination: lsh.agent_briefs (Supabase service role)
maestroRouter.post("/brief", async (c) => {
  const secret = process.env.MAESTRO_WEBHOOK_SECRET;
  if (secret) {
    const provided = c.req.header("X-Maestro-Secret") ?? c.req.header("x-maestro-secret");
    if (provided !== secret) return c.json({ error: { message: "Forbidden" } }, 403);
  }
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: { message: "Invalid JSON" } }, 400);

  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const title = typeof body.date === "string"
    ? `Maestro Brief — ${body.date}`
    : "Maestro Daily Brief";
  const briefText = typeof body.brief === "string" ? body.brief : JSON.stringify(body);

  const { error } = await (supabaseAdmin as any)
    .schema("lsh")
    .from("agent_briefs")
    .insert({
      type: "daily_brief",
      title,
      body: briefText,
      severity: "info",
      source: "maestro",
      metadata: body,
    });

  if (error) {
    console.error("[maestro/brief] insert error:", error.message);
    return c.json({ error: { message: "Failed to store brief" } }, 500);
  }

  return c.json({ data: { ok: true } });
});

// ── GET /api/maestro/brief ── latest brief
maestroRouter.get("/brief", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver" || user.role === "salesperson")
    return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ data: null });

  const { data: row, error } = await (supabaseAdmin as any)
    .schema("lsh")
    .from("agent_briefs")
    .select("id, title, body, metadata, created_at")
    .eq("source", "maestro")
    .eq("type", "daily_brief")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !row) return c.json({ data: null });

  // metadata is the full payload; merge with top-level fields the frontend expects
  const meta = row.metadata ?? {};
  let signals = Array.isArray(meta.signals) ? meta.signals : [];
  // Strip financial signals for store_manager (super_admin sees all)
  if (user.role === "store_manager") {
    signals = signals.filter((s: any) => s.category !== "financial");
  }

  return c.json({
    data: {
      id: row.id,
      brief: row.body,
      date: meta.date ?? null,
      signals,
      anomalies: Array.isArray(meta.anomalies) ? meta.anomalies : [],
      receivedAt: row.created_at,
    },
  });
});

// ── GET /api/maestro/approvals ── list approval_queue items
maestroRouter.get("/approvals", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver" || user.role === "salesperson")
    return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ data: [] });

  const { data, error } = await supabaseAdmin
    .from("approval_queue")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return c.json({ data: [] });

  const FINANCIAL: ApprovalCategory[] = ["financial"];
  const filtered = (data ?? []).filter((item: any) => {
    if (FINANCIAL.includes(item.category) && user.role !== "super_admin" && user.role !== "store_manager") return false;
    return true;
  });

  return c.json({ data: filtered });
});

// ── POST /api/maestro/approvals/:id/approve ──
// Audit destination: public.approval_decisions (Supabase service role)
maestroRouter.post("/approvals/:id/approve", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver" || user.role === "salesperson")
    return c.json({ error: { message: "Forbidden" } }, 403);

  const queueItemId = c.req.param("id");
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const { data: item, error: fetchErr } = await supabaseAdmin
    .from("approval_queue")
    .select("*")
    .eq("id", queueItemId)
    .single();

  if (fetchErr || !item) return c.json({ error: { message: "Not found" } }, 404);
  if (item.status !== "pending" && item.status !== "awaiting_second")
    return c.json({ error: { message: `Item is already ${item.status}` } }, 409);
  if (item.status === "shadow_review")
    return c.json({ error: { message: "Shadow review items are observation-only" } }, 403);
  if (item.category === "financial" && user.role !== "super_admin" && user.role !== "store_manager")
    return c.json({ error: { message: "Forbidden" } }, 403);

  // Dispatch named action from allowlist — NEVER fetch a URL from stored data
  const actionKey = item.on_approve_action ?? "noop";
  const handler = APPROVE_HANDLERS[actionKey];
  if (!handler) {
    return c.json({ error: { message: `Unknown action key: ${actionKey}` } }, 422);
  }
  await handler(item.payload ?? {});

  const { error: updateErr } = await supabaseAdmin
    .from("approval_queue")
    .update({ status: "approved" })
    .eq("id", queueItemId);

  if (updateErr) return c.json({ error: { message: "Failed to update status" } }, 500);

  // Audit log → public.approval_decisions
  // approval_decision enum: approved | denied | revised
  await supabaseAdmin.from("approval_decisions").insert({
    approval_id: queueItemId,
    decided_by_name: user.name,
    decided_by_email: user.email,
    decision: "approved",
  });

  return c.json({ data: { ok: true, action: actionKey } });
});

// ── POST /api/maestro/approvals/:id/deny ──
maestroRouter.post("/approvals/:id/deny", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver" || user.role === "salesperson")
    return c.json({ error: { message: "Forbidden" } }, 403);

  const queueItemId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const notes = typeof body?.notes === "string" ? body.notes : undefined;

  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const { data: item, error: fetchErr } = await supabaseAdmin
    .from("approval_queue")
    .select("id, status, category")
    .eq("id", queueItemId)
    .single();

  if (fetchErr || !item) return c.json({ error: { message: "Not found" } }, 404);
  if (item.status === "shadow_review")
    return c.json({ error: { message: "Shadow review items are observation-only" } }, 403);
  if (item.category === "financial" && user.role !== "super_admin" && user.role !== "store_manager")
    return c.json({ error: { message: "Forbidden" } }, 403);

  await supabaseAdmin.from("approval_queue").update({ status: "denied" }).eq("id", queueItemId);

  // Audit log → public.approval_decisions
  await supabaseAdmin.from("approval_decisions").insert({
    approval_id: queueItemId,
    decided_by_name: user.name,
    decided_by_email: user.email,
    decision: "denied",
    note: notes ?? null,
  });

  return c.json({ data: { ok: true } });
});
