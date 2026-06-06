import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpCreate, erpUpdate } from "../lib/erp";

export const tasksRouter = new Hono();

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
