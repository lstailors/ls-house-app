import { Hono } from "hono";
import { supabaseAdmin, lshAdmin } from "../lib/supabase";
import {
  canSeeFinancials,
  getAuthedUser,
  resolveSupabaseLocationId,
  canReadFinancialRow,
} from "../lib/scope";

export const salesOrdersRouter = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serializeCustomer(row: any) {
  return {
    id: row.id,
    name: row.full_name,
    phone: row.phone,
    email: row.email,
    locationId: row.division,
    createdById: null,
    dossier: {
      vip: row.vip_tier !== "Standard",
      preferences: row.style_preferences || null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeSalesOrder(row: any, customer: any) {
  return {
    id: row.id,
    customOrderId: row.custom_order_id,
    locationId: row.location_id,
    erpnextId: row.erpnext_id,
    status: row.status,
    total: Number(row.total),
    payload: row.payload_json,
    createdAt: row.created_at,
    customer: customer ?? null,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Financials: super_admin + store_manager only.
salesOrdersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const locId = resolveSupabaseLocationId(user, c.req.query("locationId"));

  let q = lshAdmin!.from("sales_orders").select("*").order("created_at", { ascending: false }).limit(200);
  if (locId) q = q.eq("location_id", locId);

  const { data, error } = await q;
  if (error) return c.json({ error: { message: error.message } }, 500);

  const rows = data ?? [];

  // Three-pass: sales_orders → custom_orders → customers
  const customOrderIds = [...new Set(rows.map((r: any) => r.custom_order_id).filter(Boolean))] as string[];
  let customerMap = new Map<string, any>();

  if (customOrderIds.length && lshAdmin) {
    const { data: customOrders } = await lshAdmin
      .from("custom_orders")
      .select("id, customer_id")
      .in("id", customOrderIds);

    if (customOrders?.length) {
      const customerIds = [...new Set(customOrders.map((co: any) => co.customer_id).filter(Boolean))] as string[];
      // Map custom_order_id → customer_id
      const coToCustomer = new Map<string, string>();
      for (const co of customOrders) coToCustomer.set(co.id, co.customer_id);

      if (customerIds.length && supabaseAdmin) {
        const { data: customers } = await supabaseAdmin
          .from("customers")
          .select("id, full_name, phone, email, division, vip_tier, style_preferences, created_at, updated_at")
          .in("id", customerIds);

        if (customers) {
          const rawMap = new Map(customers.map((c: any) => [c.id, c]));
          // Build map keyed by custom_order_id for easy lookup
          for (const [coId, custId] of coToCustomer.entries()) {
            const rawCustomer = rawMap.get(custId);
            if (rawCustomer) customerMap.set(coId, serializeCustomer(rawCustomer));
          }
        }
      }
    }
  }

  return c.json({
    data: rows.map((r: any) => serializeSalesOrder(r, r.custom_order_id ? customerMap.get(r.custom_order_id) : null)),
  });
});

salesOrdersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const { data: row, error } = await lshAdmin!
    .from("sales_orders")
    .select("*")
    .eq("id", c.req.param("id"))
    .single();

  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);
  if (!canReadFinancialRow(user, row)) return c.json({ error: { message: "Forbidden" } }, 403);

  return c.json({ data: serializeSalesOrder(row, null) });
});
