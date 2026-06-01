import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { canSeeFinancials, getAuthedUser } from "../lib/scope";

export const salesOrdersRouter = new Hono();

// Real data lives in public.erp_sales_orders (295 rows from ERPNext sync)

function serializeSalesOrder(row: any) {
  return {
    id: row.id,
    erpnextId: row.erp_name,
    customer: row.end_customer || row.erp_customer
      ? {
          name: row.end_customer ?? row.erp_customer,
          phone: "",
          dossier: { vip: false },
        }
      : null,
    makeType: row.make_type ?? null,
    status: row.status ?? "Draft",
    priceStatus: row.price_status ?? "placeholder",
    total: Number(row.total ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    transactionDate: row.transaction_date ?? null,
    deliveryDate: row.delivery_date ?? null,
    createdAt: row.created_at,
  };
}

salesOrdersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseAdmin) return c.json({ data: [] });

  const statusFilter = c.req.query("status"); // "active" | "all" | specific status

  let q = supabaseAdmin
    .from("erp_sales_orders")
    .select("*")
    .order("transaction_date", { ascending: false })
    .limit(300);

  if (statusFilter === "active") {
    q = q.not("status", "in", '("Completed","Cancelled","Closed")');
  } else if (statusFilter && statusFilter !== "all") {
    q = q.eq("status", statusFilter);
  }

  const { data, error } = await q;
  if (error) return c.json({ error: { message: error.message } }, 500);

  return c.json({ data: (data ?? []).map(serializeSalesOrder) });
});

salesOrdersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const id = c.req.param("id");
  // Support lookup by UUID id or erp_name
  const { data: row, error } = await supabaseAdmin
    .from("erp_sales_orders")
    .select("*")
    .or(`id.eq.${id},erp_name.eq.${id}`)
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);
  return c.json({ data: serializeSalesOrder(row) });
});
