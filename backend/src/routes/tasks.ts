import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";

export const tasksRouter = new Hono();

const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? "https://erp.lstailors.com";
const ERP_KEY  = process.env.ERPNEXT_API_KEY ?? "";
const ERP_SEC  = process.env.ERPNEXT_API_SECRET ?? "";
const ERP_AUTH = () => `token ${ERP_KEY}:${ERP_SEC}`;
const ERP_USER = "carl@lstailors.com";

function isMgmt(role: string) {
  return role === "super_admin" || role === "store_manager";
}

function mapPriority(p: string): string {
  return (p ?? "Medium").toLowerCase();
}

async function erpFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${ERP_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: ERP_AUTH(),
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  return res.json() as Promise<any>;
}

tasksRouter.get("/open-count", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  try {
    const filters = JSON.stringify([
      ["ToDo", "status", "=", "Open"],
      ["ToDo", "allocated_to", "=", ERP_USER],
    ]);
    const data = await erpFetch(
      `/api/resource/ToDo?filters=${encodeURIComponent(filters)}&fields=["name"]&limit_page_length=500`
    );
    const count = (data?.data ?? []).length;
    return c.json({ data: { count } });
  } catch {
    return c.json({ data: { count: 0 } });
  }
});

tasksRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const statusParam = c.req.query("status") ?? "Open";
  const context = c.req.query("context");
  try {
    const filters: any[] = [
      ["ToDo", "allocated_to", "=", ERP_USER],
      ["ToDo", "status", "=", statusParam === "open" ? "Open" : statusParam === "closed" ? "Closed" : statusParam],
    ];
    if (context) filters.push(["ToDo", "lsh_context", "=", context]);
    const fields = JSON.stringify(["name","description","date","priority","status","lsh_context","lsh_agent","reference_type","reference_name"]);
    const data = await erpFetch(
      `/api/resource/ToDo?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(fields)}&order_by=date+asc&limit_page_length=100`
    );
    const todos = (data?.data ?? []).map((t: any) => ({
      id: t.name,
      title: t.description,
      status: (t.status ?? "Open").toLowerCase(),
      priority: mapPriority(t.priority),
      due_date: t.date,
      lsh_context: t.lsh_context,
      lsh_agent: t.lsh_agent,
      reference_type: t.reference_type,
      reference_name: t.reference_name,
    }));
    return c.json({ data: todos });
  } catch (e: any) {
    return c.json({ error: { message: e?.message ?? "ERP error" } }, 500);
  }
});

tasksRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user || !isMgmt(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  const body = await c.req.json().catch(() => ({}));
  if (!body.title) return c.json({ error: { message: "title required" } }, 400);
  try {
    const data = await erpFetch("/api/resource/ToDo", {
      method: "POST",
      body: JSON.stringify({
        data: {
          description: body.title,
          status: "Open",
          priority: body.priority ?? "Medium",
          date: body.due_date ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          allocated_to: ERP_USER,
          lsh_context: body.lsh_context ?? "Admin",
          lsh_agent: "Hermes",
        },
      }),
    });
    return c.json({ data: data?.data ?? {} });
  } catch (e: any) {
    return c.json({ error: { message: e?.message ?? "ERP error" } }, 500);
  }
});

tasksRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user || !isMgmt(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const update: any = {};
  if (body.status !== undefined) update.status = body.status === "closed" ? "Closed" : body.status === "open" ? "Open" : body.status;
  if (body.title !== undefined) update.description = body.title;
  if (body.priority !== undefined) update.priority = body.priority;
  try {
    const data = await erpFetch(`/api/resource/ToDo/${id}`, {
      method: "PUT",
      body: JSON.stringify({ data: update }),
    });
    return c.json({ data: data?.data ?? {} });
  } catch (e: any) {
    return c.json({ error: { message: e?.message ?? "ERP error" } }, 500);
  }
});
