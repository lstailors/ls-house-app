// Mission Control — Board / Crons / History
// Auth: super_admin + store_manager
// Data: lsh.* snapshots (Studio writers) — Edge-safe

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { lshSelect, lshInsert, lshUpdate, supabaseConfig } from "../lib/supabase-lsh";
import { mcListActivity, mcListBriefs } from "../lib/mc-data";

export const missionControlRouter = new Hono();

function isMissionControl(role: string): boolean {
  return role === "super_admin" || role === "store_manager";
}

function ageDays(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, (Date.now() - t) / 86_400_000);
}

function mapKanbanRow(r: any) {
  return {
    id: r.task_id,
    title: r.title ?? "",
    body: r.body ?? null,
    assignee: r.assignee ?? null,
    status: r.status ?? "todo",
    priority: Number(r.priority ?? 0),
    age_days: ageDays(r.created_at),
    created_at: r.created_at ?? undefined,
    started_at: r.started_at ?? undefined,
    completed_at: r.completed_at ?? undefined,
    consecutive_failures: Number(r.consecutive_failures ?? 0),
    last_failure_error: r.last_failure_error ?? null,
    block_kind: r.block_kind ?? null,
    result_summary: r.result_summary ?? null,
    parent_ids: r.parent_ids ?? [],
    child_ids: r.child_ids ?? [],
    comment_count: Number(r.comment_count ?? 0),
    latest_comment_at: r.latest_comment_at ?? null,
    latest_comment_author: r.latest_comment_author ?? null,
    latest_comment_body: r.latest_comment_body ?? null,
    snapshot_at: r.snapshot_at ?? null,
  };
}

missionControlRouter.get("/board", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const assignee = c.req.query("assignee") || null;
  const status = c.req.query("status") || null;
  const blockedOnly = c.req.query("blockedOnly") === "true";
  const q = (c.req.query("q") || "").trim().toLowerCase();

  if (!supabaseConfig()) {
    return c.json({
      data: { tasks: [], total: 0, filters: { assignee, status, blockedOnly }, warning: "supabase_not_configured" },
    });
  }

  try {
    const filters: string[] = [];
    if (assignee) filters.push(`assignee=eq.${assignee}`);
    if (status) filters.push(`status=eq.${status}`);
    if (blockedOnly) filters.push(`status=eq.blocked`);

    const rows = await lshSelect<any>("kanban_snapshot", {
      filters,
      order: "priority.desc,created_at.asc",
      limit: 500,
    });

    let tasks = rows.map(mapKanbanRow);
    if (q) {
      tasks = tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.id || "").toLowerCase().includes(q) ||
          (t.assignee || "").toLowerCase().includes(q)
      );
    }

    return c.json({ data: { tasks, total: tasks.length, filters: { assignee, status, blockedOnly } } });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("42P01") || msg.includes("does not exist") || msg.includes("404")) {
      return c.json({
        data: { tasks: [], total: 0, filters: { assignee, status, blockedOnly }, warning: "table_missing" },
      });
    }
    return c.json({ error: { message: msg } }, 500);
  }
});

missionControlRouter.get("/board/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const id = c.req.param("id");
  if (!supabaseConfig()) {
    return c.json({ data: { task: null, comments: [], events: [], parents: [], children: [] } });
  }

  try {
    const rows = await lshSelect<any>("kanban_snapshot", { filters: [`task_id=eq.${id}`], limit: 1 });
    const row = rows[0];
    if (!row) return c.json({ data: { task: null, comments: [], events: [], parents: [], children: [] } });
    const task = mapKanbanRow(row);
    const comments = row.latest_comment_body
      ? [{ author: row.latest_comment_author, body: row.latest_comment_body, created_at: row.latest_comment_at }]
      : [];
    return c.json({
      data: {
        task,
        comments,
        events: [],
        parents: (row.parent_ids as string[]) ?? [],
        children: (row.child_ids as string[]) ?? [],
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "failed" } }, 500);
  }
});

// Queue Hermes kanban action + optimistic snapshot update
missionControlRouter.post("/board/:id/action", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseConfig()) return c.json({ error: { message: "Supabase not configured" } }, 503);

  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({} as any));
  const action = String(body.action || "").toLowerCase();
  const allowed = ["promote", "block", "unblock", "complete", "archive", "schedule", "assign", "comment"];
  if (!allowed.includes(action)) {
    return c.json({ error: { message: `action must be one of ${allowed.join(", ")}` } }, 400);
  }

  const payload: Record<string, unknown> = { ...(body.payload || {}) };
  if (typeof body.reason === "string") payload.reason = body.reason;
  if (typeof body.assignee === "string") payload.assignee = body.assignee;
  if (typeof body.comment === "string") payload.comment = body.comment;

  try {
    const queued = await lshInsert<any>("kanban_commands", {
      task_id: id,
      action,
      payload,
      requested_by: user.email,
      status: "pending",
    });

    const optStatus =
      action === "promote"
        ? "ready"
        : action === "block"
          ? "blocked"
          : action === "unblock"
            ? "todo"
            : action === "complete"
              ? "done"
              : action === "archive"
                ? "archived"
                : action === "schedule"
                  ? "scheduled"
                  : null;

    if (optStatus || action === "assign") {
      await lshUpdate(
        "kanban_snapshot",
        [`task_id=eq.${id}`],
        {
          ...(optStatus ? { status: optStatus } : {}),
          ...(action === "block" ? { block_kind: payload.reason || "human" } : {}),
          ...(action === "complete" ? { completed_at: new Date().toISOString() } : {}),
          ...(action === "assign" && payload.assignee ? { assignee: payload.assignee } : {}),
        }
      );
    }

    return c.json({
      data: { queued: true, command: Array.isArray(queued) ? queued[0] : queued, optimistic_status: optStatus },
    });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "failed" } }, 500);
  }
});

missionControlRouter.get("/crons", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const profile = c.req.query("profile") || c.req.query("agent") || null;
  const color = c.req.query("status") || c.req.query("color") || null;

  if (!supabaseConfig()) {
    return c.json({
      data: { crons: [], summary: { green: 0, amber: 0, red: 0, total: 0 }, warning: "supabase_not_configured" },
    });
  }

  try {
    const filters: string[] = [];
    if (profile) filters.push(`profile=eq.${profile}`);
    if (color) filters.push(`health_color=eq.${color}`);

    const rows = await lshSelect<any>("cron_health", {
      filters,
      order: "health_color.desc,profile.asc,job_name.asc",
      limit: 500,
    });

    const crons = rows.map((r) => ({
      id: `${r.profile}:${r.job_id}`,
      profile: r.profile,
      agent_slug: r.profile,
      job_id: r.job_id,
      job_name: r.job_name,
      enabled: !!r.enabled,
      status: r.health_color as "green" | "amber" | "red",
      health_reasons: r.health_reasons ?? [],
      last_status: r.last_status,
      last_run_at: r.last_run_at,
      next_run_at: r.next_run_at,
      last_error: r.last_error,
      last_delivery_error: r.last_delivery_error,
      model: r.model,
      model_snapshot: r.model_snapshot,
      model_drift: !!r.model_drift,
      stale: !!r.stale,
      schedule_display: r.schedule_display,
      snapshot_at: r.snapshot_at,
    }));

    const summary = {
      green: crons.filter((x) => x.status === "green").length,
      amber: crons.filter((x) => x.status === "amber").length,
      red: crons.filter((x) => x.status === "red").length,
      total: crons.length,
    };

    return c.json({ data: { crons, summary } });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("42P01") || msg.includes("does not exist") || msg.includes("404")) {
      return c.json({
        data: { crons: [], summary: { green: 0, amber: 0, red: 0, total: 0 }, warning: "table_missing" },
      });
    }
    return c.json({ error: { message: msg } }, 500);
  }
});

missionControlRouter.get("/history", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const agent = c.req.query("agent") || null;
  const from = c.req.query("from") || null;
  const to = c.req.query("to") || null;
  const q = (c.req.query("q") || "").trim().toLowerCase();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "80", 10) || 80, 200);

  type Entry = {
    id: string;
    ts: string;
    agent_slug: string | null;
    kind: string;
    title: string;
    snippet: string | null;
    body?: string | null;
    doc_ref?: string | null;
    metadata?: Record<string, unknown>;
    source?: string;
  };

  const entries: Entry[] = [];

  try {
    const act = await mcListActivity({ agentSlug: agent ?? undefined, limit: Math.min(limit * 2, 300) });
    for (const e of act as any[]) {
      entries.push({
        id: String(e.id),
        ts: e.created_at,
        agent_slug: e.agent_slug ?? null,
        kind: e.kind || e.event_type || "event",
        title: e.title || e.kind || "activity",
        snippet: e.body ? String(e.body).slice(0, 280) : null,
        body: e.body ?? null,
        metadata: e.metadata || {},
        source: e.source,
        doc_ref: e.ref || null,
      });
    }
  } catch (e: any) {
    console.error("[mission-control/history] activity", e?.message);
  }

  try {
    const briefs = await mcListBriefs(40);
    for (const b of briefs as any[]) {
      if (agent && b.source && b.source !== agent && b.agent_slug && b.agent_slug !== agent) continue;
      entries.push({
        id: `brief:${b.id}`,
        ts: b.created_at,
        agent_slug: b.agent_slug || b.source || null,
        kind: "brief",
        title: b.title || "brief",
        snippet: b.body ? String(b.body).slice(0, 280) : null,
        body: b.body ?? null,
        metadata: { type: b.type, source: b.source },
        source: "brief",
      });
    }
  } catch (e: any) {
    console.error("[mission-control/history] briefs", e?.message);
  }

  let filtered = entries.filter((e) => e.ts);
  if (from) filtered = filtered.filter((e) => e.ts >= from);
  if (to) filtered = filtered.filter((e) => e.ts <= to);
  if (q) {
    filtered = filtered.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.snippet || "").toLowerCase().includes(q) ||
        (e.body || "").toLowerCase().includes(q) ||
        (e.agent_slug || "").toLowerCase().includes(q)
    );
  }

  filtered.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const page = filtered.slice(0, limit);

  return c.json({
    data: {
      entries: page,
      hasMore: filtered.length > limit,
      query: { agent, from, to, q, limit },
    },
  });
});

export default missionControlRouter;
