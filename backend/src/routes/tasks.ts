import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet, erpCreate, erpUpdate } from "../lib/erp";
import { grokChat, grokJSON } from "../lib/grok";

export const tasksRouter = new Hono();

// ── ERPNext ToDo integration ─────────────────────────────────────────────────
// The /tasks page is backed 1:1 by the ERPNext **ToDo** doctype. We speak the
// doctype's native field names (description / date / status / priority /
// allocated_to) so the frontend binds without a translation layer.

const TODO_FIELDS = [
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
  "lsh_context",
  "lsh_agent",
];

// Staff roster — kept in sync with the assignee pills in webapp Tasks.tsx.
const STAFF: { name: string; email: string }[] = [
  { name: "Carl", email: "carl@lstailors.com" },
  { name: "Kelvin", email: "kelvin@lstailors.com" },
  { name: "Gianna", email: "gianna@lstailors.com" },
  { name: "Antonio", email: "antonio@lstailors.com" },
];

function isMgmt(role: string): boolean {
  return role === "super_admin" || role === "store_manager";
}

function stripHtml(html: string): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function nyToday(): string {
  // YYYY-MM-DD in America/New_York (the store's timezone).
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Normalize an incoming status to the ERPNext casing.
function normStatus(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const v = s.toLowerCase();
  if (v === "open") return "Open";
  if (v === "closed") return "Closed";
  if (v === "cancelled" || v === "canceled") return "Cancelled";
  return undefined;
}

interface ErpTodo {
  name: string;
  description?: string;
  status?: string;
  priority?: string;
  date?: string | null;
  allocated_to?: string | null;
  assigned_by?: string | null;
  assigned_by_full_name?: string | null;
  reference_type?: string | null;
  reference_name?: string | null;
  lsh_context?: string | null;
  lsh_agent?: string | null;
}

// Shape returned to the webapp — matches the `Todo` interface in Tasks.tsx.
function serialize(t: ErpTodo) {
  return {
    name: t.name,
    description: t.description ?? "",
    status: t.status ?? "Open",
    priority: t.priority ?? "Medium",
    date: t.date ?? null,
    allocated_to: t.allocated_to ?? null,
    assigned_by: t.assigned_by ?? null,
    assigned_by_full_name: t.assigned_by_full_name ?? null,
    reference_type: t.reference_type ?? null,
    reference_name: t.reference_name ?? null,
    lsh_context: t.lsh_context ?? null,
    lsh_agent: t.lsh_agent ?? null,
  };
}

// ── List ──────────────────────────────────────────────────────────────────────
// GET /api/tasks?status=open|all|closed&assignee=<email>|all
tasksRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const status = (c.req.query("status") ?? "open").toLowerCase();
  const assignee = c.req.query("assignee") ?? "all";
  const context = c.req.query("context");
  const mgmt = isMgmt(user.role);

  const filters: unknown[] = [];

  // Status: "all" => no status filter.
  if (status === "open") filters.push(["status", "=", "Open"]);
  else if (status === "closed") filters.push(["status", "=", "Closed"]);

  // Visibility: non-management always scoped to their own tasks. Management can
  // pick a specific assignee via the pills, or "all" to see the whole team.
  if (!mgmt) {
    filters.push(["allocated_to", "=", user.email]);
  } else if (assignee && assignee !== "all") {
    filters.push(["allocated_to", "=", assignee]);
  }

  if (context) filters.push(["lsh_context", "=", context]);

  try {
    const rows = await erpList<ErpTodo>("ToDo", {
      filters,
      fields: TODO_FIELDS,
      order_by: "date asc",
      limit: 200,
    });
    return c.json({ data: rows.map(serialize) });
  } catch (e: any) {
    return c.json({ error: { message: e?.message ?? "ERP error" } }, 500);
  }
});

// ── Open count (sidebar badge) ────────────────────────────────────────────────
// GET /api/tasks/open-count → { count, overdue } for the logged-in user.
tasksRouter.get("/open-count", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  try {
    const rows = await erpList<ErpTodo>("ToDo", {
      filters: [
        ["status", "=", "Open"],
        ["allocated_to", "=", user.email],
      ],
      fields: ["name", "date"],
      limit: 500,
    });
    const today = nyToday();
    const overdue = rows.filter((r) => r.date && r.date < today).length;
    return c.json({ data: { count: rows.length, overdue } });
  } catch {
    return c.json({ data: { count: 0, overdue: 0 } });
  }
});

// ── AI: daily briefing (Sofia / Grok) ────────────────────────────────────────
// GET /api/tasks/briefing → { briefing } summarizing the viewer's open tasks.
tasksRouter.get("/briefing", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  try {
    const todos = await erpList<ErpTodo>("ToDo", {
      filters: [
        ["status", "=", "Open"],
        ["allocated_to", "=", user.email],
      ],
      fields: ["description", "priority", "date"],
      order_by: "date asc",
      limit: 50,
    });
    if (todos.length === 0) return c.json({ data: { briefing: "" } });

    const today = nyToday();
    const overdue = todos.filter((t) => t.date && t.date < today).length;
    const dueToday = todos.filter((t) => t.date === today).length;
    const lines = todos
      .slice(0, 25)
      .map((t) => `- [${t.priority ?? "Medium"}] ${stripHtml(t.description ?? "")} (due ${t.date ?? "no date"})`)
      .join("\n");

    const briefing = await grokChat(
      [
        {
          role: "system",
          content:
            "You are Sofia preparing a quick task briefing. Write ONE or TWO sentences, " +
            "plain English, no markdown, no bullet symbols, no sign-off. Lead with what's " +
            "most urgent (overdue first, then due today). Be warm and concise.",
        },
        {
          role: "user",
          content:
            `Briefing for ${user.name || user.email}. ${todos.length} open tasks, ` +
            `${overdue} overdue, ${dueToday} due today.\n\nTasks:\n${lines}\n\nWrite the briefing now.`,
        },
      ],
      { maxTokens: 160, temperature: 0.3 },
    );
    return c.json({ data: { briefing } });
  } catch {
    return c.json({ data: { briefing: "" } });
  }
});

// ── AI: suggested tasks (Sofia / Grok) — super_admin only ─────────────────────
// GET /api/tasks/suggestions → [{ description, priority, date }]
tasksRouter.get("/suggestions", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin") return c.json({ data: [] });

  try {
    const today = nyToday();
    const open = await erpList<ErpTodo>("ToDo", {
      filters: [["status", "=", "Open"]],
      fields: ["description", "priority", "date", "allocated_to"],
      order_by: "date asc",
      limit: 100,
    });
    const overdue = open.filter((t) => t.date && t.date < today).length;
    const existing = open
      .slice(0, 40)
      .map((t) => `- ${stripHtml(t.description ?? "")}`)
      .join("\n");

    const parsed = await grokJSON<{ tasks?: { description: string; priority: string; date: string | null }[] }>(
      [
        {
          role: "system",
          content:
            "You are Sofia, operations co-pilot for a custom tailoring shop. Propose up to 3 " +
            "concrete, NEW follow-up tasks the owner likely needs that are NOT already in the " +
            "list. Respond ONLY as JSON: " +
            '{"tasks":[{"description":string,"priority":"High"|"Medium"|"Low","date":"YYYY-MM-DD"|null}]}. ' +
            `Today is ${today}.`,
        },
        {
          role: "user",
          content:
            `There are ${open.length} open tasks (${overdue} overdue). Existing tasks:\n${existing}\n\n` +
            "Suggest up to 3 new tasks as JSON.",
        },
      ],
      { maxTokens: 400, temperature: 0.5 },
    );

    const valid = (parsed?.tasks ?? [])
      .filter((t) => t && typeof t.description === "string" && t.description.trim())
      .slice(0, 3)
      .map((t) => ({
        description: t.description.trim(),
        priority: ["High", "Medium", "Low"].includes(t.priority) ? t.priority : "Medium",
        date: typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null,
      }));
    return c.json({ data: valid });
  } catch {
    return c.json({ data: [] });
  }
});

// ── AI: natural-language parse (Sofia / Grok) ─────────────────────────────────
// POST /api/tasks/ai-parse { text } → { description, priority, date, allocated_to }
tasksRouter.post("/ai-parse", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const body = await c.req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: { message: "text required" } }, 400);

  const today = nyToday();
  const roster = STAFF.map((s) => `${s.name} = ${s.email}`).join(", ");

  const parsed = await grokJSON<{
    description?: string;
    priority?: string;
    date?: string | null;
    allocated_to?: string | null;
  }>(
    [
      {
        role: "system",
        content:
          "Parse a natural-language task into JSON. Respond ONLY as JSON: " +
          '{"description":string,"priority":"High"|"Medium"|"Low","date":"YYYY-MM-DD"|null,"allocated_to":string|null}. ' +
          `Today is ${today} (America/New_York). Resolve relative dates like "tomorrow" / "next Friday". ` +
          `If a person is named, map to one of these emails (else null): ${roster}. ` +
          "Default priority Medium. Keep the description short and imperative.",
      },
      { role: "user", content: text },
    ],
    { maxTokens: 220, temperature: 0.2 },
  );

  const validEmail = (e: unknown) =>
    typeof e === "string" && STAFF.some((s) => s.email === e) ? (e as string) : null;

  return c.json({
    data: {
      description:
        typeof parsed?.description === "string" && parsed.description.trim() ? parsed.description.trim() : text,
      priority: ["High", "Medium", "Low"].includes(parsed?.priority as string) ? parsed!.priority : "Medium",
      date: typeof parsed?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      allocated_to: validEmail(parsed?.allocated_to),
    },
  });
});

// ── AI: priority assist (Sofia / Grok) ───────────────────────────────────────
// POST /api/tasks/ai-priority { description } → { priority, reason }
tasksRouter.post("/ai-priority", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const body = await c.req.json().catch(() => ({}));
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return c.json({ error: { message: "description required" } }, 400);

  const parsed = await grokJSON<{ priority?: string; reason?: string }>(
    [
      {
        role: "system",
        content:
          "Assess the priority of a task for a custom tailoring shop. Respond ONLY as JSON: " +
          '{"priority":"High"|"Medium"|"Low","reason":string}. ' +
          "High = time-sensitive, customer-facing, or revenue-impacting. Reason under 12 words.",
      },
      { role: "user", content: description },
    ],
    { maxTokens: 80, temperature: 0.2 },
  );

  return c.json({
    data: {
      priority: ["High", "Medium", "Low"].includes(parsed?.priority as string) ? parsed!.priority : "Medium",
      reason: typeof parsed?.reason === "string" ? parsed.reason : "",
    },
  });
});

// ── Create ────────────────────────────────────────────────────────────────────
// POST /api/tasks { description, priority?, date?, allocated_to?, reference_type?, reference_name?, lsh_context? }
tasksRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const body = await c.req.json().catch(() => ({}));
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return c.json({ error: { message: "description required" } }, 400);

  const mgmt = isMgmt(user.role);
  // Non-management can only create tasks for themselves.
  const allocatedTo =
    mgmt && typeof body.allocated_to === "string" && body.allocated_to.trim()
      ? body.allocated_to.trim()
      : user.email;

  const doc: Record<string, unknown> = {
    description,
    status: "Open",
    priority: ["High", "Medium", "Low"].includes(body.priority) ? body.priority : "Medium",
    date:
      typeof body.date === "string" && body.date
        ? body.date
        : new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    allocated_to: allocatedTo,
    assigned_by: user.email,
    lsh_context: typeof body.lsh_context === "string" && body.lsh_context ? body.lsh_context : "Admin",
    lsh_agent: "Hermes",
  };
  if (typeof body.reference_type === "string" && body.reference_type) doc.reference_type = body.reference_type;
  if (typeof body.reference_name === "string" && body.reference_name) doc.reference_name = body.reference_name;

  try {
    const created = await erpCreate<ErpTodo>("ToDo", doc);
    return c.json({ data: created ? serialize(created) : {} });
  } catch (e: any) {
    return c.json({ error: { message: e?.message ?? "ERP error" } }, 500);
  }
});

// ── Update ────────────────────────────────────────────────────────────────────
// PATCH /api/tasks/:id { status?, description?, priority?, date?, allocated_to? }
tasksRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const id = c.req.param("id");

  let existing: ErpTodo | null;
  try {
    existing = await erpGet<ErpTodo>("ToDo", id);
  } catch (e: any) {
    return c.json({ error: { message: e?.message ?? "ERP error" } }, 500);
  }
  if (!existing) return c.json({ error: { message: "Not found" } }, 404);

  const mgmt = isMgmt(user.role);
  // Users may edit their own tasks; management may edit anyone's.
  if (!mgmt && existing.allocated_to !== user.email) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  const status = normStatus(body.status);
  if (status) update.status = status;
  if (typeof body.description === "string") update.description = body.description.trim();
  if (["High", "Medium", "Low"].includes(body.priority)) update.priority = body.priority;
  if (typeof body.date === "string" || body.date === null) update.date = body.date;
  // Only management may reassign a task.
  if (mgmt && typeof body.allocated_to === "string" && body.allocated_to.trim()) {
    update.allocated_to = body.allocated_to.trim();
  }

  if (Object.keys(update).length === 0) {
    return c.json({ data: serialize(existing) });
  }

  try {
    const updated = await erpUpdate<ErpTodo>("ToDo", id, update);
    return c.json({ data: updated ? serialize(updated) : serialize(existing) });
  } catch (e: any) {
    return c.json({ error: { message: e?.message ?? "ERP error" } }, 500);
  }
});
