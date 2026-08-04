// SPEC 067 — Mission Control Approvals
// Dual-source read: LSH Agent Approval (canonical) + LSH Approval Queue (legacy)
// Decide: enqueue lsh.mc_commands (kind=approval) + apply immediately for snappy UX.

import {
  listAgentApprovals,
  getAgentApproval,
  updateAgentApproval,
  listApprovalQueue,
  getApprovalItem,
  updateApprovalItem,
  insertApprovalDecision,
} from "./erpnext/agents";
import { lshInsert, supabaseConfig } from "./supabase-lsh";

export type McApprovalSource = "agent_approval" | "queue";

export type McApproval = {
  id: string;
  source: McApprovalSource;
  agent: string;
  action_type: string;
  summary: string;
  status: string; // Pending | Approved | Denied | Expired | Executed | awaiting_second | shadow_review
  risk_level: "Low" | "Medium" | "High" | null;
  amount: number | null;
  short_code: string | null;
  requested_at: string | null;
  expires_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_channel: string | null;
  decision_note: string | null;
  payload: unknown;
  reference_doctype: string | null;
  reference_name: string | null;
  /** legacy queue only */
  category: string | null;
  priority: string | null;
  on_approve_action: string | null;
};

const QUEUE_STATUS_MAP: Record<string, string> = {
  pending: "Pending",
  awaiting_second: "Pending",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
  cancelled: "Expired",
  revised: "Pending",
  shadow_review: "Pending",
  executed: "Executed",
};

const PRIORITY_TO_RISK: Record<string, "Low" | "Medium" | "High"> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "High",
  critical: "High",
};

function parsePayload(raw: unknown): unknown {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function amountFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const a = p.amount ?? p.total ?? p.grand_total ?? p.outstanding;
  if (typeof a === "number" && !Number.isNaN(a)) return a;
  if (typeof a === "string" && a.trim() && !Number.isNaN(Number(a))) return Number(a);
  return null;
}

export function mapAgentApproval(row: any): McApproval {
  return {
    id: String(row.name),
    source: "agent_approval",
    agent: String(row.agent || "Other"),
    action_type: String(row.action_type || "action"),
    summary: String(row.summary || ""),
    status: String(row.status || "Pending"),
    risk_level: (row.risk_level as McApproval["risk_level"]) || "Medium",
    amount:
      row.amount == null || row.amount === ""
        ? null
        : Number(row.amount),
    short_code: row.short_code ?? null,
    requested_at: row.requested_at || row.creation || null,
    expires_at: row.expires_at || null,
    decided_at: row.decided_at || null,
    decided_by: row.decided_by || null,
    decision_channel: row.decision_channel || null,
    decision_note: row.decision_note || null,
    payload: parsePayload(row.payload),
    reference_doctype: row.reference_doctype || null,
    reference_name: row.reference_name || null,
    category: null,
    priority: null,
    on_approve_action: null,
  };
}

export function mapQueueApproval(row: any): McApproval {
  const payload = parsePayload(row.payload);
  const statusRaw = String(row.status || "pending").toLowerCase();
  const priority = String(row.priority || "medium").toLowerCase();
  return {
    id: String(row.name || row.id),
    source: "queue",
    agent: String(row.agent_slug || row.source_agent || row.requested_by || "Other"),
    action_type: String(row.category || row.action_type || "action"),
    summary: String(row.summary || row.title || ""),
    status: QUEUE_STATUS_MAP[statusRaw] || "Pending",
    risk_level: PRIORITY_TO_RISK[priority] || "Medium",
    amount: amountFromPayload(payload),
    short_code: null,
    requested_at: row.creation || row.created_at || row.requested_at || null,
    expires_at: row.expires_at || null,
    decided_at: row.decided_at || null,
    decided_by: row.decided_by || null,
    decision_channel: row.decision_channel || null,
    decision_note: row.decision_note || null,
    payload,
    reference_doctype: row.reference_doctype || null,
    reference_name: row.reference_name || null,
    category: row.category ?? null,
    priority: row.priority ?? null,
    on_approve_action: row.on_approve_action ?? null,
  };
}

function isQueuePending(status: string): boolean {
  const s = status.toLowerCase();
  return s === "pending" || s === "awaiting_second" || s === "revised";
}

function isAgentPending(status: string): boolean {
  return String(status).toLowerCase() === "pending";
}

export async function mcListUnifiedApprovals(opts: {
  view: "queue" | "history";
  risk?: string | null;
  agent?: string | null;
  financialOnly?: boolean;
  q?: string | null;
  days?: number;
  outcome?: string | null;
  limit?: number;
}): Promise<{ items: McApproval[]; total: number; sources: Record<string, number> }> {
  const limit = opts.limit ?? 100;
  const days = opts.days ?? (opts.view === "history" ? 30 : 3650);
  const since =
    days < 3650
      ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace("T", " ")
      : undefined;

  const [agentRows, queueRows] = await Promise.all([
    listAgentApprovals({
      status:
        opts.view === "queue"
          ? ["Pending"]
          : ["Approved", "Denied", "Expired", "Executed"],
      limit,
      since: opts.view === "history" ? since : undefined,
    }).catch(() => [] as any[]),
    listApprovalQueue({
      status:
        opts.view === "queue"
          ? ["pending", "awaiting_second"]
          : ["approved", "denied", "expired", "cancelled"],
      limit,
    }).catch(() => [] as any[]),
  ]);

  let items: McApproval[] = [
    ...agentRows.map(mapAgentApproval),
    ...queueRows.map(mapQueueApproval),
  ];

  // History date filter for queue (no since filter on list)
  if (opts.view === "history" && since) {
    const cutoff = Date.parse(since.replace(" ", "T") + "Z") || Date.parse(since);
    items = items.filter((i) => {
      const t = Date.parse(i.decided_at || i.requested_at || "") || 0;
      return !cutoff || t >= cutoff;
    });
  }

  if (opts.risk) {
    const r = opts.risk.toLowerCase();
    items = items.filter((i) => (i.risk_level || "").toLowerCase() === r);
  }
  if (opts.agent) {
    const a = opts.agent.toLowerCase();
    items = items.filter((i) => i.agent.toLowerCase() === a || i.agent.toLowerCase().includes(a));
  }
  if (opts.financialOnly) {
    items = items.filter((i) => i.amount != null && Number(i.amount) !== 0);
  }
  if (opts.outcome && opts.view === "history") {
    const o = opts.outcome.toLowerCase();
    items = items.filter((i) => i.status.toLowerCase() === o);
  }
  if (opts.q) {
    const q = opts.q.toLowerCase();
    items = items.filter(
      (i) =>
        i.summary.toLowerCase().includes(q) ||
        i.action_type.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q) ||
        i.agent.toLowerCase().includes(q)
    );
  }

  // Risk then recency
  const riskW: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
  items.sort((a, b) => {
    const rw = (riskW[b.risk_level || ""] || 0) - (riskW[a.risk_level || ""] || 0);
    if (rw) return rw;
    const ta = Date.parse(a.requested_at || "") || 0;
    const tb = Date.parse(b.requested_at || "") || 0;
    return tb - ta;
  });

  const sources = {
    agent_approval: items.filter((i) => i.source === "agent_approval").length,
    queue: items.filter((i) => i.source === "queue").length,
  };

  return { items: items.slice(0, limit), total: items.length, sources };
}

async function enqueueApprovalCommand(opts: {
  id: string;
  action: "approve" | "reject" | "edit";
  createdBy: string;
  notes?: string;
  payload?: unknown;
  source: McApprovalSource;
}) {
  if (!supabaseConfig()) return null;
  try {
    const row = await lshInsert<any>("mc_commands", {
      kind: "approval",
      action: opts.action,
      target_id: opts.id,
      payload: {
        source: opts.source,
        notes: opts.notes || null,
        edited_payload: opts.payload ?? null,
        decision_channel: "API",
      },
      status: "pending",
      created_by: opts.createdBy,
    });
    return row;
  } catch (e) {
    console.error("[mc-approvals] enqueue", (e as Error).message);
    return null;
  }
}

export async function mcDecideApproval(opts: {
  id: string;
  action: "approve" | "reject" | "edit_approve";
  user: { name?: string; email?: string; role: string };
  notes?: string;
  payload?: unknown;
}): Promise<{ ok: true; item: McApproval; command_id: string | null } | { ok: false; error: string; status: number }> {
  const { id, action, user } = opts;
  const decidedBy = user.name || user.email || "mission-control";
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  // Prefer LSH Agent Approval
  let agentDoc: any = null;
  try {
    agentDoc = await getAgentApproval(id);
  } catch {
    agentDoc = null;
  }

  if (agentDoc?.name) {
    if (!isAgentPending(agentDoc.status)) {
      return { ok: false, error: `Item is already ${agentDoc.status}`, status: 409 };
    }
    const verb = action === "reject" ? "reject" : action === "edit_approve" ? "edit" : "approve";
    const cmd = await enqueueApprovalCommand({
      id,
      action: verb,
      createdBy: decidedBy,
      notes: opts.notes,
      payload: opts.payload,
      source: "agent_approval",
    });

    const newStatus = action === "reject" ? "Denied" : "Approved";
    const update: Record<string, unknown> = {
      status: newStatus,
      decided_at: now,
      decided_by: decidedBy,
      decision_channel: "API",
      decision_note: opts.notes || null,
    };
    if ((action === "edit_approve" || action === "approve") && opts.payload !== undefined) {
      update.payload =
        typeof opts.payload === "string" ? opts.payload : JSON.stringify(opts.payload);
    }
    try {
      await updateAgentApproval(id, update);
    } catch (e: any) {
      return { ok: false, error: e?.message || "ERP update failed", status: 500 };
    }
    const fresh = await getAgentApproval(id);
    return {
      ok: true,
      item: mapAgentApproval(fresh || { ...agentDoc, ...update, name: id }),
      command_id: cmd?.id ? String(cmd.id) : null,
    };
  }

  // Legacy LSH Approval Queue
  let queueDoc: any = null;
  try {
    queueDoc = await getApprovalItem(id);
  } catch {
    queueDoc = null;
  }
  if (!queueDoc?.name) {
    return { ok: false, error: "Not found", status: 404 };
  }
  if (String(queueDoc.status).toLowerCase() === "shadow_review") {
    return { ok: false, error: "Shadow review items are observation-only", status: 403 };
  }
  if (!isQueuePending(queueDoc.status) && action !== "reject") {
    // allow reject only if pending-ish
    if (!["pending", "awaiting_second", "revised"].includes(String(queueDoc.status).toLowerCase())) {
      return { ok: false, error: `Item is already ${queueDoc.status}`, status: 409 };
    }
  }
  if (queueDoc.category === "financial" && user.role !== "super_admin" && user.role !== "store_manager") {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  const verb = action === "reject" ? "reject" : action === "edit_approve" ? "edit" : "approve";
  const cmd = await enqueueApprovalCommand({
    id,
    action: verb,
    createdBy: decidedBy,
    notes: opts.notes,
    payload: opts.payload,
    source: "queue",
  });

  const newStatus = action === "reject" ? "denied" : "approved";
  const update: Record<string, unknown> = { status: newStatus };
  if (opts.payload !== undefined && action !== "reject") {
    update.payload =
      typeof opts.payload === "string" ? opts.payload : JSON.stringify(opts.payload);
  }
  try {
    await updateApprovalItem(id, update);
    await insertApprovalDecision({
      approval_id: id,
      decided_by_name: user.name,
      decided_by_email: user.email,
      decision: newStatus === "approved" ? "approved" : "denied",
      notes: opts.notes,
    }).catch(() => null);
  } catch (e: any) {
    return { ok: false, error: e?.message || "Queue update failed", status: 500 };
  }

  const fresh = await getApprovalItem(id);
  return {
    ok: true,
    item: mapQueueApproval(fresh || { ...queueDoc, ...update, name: id }),
    command_id: cmd?.id ? String(cmd.id) : null,
  };
}
