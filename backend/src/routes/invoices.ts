import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { canSeeFinancials, getAuthedUser } from "../lib/scope";

export const invoicesRouter = new Hono();

// Real data lives in public.erp_sales_invoices (118 rows from ERPNext sync)

function serializeInvoice(row: any) {
  return {
    id: row.id,
    erpnextId: row.erp_name,
    salesOrderErpName: row.sales_order ?? null,
    customer: row.end_customer || row.erp_customer
      ? { name: row.end_customer ?? row.erp_customer }
      : null,
    status: normalizeStatus(row.status),
    total: Number(row.total ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    outstandingAmount: Number(row.outstanding_amount ?? 0),
    paidAmount: Number(row.paid_amount ?? 0),
    postingDate: row.posting_date ?? null,
    dueDate: row.due_date ?? null,
    sendStatus: row.send_status ?? null,
    pdfUrl: null, // generated on demand via ERPNext
    createdAt: row.created_at,
  };
}

function normalizeStatus(raw: string): string {
  if (!raw) return "draft";
  const s = raw.toLowerCase();
  if (s === "paid" || s === "return") return "paid";
  if (s === "submitted" || s === "unpaid") return "sent";
  if (s === "overdue") return "overdue";
  if (s === "cancelled") return "void";
  return "draft";
}

invoicesRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseAdmin) return c.json({ data: [] });

  const { data, error } = await supabaseAdmin
    .from("erp_sales_invoices")
    .select("*")
    .order("posting_date", { ascending: false })
    .limit(300);

  if (error) return c.json({ error: { message: error.message } }, 500);

  return c.json({ data: (data ?? []).map(serializeInvoice) });
});

invoicesRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const id = c.req.param("id");
  const { data: row, error } = await supabaseAdmin
    .from("erp_sales_invoices")
    .select("*")
    .or(`id.eq.${id},erp_name.eq.${id}`)
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);
  return c.json({ data: serializeInvoice(row) });
});
