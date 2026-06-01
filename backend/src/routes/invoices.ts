import { Hono } from "hono";
import { lshAdmin } from "../lib/supabase";
import {
  canSeeFinancials,
  getAuthedUser,
  resolveSupabaseLocationId,
  canReadFinancialRow,
} from "../lib/scope";

export const invoicesRouter = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serializeInvoice(row: any) {
  return {
    id: row.id,
    salesOrderId: row.sales_order_id,
    locationId: row.location_id,
    erpnextId: row.erpnext_id,
    status: row.status,
    total: Number(row.total),
    pdfUrl: row.pdf_url,
    createdAt: row.created_at,
    customer: null,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

invoicesRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const locId = resolveSupabaseLocationId(user, c.req.query("locationId"));

  let q = lshAdmin!.from("erp_invoices").select("*").order("created_at", { ascending: false }).limit(200);
  if (locId) q = q.eq("location_id", locId);

  const { data, error } = await q;
  if (error) return c.json({ error: { message: error.message } }, 500);

  return c.json({ data: (data ?? []).map(serializeInvoice) });
});

invoicesRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const { data: row, error } = await lshAdmin!
    .from("erp_invoices")
    .select("*")
    .eq("id", c.req.param("id"))
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);
  if (!canReadFinancialRow(user, row)) return c.json({ error: { message: "Forbidden" } }, 403);

  return c.json({ data: serializeInvoice(row) });
});
