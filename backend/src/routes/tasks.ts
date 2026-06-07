import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpCreate, erpUpdate } from "../lib/erp";
import { sendSms } from "../lib/twilio";

const RAVEN_ALERTS = "L&S Tailors-alerts";

const STAFF_PHONES: Record<string, string> = {
  "carl@lstailors.com": "+16319260917",
  "gianna@lstailors.com": "+16462087809",
  "kelvin@lstailors.com": "+13475539027",
  "antonio@lstailors.com": "+16463637906",
};

async function postToRaven(text: string, senderEmail = "house@lstailors.com"): Promise<void> {
  try {
    await erpCreate("Raven Message", {
      channel_id: RAVEN_ALERTS,
      text,
      message_type: "Text",
      owner: senderEmail,
    });
  } catch { /* non-blocking */ }
}

async function notifyAssignee(assigneeEmail: string, description: string, date: unknown, senderEmail: string): Promise<void> {
  const name = assigneeEmail.split("@")[0];
  const due = date ? ` (due ${date})` : "";
  const desc = description.replace(/<[^>]*>/g, "").slice(0, 100);
  postToRaven(`📌 Task assigned to ${name}: ${desc}${due}`, senderEmail);
  const phone = STAFF_PHONES[assigneeEmail];
  if (phone) {
    try {
      await sendSms(phone, `📌 Task assigned to you: ${desc}${due}`);
    } catch { /* non-blocking */ }
  }
}

export const tasksRouter = new Hono();

async function callAnthropic(system: string, userMsg: string, maxTokens = 512): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: maxTokens, system, messages: [{ role: "user", content: userMsg }] }),
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
  const today = new Date().toISOString().slice(0, 10);
  const overdueFilters = [...filters, ["date", "<", today], ["date", "!=", ""]];
  const [openTodos, overdueTodos] = await Promise.all([
    erpList("ToDo", { filters, fields: ["name"], limit: 200 }),
    erpList("ToDo", { filters: overdueFilters, fields: ["name"], limit: 200 }),
  ]);
  return c.json({ data: { count: openTodos.length, overdue: overdueTodos.length } });
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

  const assigneeParam = c.req.query("assignee");
  if (assigneeParam && assigneeParam !== "all") {
    filters.push(["allocated_to", "=", assigneeParam]);
  } else if (!assigneeParam && user.role !== "super_admin") {
    filters.push(["allocated_to", "=", user.email]);
  } else if (assigneeParam === "all" && user.role !== "super_admin") {
    // non-admins cannot use assignee=all; fall back to their own tasks
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

  // Prepend recurrence prefix to description if repeat_on is set
  let description = String(body.description);
  if (body.repeat_on === "Daily") description = `[Daily] ${description}`;
  else if (body.repeat_on === "Weekly") description = `[Weekly] ${description}`;
  else if (body.repeat_on === "Monthly") description = `[Monthly] ${description}`;

  const createPayload: Record<string, unknown> = {
    description,
    status: "Open",
    priority: body.priority ?? "Medium",
    date: body.date ?? null,
    allocated_to: body.allocated_to ?? user.email,
    assigned_by: user.email,
  };
  if (body.reference_type) createPayload.reference_type = body.reference_type;
  if (body.reference_name) createPayload.reference_name = body.reference_name;

  const todo = await erpCreate("ToDo", createPayload);

  const desc = description.replace(/<[^>]*>/g, "").slice(0, 80);
  const assigneeEmail = String(body.allocated_to ?? user.email);
  const assigneeName = assigneeEmail.split("@")[0];
  const due = body.date ? ` · due ${body.date}` : "";
  postToRaven(`📋 New task [${body.priority ?? "Medium"}]: ${desc}${due} → ${assigneeName}`, user.email);

  // Notify assignee if different from creator
  if (body.allocated_to && body.allocated_to !== user.email) {
    notifyAssignee(assigneeEmail, description, body.date, user.email);
  }

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

  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [overdueInvoices, readyOrders, upcomingYZ] = await Promise.all([
    erpList("Sales Invoice", {
      filters: [["due_date", "<", today], ["outstanding_amount", ">", 0], ["docstatus", "=", 1]],
      fields: ["name", "customer_name", "outstanding_amount", "due_date"],
      limit: 10
    }).catch((err: unknown) => { console.error("[tasks/suggestions] ERPNext error (invoices):", err); return [] as any[]; }),
    erpList("Sales Order", {
      filters: [["status", "in", ["To Deliver and Bill", "To Deliver"]], ["delivery_date", "<=", nextWeek]],
      fields: ["name", "customer_name", "delivery_date"],
      limit: 10
    }).catch((err: unknown) => { console.error("[tasks/suggestions] ERPNext error (orders):", err); return [] as any[]; }),
    erpList("Sales Order", {
      filters: [["yz_ship_plan", ">=", today], ["yz_ship_plan", "<=", nextWeek], ["yz_ship_plan", "!=", ""]],
      fields: ["name", "customer_name", "yz_ship_plan"],
      limit: 5
    }).catch((err: unknown) => { console.error("[tasks/suggestions] ERPNext error (yz):", err); return [] as any[]; }),
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

  const todo = await erpUpdate("ToDo", id, update) as Record<string, unknown>;

  let completedBy: string | undefined;
  let completedAt: string | undefined;

  if (body.status === "Closed") {
    const desc = String(todo?.description ?? id).replace(/<[^>]*>/g, "").slice(0, 80);
    postToRaven(`✅ Task completed: ${desc}`, user.email);
    completedBy = user.email;
    completedAt = new Date().toISOString();
  }

  // Notify new assignee if allocated_to changed to someone else
  if (body.allocated_to && body.allocated_to !== user.email) {
    const desc = String(body.description ?? todo?.description ?? "").replace(/<[^>]*>/g, "");
    notifyAssignee(String(body.allocated_to), desc, body.date ?? todo?.date, user.email);
  }

  return c.json({
    data: {
      ...(todo ?? {}),
      ...(completedBy ? { completedBy, completedAt } : {}),
    },
  });
});
