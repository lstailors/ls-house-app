// Mission Control — Agent management routes
// Auth: super_admin + store_manager only (unless noted)

import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";

export const agentsRouter = new Hono();

const lshAdmin = () => (supabaseAdmin as any).schema("lsh");

// ── Helpers ──────────────────────────────────────────────────────────────────

function isMissionControl(role: string): boolean {
  return role === "super_admin" || role === "store_manager";
}

// Priority sort order (higher = more urgent)
const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ── GET /api/agents ──────────────────────────────────────────────────────────
agentsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ data: [] });

  // Fetch all agents
  const { data: agents, error: agentsErr } = await lshAdmin()
    .from("agents")
    .select("*")
    .order("name", { ascending: true });

  if (agentsErr) {
    console.error("[agents] fetch error:", agentsErr.message);
    return c.json({ error: { message: "Failed to fetch agents" } }, 500);
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Fetch recent tasks (last 24h) grouped by assigned_to
  const { data: recentTasks } = await lshAdmin()
    .from("agent_tasks")
    .select("assigned_to")
    .gte("created_at", since24h);

  // Fetch pending approvals grouped by source_agent
  const { data: pendingApprovals } = await supabaseAdmin
    .from("approval_queue")
    .select("source_agent")
    .eq("status", "pending");

  // Build lookup maps
  const taskCountBySlug: Record<string, number> = {};
  for (const t of recentTasks ?? []) {
    if (t.assigned_to) {
      taskCountBySlug[t.assigned_to] = (taskCountBySlug[t.assigned_to] ?? 0) + 1;
    }
  }

  const approvalCountBySlug: Record<string, number> = {};
  for (const a of pendingApprovals ?? []) {
    if (a.source_agent) {
      approvalCountBySlug[a.source_agent] = (approvalCountBySlug[a.source_agent] ?? 0) + 1;
    }
  }

  const enriched = (agents ?? []).map((agent: any) => ({
    ...agent,
    recent_task_count: taskCountBySlug[agent.slug] ?? 0,
    pending_approval_count: approvalCountBySlug[agent.slug] ?? 0,
  }));

  return c.json({ data: enriched });
});

// ── GET /api/agents/approvals/pending ─────────────────────────────────────────
// NOTE: This must be defined BEFORE /:slug to avoid route conflict
agentsRouter.get("/approvals/pending", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ data: { byAgent: {}, total: 0 } });

  const { data, error } = await supabaseAdmin
    .from("approval_queue")
    .select("*")
    .in("status", ["pending", "awaiting_second"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[agents/approvals/pending] fetch error:", error.message);
    return c.json({ error: { message: "Failed to fetch approvals" } }, 500);
  }

  // Filter financial for non-super_admin
  const filtered = (data ?? []).filter((item: any) => {
    if (item.category === "financial" && user.role !== "super_admin") return false;
    return true;
  });

  // Sort by priority desc then created_at desc
  filtered.sort((a: any, b: any) => {
    const pa = PRIORITY_WEIGHT[a.priority ?? "low"] ?? 1;
    const pb = PRIORITY_WEIGHT[b.priority ?? "low"] ?? 1;
    if (pb !== pa) return pb - pa;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // Group by source_agent
  const byAgent: Record<string, any[]> = {};
  for (const item of filtered) {
    const slug = item.source_agent ?? "unknown";
    if (!byAgent[slug]) byAgent[slug] = [];
    byAgent[slug].push(item);
  }

  return c.json({ data: { byAgent, total: filtered.length } });
});

// ── GET /api/agents/briefs ─────────────────────────────────────────────────
agentsRouter.get("/briefs", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ data: [] });

  const limitParam = c.req.query("limit");
  const limit = Math.min(parseInt(limitParam ?? "20", 10) || 20, 100);

  const { data, error } = await lshAdmin()
    .from("agent_briefs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[agents/briefs] fetch error:", error.message);
    return c.json({ error: { message: "Failed to fetch briefs" } }, 500);
  }

  return c.json({ data: data ?? [] });
});

// ── GET /api/agents/:slug ─────────────────────────────────────────────────────
agentsRouter.get("/:slug", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ data: null });

  const slug = c.req.param("slug");

  // Fetch agent
  const { data: agent, error: agentErr } = await lshAdmin()
    .from("agents")
    .select("*")
    .eq("slug", slug)
    .single();

  if (agentErr || !agent) return c.json({ error: { message: "Agent not found" } }, 404);

  // Fetch last 20 events
  const { data: events } = await lshAdmin()
    .from("agent_events")
    .select("*")
    .eq("agent_slug", slug)
    .order("created_at", { ascending: false })
    .limit(20);

  // Fetch last 10 tasks
  const { data: tasks } = await lshAdmin()
    .from("agent_tasks")
    .select("*")
    .eq("assigned_to", slug)
    .order("created_at", { ascending: false })
    .limit(10);

  // Active task count
  const { data: activeTasks } = await lshAdmin()
    .from("agent_tasks")
    .select("id")
    .eq("assigned_to", slug)
    .in("status", ["in_progress", "pending"]);

  // Pending approvals
  const { data: pendingApprovals } = await supabaseAdmin
    .from("approval_queue")
    .select("*")
    .eq("source_agent", slug)
    .eq("status", "pending");

  return c.json({
    data: {
      ...agent,
      events: events ?? [],
      tasks: tasks ?? [],
      active_task_count: (activeTasks ?? []).length,
      pending_approvals: pendingApprovals ?? [],
    },
  });
});

// ── GET /api/agents/:slug/events ──────────────────────────────────────────────
agentsRouter.get("/:slug/events", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ data: [] });

  const slug = c.req.param("slug");
  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");
  const limit = Math.min(parseInt(limitParam ?? "50", 10) || 50, 200);
  const offset = parseInt(offsetParam ?? "0", 10) || 0;

  const { data, error, count } = await lshAdmin()
    .from("agent_events")
    .select("*", { count: "exact" })
    .eq("agent_slug", slug)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[agents/:slug/events] fetch error:", error.message);
    return c.json({ error: { message: "Failed to fetch events" } }, 500);
  }

  return c.json({ data: data ?? [], total: count ?? 0 });
});

// ── GET /api/agents/:slug/tasks ───────────────────────────────────────────────
agentsRouter.get("/:slug/tasks", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ data: [] });

  const slug = c.req.param("slug");
  const statusParam = c.req.query("status") ?? "all";

  let query = lshAdmin()
    .from("agent_tasks")
    .select("*")
    .eq("assigned_to", slug)
    .order("created_at", { ascending: false });

  if (statusParam === "active") {
    query = query.in("status", ["pending", "in_progress"]);
  } else if (statusParam === "completed") {
    query = query.eq("status", "completed");
  }
  // "all" = no filter

  const { data, error } = await query;

  if (error) {
    console.error("[agents/:slug/tasks] fetch error:", error.message);
    return c.json({ error: { message: "Failed to fetch tasks" } }, 500);
  }

  return c.json({ data: data ?? [] });
});

// ── POST /api/agents/:slug/tasks ──────────────────────────────────────────────
agentsRouter.post("/:slug/tasks", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const slug = c.req.param("slug");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return c.json({ error: { message: "title is required" } }, 400);
  }

  const taskData: Record<string, unknown> = {
    assigned_to: slug,
    assigned_by: user.email,
    title: body.title.trim(),
    status: "pending",
  };

  if (typeof body.description === "string") taskData.description = body.description;
  if (["low", "medium", "high", "urgent"].includes(body.priority)) {
    taskData.priority = body.priority;
  }
  if (typeof body.due_at === "string") taskData.due_at = body.due_at;

  const { data: task, error: taskErr } = await lshAdmin()
    .from("agent_tasks")
    .insert(taskData)
    .select()
    .single();

  if (taskErr) {
    console.error("[agents/:slug/tasks POST] insert error:", taskErr.message);
    return c.json({ error: { message: "Failed to create task" } }, 500);
  }

  // Log event
  await lshAdmin()
    .from("agent_events")
    .insert({
      agent_slug: slug,
      event_type: "task_delegated",
      title: `Task delegated by ${user.name ?? user.email}`,
      body: body.title.trim(),
      severity: "info",
      task_id: task?.id ?? null,
      metadata: { assigned_by: user.email },
    });

  return c.json({ data: task }, 201);
});

// ── PATCH /api/agents/:slug/tasks/:taskId ─────────────────────────────────────
agentsRouter.patch("/:slug/tasks/:taskId", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const slug = c.req.param("slug");
  const taskId = c.req.param("taskId");
  const body = await c.req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  if (typeof body.status === "string") updates.status = body.status;
  if (typeof body.result === "string") updates.result = body.result;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: { message: "No valid fields to update" } }, 400);
  }

  // Mark timestamps if transitioning
  if (updates.status === "in_progress") updates.started_at = new Date().toISOString();
  if (updates.status === "completed") updates.completed_at = new Date().toISOString();

  const { data: task, error } = await lshAdmin()
    .from("agent_tasks")
    .update(updates)
    .eq("id", taskId)
    .eq("assigned_to", slug)
    .select()
    .single();

  if (error) {
    console.error("[agents/:slug/tasks/:taskId PATCH] update error:", error.message);
    return c.json({ error: { message: "Failed to update task" } }, 500);
  }

  return c.json({ data: task });
});

// ── PATCH /api/agents/:slug ───────────────────────────────────────────────────
agentsRouter.patch("/:slug", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const slug = c.req.param("slug");
  const body = await c.req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  if (body.settings !== undefined && typeof body.settings === "object") {
    updates.settings = body.settings;
  }
  if (typeof body.enabled === "boolean") {
    updates.enabled = body.enabled;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: { message: "No valid fields to update" } }, 400);
  }

  const { data: agent, error } = await lshAdmin()
    .from("agents")
    .update(updates)
    .eq("slug", slug)
    .select()
    .single();

  if (error) {
    console.error("[agents/:slug PATCH] update error:", error.message);
    return c.json({ error: { message: "Failed to update agent" } }, 500);
  }

  return c.json({ data: agent });
});
