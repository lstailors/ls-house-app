import { erpList, erpGet, erpCreate, erpUpdate } from "../erp";
import { DT } from "./doctypes";

export async function getAgentBySlug(slug: string) {
  // Live ERP seeded hermes as "Hermes (Maestro)" — FE routes use /agents/maestro.
  const aliases = slug === "maestro" ? ["maestro", "hermes"] : slug === "hermes" ? ["hermes", "maestro"] : [slug];
  for (const s of aliases) {
    const rows = await erpList<any>(DT.AGENT, {
      filters: [["slug", "=", s]],
      limit: 1,
    });
    if (rows[0]) {
      if (slug === "maestro" && rows[0].slug !== "maestro") {
        return {
          ...rows[0],
          slug: "maestro",
          agent_name: rows[0].agent_name?.includes("Maestro") ? "Maestro" : (rows[0].agent_name || "Maestro"),
          // keep ERP doc name (hermes) for writes
        };
      }
      return rows[0];
    }
  }
  return null;
}

export async function listAgents() {
  const rows = await erpList<any>(DT.AGENT, {
    fields: [
      "name", "slug", "agent_name", "role", "description", "status", "model", "platform",
      "color", "icon", "current_task", "current_task_since", "last_action_at",
      "last_action_summary", "last_heartbeat_at", "health_score", "settings", "stats",
      "enabled", "creation", "modified",
    ],
    order_by: "agent_name asc",
    limit: 50,
  });
  // Surface Maestro under the slug the FE expects, even when ERP name is hermes.
  const hasMaestro = rows.some((x: any) => x.slug === "maestro");
  return rows.map((r: any) => {
    if (!hasMaestro && r.slug === "hermes") {
      return {
        ...r,
        slug: "maestro",
        agent_name: r.agent_name?.includes("Maestro") ? "Maestro" : (r.agent_name || "Maestro"),
        // keep ERP name = hermes for updates
      };
    }
    return r;
  });
}

export async function updateAgent(slug: string, update: Record<string, unknown>) {
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new Error("Agent not found");
  return erpUpdate(DT.AGENT, agent.name, update);
}

export async function listAgentTasks(opts: { assignedTo?: string; status?: string[]; since?: string; limit?: number } = {}) {
  const filters: unknown[] = [];
  if (opts.assignedTo) filters.push(["assigned_to", "=", opts.assignedTo]);
  if (opts.status?.length) filters.push(["status", "in", opts.status]);
  if (opts.since) filters.push(["creation", ">=", opts.since]);
  return erpList<any>(DT.AGENT_TASK, {
    filters,
    order_by: "creation desc",
    limit: opts.limit ?? 100,
  });
}

export async function createAgentTask(doc: Record<string, unknown>) {
  return erpCreate(DT.AGENT_TASK, doc);
}

export async function updateAgentTask(name: string, doc: Record<string, unknown>) {
  return erpUpdate(DT.AGENT_TASK, name, doc);
}

export async function listAgentEvents(opts: { agentSlug?: string; limit?: number } = {}) {
  const filters: unknown[] = [];
  if (opts.agentSlug) filters.push(["agent_slug", "=", opts.agentSlug]);
  return erpList<any>(DT.AGENT_EVENT, {
    filters,
    order_by: "creation desc",
    limit: opts.limit ?? 100,
  });
}

export async function insertAgentEvents(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    await erpCreate(DT.AGENT_EVENT, row).catch((e) => console.error("[agents] event insert:", e.message));
  }
}

export async function listApprovalQueue(opts: { status?: string[]; limit?: number } = {}) {
  const filters: unknown[] = [];
  if (opts.status?.length) filters.push(["status", "in", opts.status]);
  return erpList<any>(DT.APPROVAL_QUEUE, {
    filters,
    order_by: "creation desc",
    limit: opts.limit ?? 50,
  });
}

export async function getApprovalItem(id: string) {
  return erpGet<any>(DT.APPROVAL_QUEUE, id);
}

export async function updateApprovalItem(id: string, doc: Record<string, unknown>) {
  return erpUpdate(DT.APPROVAL_QUEUE, id, doc);
}

export async function insertApprovalDecision(doc: Record<string, unknown>) {
  return erpCreate(DT.APPROVAL_DECISION, doc);
}

export async function listAgentBriefs(opts: { period?: string; limit?: number } = {}) {
  const filters: unknown[] = [];
  if (opts.period) filters.push(["period", "=", opts.period]);
  return erpList<any>(DT.AGENT_BRIEF, {
    filters,
    order_by: "creation desc",
    limit: opts.limit ?? 20,
  });
}

export async function insertAgentBrief(doc: Record<string, unknown>) {
  return erpCreate(DT.AGENT_BRIEF, doc);
}

export async function insertAgentCosts(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    await erpCreate(DT.AGENT_COST, row).catch(() => {});
  }
}

export async function insertAuditLog(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    await erpCreate(DT.AUDIT_LOG, row).catch(() => {});
  }
}

export async function insertSmsMessage(doc: Record<string, unknown>) {
  return erpCreate(DT.SMS_MESSAGE, doc);
}

export async function listSmsMessages(opts: { phone?: string; limit?: number } = {}) {
  const filters: unknown[] = [];
  if (opts.phone) filters.push(["client_phone", "=", opts.phone]);
  return erpList<any>(DT.SMS_MESSAGE, {
    filters,
    order_by: "creation desc",
    limit: opts.limit ?? 100,
  });
}

export async function insertCallLog(doc: Record<string, unknown>) {
  return erpCreate(DT.CALL_LOG, doc);
}

export async function insertBrainEntry(doc: Record<string, unknown>) {
  return erpCreate(DT.BRAIN_ENTRY, doc);
}

export async function listBrainEntries(opts: { limit?: number } = {}) {
  return erpList<any>(DT.BRAIN_ENTRY, {
    order_by: "creation desc",
    limit: opts.limit ?? 50,
  });
}

export async function insertPendingEmailDraft(doc: Record<string, unknown>) {
  return erpCreate(DT.PENDING_EMAIL_DRAFT, doc);
}

export async function getPendingEmailDraft(id: string) {
  return erpGet<any>(DT.PENDING_EMAIL_DRAFT, id);
}

export async function listPendingEmailDrafts(opts: { status?: string; inbox?: string; limit?: number } = {}) {
  const filters: unknown[] = [];
  if (opts.status) filters.push(["status", "=", opts.status]);
  if (opts.inbox) filters.push(["inbox", "=", opts.inbox]);
  return erpList<any>(DT.PENDING_EMAIL_DRAFT, { filters, order_by: "creation desc", limit: opts.limit ?? 20 });
}

export async function listAgentCosts(opts: { since?: string; limit?: number } = {}) {
  const filters: unknown[] = [];
  if (opts.since) filters.push(["day", ">=", opts.since]);
  return erpList<any>(DT.AGENT_COST, {
    filters,
    fields: ["name", "agent_slug", "model", "input_tokens", "output_tokens", "cost_usd", "day", "creation"],
    order_by: "day desc",
    limit: opts.limit ?? 500,
  });
}

export async function listCronJobs() {
  return erpList<any>(DT.CRON_JOB, { order_by: "job_name asc", limit: 100 });
}

export async function updateCronJob(name: string, doc: Record<string, unknown>) {
  return erpUpdate(DT.CRON_JOB, name, doc);
}

export async function listAuditLogs(opts: { agentSlug?: string; limit?: number } = {}) {
  const filters: unknown[] = [];
  if (opts.agentSlug) filters.push(["agent_slug", "=", opts.agentSlug]);
  return erpList<any>(DT.AUDIT_LOG, {
    filters,
    order_by: "creation desc",
    limit: opts.limit ?? 100,
  });
}

export async function listAgentMessages(opts: { agentSlug: string; limit?: number }) {
  return erpList<any>(DT.AGENT_MESSAGE, {
    filters: [["agent_slug", "=", opts.agentSlug]],
    fields: ["name", "role", "content", "creation"],
    order_by: "creation asc",
    limit: opts.limit ?? 50,
  });
}

export async function insertAgentMessage(doc: Record<string, unknown>) {
  return erpCreate(DT.AGENT_MESSAGE, doc);
}

export async function listCallLogs(opts: {
  limit?: number;
  since?: string;
  phone?: string;
  orderBy?: string;
} = {}) {
  const filters: unknown[] = [];
  if (opts.since) filters.push(["time", ">=", opts.since]);
  if (opts.phone) filters.push(["from", "=", opts.phone]);
  return erpList<any>(DT.CALL_LOG, {
    filters,
    fields: [
      "name",
      "external_id",
      "time",
      "from",
      "from_caller_name",
      "to",
      "direction",
      "duration",
      "status",
      "transcript_raw",
      "transcript_whisper",
      "recording",
      "creation",
    ],
    order_by: opts.orderBy ?? "time desc",
    limit: opts.limit ?? 100,
  });
}

export async function getCallLog(id: string) {
  return erpGet<any>(DT.CALL_LOG, id);
}

export async function updateCallLog(id: string, doc: Record<string, unknown>) {
  return erpUpdate(DT.CALL_LOG, id, doc);
}

export async function upsertCallLog(doc: Record<string, unknown>, keyField = "external_id") {
  const { storeUpsert } = await import("./store");
  return storeUpsert(DT.CALL_LOG, doc, keyField);
}

export async function listPlaudCaptures(opts: { limit?: number; since?: string } = {}) {
  const filters: unknown[] = [];
  if (opts.since) filters.push(["recorded_at", ">=", opts.since]);
  return erpList<any>(DT.PLAUD_CAPTURE, {
    filters,
    order_by: "recorded_at desc",
    limit: opts.limit ?? 50,
  });
}

export async function getPlaudCapture(id: string) {
  return erpGet<any>(DT.PLAUD_CAPTURE, id);
}

export async function listBrainEntriesFiltered(opts: {
  agentSlug?: string;
  entryTypes?: string[];
  summaryLike?: string;
  limit?: number;
  orderBy?: string;
} = {}) {
  const filters: unknown[] = [];
  if (opts.agentSlug) filters.push(["agent_slug", "=", opts.agentSlug]);
  if (opts.entryTypes?.length) filters.push(["entry_type", "in", opts.entryTypes]);
  if (opts.summaryLike) filters.push(["summary", "like", `%${opts.summaryLike}%`]);
  return erpList<any>(DT.BRAIN_ENTRY, {
    filters,
    order_by: opts.orderBy ?? "creation desc",
    limit: opts.limit ?? 50,
  });
}

export async function listSmsMessagesFiltered(opts: {
  phone?: string;
  contentLike?: string;
  twilioSid?: string;
  limit?: number;
  ascending?: boolean;
} = {}) {
  const filters: unknown[] = [];
  if (opts.phone) filters.push(["client_phone", "=", opts.phone]);
  if (opts.contentLike) filters.push(["content", "like", `%${opts.contentLike}%`]);
  if (opts.twilioSid) filters.push(["twilio_sid", "=", opts.twilioSid]);
  return erpList<any>(DT.SMS_MESSAGE, {
    filters,
    fields: [
      "name",
      "client_phone",
      "client_name",
      "customer",
      "direction",
      "content",
      "body",
      "sender",
      "timestamp",
      "twilio_sid",
      "status",
      "reference_doctype",
      "reference_name",
      "context_tag",
      "creation",
      "modified",
    ],
    order_by: opts.ascending ? "timestamp asc" : "timestamp desc",
    limit: opts.limit ?? 100,
  });
}

export async function findSmsByTwilioSid(sid: string) {
  const rows = await listSmsMessagesFiltered({ twilioSid: sid, limit: 1 });
  return rows[0] ?? null;
}

export async function listAgentBriefsFiltered(opts: {
  source?: string;
  type?: string;
  limit?: number;
} = {}) {
  const filters: unknown[] = [];
  if (opts.source) filters.push(["source", "=", opts.source]);
  if (opts.type) filters.push(["type", "=", opts.type]);
  return erpList<any>(DT.AGENT_BRIEF, {
    filters,
    order_by: "creation desc",
    limit: opts.limit ?? 20,
  });
}
