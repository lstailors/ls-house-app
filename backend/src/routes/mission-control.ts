// Mission Control — Board / Crons / History / Alerts
// Auth: super_admin + store_manager
// Data: lsh.* snapshots (Studio writers) — Edge-safe
// Alerts (SPEC 071): derived read over cron_health + approval_queue — no new SoT

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { lshSelect, lshInsert, lshUpdate, supabaseConfig } from "../lib/supabase-lsh";
import { mcListActivity, mcListApprovals, mcListBriefs } from "../lib/mc-data";

export const missionControlRouter = new Hono();

/** Default stale-approval threshold (hours). Per-source overrides = v2. */
const STALE_APPROVAL_HOURS_DEFAULT = Number(
  process.env.MC_STALE_APPROVAL_HOURS || 4
);

function isMissionControl(role: string): boolean {
  return role === "super_admin" || role === "store_manager";
}

function ageDays(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, (Date.now() - t) / 86_400_000);
}

function ageHours(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function formatStuckAge(hours: number | null): string {
  if (hours == null) return "unknown age";
  if (hours < 1) {
    const m = Math.max(1, Math.round(hours * 60));
    return `${m}m`;
  }
  if (hours < 48) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(hours / 24);
  return `${d}d`;
}

function titleCaseName(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
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

// ── SPEC 071 Alerts ──────────────────────────────────────────────────────────
// Derived standing-state aggregation. Dedupe key = {type}:{source_id}.
// agent_dark + cost_anomaly gated OFF until real heartbeats / token metering.

type McAlertRow = {
  id: string;
  type: "cron_error" | "stale_approval" | "agent_dark" | "cost_anomaly";
  severity: "critical" | "warning";
  title: string;
  context: string;
  source_tab: "crons" | "approvals" | "fleet" | "costs";
  source_id: string;
  href: string;
  first_seen: string | null;
  last_seen: string | null;
  occurrences: number;
  age_hours: number | null;
};

missionControlRouter.get("/alerts", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const thresholdH = Number.isFinite(STALE_APPROVAL_HOURS_DEFAULT)
    ? Math.max(0.25, STALE_APPROVAL_HOURS_DEFAULT)
    : 4;

  const alerts: McAlertRow[] = [];
  const sources: {
    cron_health: "ok" | "error" | "missing" | "unconfigured";
    approvals: "ok" | "error";
    agent_dark: "gated_off";
    cost_anomaly: "gated_off";
  } = {
    cron_health: "unconfigured",
    approvals: "ok",
    agent_dark: "gated_off",
    cost_anomaly: "gated_off",
  };
  const sourceErrors: string[] = [];

  // ── cron_error: red rows in lsh.cron_health ──
  if (!supabaseConfig()) {
    sources.cron_health = "unconfigured";
    sourceErrors.push("cron_health: supabase_not_configured");
  } else {
    try {
      const rows = await lshSelect<any>("cron_health", {
        filters: ["health_color=eq.red"],
        order: "last_run_at.asc.nullslast",
        limit: 200,
      });
      sources.cron_health = "ok";
      for (const r of rows) {
        const sourceId = `${r.profile}:${r.job_id}`;
        const jobLabel = r.job_name || r.job_id || "cron";
        const profileLabel = titleCaseName(String(r.profile || "agent"));
        const lastSeen = r.last_run_at || r.snapshot_at || null;
        const firstSeen = r.last_run_at || r.snapshot_at || null;
        const hours = ageHours(firstSeen);
        const reasons = Array.isArray(r.health_reasons) ? r.health_reasons : [];
        const failBit = String(r.last_error || r.last_delivery_error || reasons[0] || "").trim();
        const titleCore = failBit
          ? `${profileLabel}'s ${jobLabel} — ${failBit.slice(0, 72)}`
          : `${profileLabel}'s ${jobLabel} — red health`;
        alerts.push({
          id: `cron_error:${sourceId}`,
          type: "cron_error",
          severity: "critical",
          title: titleCore.slice(0, 160),
          context: `Crons · stuck red for ${formatStuckAge(hours)}`,
          source_tab: "crons",
          source_id: sourceId,
          href: `/mission-control?tab=crons&status=red&job=${encodeURIComponent(sourceId)}`,
          first_seen: firstSeen,
          last_seen: lastSeen,
          occurrences: 1,
          age_hours: hours,
        });
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("42P01") || msg.includes("does not exist") || msg.includes("404")) {
        sources.cron_health = "missing";
        sourceErrors.push("cron_health: table_missing");
      } else {
        sources.cron_health = "error";
        sourceErrors.push(`cron_health: ${msg.slice(0, 120)}`);
      }
    }
  }

  // ── stale_approval: pending items older than threshold ──
  try {
    const pending = await mcListApprovals(["pending", "awaiting_second"]);
    sources.approvals = "ok";
    for (const item of pending as any[]) {
      if (item.category === "financial" && user.role !== "super_admin") continue;
      const created = item.creation || item.created_at || null;
      const hours = ageHours(created);
      if (hours == null || hours < thresholdH) continue;
      const id = String(item.name || item.id || "");
      if (!id) continue;
      const titleBase = item.title || "Approval pending";
      const ageLabel = formatStuckAge(hours);
      const severity: "critical" | "warning" =
        hours >= thresholdH * 2 ? "critical" : "warning";
      const agent = item.source_agent ? titleCaseName(String(item.source_agent)) : null;
      const summaryBit = item.summary
        ? String(item.summary).replace(/\s+/g, " ").slice(0, 60)
        : null;
      alerts.push({
        id: `stale_approval:${id}`,
        type: "stale_approval",
        severity,
        title: `Approval pending ${ageLabel} — ${titleBase}`.slice(0, 160),
        context: [
          "Approvals",
          agent,
          summaryBit,
          `${ageLabel} old`,
        ]
          .filter(Boolean)
          .join(" · "),
        source_tab: "approvals",
        source_id: id,
        href: `/mission-control?tab=approvals&id=${encodeURIComponent(id)}`,
        first_seen: created,
        last_seen: created,
        occurrences: 1,
        age_hours: hours,
      });
    }
  } catch (e: any) {
    sources.approvals = "error";
    sourceErrors.push(`approvals: ${String(e?.message || e).slice(0, 120)}`);
  }

  // agent_dark + cost_anomaly intentionally gated — do not wire against fake signals

  // Sort: critical first, then oldest first_seen within tier
  const sevRank = (s: string) => (s === "critical" ? 0 : 1);
  alerts.sort((a, b) => {
    const sd = sevRank(a.severity) - sevRank(b.severity);
    if (sd !== 0) return sd;
    const at = a.first_seen ? Date.parse(a.first_seen) : Number.POSITIVE_INFINITY;
    const bt = b.first_seen ? Date.parse(b.first_seen) : Number.POSITIVE_INFINITY;
    return at - bt;
  });

  // Dedupe by id (defensive — sources already unique)
  const seen = new Set<string>();
  const deduped = alerts.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  const critical_count = deduped.filter((a) => a.severity === "critical").length;
  const warning_count = deduped.filter((a) => a.severity === "warning").length;
  const highest_severity =
    critical_count > 0 ? "critical" : warning_count > 0 ? "warning" : null;

  const feedBroken =
    sources.cron_health === "error" ||
    sources.cron_health === "unconfigured" ||
    sources.approvals === "error";
  // Both primary sources hard-failed → error (not silent all-clear)
  const bothFailed =
    (sources.cron_health === "error" || sources.cron_health === "unconfigured" || sources.cron_health === "missing") &&
    sources.approvals === "error";

  return c.json({
    data: {
      alerts: deduped,
      count: deduped.length,
      critical_count,
      warning_count,
      highest_severity,
      generated_at: new Date().toISOString(),
      stale_approval_threshold_hours: thresholdH,
      gated: { agent_dark: true, cost_anomaly: true },
      sources,
      error: bothFailed
        ? sourceErrors.join("; ") || "Alerts feed unavailable"
        : null,
      warning:
        !bothFailed && feedBroken
          ? sourceErrors.join("; ")
          : sources.cron_health === "missing"
            ? "cron_health table not applied yet"
            : null,
      cache_age_minutes: null,
    },
  });
});

export default missionControlRouter;
