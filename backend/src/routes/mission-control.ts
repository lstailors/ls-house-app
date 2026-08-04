// Mission Control — Board / Crons / History routes (Phase 1 scaffold)
// Auth: super_admin + store_manager only (via isMissionControl)
// Data source: Supabase lsh.* snapshot tables (kanban_snapshot, cron_health, etc.)
// See /Users/Maestro_1/ls-design/handoffs/mc-data-access.md for Vercel Edge decision.
// Real queries TODO once Simone/Hermes snapshot writers land.

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";

export const missionControlRouter = new Hono();

function isMissionControl(role: string): boolean {
  return role === "super_admin" || role === "store_manager";
}

// ─── GET /api/mission-control/board ────────────────────────────────────────────
// List Kanban tasks (from lsh.kanban_snapshot or equivalent)
missionControlRouter.get("/board", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  // TODO: query lsh.kanban_snapshot (or lsh.kanban_tasks) with filters
  // fields: id, title, assignee, status, priority, age, blocked_reason, last_failure, ...
  return c.json({
    data: {
      tasks: [],
      total: 0,
      filters: { assignee: null, status: null, blockedOnly: false },
    },
  });
});

// ─── GET /api/mission-control/board/:id ────────────────────────────────────────
// Single task detail + comments + events + links
missionControlRouter.get("/board/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const id = c.req.param("id");

  // TODO: fetch task + task_comments + task_events from snapshot / kanban.db bridge
  return c.json({
    data: {
      task: null,
      comments: [],
      events: [],
      parents: [],
      children: [],
    },
  });
});

// ─── GET /api/mission-control/crons ────────────────────────────────────────────
// Fleet cron health from lsh.cron_health snapshot
missionControlRouter.get("/crons", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  // TODO: select * from lsh.cron_health order by agent_slug, name
  // status: green | amber | red (computed in snapshot writer)
  return c.json({
    data: {
      crons: [],
      summary: { green: 0, amber: 0, red: 0, total: 0 },
    },
  });
});

// ─── GET /api/mission-control/history ──────────────────────────────────────────
// Merged timeline (briefs + events + kanban activity + telemetry)
missionControlRouter.get("/history", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const agent = c.req.query("agent");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const q = c.req.query("q");
  const limit = Number(c.req.query("limit") ?? 50);

  // TODO: server-side merge from lsh.agent_briefs + lsh.agent_events + kanban activity + ERP
  return c.json({
    data: {
      entries: [],
      hasMore: false,
      query: { agent, from, to, q, limit },
    },
  });
});

export default missionControlRouter;