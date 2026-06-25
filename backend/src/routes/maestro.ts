import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import type { ApprovalCategory } from "../types";
import {
  insertAgentBrief,
  listAgentBriefsFiltered,
  listApprovalQueue,
  getApprovalItem,
  updateApprovalItem,
  insertApprovalDecision,
  insertAgentEvents,
  insertAgentCosts,
  updateAgent,
  getAgentBySlug,
} from "../lib/erpnext/agents";
import { erpCreate } from "../lib/erp";
import { storeList } from "../lib/erpnext/store";
import { DT } from "../lib/erpnext/doctypes";

export const maestroRouter = new Hono();

// ── Action executor — fires real downstream effects ───────────────────────────

// Workflow ID → webhook path map. WF-13 uses a webhook trigger, not the execute API.
const N8N_WEBHOOK_PATHS: Record<string, string> = {
  "WF-13": "maestro-command",
  "WF-PO-03": "po-approved",
};

async function fireN8nWebhook(workflowId: string, payload: unknown): Promise<void> {
  const webhookPath = N8N_WEBHOOK_PATHS[workflowId];
  if (webhookPath) {
    // Workflow uses a webhook trigger — POST to the webhook URL directly
    const webhookBase = "https://lstailors.app.n8n.cloud/webhook";
    await fetch(`${webhookBase}/${webhookPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(e => console.error("[maestro/n8n webhook]", e?.message));
    return;
  }
  // Fallback: use execute API for workflows without a webhook trigger
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

  const title = typeof body.date === "string"
    ? `Maestro Brief — ${body.date}`
    : "Maestro Daily Brief";
  const briefText = typeof body.brief === "string" ? body.brief : JSON.stringify(body);

  try {
    await insertAgentBrief({
      type: "daily_brief",
      title,
      body: briefText,
      severity: "info",
      source: "maestro",
      metadata: JSON.stringify(body),
    });
  } catch (e: any) {
    console.error("[maestro/brief] insert error:", e.message);
    return c.json({ error: { message: "Failed to store brief" } }, 500);
  }

  return c.json({ data: { ok: true } });
});

// ── GET /api/maestro/brief/trigger ── generate + save a fresh brief via Grok ──
maestroRouter.get("/brief/trigger", async (_c) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0]!;
    const nycHour = parseInt(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
    const period = nycHour < 12 ? "Morning" : nycHour < 16 ? "Midday" : "Afternoon";

    // ── Gather live data in parallel ──────────────────────────────────────
    const [overdueInvoices, openApprovals, openTasks, altKpis, appointments] = await Promise.all([
      erpList<any>("Sales Invoice", {
        filters: [["docstatus","=",1],["outstanding_amount",">",0],["due_date","<",todayStr]],
        fields: ["name","customer_name","outstanding_amount","due_date"],
        limit: 10,
      }).catch(() => []),
      listApprovalQueue({ status: ["pending", "awaiting_second"], limit: 20 }),
      storeList<any>(DT.AGENT_TASK, {
        filters: [["status", "in", ["pending", "active", "in_progress"]]],
        fields: ["name", "title", "priority", "status", "due_at"],
        limit: 10,
      }),
      erpList<any>("Alteration Ticket", {
        filters: [["workflow_state","in",["Received","In Progress"]]],
        fields: ["name","workflow_state","due_date","is_rush"],
        limit: 200,
      }).catch(() => []),
      storeList<any>(DT.APPOINTMENT, {
        filters: [["start_time", ">=", `${todayStr}T00:00:00Z`], ["start_time", "<=", `${todayStr}T23:59:59Z`]],
        fields: ["name", "event_type", "start_time"],
        orderBy: "start_time asc",
        limit: 5,
      }),
    ]);

    const approvals = openApprovals as any[];
    const tasks = openTasks as any[];
    const appts = appointments as any[];

    const overdueAlt = altKpis.filter((t:any) => t.due_date && t.due_date < todayStr).length;
    const rushAlt = altKpis.filter((t:any) => t.is_rush).length;
    const totalAlt = altKpis.length;

    const nycNow = new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday:"long", month:"long", day:"numeric", year:"numeric" });

    const dataBlock = [
      `Date: ${nycNow}`,
      `Period: ${period}`,
      `Alterations — Active: ${totalAlt} | Overdue: ${overdueAlt} | Rush: ${rushAlt}`,
      overdueInvoices.length ? `Overdue Invoices: ${overdueInvoices.map((i:any)=>`${i.customer_name} $${Number(i.outstanding_amount).toLocaleString()}`).join(", ")}` : "No overdue invoices",
      `Approvals pending: ${approvals.length}${approvals.filter((a:any)=>a.priority==="urgent").length > 0 ? ` (${approvals.filter((a:any)=>a.priority==="urgent").length} urgent)` : ""}`,
      tasks.length ? `Open tasks: ${tasks.slice(0,3).map((t:any)=>t.title).join("; ")}` : "No open tasks",
      appts.length ? `Today's appointments: ${appts.map((a:any)=>`${new Date(a.start_time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})} — ${a.event_type}`).join(", ")}` : "No appointments today",
    ].join("\n");

    // ── Call Grok ─────────────────────────────────────────────────────────
    const apiKey = process.env.XAI_API_KEY;
    let briefText = "";
    if (apiKey) {
      const prompt = `You are Maestro, the operations intelligence for L&S Custom Tailors — a luxury bespoke house in New York.\n\nWrite the ${period} Brief for Carl (the owner). Be direct, professional, specific. 4-8 sentences. Call out risks and priorities. Sign off as — Maestro.\n\nData:\n${dataBlock}`;
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "grok-3-mini", messages: [{ role: "user", content: prompt }], max_tokens: 400, temperature: 0.5 }),
      });
      const grokData = await res.json() as any;
      briefText = grokData?.choices?.[0]?.message?.content?.trim() ?? "";
    }
    if (!briefText) briefText = `${period} Brief:\n${dataBlock}\n— Maestro`;

    try {
      await insertAgentBrief({
        type: "daily_brief",
        title: `Maestro Brief — ${todayStr}`,
        body: briefText,
        severity: "info",
        source: "maestro",
        metadata: JSON.stringify({ date: todayStr, period, generated_at: now.toISOString() }),
      });
    } catch (e: any) {
      console.error("[maestro/brief/trigger] save error:", e.message);
    }

    return _c.json({ data: { ok: true, period, brief: briefText } });
  } catch (e: any) {
    console.error("[maestro/brief/trigger]", e.message);
    return _c.json({ error: { message: e.message } }, 500);
  }
});

// ── GET /api/maestro/brief ── latest brief
maestroRouter.get("/brief", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver" || user.role === "salesperson")
    return c.json({ error: { message: "Forbidden" } }, 403);

  const briefs = await listAgentBriefsFiltered({ source: "maestro", type: "daily_brief", limit: 1 });
  const row = briefs[0];
  if (!row) return c.json({ data: null });

  let meta: any = {};
  try {
    meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? {});
  } catch {
    meta = {};
  }
  let signals = Array.isArray(meta.signals) ? meta.signals : [];
  // Strip financial signals for store_manager (super_admin sees all)
  if (user.role === "store_manager") {
    signals = signals.filter((s: any) => s.category !== "financial");
  }

  return c.json({
    data: {
      id: row.name,
      brief: row.body,
      date: meta.date ?? null,
      signals,
      anomalies: Array.isArray(meta.anomalies) ? meta.anomalies : [],
      receivedAt: row.creation,
    },
  });
});

// ── GET /api/maestro/approvals ── list approval_queue items
maestroRouter.get("/approvals", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver" || user.role === "salesperson")
    return c.json({ error: { message: "Forbidden" } }, 403);

  const data = await listApprovalQueue({ limit: 100 });

  const FINANCIAL: ApprovalCategory[] = ["financial"];
  const filtered = data.filter((item: any) => {
    if (FINANCIAL.includes(item.category) && user.role !== "super_admin" && user.role !== "store_manager") return false;
    return true;
  });

  return c.json({ data: filtered.map((r: any) => ({ ...r, id: r.name, created_at: r.creation })) });
});

// ── POST /api/maestro/approvals/:id/approve ──
maestroRouter.post("/approvals/:id/approve", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver" || user.role === "salesperson")
    return c.json({ error: { message: "Forbidden" } }, 403);

  const queueItemId = c.req.param("id");
  const item = await getApprovalItem(queueItemId);
  if (!item) return c.json({ error: { message: "Not found" } }, 404);
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

  try {
    await updateApprovalItem(queueItemId, { status: "approved" });
    await insertApprovalDecision({
      approval_id: queueItemId,
      decided_by_name: user.name,
      decided_by_email: user.email,
      decision: "approved",
    });
  } catch {
    return c.json({ error: { message: "Failed to update status" } }, 500);
  }

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

  const item = await getApprovalItem(queueItemId);
  if (!item) return c.json({ error: { message: "Not found" } }, 404);
  if (item.status === "shadow_review")
    return c.json({ error: { message: "Shadow review items are observation-only" } }, 403);
  if (item.category === "financial" && user.role !== "super_admin" && user.role !== "store_manager")
    return c.json({ error: { message: "Forbidden" } }, 403);

  await updateApprovalItem(queueItemId, { status: "denied" });
  await insertApprovalDecision({
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
  const events = Array.isArray(body) ? body : [body];
  const rows = events.map((ev: any) => ({
    agent_slug: ev.agent_slug ?? ev.agent ?? "maestro",
    event_type: ev.event_type ?? ev.type ?? "info",
    title: ev.title ?? ev.summary ?? ev.message ?? ev.event_type ?? "event",
    body: ev.body ?? ev.summary ?? ev.message ?? null,
    severity: ev.severity ?? "info",
    metadata: typeof ev.metadata === "object" ? JSON.stringify(ev.metadata) : (ev.metadata ?? "{}"),
    tenant_id: ev.tenant_id ?? null,
  }));

  try {
    await insertAgentEvents(rows);
  } catch (e: any) {
    console.error("[maestro/events] insert error:", e.message);
    return c.json({ error: { message: e.message } }, 500);
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

  try {
    await insertAgentCosts(rows);
  } catch (e: any) {
    console.error("[maestro/costs] insert error:", e.message);
    return c.json({ error: { message: e.message } }, 500);
  }

  for (const row of rows) {
    if (row.agent_slug) {
      await updateAgent(row.agent_slug, { last_action_at: new Date().toISOString() }).catch(() => {});
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

  try {
    await updateAgent(slug, update);
  } catch (e: any) {
    if (e.message === "Agent not found") {
      // Agent row missing — create a minimal record so the heartbeat succeeds.
      try {
        await erpCreate(DT.AGENT, {
          slug,
          agent_name: slug,
          status: update.status ?? "active",
          ...update,
        });
      } catch (createErr: any) {
        return c.json({ error: { message: `Agent not found and could not be created: ${createErr.message}` } }, 500);
      }
    } else {
      return c.json({ error: { message: e.message } }, 500);
    }
  }

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
    metadata: typeof e.metadata === "object" ? JSON.stringify(e.metadata) : (e.metadata ?? "{}"),
    tenant_id: e.tenant_id ?? null,
  }));

  const { insertAuditLog } = await import("../lib/erpnext/agents");
  await insertAuditLog(rows);

  return c.json({ data: { ok: true, count: rows.length } });
});
