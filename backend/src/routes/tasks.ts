import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpCreate, erpUpdate } from "../lib/erp";

export const tasksRouter = new Hono();

async function callAnthropic(system: string, userMsg: string, maxTokens = 512): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, system, messages: [{ role: "user", content: userMsg }] }),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`AI ${res.status}: ${err}`); }
  const data: any = await res.json();
  return data.content?.[0]?.text ?? "";
}

// GET /api/tasks/open-count
tasksRouter.get("/open-count", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const filters: unknown[] = [["status", "=", "Open"]];
  if (user.role !== "super_admin") filters.push(["allocated_to", "=", user.email]);
  const todos = await erpList("ToDo", { filters, fields: ["name"], limit: 200 });
  return c.json({ data: { count: todos.length } });
});

// GET /api/tasks
tasksRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const statusParam = c.req.query("status") ?? "open";
  const filters: unknown[] = [];

  if (statusParam === "open") filters.push(["status", "=", "Open"]);
  else if (statusParam === "closed") filters.push(["status", "=", "Closed"]);
  // else "all" = no status filter

  if (user.role !== "super_admin") {
    filters.push(["allocated_to", "=", user.email]);
  }

  const todos = await erpList("ToDo", {
    filters,
    fields: [
      "name",
      "description",
      "status",
      "priority",
      "date",
      "allocated_to",
      "assigned_by",
      "assigned_by_full_name",
      "reference_type",
      "reference_name",
      "color",
    ],
    limit: 100,
    order_by: "date asc",
  });

  return c.json({ data: todos });
});

// POST /api/tasks
tasksRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!body.description) return c.json({ error: { message: "description required" } }, 400);

  const todo = await erpCreate("ToDo", {
    description: body.description,
    status: "Open",
    priority: body.priority ?? "Medium",
    date: body.date ?? null,
    allocated_to: body.allocated_to ?? user.email,
    assigned_by: user.email,
  });

  return c.json({ data: todo });
});

// POST /api/tasks/ai-parse
tasksRouter.post("/ai-parse", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const { text } = await c.req.json().catch(() => ({}));
  if (!text) return c.json({ error: { message: "text required" } }, 400);

  const today = new Date().toISOString().slice(0, 10);
  const system = `You are a task parser for L&S Custom Tailors (NYC bespoke tailoring shop).
Parse natural language task descriptions into structured fields.
Today is ${today}.
Return ONLY valid JSON with these fields:
{
  "description": "clear task description",
  "priority": "High" | "Medium" | "Low",
  "date": "YYYY-MM-DD or null",
  "allocated_to": "email if mentioned or null"
}
Infer priority from urgency words (urgent/asap/critical = High, soon/this week = Medium, else Low).
Parse relative dates (today, tomorrow, Monday, next week, etc.) to absolute dates.
Keep description concise and actionable.`;

  try {
    const raw = await callAnthropic(system, text);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return c.json({ data: parsed });
  } catch {
    return c.json({ data: { description: text, priority: "Medium", date: null, allocated_to: null } });
  }
});

// GET /api/tasks/suggestions
tasksRouter.get("/suggestions", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const today = new Date().toISOString().slice(0, 10);

  const [overdueInvoices, readyOrders, upcomingYZ] = await Promise.all([
    erpList("Sales Invoice", {
      filters: [["due_date", "<", today], ["status", "=", "Unpaid"]],
      fields: ["name", "customer_name", "outstanding_amount", "due_date"],
      limit: 10
    }).catch(() => [] as any[]),
    erpList("Sales Order", {
      filters: [["status", "=", "To Deliver and Bill"]],
      fields: ["name", "customer_name", "delivery_date"],
      limit: 10
    }).catch(() => [] as any[]),
    erpList("Sales Order", {
      filters: [["yz_ship_plan", ">=", today], ["yz_ship_plan", "<=", new Date(Date.now()+7*86400000).toISOString().slice(0,10)], ["yz_ship_plan", "!=", ""]],
      fields: ["name", "customer_name", "yz_ship_plan"],
      limit: 5
    }).catch(() => [] as any[]),
  ]);

  const context = [
    overdueInvoices.length ? `Overdue invoices: ${overdueInvoices.slice(0,5).map((i:any) => `${i.customer_name} $${i.outstanding_amount} (due ${i.due_date})`).join("; ")}` : "",
    readyOrders.length ? `Orders ready to deliver: ${readyOrders.slice(0,5).map((o:any) => `${o.customer_name} (${o.name})`).join("; ")}` : "",
    upcomingYZ.length ? `YZ shipments arriving this week: ${upcomingYZ.map((o:any) => `${o.customer_name} on ${o.yz_ship_plan}`).join("; ")}` : "",
  ].filter(Boolean).join("\n");

  if (!context) return c.json({ data: [] });

  const system = `You are a smart assistant for L&S Custom Tailors (NYC bespoke tailoring).
Based on the shop's current data, suggest 3-5 specific actionable tasks a manager should create.
Return ONLY a JSON array of task objects:
[{"description": "...", "priority": "High"|"Medium"|"Low", "date": "YYYY-MM-DD or null"}]
Today is ${today}. Be specific, practical, and concise. Focus on the most urgent items.`;

  try {
    const raw = await callAnthropic(system, context, 800);
    const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    return c.json({ data: Array.isArray(arr) ? arr.slice(0, 5) : [] });
  } catch {
    return c.json({ data: [] });
  }
});

// GET /api/tasks/briefing
tasksRouter.get("/briefing", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const today = new Date().toISOString().slice(0, 10);
  const filters: unknown[] = [["status", "=", "Open"]];
  if (user.role !== "super_admin") filters.push(["allocated_to", "=", user.email]);

  const todos = await erpList("ToDo", { filters, fields: ["description", "priority", "date", "allocated_to"], limit: 50 });

  if (!todos.length) return c.json({ data: { briefing: "No open tasks today. The house is clear." } });

  const overdue = todos.filter((t:any) => t.date && t.date < today);
  const dueToday = todos.filter((t:any) => t.date === today);
  const high = todos.filter((t:any) => t.priority === "High");

  const context = `Open tasks: ${todos.length} total. Overdue: ${overdue.length}. Due today: ${dueToday.length}. High priority: ${high.length}.
Tasks: ${todos.slice(0,10).map((t:any) => `[${t.priority}] ${t.description?.replace(/<[^>]*>/g,"").trim().slice(0,80)}`).join(" | ")}`;

  const system = `You are a concise morning briefing assistant for L&S Custom Tailors (NYC bespoke tailoring).
Write 2 sentences summarizing the task situation. Be direct, practical, and specific about what needs attention.
Do NOT use bullet points. Write as flowing prose. Sound like a seasoned shop manager briefing the team.`;

  try {
    const briefing = await callAnthropic(system, context, 200);
    return c.json({ data: { briefing: briefing.trim() } });
  } catch {
    return c.json({ data: { briefing: `${todos.length} open tasks — ${overdue.length} overdue, ${high.length} high priority.` } });
  }
});

// POST /api/tasks/ai-priority
tasksRouter.post("/ai-priority", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const { description } = await c.req.json().catch(() => ({}));
  if (!description) return c.json({ data: { priority: "Medium" } });

  const system = `You are a priority classifier for a bespoke tailoring shop's task list.
Given a task description, return ONLY a JSON object: {"priority": "High"|"Medium"|"Low", "reason": "one short sentence"}
High = urgent, customer-facing, financial, or time-sensitive.
Medium = important but not immediately urgent.
Low = nice-to-do, administrative, non-time-sensitive.`;

  try {
    const raw = await callAnthropic(system, description, 100);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return c.json({ data: { priority: parsed.priority ?? "Medium", reason: parsed.reason ?? "" } });
  } catch {
    return c.json({ data: { priority: "Medium", reason: "" } });
  }
});

// PATCH /api/tasks/:id
tasksRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if (body.status !== undefined) update.status = body.status;
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.date !== undefined) update.date = body.date;
  if (body.description !== undefined) update.description = body.description;
  if (body.allocated_to !== undefined) update.allocated_to = body.allocated_to;

  const todo = await erpUpdate("ToDo", id, update);
  return c.json({ data: todo });
});
