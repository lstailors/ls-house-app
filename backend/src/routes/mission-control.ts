// Mission Control — Board / Crons / History (read-only v1)
// Auth: super_admin + store_manager
// Data: lsh.kanban_snapshot + lsh.cron_health (Studio writers) + ERP agent events/briefs

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { lshSelect, supabaseConfig } from "../lib/supabase-lsh";
import { listAgentEvents, listAgentBriefs, listAuditLogs } from "../lib/erpnext/agents";

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

// ─── GET /api/mission-control/board ────────────────────────────────────────────
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
      data: {
        tasks: [],
        total: 0,
        filters: { assignee, status, blockedOnly },
        warning: "supabase_not_configured",
      },
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

    return c.json({
      data: {
        tasks,
        total: tasks.length,
        filters: { assignee, status, blockedOnly },
      },
    });
  } catch (e: any) {
    // Table missing until migration applied — soft empty
    const msg = String(e?.message || e);
    if (msg.includes("42P01") || msg.includes("does not exist") || msg.includes("404")) {
      return c.json({
        data: { tasks: [], total: 0, filters: { assignee, status, blockedOnly }, warning: "table_missing" },
      });
    }
    console.error("[mission-control/board]", msg);
    return c.json({ error: { message: msg } }, 500);
  }
});

// ─── GET /api/mission-control/board/:id ────────────────────────────────────────
missionControlRouter.get("/board/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const id = c.req.param("id");
  if (!supabaseConfig()) {
    return c.json({ data: { task: null, comments: [], events: [], parents: [], children: [] } });
  }

  try {
    const rows = await lshSelect<any>("kanban_snapshot", {
      filters: [`task_id=eq.${id}`],
      limit: 1,
    });
    const row = rows[0];
    if (!row) return c.json({ data: { task: null, comments: [], events: [], parents: [], children: [] } });

    const task = mapKanbanRow(row);
    const comments =
      row.latest_comment_body
        ? [
            {
              author: row.latest_comment_author,
              body: row.latest_comment_body,
              created_at: row.latest_comment_at,
            },
          ]
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
    console.error("[mission-control/board/:id]", e?.message);
    return c.json({ error: { message: e?.message || "failed" } }, 500);
  }
});

// ─── GET /api/mission-control/crons ────────────────────────────────────────────
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
      paused_at: r.paused_at,
      paused_reason: r.paused_reason,
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
    console.error("[mission-control/crons]", msg);
    return c.json({ error: { message: msg } }, 500);
  }
});

// ─── GET /api/mission-control/history ──────────────────────────────────────────
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
    doc_ref?: string | null;
    metadata?: Record<string, unknown>;
  };

  const entries: Entry[] = [];

  try {
    const [events, briefs, audit] = await Promise.all([
      listAgentEvents({ agentSlug: agent ?? undefined, limit: limit }),
      listAgentBriefs({ limit: Math.min(limit, 50) }),
      listAuditLogs({ agentSlug: agent ?? undefined, limit: Math.min(limit, 50) }),
    ]);

    for (const e of events as any[]) {
      entries.push({
        id: `evt:${e.name}`,
        ts: e.creation,
        agent_slug: e.agent_slug ?? null,
        kind: "event",
        title: e.title || e.event_type || "event",
        snippet: e.body ? String(e.body).slice(0, 240) : null,
        metadata: { event_type: e.event_type, severity: e.severity },
      });
    }

    for (const b of briefs as any[]) {
      if (agent && b.agent_slug && b.agent_slug !== agent && b.source !== agent) continue;
      entries.push({
        id: `brief:${b.name}`,
        ts: b.creation,
        agent_slug: b.agent_slug || b.source || null,
        kind: "brief",
        title: b.title || "brief",
        snippet: b.body ? String(b.body).slice(0, 240) : null,
        metadata: { type: b.type, source: b.source },
      });
    }

    for (const a of audit as any[]) {
      entries.push({
        id: `audit:${a.name}`,
        ts: a.creation,
        agent_slug: a.agent_slug ?? null,
        kind: "telemetry",
        title: a.action || a.title || "audit",
        snippet: a.detail ? String(a.detail).slice(0, 240) : a.body ? String(a.body).slice(0, 240) : null,
      });
    }
  } catch (e: any) {
    console.error("[mission-control/history] erp merge:", e?.message);
  }

  // Kanban done/completions from snapshot (recent done)
  if (supabaseConfig()) {
    try {
      const done = await lshSelect<any>("kanban_snapshot", {
        filters: ["status=eq.done"],
        order: "completed_at.desc",
        limit: 40,
      });
      for (const r of done) {
        entries.push({
          id: `kb:${r.task_id}`,
          ts: r.completed_at || r.snapshot_at || r.updated_at,
          agent_slug: r.assignee ?? null,
          kind: "kanban_done",
          title: r.title || r.task_id,
          snippet: r.result_summary ? String(r.result_summary).slice(0, 240) : null,
        });
      }
    } catch {
      /* table may be missing */
    }
  }

  let filtered = entries.filter((e) => e.ts);
  if (from) filtered = filtered.filter((e) => e.ts >= from);
  if (to) filtered = filtered.filter((e) => e.ts <= to);
  if (q) {
    filtered = filtered.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.snippet || "").toLowerCase().includes(q) ||
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
