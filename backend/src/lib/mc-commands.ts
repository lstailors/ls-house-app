// Unified MC command queue helpers (SPEC 066 / SPEC 069).
// Prefers lsh.mc_commands when present; falls back to lsh.kanban_commands
// (live today) with chat_run fields stored in payload.

import { lshInsert, lshSelect, lshUpdate, supabaseConfig } from "./supabase-lsh";

export type UiCommandStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "timeout"
  | "cancelled";

export type AgentCommandView = {
  id: string;
  agent_slug: string;
  command: string;
  status: UiCommandStatus;
  session_id: string | null;
  pid: number | string | null;
  started_at: string | null;
  finished_at: string | null;
  result: string | null;
  format: "code" | "prose" | null;
  error: string | null;
  created_at: string | null;
  timeout_s: number;
  source_table: "mc_commands" | "kanban_commands";
};

const DEFAULT_TIMEOUT_S = 180;

let cachedTable: "mc_commands" | "kanban_commands" | null = null;

export async function resolveCommandsTable(): Promise<"mc_commands" | "kanban_commands"> {
  if (cachedTable) return cachedTable;
  if (!supabaseConfig()) throw new Error("Supabase not configured");
  try {
    await lshSelect("mc_commands", { limit: 1 });
    cachedTable = "mc_commands";
  } catch {
    cachedTable = "kanban_commands";
  }
  return cachedTable;
}

/** Reset cache (tests / after migration apply). */
export function clearCommandsTableCache() {
  cachedTable = null;
}

function parsePayload(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as Record<string, any>;
  return {};
}

function mapDbStatus(db: string | null | undefined, payload: Record<string, any>): UiCommandStatus {
  if (payload.ui_timeout) return "timeout";
  switch (db) {
    case "pending":
      return "queued";
    case "leased":
    case "running":
      return "running";
    case "applied":
    case "done":
      return "done";
    case "failed":
      return "error";
    case "cancelled":
      return "cancelled";
    case "timeout":
      return "timeout";
    default:
      return "queued";
  }
}

export function mapCommandRow(row: any, table: "mc_commands" | "kanban_commands"): AgentCommandView {
  const payload = parsePayload(row.payload);
  const agentSlug =
    table === "mc_commands"
      ? String(row.target_id || payload.agent_slug || "")
      : String(row.task_id || payload.agent_slug || "");
  const command = String(payload.prompt ?? payload.command ?? "");
  const formatRaw = payload.format;
  const format =
    formatRaw === "code" || formatRaw === "prose"
      ? formatRaw
      : typeof payload.result === "string" && looksLikeCode(payload.result)
        ? "code"
        : payload.result
          ? "prose"
          : null;

  return {
    id: String(row.id),
    agent_slug: agentSlug,
    command,
    status: mapDbStatus(row.status, payload),
    session_id: payload.session_id ?? row.session_id ?? null,
    pid: payload.pid ?? row.pid ?? null,
    started_at: payload.started_at ?? row.leased_at ?? row.started_at ?? null,
    finished_at: row.applied_at ?? payload.finished_at ?? null,
    result: typeof payload.result === "string" ? payload.result : null,
    format,
    error: row.error ?? payload.error ?? null,
    created_at: row.created_at ?? null,
    timeout_s: Number(payload.timeout_s) > 0 ? Number(payload.timeout_s) : DEFAULT_TIMEOUT_S,
    source_table: table,
  };
}

function looksLikeCode(text: string): boolean {
  if (text.length > 400) return true;
  if (text.includes("\n") && /[{}\[\]`$]|^\s{2,}\S/m.test(text)) return true;
  if (/^(error|trace|fail|ok|done|status)[:\s]/im.test(text) && text.includes("\n")) return true;
  return false;
}

export async function enqueueChatCommand(opts: {
  slug: string;
  prompt: string;
  requestedBy: string;
  idempotencyKey?: string | null;
  timeoutS?: number;
}): Promise<AgentCommandView> {
  const table = await resolveCommandsTable();
  const prompt = opts.prompt.trim().slice(0, 4000);
  if (!prompt) throw new Error("prompt is required");

  // One-in-flight guard: pending/leased chat for this agent blocks a new send.
  const inflight = await listInflightChat(opts.slug);
  if (inflight) {
    const err = new Error("A command is already in flight for this agent") as Error & {
      code?: string;
      existing?: AgentCommandView;
    };
    err.code = "in_flight";
    err.existing = inflight;
    throw err;
  }

  const timeout_s = opts.timeoutS && opts.timeoutS > 0 ? opts.timeoutS : DEFAULT_TIMEOUT_S;
  const payload = {
    kind: "chat_run",
    prompt,
    agent_slug: opts.slug,
    timeout_s,
    session_id: null as string | null,
    pid: null as number | null,
    result: null as string | null,
    format: null as string | null,
    started_at: null as string | null,
  };

  if (table === "mc_commands") {
    const row: Record<string, unknown> = {
      kind: "chat_run",
      action: "send",
      target_id: opts.slug,
      payload,
      requested_by: opts.requestedBy,
      origin_surface: "mission_control",
      status: "pending",
    };
    if (opts.idempotencyKey) row.idempotency_key = opts.idempotencyKey;
    const inserted = await lshInsert<any>("mc_commands", row);
    const rec = Array.isArray(inserted) ? inserted[0] : inserted;
    if (!rec) throw new Error("enqueue failed — empty insert");
    return mapCommandRow(rec, "mc_commands");
  }

  const inserted = await lshInsert<any>("kanban_commands", {
    task_id: opts.slug,
    action: "chat_send",
    payload,
    requested_by: opts.requestedBy,
    status: "pending",
  });
  const rec = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!rec) throw new Error("enqueue failed — empty insert");
  return mapCommandRow(rec, "kanban_commands");
}

async function listInflightChat(slug: string): Promise<AgentCommandView | null> {
  const table = await resolveCommandsTable();
  if (table === "mc_commands") {
    const rows = await lshSelect<any>("mc_commands", {
      filters: [
        `kind=eq.chat_run`,
        `target_id=eq.${slug}`,
        `status=in.(pending,leased,running)`,
      ],
      order: "created_at.desc",
      limit: 1,
    });
    return rows[0] ? mapCommandRow(rows[0], "mc_commands") : null;
  }
  // kanban_commands: action=chat_send, task_id=slug
  const rows = await lshSelect<any>("kanban_commands", {
    filters: [
      `action=eq.chat_send`,
      `task_id=eq.${slug}`,
      `status=in.(pending,leased,running)`,
    ],
    order: "created_at.desc",
    limit: 1,
  });
  return rows[0] ? mapCommandRow(rows[0], "kanban_commands") : null;
}

export async function getChatCommand(id: string): Promise<AgentCommandView | null> {
  const table = await resolveCommandsTable();
  const rows = await lshSelect<any>(table, {
    filters: [`id=eq.${id}`],
    limit: 1,
  });
  if (!rows[0]) return null;
  return mapCommandRow(rows[0], table);
}

export async function cancelChatCommand(
  id: string,
  opts?: { reason?: string }
): Promise<AgentCommandView> {
  const table = await resolveCommandsTable();
  const existing = await getChatCommand(id);
  if (!existing) {
    const err = new Error("Command not found") as Error & { code?: string };
    err.code = "not_found";
    throw err;
  }
  if (["done", "error", "timeout", "cancelled"].includes(existing.status)) {
    return existing;
  }

  // SPEC 069: cancel must work during running (not only pending).
  // Mark cancelled + flag payload so the worker can short-circuit if still mid-flight.
  const row = (
    await lshSelect<any>(table, { filters: [`id=eq.${id}`], limit: 1 })
  )[0];
  const payload = {
    ...parsePayload(row?.payload),
    cancelled_by_user: true,
    cancel_reason: opts?.reason || "Cancelled from Mission Control",
  };

  await lshUpdate(table, [`id=eq.${id}`], {
    status: "cancelled",
    error: null,
    payload,
    applied_at: new Date().toISOString(),
  });

  const updated = await getChatCommand(id);
  if (!updated) throw new Error("cancel failed");
  return updated;
}

export async function latestChatCommand(slug: string): Promise<AgentCommandView | null> {
  const table = await resolveCommandsTable();
  if (table === "mc_commands") {
    const rows = await lshSelect<any>("mc_commands", {
      filters: [`kind=eq.chat_run`, `target_id=eq.${slug}`],
      order: "created_at.desc",
      limit: 1,
    });
    return rows[0] ? mapCommandRow(rows[0], "mc_commands") : null;
  }
  const rows = await lshSelect<any>("kanban_commands", {
    filters: [`action=eq.chat_send`, `task_id=eq.${slug}`],
    order: "created_at.desc",
    limit: 1,
  });
  return rows[0] ? mapCommandRow(rows[0], "kanban_commands") : null;
}
