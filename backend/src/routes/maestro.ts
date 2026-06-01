import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";
import type { ApprovalCategory } from "../types";

export const maestroRouter = new Hono();

// ── Action executor — fires real downstream effects ───────────────────────────

async function fireN8nWebhook(workflowId: string, payload: unknown): Promise<void> {
  const key = process.env.N8N_API_KEY;
  const base = "https://lstailors.app.n8n.cloud/api/v1";
  if (!key) { console.warn("[maestro] N8N_API_KEY not set"); return; }
  await fetch(`${base}/workflows/${workflowId}/execute`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ workflowData: payload }),
  }).catch(e => console.error("[maestro/n8n]", e?.message));
}

async function fireMaestroWebhook(path: string, payload: unknown): Promise<void> {
  const secret = process.env.MAESTRO_WEBHOOK_SECRET;
  const base = process.env.MAESTRO_WEBHOOK_BASE ?? "https://app.lstailors.com";
  await fetch(`${base}/api/maestro/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "X-Maestro-Secret": secret } : {}),
    },
    body: JSON.stringify(payload),
  }).catch(e => console.error(`[maestro/webhook/${path}]`, e?.message));
}

// Named action allowlist — handlers now fire real effects
const APPROVE_HANDLERS: Record<string, (item: any) => Promise<void>> = {
  send_email: async (item) => {
    // Fire n8n email workflow (WF-13 Maestro Command Router)
    await fireN8nWebhook("WF-13", {
      action: "send_email",
      approval_id: item.id,
      payload: item.on_approve_config ?? {},
    });
  },
  send_sms: async (item) => {
    // Fire SMS via Twilio through n8n
    await fireN8nWebhook("WF-13", {
      action: "send_sms",
      approval_id: item.id,
      payload: item.on_approve_config ?? {},
    });
  },
  create_task: async (item) => {
    await fireN8nWebhook("WF-13", {
      action: "create_task",
      approval_id: item.id,
      payload: item.on_approve_config ?? {},
    });
  },
  update_order: async (item) => {
    await fireN8nWebhook("WF-13", {
      action: "update_order",
      approval_id: item.id,
      payload: item.on_approve_config ?? {},
    });
  },
  post_social: async (item) => {
    await fireN8nWebhook("WF-13", {
      action: "post_social",
      approval_id: item.id,
      payload: item.on_approve_config ?? {},
    });
  },
  factory_release: async (item) => {
    await fireN8nWebhook("WF-PO-03", {
      action: "factory_release",
      approval_id: item.id,
      payload: item.on_approve_config ?? {},
    });
  },
  n8n_webhook: async (item) => {
    // Generic: fire a specific n8n workflow ID stored in on_approve_config
    const cfg = item.on_approve_config ?? {};
    if (cfg.workflow_id) {
      await fireN8nWebhook(cfg.workflow_id, { approval_id: item.id, ...cfg });
    }
  },
  noop: async (_item) => { /* explicit no-op — human sign-off only */ },
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
  await handler(item);

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

// ── POST /api/maestro/events — ingest agent events (from n8n/Hermes) ──────────
// Feeds the Live Feed panel and audit log in Mission Control.
// Secured with X-Maestro-Secret header.
maestroRouter.post("/events", async (c) => {
  const secret = process.env.MAESTRO_WEBHOOK_SECRET;
  if (secret) {
    const provided = c.req.header("X-Maestro-Secret") ?? c.req.header("x-maestro-secret");
    if (provided !== secret) return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: { message: "Invalid JSON" } }, 400);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const lshAdmin = (supabaseAdmin as any).schema("lsh");

  // Support single event or array
  const events = Array.isArray(body) ? body : [body];
  const rows = events.map((ev: any) => ({
    agent_slug: ev.agent_slug ?? ev.agent ?? "maestro",
    event_type: ev.event_type ?? ev.type ?? "info",
    summary: ev.summary ?? ev.message ?? null,
    severity: ev.severity ?? "info",
    metadata: ev.metadata ?? {},
    tenant_id: ev.tenant_id ?? null,
  }));

  const { error } = await lshAdmin.from("agent_events").insert(rows);
  if (error) {
    console.error("[maestro/events] insert error:", error.message);
    return c.json({ error: { message: error.message } }, 500);
  }

  return c.json({ data: { ok: true, count: rows.length } });
});

// ── POST /api/maestro/costs — record token/cost data ─────────────────────────
// Called by Hermes after each agent invocation with token counts + cost.
maestroRouter.post("/costs", async (c) => {
  const secret = process.env.MAESTRO_WEBHOOK_SECRET;
  if (secret) {
    const provided = c.req.header("X-Maestro-Secret") ?? c.req.header("x-maestro-secret");
    if (provided !== secret) return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: { message: "Invalid JSON" } }, 400);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const lshAdmin = (supabaseAdmin as any).schema("lsh");

  const records = Array.isArray(body) ? body : [body];
  const rows = records.map((r: any) => ({
    agent_slug: r.agent_slug ?? r.agent ?? "maestro",
    model: r.model ?? "unknown",
    input_tokens: parseInt(r.input_tokens ?? r.prompt_tokens ?? 0),
    output_tokens: parseInt(r.output_tokens ?? r.completion_tokens ?? 0),
    cost_usd: parseFloat(r.cost_usd ?? r.cost ?? 0),
    task_id: r.task_id ?? null,
    day: r.day ?? new Date().toISOString().split("T")[0],
    tenant_id: r.tenant_id ?? null,
  }));

  const { error } = await lshAdmin.from("agent_costs").insert(rows);
  if (error) {
    console.error("[maestro/costs] insert error:", error.message);
    return c.json({ error: { message: error.message } }, 500);
  }

  // Also update agent last_action_at + last_action_summary
  for (const row of rows) {
    if (row.agent_slug) {
      await lshAdmin
        .from("agents")
        .update({ last_action_at: new Date().toISOString() })
        .eq("slug", row.agent_slug)
        .catch(() => {});
    }
  }

  return c.json({ data: { ok: true, count: rows.length } });
});

// ── POST /api/maestro/heartbeat — agent heartbeat ────────────────────────────
// Agents ping this every N minutes to stay "active" in the fleet view.
maestroRouter.post("/heartbeat", async (c) => {
  const secret = process.env.MAESTRO_WEBHOOK_SECRET;
  if (secret) {
    const provided = c.req.header("X-Maestro-Secret") ?? c.req.header("x-maestro-secret");
    if (provided !== secret) return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: { message: "Invalid JSON" } }, 400);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const lshAdmin = (supabaseAdmin as any).schema("lsh");
  const slug = body.agent_slug ?? body.agent;
  if (!slug) return c.json({ error: { message: "agent_slug required" } }, 400);

  const update: Record<string, any> = {
    last_heartbeat_at: new Date().toISOString(),
    status: body.status ?? "active",
  };
  if (body.current_task !== undefined) update.current_task = body.current_task;
  if (body.current_task_since !== undefined) update.current_task_since = body.current_task_since;
  if (body.health_score !== undefined) update.health_score = Math.min(100, Math.max(0, parseInt(body.health_score)));
  if (body.last_action_summary !== undefined) update.last_action_summary = body.last_action_summary;

  const { error } = await lshAdmin.from("agents").update(update).eq("slug", slug);
  if (error) return c.json({ error: { message: error.message } }, 500);

  return c.json({ data: { ok: true, slug } });
});

// ── POST /api/maestro/audit — write audit log entry ──────────────────────────
maestroRouter.post("/audit", async (c) => {
  const secret = process.env.MAESTRO_WEBHOOK_SECRET;
  if (secret) {
    const provided = c.req.header("X-Maestro-Secret") ?? c.req.header("x-maestro-secret");
    if (provided !== secret) return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: { message: "Invalid JSON" } }, 400);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const lshAdmin = (supabaseAdmin as any).schema("lsh");
  const entries = Array.isArray(body) ? body : [body];

  const rows = entries.map((e: any) => ({
    agent_slug: e.agent_slug ?? e.agent ?? "maestro",
    event_type: e.event_type ?? "action",
    intent: e.intent ?? null,
    tool_called: e.tool_called ?? null,
    tool_input: e.tool_input ?? null,
    tool_output: e.tool_output ?? null,
    policy_applied: e.policy_applied ?? null,
    approval_id: e.approval_id ?? null,
    side_effect: e.side_effect ?? null,
    linked_customer_id: e.linked_customer_id ?? null,
    linked_order_id: e.linked_order_id ?? null,
    severity: e.severity ?? "info",
    metadata: e.metadata ?? {},
    tenant_id: e.tenant_id ?? null,
  }));

  const { error } = await lshAdmin.from("audit_log").insert(rows);
  if (error) return c.json({ error: { message: error.message } }, 500);

  return c.json({ data: { ok: true, count: rows.length } });
});
