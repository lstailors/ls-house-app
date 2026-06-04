import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase.js";
import { getAuthedUser } from "../lib/scope.js";

export const tasksRouter = new Hono();

function isMgmt(role: string) {
  return role === "super_admin" || role === "store_manager";
}

tasksRouter.get("/open-count", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: { count: 0 } });
  const { count } = await supabaseAdmin
    .from("ls_tasks")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "scheduled", "in_progress"]);
  return c.json({ data: { count: count ?? 0 } });
});

tasksRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });
  const statusParam = c.req.query("status") ?? "open,scheduled,in_progress";
  const statuses = statusParam.split(",").map((s) => s.trim());
  const { data, error } = await supabaseAdmin
    .from("ls_tasks")
    .select("id, title, status, task_type, priority, assigned_to_name, scheduled_at, notes, related_customer_id, created_at")
    .in("status", statuses)
    .order("scheduled_at", { ascending: true });
  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data: data ?? [] });
});

tasksRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user || !isMgmt(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);
  const body = await c.req.json().catch(() => ({}));
  if (!body.title) return c.json({ error: { message: "title required" } }, 400);
  const { data, error } = await supabaseAdmin
    .from("ls_tasks")
    .insert({
      title: body.title,
      task_type: body.task_type ?? "internal",
      priority: body.priority ?? "medium",
      status: "open",
      assigned_to_name: body.assigned_to_name ?? null,
      scheduled_at: body.scheduled_at ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single();
  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data });
});

tasksRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user || !isMgmt(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const update: any = {};
  if (body.status !== undefined) update.status = body.status;
  if (body.title !== undefined) update.title = body.title;
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.notes !== undefined) update.notes = body.notes;
  const { data, error } = await supabaseAdmin.from("ls_tasks").update(update).eq("id", id).select().single();
  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data });
});
