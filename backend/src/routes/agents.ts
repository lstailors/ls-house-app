// Mission Control — Agent management routes
// Auth: super_admin + store_manager only (unless noted)

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import {
  updateAgent,
  createAgentTask,
  updateAgentTask,
  insertAgentEvents,
  updateCronJob,
  insertAgentMessage,
} from "../lib/erpnext/agents";
import {
  mcListAgents,
  mcGetAgent,
  mcListActivity,
  mcListCosts,
  mcListCronJobs,
  mcListAudit,
  mcListBriefs,
  mcListTasksForAgent,
  mcListApprovals,
  mcListMessages,
} from "../lib/mc-data";
import { lshSelect, lshInsert, lshUpdate, supabaseConfig } from "../lib/supabase-lsh";

async function callAnthropic(system: string, messages: { role: string; content: string }[]): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic ${res.status}: ${err}`);
  }

  const data: any = await res.json();
  return data.content?.[0]?.text ?? "(no response)";
}

export const agentsRouter = new Hono();

function isMissionControl(role: string): boolean {
  return role === "super_admin" || role === "store_manager";
}

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function mapAgent(row: any) {
  return {
    ...row,
    id: row.id || row.name || row.slug,
    name: row.name || row.agent_name || row.slug,
    created_at: row.created_at || row.creation,
  };
}

agentsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const [agents, pendingApprovals, kanbanOpen] = await Promise.all([
    mcListAgents(),
    mcListApprovals(["pending"]),
    supabaseConfig()
      ? lshSelect<any>("kanban_snapshot", {
          filters: ["status=neq.done", "status=neq.archived"],
          limit: 500,
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const taskCountBySlug: Record<string, number> = {};
  for (const t of kanbanOpen as any[]) {
    if (t.assignee) taskCountBySlug[t.assignee] = (taskCountBySlug[t.assignee] ?? 0) + 1;
  }

  const approvalCountBySlug: Record<string, number> = {};
  for (const a of pendingApprovals) {
    if (a.source_agent) approvalCountBySlug[a.source_agent] = (approvalCountBySlug[a.source_agent] ?? 0) + 1;
  }

  const enriched = agents.map((agent: any) => ({
    ...mapAgent(agent),
    recent_task_count: taskCountBySlug[agent.slug] ?? 0,
    pending_approval_count: approvalCountBySlug[agent.slug] ?? 0,
  }));

  return c.json({ data: enriched });
});

agentsRouter.get("/approvals/pending", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const data = await mcListApprovals(["pending", "awaiting_second"]);

  const filtered = data.filter((item: any) => {
    if (item.category === "financial" && user.role !== "super_admin") return false;
    return true;
  });

  filtered.sort((a: any, b: any) => {
    const pa = PRIORITY_WEIGHT[a.priority ?? "low"] ?? 1;
    const pb = PRIORITY_WEIGHT[b.priority ?? "low"] ?? 1;
    if (pb !== pa) return pb - pa;
    return new Date(b.creation ?? b.created_at ?? 0).getTime() - new Date(a.creation ?? a.created_at ?? 0).getTime();
  });

  const byAgent: Record<string, any[]> = {};
  for (const item of filtered) {
    const slug = item.source_agent ?? "unknown";
    if (!byAgent[slug]) byAgent[slug] = [];
    byAgent[slug].push({ ...item, id: item.name || item.id, created_at: item.creation || item.created_at });
  }

  return c.json({
    data: {
      byAgent,
      total: filtered.length,
      setup: filtered.length === 0
        ? {
            message:
              "No pending approvals. Queue is empty — agents escalate via Maestro when dual-control is required. Not a wiring failure.",
          }
        : null,
    },
  });
});

agentsRouter.get("/briefs", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
  const data = await mcListBriefs(limit);
  return c.json({ data });
});

agentsRouter.get("/costs", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const days = parseInt(c.req.query("days") ?? "30", 10) || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0]!;
  const data = await mcListCosts(since);

  const byAgent: Record<string, { totalCost: number; totalTokens: number; model: string; daily: any[] }> = {};
  for (const row of data) {
    const bucket = byAgent[row.agent_slug] ?? { totalCost: 0, totalTokens: 0, model: row.model, daily: [] as any[] };
    if (!byAgent[row.agent_slug]) byAgent[row.agent_slug] = bucket;
    bucket.totalCost += Number(row.cost_usd || 0);
    bucket.totalTokens += Number(row.input_tokens || 0) + Number(row.output_tokens || 0);
    bucket.daily.push(row);
  }

  return c.json({ data: byAgent });
});

agentsRouter.get("/cron", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const data = await mcListCronJobs();
  return c.json({ data });
});

agentsRouter.patch("/cron/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as any;
  const update: Record<string, any> = {};
  if (typeof body.enabled === "boolean") update.enabled = body.enabled ? 1 : 0;
  if (Object.keys(update).length === 0) return c.json({ error: { message: "Nothing to update" } }, 400);

  // Hermes jobs: queue enable toggle note (Studio applies). ERP ids still update ERP.
  if (id.includes(":") && supabaseConfig()) {
    try {
      await lshInsert("kanban_commands", {
        task_id: id,
        action: body.enabled ? "cron_enable" : "cron_disable",
        payload: { job: id, enabled: !!body.enabled },
        requested_by: user.email,
        status: "pending",
      });
      // optimistic health flip
      const [profile, jobId] = id.split(":");
      if (profile && jobId) {
        await lshUpdate(
          "cron_health",
          [`profile=eq.${profile}`, `job_id=eq.${jobId}`],
          { enabled: !!body.enabled }
        );
      }
      return c.json({ data: { id, enabled: !!body.enabled, queued: true } });
    } catch (e: any) {
      return c.json({ error: { message: e.message } }, 500);
    }
  }

  try {
    const data = await updateCronJob(id, update);
    return c.json({ data: { ...(data as any), id: (data as any)?.name } });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 500);
  }
});

agentsRouter.get("/audit", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 500);
  const agentSlug = c.req.query("agent");
  const data = await mcListAudit({ agentSlug: agentSlug ?? undefined, limit });
  return c.json({ data });
});

agentsRouter.get("/live", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const data = await mcListActivity({ limit: 200, sinceHours: 48 });
  return c.json({ data });
});

agentsRouter.get("/:slug", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const slug = c.req.param("slug");
  const agent = await mcGetAgent(slug);
  if (!agent) return c.json({ error: { message: "Agent not found" } }, 404);

  const [events, tasks, pendingApprovals] = await Promise.all([
    mcListActivity({ agentSlug: slug, limit: 40 }),
    mcListTasksForAgent(slug),
    mcListApprovals(["pending"]),
  ]);

  const agentApprovals = pendingApprovals.filter((a: any) => a.source_agent === slug || a.source_agent === "hermes" && slug === "maestro");
  const activeTasks = tasks.filter((t: any) => !["done", "completed", "archived", "cancelled"].includes(String(t.status)));

  return c.json({
    data: {
      ...mapAgent(agent),
      events: events.map((r: any) => ({ ...r, id: r.id || r.name, created_at: r.created_at || r.creation })),
      tasks: tasks.map((r: any) => ({ ...r, id: r.id || r.name, created_at: r.created_at || r.creation })),
      active_task_count: activeTasks.length,
      pending_approvals: agentApprovals.map((r: any) => ({ ...r, id: r.name || r.id, created_at: r.creation || r.created_at })),
    },
  });
});

agentsRouter.get("/:slug/events", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const slug = c.req.param("slug");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const page = await mcListActivity({ agentSlug: slug, limit });

  return c.json({
    data: page,
    total: page.length,
  });
});

agentsRouter.get("/:slug/tasks", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const slug = c.req.param("slug");
  const statusParam = c.req.query("status") ?? "all";

  let data = await mcListTasksForAgent(slug);
  if (statusParam === "active") {
    data = data.filter((t) => ["pending", "in_progress", "todo", "ready", "running", "blocked"].includes(String(t.status)));
  } else if (statusParam === "completed") {
    data = data.filter((t) => ["completed", "done"].includes(String(t.status)));
  }
  return c.json({ data });
});

agentsRouter.post("/:slug/tasks", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden" } }, 403);

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
  if (["low", "medium", "high", "urgent"].includes(body.priority)) taskData.priority = body.priority;
  if (typeof body.due_at === "string") taskData.due_at = body.due_at;

  try {
    const task = await createAgentTask(taskData);
    await insertAgentEvents([{
      agent_slug: slug,
      event_type: "task_delegated",
      title: `Task delegated by ${user.name ?? user.email}`,
      body: body.title.trim(),
      severity: "info",
      task_id: (task as any)?.name ?? null,
      metadata: { assigned_by: user.email },
    }]);
    return c.json({ data: { ...(task as any), id: (task as any)?.name, created_at: (task as any)?.creation } }, 201);
  } catch (e: any) {
    console.error("[agents/:slug/tasks POST]", e.message);
    return c.json({ error: { message: "Failed to create task" } }, 500);
  }
});

agentsRouter.patch("/:slug/tasks/:taskId", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const taskId = c.req.param("taskId");
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (typeof body.status === "string") updates.status = body.status;
  if (typeof body.result === "string") updates.result = body.result;
  if (Object.keys(updates).length === 0) return c.json({ error: { message: "No valid fields to update" } }, 400);

  if (updates.status === "in_progress") updates.started_at = new Date().toISOString();
  if (updates.status === "completed") updates.completed_at = new Date().toISOString();

  try {
    const task = await updateAgentTask(taskId, updates);
    return c.json({ data: { ...(task as any), id: (task as any)?.name } });
  } catch (e: any) {
    return c.json({ error: { message: "Failed to update task" } }, 500);
  }
});

agentsRouter.patch("/:slug", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden" } }, 403);

  const slug = c.req.param("slug");
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body.settings !== undefined && typeof body.settings === "object") updates.settings = body.settings;
  if (typeof body.enabled === "boolean") updates.enabled = body.enabled ? 1 : 0;
  if (Object.keys(updates).length === 0) return c.json({ error: { message: "No valid fields to update" } }, 400);

  try {
    const agent = await updateAgent(slug, updates);
    return c.json({ data: mapAgent(agent) });
  } catch (e: any) {
    return c.json({ error: { message: "Failed to update agent" } }, 500);
  }
});

const AGENT_PERSONAS: Record<string, string> = {
  maestro: `You are Maestro — orchestrator of L&S House, the operating system that runs L&S Custom Tailors (est. 1974, 138 East 61st Street, NYC). You are the chief of staff to Calogero "C" Cristiano, the owner. You are direct, warm with people you trust, Sicilian-American in temperament. You coordinate all agents: Sofia (clients), Mia (calendar), Simone (email), La Penna (copy), Marco (tech), Paperclip (strategy). You never speak as an AI — you are Maestro. You call the owner "C" or "Boss". Answer questions about the house, the business, the team, and operations. Be concise, no fluff.`,
  sofia: `You are Sofia — client concierge of L&S Custom Tailors, a Sicilian-heritage bespoke house founded in 1974 at 138 East 61st Street, NYC. You handle all client SMS and voice. You are warm, professional, impeccably on brand. You book appointments, handle inquiries, and escalate when needed. You never quote prices or make fabric promises without checking with Maestro or C. Answer questions about client management, appointments, and concierge operations. Be gracious but efficient.`,
  mia: `You are Mia — the scheduling and dossier agent at L&S Custom Tailors. You own every calendar, every fitting slot, every minute of C's professional time. You use Cal.com and Apple Calendar. You generate client dossiers before every consultation. You are precise, organized, and never double-book. Answer questions about scheduling, calendar management, and client preparation.`,
  rocco: `You are Rocco — production and delivery manager at L&S Custom Tailors. You own the floor from cradle to delivery. You track MTMPro orders, alteration tickets, the YZ pipeline, and factory monitoring. You flag stalled jobs and late deliveries. You are no-nonsense, floor-smart, and direct. Answer questions about production, orders, delivery timelines, and the factory pipeline.`,
  melena: `You are Melena — head of accounting and books at L&S Custom Tailors. You own the money: billing, invoicing, Square reconciliation across LSTNY, LSTX, and Holdings. You draft only — you never auto-send. You escalate every discrepancy. You are precise, cautious with numbers, and thorough. Answer questions about financials, billing, invoicing, and reconciliation.`,
  filo: `You are Filo — ingestion and intelligence agent at L&S Custom Tailors. You run locally on the Mac Studio. You watch every inbox, the Downloads folder, and all attachments the moment they land. You parse, classify, extract, and backfile data into ERPNext. You are fast, thorough, and confidence-tiered: you auto-commit low-risk data and queue financial fields for Melena. Answer questions about data ingestion, document processing, and intelligence pipelines.`,
};

// ─── One-shot Command console (SPEC 069) via lsh.mc_commands chat_run ────────

type UiCommandStatus = "queued" | "running" | "done" | "error" | "timeout" | "cancelled";

function parsePayload(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === "object") return p as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {};
}

function mapMcCommandToUi(row: any) {
  const payload = parsePayload(row.payload);
  const dbStatus = String(row.status || "pending");
  const timedOut = payload.timed_out === true || /timed?\s*out/i.test(String(row.error || ""));
  let status: UiCommandStatus = "queued";
  if (dbStatus === "pending") status = "queued";
  else if (dbStatus === "leased") status = "running";
  else if (dbStatus === "applied") status = "done";
  else if (dbStatus === "cancelled") status = "cancelled";
  else if (dbStatus === "failed") status = timedOut ? "timeout" : "error";

  const startedAt =
    (typeof payload.started_at === "string" && payload.started_at) ||
    row.leased_at ||
    null;
  const finishedAt =
    (typeof payload.finished_at === "string" && payload.finished_at) ||
    row.applied_at ||
    null;

  let elapsedMs: number | null = null;
  const startMs = startedAt ? Date.parse(String(startedAt)) : NaN;
  if (!Number.isNaN(startMs)) {
    const endMs = finishedAt ? Date.parse(String(finishedAt)) : Date.now();
    if (!Number.isNaN(endMs)) elapsedMs = Math.max(0, endMs - startMs);
  }

  const pidRaw = payload.pid;
  const pid =
    typeof pidRaw === "number"
      ? pidRaw
      : typeof pidRaw === "string" && /^\d+$/.test(pidRaw)
        ? parseInt(pidRaw, 10)
        : null;

  const result =
    typeof payload.result === "string"
      ? payload.result
      : status === "done" && !payload.result
        ? null
        : null;

  const format =
    payload.format === "text" || payload.format === "code"
      ? payload.format
      : result && (result.includes("\n") || result.length > 280)
        ? "code"
        : result
          ? "text"
          : null;

  return {
    id: row.id as string,
    prompt: typeof payload.prompt === "string" ? payload.prompt : "",
    status,
    session_id: typeof payload.session_id === "string" ? payload.session_id : null,
    pid,
    result,
    result_format: format as "text" | "code" | null,
    error: row.error ?? (status === "error" ? "Command failed to complete." : null),
    timeout_seconds:
      typeof payload.timeout_seconds === "number" ? payload.timeout_seconds : null,
    created_at: row.created_at ?? null,
    started_at: startedAt,
    finished_at: finishedAt,
    elapsed_ms: elapsedMs,
    requested_by: row.requested_by ?? null,
  };
}

/** POST /api/agents/:slug/commands — enqueue one-shot chat_run */
agentsRouter.post("/:slug/commands", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseConfig()) return c.json({ error: { message: "Supabase not configured" } }, 503);

  const slug = c.req.param("slug");
  const body = await c.req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return c.json({ error: { message: "prompt is required" } }, 400);
  if (prompt.length > 8000) return c.json({ error: { message: "prompt too long (max 8000)" } }, 400);

  const idempotencyKey =
    typeof body?.idempotency_key === "string" && body.idempotency_key.trim()
      ? body.idempotency_key.trim().slice(0, 120)
      : null;

  // One in-flight command per agent
  try {
    const open = await lshSelect<any>("mc_commands", {
      filters: [
        `kind=eq.chat_run`,
        `target_id=eq.${slug}`,
        `status=in.(pending,leased)`,
      ],
      limit: 1,
    });
    if (open.length > 0) {
      return c.json(
        {
          error: {
            message: "A command is already in flight for this agent",
            existing: mapMcCommandToUi(open[0]),
          },
        },
        409
      );
    }
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("404") || msg.includes("does not exist") || msg.includes("42P01")) {
      return c.json(
        { error: { message: "mc_commands table missing — apply migration_009_mc_commands.sql" } },
        503
      );
    }
    // continue — insert may still work
  }

  try {
    const row = {
      kind: "chat_run",
      action: "send",
      target_id: slug,
      payload: {
        prompt,
        timeout_seconds: typeof body?.timeout_seconds === "number" ? body.timeout_seconds : 180,
      },
      requested_by: user.email,
      origin_surface: "mission_control",
      status: "pending",
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    };
    const inserted = await lshInsert<any>(
      "mc_commands",
      row,
      idempotencyKey ? { upsert: true, onConflict: "idempotency_key" } : {}
    );
    const cmd = Array.isArray(inserted) ? inserted[0] : inserted;
    if (!cmd) return c.json({ error: { message: "Failed to enqueue command" } }, 500);
    return c.json({ data: mapMcCommandToUi(cmd) }, 201);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("404") || msg.includes("does not exist")) {
      return c.json(
        { error: { message: "mc_commands table missing — apply migration_009_mc_commands.sql" } },
        503
      );
    }
    return c.json({ error: { message: msg.slice(0, 300) } }, 500);
  }
});

/** GET /api/agents/:slug/commands/:id — poll one-shot command status */
agentsRouter.get("/:slug/commands/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseConfig()) return c.json({ error: { message: "Supabase not configured" } }, 503);

  const slug = c.req.param("slug");
  const id = c.req.param("id");
  try {
    const rows = await lshSelect<any>("mc_commands", {
      filters: [`id=eq.${id}`, `kind=eq.chat_run`, `target_id=eq.${slug}`],
      limit: 1,
    });
    const row = rows[0];
    if (!row) return c.json({ error: { message: "Command not found" } }, 404);
    return c.json({ data: mapMcCommandToUi(row) });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("404") || msg.includes("does not exist")) {
      return c.json({ error: { message: "mc_commands table missing" } }, 503);
    }
    return c.json({ error: { message: msg.slice(0, 300) } }, 500);
  }
});

/** POST /api/agents/:slug/commands/:id/cancel — cancel pending/running chat_run */
agentsRouter.post("/:slug/commands/:id/cancel", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseConfig()) return c.json({ error: { message: "Supabase not configured" } }, 503);

  const slug = c.req.param("slug");
  const id = c.req.param("id");
  try {
    const rows = await lshSelect<any>("mc_commands", {
      filters: [`id=eq.${id}`, `kind=eq.chat_run`, `target_id=eq.${slug}`],
      limit: 1,
    });
    const row = rows[0];
    if (!row) return c.json({ error: { message: "Command not found" } }, 404);
    if (!["pending", "leased"].includes(String(row.status))) {
      return c.json({ data: mapMcCommandToUi(row), message: "already terminal" });
    }
    await lshUpdate("mc_commands", [`id=eq.${id}`], {
      status: "cancelled",
      error: null,
      applied_at: new Date().toISOString(),
    });
    const refreshed = await lshSelect<any>("mc_commands", { filters: [`id=eq.${id}`], limit: 1 });
    return c.json({ data: mapMcCommandToUi(refreshed[0] ?? { ...row, status: "cancelled" }) });
  } catch (e: any) {
    return c.json({ error: { message: String(e?.message || e).slice(0, 300) } }, 500);
  }
});

agentsRouter.get("/:slug/messages", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const slug = c.req.param("slug");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);
  const data = await mcListMessages(slug, limit);
  return c.json({ data });
});

agentsRouter.post("/:slug/messages", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const slug = c.req.param("slug");
  const body = await c.req.json().catch(() => null);
  if (!body?.content || typeof body.content !== "string") {
    return c.json({ error: { message: "content is required" } }, 400);
  }

  const userContent = body.content.trim().slice(0, 2000);
  if (!userContent) return c.json({ error: { message: "content is empty" } }, 400);

  await insertAgentMessage({ agent_slug: slug, role: "user", content: userContent, user_id: user.id });

  const history = await mcListMessages(slug, 20);
  const messages: { role: "user" | "assistant"; content: string }[] = history.map((m: any) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  const last = messages[messages.length - 1];
  if (!messages.length || !last || last.content !== userContent) {
    messages.push({ role: "user", content: userContent });
  }

  const systemPrompt = AGENT_PERSONAS[slug] ?? `You are ${slug}, an agent at L&S Custom Tailors, a bespoke tailoring house in NYC. Be helpful and professional.`;

  let replyContent = "";
  try {
    replyContent = await callAnthropic(systemPrompt, messages);
  } catch (err: any) {
    console.error("[agents/messages] Anthropic error:", err?.message);
    return c.json({ error: { message: "AI unavailable — try again" } }, 502);
  }

  const saved = await insertAgentMessage({ agent_slug: slug, role: "assistant", content: replyContent });
  return c.json({
    data: {
      id: (saved as any)?.name,
      role: "assistant",
      content: replyContent,
      created_at: (saved as any)?.creation,
    },
  });
});
