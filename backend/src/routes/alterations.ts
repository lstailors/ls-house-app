import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";

export const alterationsRouter = new Hono();

// Alterations come from ERPNext via the public.erp_alteration_tickets mirror.
// If that table doesn't exist yet (pre-sync), we fall back to empty gracefully.

function serializeTicket(row: any) {
  return {
    id: row.id ?? row.erp_name,
    erpName: row.erp_name,
    customer: row.customer_name
      ? { name: row.customer_name, phone: row.customer_phone ?? "", dossier: { vip: false } }
      : null,
    tailor: row.tailor_name ? { name: row.tailor_name } : null,
    items: Array.isArray(row.items)
      ? row.items.map((i: any) => ({ label: i.description ?? i.item_name ?? "Item" }))
      : [],
    dueDate: row.due_date ?? row.delivery_date ?? null,
    status: normalizeStatus(row.status),
    price: Number(row.grand_total ?? row.total ?? 0),
    createdAt: row.created_at ?? row.posting_date ?? null,
  };
}

function normalizeStatus(raw: string): string {
  if (!raw) return "intake";
  const s = raw.toLowerCase();
  if (s.includes("complete") || s.includes("done")) return "picked_up";
  if (s.includes("ready") || s.includes("deliver")) return "ready";
  if (s.includes("progress") || s.includes("wip")) return "in_progress";
  if (s.includes("cancel")) return "cancelled";
  return "intake";
}

alterationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  if (!supabaseAdmin) return c.json({ data: [] });

  // Try the ERPNext mirror table first
  const { data, error } = await supabaseAdmin
    .from("erp_alteration_tickets")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    // Table may not exist yet — return empty, not 500
    return c.json({ data: [] });
  }

  return c.json({ data: (data ?? []).map(serializeTicket) });
});

alterationsRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  return c.json({ error: { message: "Not found" } }, 404);
});
