// Mission Control — Agent management routes
// Auth: super_admin + store_manager only (unless noted)

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import {
  listAgents,
  getAgentBySlug,
  updateAgent,
  listAgentTasks,
  createAgentTask,
  updateAgentTask,
  listAgentEvents,
  insertAgentEvents,
  listApprovalQueue,
  listAgentBriefs,
  listAgentCosts,
  listCronJobs,
  updateCronJob,
  listAuditLogs,
  listAgentMessages,
  insertAgentMessage,
} from "../lib/erpnext/agents";

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
    id: row.name,
    name: row.agent_name ?? row.slug,
    created_at: row.creation,
  };
}

agentsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [agents, recentTasks, pendingApprovals] = await Promise.all([
    listAgents(),
    listAgentTasks({ since: since24h, limit: 500 }),
    listApprovalQueue({ status: ["pending"] }),
  ]);

  const taskCountBySlug: Record<string, number> = {};
  for (const t of recentTasks) {
    if (t.assigned_to) taskCountBySlug[t.assigned_to] = (taskCountBySlug[t.assigned_to] ?? 0) + 1;
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

  const data = await listApprovalQueue({ status: ["pending", "awaiting_second"], limit: 100 });

  const filtered = data.filter((item: any) => {
    if (item.category === "financial" && user.role !== "super_admin") return false;
    return true;
  });

  filtered.sort((a: any, b: any) => {
    const pa = PRIORITY_WEIGHT[a.priority ?? "low"] ?? 1;
    const pb = PRIORITY_WEIGHT[b.priority ?? "low"] ?? 1;
    if (pb !== pa) return pb - pa;
    return new Date(b.creation ?? 0).getTime() - new Date(a.creation ?? 0).getTime();
  });

  const byAgent: Record<string, any[]> = {};
  for (const item of filtered) {
    const slug = item.source_agent ?? "unknown";
    if (!byAgent[slug]) byAgent[slug] = [];
    byAgent[slug].push({ ...item, id: item.name, created_at: item.creation });
  }

  return c.json({ data: { byAgent, total: filtered.length } });
});

agentsRouter.get("/briefs", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
  const data = await listAgentBriefs({ limit });
  return c.json({ data: data.map((r: any) => ({ ...r, id: r.name, created_at: r.creation })) });
});

agentsRouter.get("/costs", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const days = parseInt(c.req.query("days") ?? "30", 10) || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0]!;
  const data = await listAgentCosts({ since });

  const byAgent: Record<string, { totalCost: number; totalTokens: number; model: string; daily: any[] }> = {};
  for (const row of data) {
    if (!byAgent[row.agent_slug]) {
      byAgent[row.agent_slug] = { totalCost: 0, totalTokens: 0, model: row.model, daily: [] };
    }
    byAgent[row.agent_slug].totalCost += Number(row.cost_usd);
    byAgent[row.agent_slug].totalTokens += row.input_tokens + row.output_tokens;
    byAgent[row.agent_slug].daily.push(row);
  }

  return c.json({ data: byAgent });
});

agentsRouter.get("/cron", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const data = await listCronJobs();
  return c.json({ data: data.map((r: any) => ({ ...r, id: r.name })) });
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
  const data = await listAuditLogs({ agentSlug: agentSlug ?? undefined, limit });
  return c.json({ data: data.map((r: any) => ({ ...r, id: r.name, created_at: r.creation })) });
});

agentsRouter.get("/live", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const since = new Date(Date.now() - 2 * 3600000).toISOString();
  const all = await listAgentEvents({ limit: 200 });
  const data = all.filter((e: any) => e.creation >= since);
  return c.json({
    data: data.map((r: any) => ({
      id: r.name,
      agent_slug: r.agent_slug,
      event_type: r.event_type,
      title: r.title,
      body: r.body,
      severity: r.severity,
      metadata: r.metadata,
      created_at: r.creation,
    })),
  });
});

agentsRouter.get("/:slug", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) return c.json({ error: { message: "Agent not found" } }, 404);

  const [events, tasks, activeTasks, pendingApprovals] = await Promise.all([
    listAgentEvents({ agentSlug: slug, limit: 20 }),
    listAgentTasks({ assignedTo: slug, limit: 10 }),
    listAgentTasks({ assignedTo: slug, status: ["in_progress", "pending"], limit: 50 }),
    listApprovalQueue({ status: ["pending"] }),
  ]);

  const agentApprovals = pendingApprovals.filter((a: any) => a.source_agent === slug);

  return c.json({
    data: {
      ...mapAgent(agent),
      events: events.map((r: any) => ({ ...r, id: r.name, created_at: r.creation })),
      tasks: tasks.map((r: any) => ({ ...r, id: r.name, created_at: r.creation })),
      active_task_count: activeTasks.length,
      pending_approvals: agentApprovals.map((r: any) => ({ ...r, id: r.name, created_at: r.creation })),
    },
  });
});

agentsRouter.get("/:slug/events", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const slug = c.req.param("slug");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
  const all = await listAgentEvents({ agentSlug: slug, limit: offset + limit });
  const page = all.slice(offset, offset + limit);

  return c.json({
    data: page.map((r: any) => ({ ...r, id: r.name, created_at: r.creation })),
    total: all.length,
  });
});

agentsRouter.get("/:slug/tasks", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const slug = c.req.param("slug");
  const statusParam = c.req.query("status") ?? "all";

  let status: string[] | undefined;
  if (statusParam === "active") status = ["pending", "in_progress"];
  else if (statusParam === "completed") status = ["completed"];

  const data = await listAgentTasks({ assignedTo: slug, status, limit: 100 });
  return c.json({ data: data.map((r: any) => ({ ...r, id: r.name, created_at: r.creation })) });
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

agentsRouter.get("/:slug/messages", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const slug = c.req.param("slug");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);
  const data = await listAgentMessages({ agentSlug: slug, limit });
  return c.json({
    data: data.map((m: any) => ({ id: m.name, role: m.role, content: m.content, created_at: m.creation })),
  });
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

  const history = await listAgentMessages({ agentSlug: slug, limit: 20 });
  const messages: { role: "user" | "assistant"; content: string }[] = history.map((m: any) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  if (!messages.length || messages[messages.length - 1].content !== userContent) {
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
