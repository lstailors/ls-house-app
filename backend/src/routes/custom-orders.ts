import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser, resolveLocationCode, canSeeFinancials } from "../lib/scope";
import { CreateCustomOrderInput, TakeDepositInput, UpdateOrderStatusInput } from "../types";

export const customOrdersRouter = new Hono();

// ── Status mappers ──────────────────────────────────────────────────────────
function toAppStatus(dbStatus: string): string {
  if (["Submitted", "Consultation"].includes(dbStatus)) return "quote";
  if (dbStatus === "Ordered") return "deposit_paid";
  if (["Pattern", "Cutting", "Sewing", "First Fitting", "Alterations", "Second Fitting", "Final QC", "In Transit", "Arrived"].includes(dbStatus)) return "in_production";
  if (dbStatus === "Complete") return "ready";
  if (dbStatus === "Delivered") return "delivered";
  if (dbStatus === "Cancelled") return "cancelled";
  return "quote";
}

function toDbStatus(appStatus: string): string {
  const map: Record<string, string> = {
    quote: "Submitted",
    deposit_paid: "Ordered",
    in_production: "Pattern",
    ready: "Complete",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  return map[appStatus] ?? "Submitted";
}

function serializeCustomer(row: any) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.full_name,
    phone: row.phone,
    email: row.email,
    locationId: row.division,
    createdById: null,
    dossier: { vip: row.vip_tier !== "Standard", preferences: row.style_preferences || null },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchCustomerMap(ids: string[]): Promise<Map<string, any>> {
  if (!ids.length || !supabaseAdmin) return new Map();
  const { data } = await supabaseAdmin
    .from("customers")
    .select("id,full_name,phone,email,division,vip_tier,style_preferences,created_at,updated_at")
    .in("id", ids);
  return new Map((data ?? []).map((r: any) => [r.id, r]));
}

function serializeOrder(order: any, garments: any[], customerRow: any) {
  const firstGarment = garments?.[0];
  return {
    id: order.id,
    customerId: order.customer_id,
    customer: customerRow ? serializeCustomer(customerRow) : undefined,
    locationId: order.origin_location,
    garmentType: firstGarment?.garment_type ?? "suit",
    quotedPrice: Number(order.order_total ?? 0),
    priceTbd: false,
    depositAmount: Number(order.deposit_amount ?? 0),
    status: toAppStatus(order.status),
    notes: order.special_instructions ?? null,
    spec: {
      yzOrderNumber: order.yz_order_number,
      garments: garments?.map((g) => ({
        id: g.id,
        type: g.garment_type,
        status: g.status,
        price: Number(g.price ?? 0),
      })) ?? [],
    },
    createdById: order.sales_rep_id ?? null,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

customOrdersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });
  if (!supabaseAdmin) return c.json({ data: [] });

  const locCode = resolveLocationCode(user, c.req.query("locationId"));
  const filterCustomerId = c.req.query("customerId");
  const limitParam = parseInt(c.req.query("limit") ?? "200");
  const limit = Math.min(isNaN(limitParam) ? 200 : limitParam, 500);

  let q = supabaseAdmin.from("orders").select("*").order("created_at", { ascending: false }).limit(limit);
  if (locCode) q = q.eq("origin_location", locCode);
  if (filterCustomerId) q = q.eq("customer_id", filterCustomerId);
  if (user.role === "salesperson") {
    const createdBy = user.supabaseProfileId || user.id;
    q = q.eq("sales_rep_id", createdBy);
  }

  const { data, error } = await q;
  if (error) return c.json({ error: { message: error.message } }, 500);
  const rows = data ?? [];

  const orderIds = rows.map((r: any) => r.id);
  const customerIds = [...new Set(rows.map((r: any) => r.customer_id).filter(Boolean))] as string[];

  const [customerMap, garmentsData] = await Promise.all([
    fetchCustomerMap(customerIds),
    orderIds.length
      ? supabaseAdmin.from("garments").select("*").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
  ]);

  const garmentsByOrder = new Map<string, any[]>();
  for (const g of (garmentsData.data ?? [])) {
    if (!garmentsByOrder.has(g.order_id)) garmentsByOrder.set(g.order_id, []);
    garmentsByOrder.get(g.order_id)!.push(g);
  }

  return c.json({
    data: rows.map((r: any) =>
      serializeOrder(r, garmentsByOrder.get(r.id) ?? [], customerMap.get(r.customer_id))
    ),
  });
});

customOrdersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const id = c.req.param("id");
  const { data: row, error } = await supabaseAdmin.from("orders").select("*").eq("id", id).single();
  if (error || !row) return c.json({ error: { message: "Not found" } }, 404);

  const locCode = resolveLocationCode(user, null);
  if (user.role !== "super_admin" && locCode && row.origin_location !== locCode) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const [garmentRes, customerMap] = await Promise.all([
    supabaseAdmin.from("garments").select("*").eq("order_id", id),
    fetchCustomerMap(row.customer_id ? [row.customer_id] : []),
  ]);

  return c.json({
    data: serializeOrder(row, garmentRes.data ?? [], customerMap.get(row.customer_id)),
  });
});

customOrdersRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const parsed = CreateCustomOrderInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { message: "Invalid input" } }, 400);
  const body = parsed.data;

  const locCode =
    user.role === "super_admin"
      ? (body.locationId || user.locationCode)
      : user.locationCode;
  if (!locCode) return c.json({ error: { message: "Location required" } }, 400);

  // Find-or-create customer by phone
  let customerId: string;
  const { data: existing } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", body.customerPhone)
    .maybeSingle();

  if (existing) {
    customerId = existing.id;
  } else {
    const { data: created, error: createErr } = await supabaseAdmin
      .from("customers")
      .insert({
        full_name: body.customerName,
        phone: body.customerPhone,
        email: body.customerEmail || null,
        division: locCode,
      })
      .select("id")
      .single();
    if (createErr || !created) return c.json({ error: { message: "Failed to create customer" } }, 500);
    customerId = created.id;
  }

  const dbStatus = body.depositAmount > 0 ? "Ordered" : "Submitted";

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .insert({
      customer_id: customerId,
      source_channel: "Bespoke In-Shop",
      status: dbStatus,
      order_total: body.quotedPrice,
      deposit_amount: body.depositAmount,
      origin_location: locCode,
      special_instructions: body.notes || null,
      sales_rep_id: user.supabaseProfileId || null,
    })
    .select("*")
    .single();

  if (orderErr || !order) return c.json({ error: { message: orderErr?.message ?? "Failed to create order" } }, 500);

  const { data: garment } = await supabaseAdmin
    .from("garments")
    .insert({
      order_id: order.id,
      garment_type: body.garmentType,
      construction: "Made-to-Measure",
      status: "Ordered",
      price: body.quotedPrice,
    })
    .select("*")
    .single();

  const customerMap = await fetchCustomerMap([customerId]);
  return c.json({ data: serializeOrder(order, garment ? [garment] : [], customerMap.get(customerId)) }, 201);
});

customOrdersRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Not found" } }, 404);

  const id = c.req.param("id");
  const parsed = UpdateOrderStatusInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { message: "Invalid input" } }, 400);
  const input = parsed.data;

  const { data: existing, error: fetchErr } = await supabaseAdmin.from("orders").select("*").eq("id", id).single();
  if (fetchErr || !existing) return c.json({ error: { message: "Not found" } }, 404);

  const locCode = resolveLocationCode(user, null);
  if (user.role !== "super_admin" && locCode && existing.origin_location !== locCode) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("orders")
    .update({ status: toDbStatus(input.status) })
    .eq("id", id)
    .select("*")
    .single();

  if (updateErr || !updated) return c.json({ error: { message: updateErr?.message ?? "Update failed" } }, 500);

  const [garmentRes, customerMap] = await Promise.all([
    supabaseAdmin.from("garments").select("*").eq("order_id", id),
    fetchCustomerMap(updated.customer_id ? [updated.customer_id] : []),
  ]);

  return c.json({ data: serializeOrder(updated, garmentRes.data ?? [], customerMap.get(updated.customer_id)) });
});

// STUB: Square card-present deposit
customOrdersRouter.post("/deposit", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const parsed = TakeDepositInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { message: "Invalid input" } }, 400);
  const { customOrderId, amount } = parsed.data;

  const { data: existing, error: fetchErr } = await supabaseAdmin.from("orders").select("*").eq("id", customOrderId).single();
  if (fetchErr || !existing) return c.json({ error: { message: "Order not found" } }, 404);

  const locCode = resolveLocationCode(user, null);
  if (user.role !== "super_admin" && locCode && existing.origin_location !== locCode) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const newDeposit = Number(existing.deposit_amount) + amount;
  const newStatus = existing.status === "Submitted" ? "Ordered" : existing.status;

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("orders")
    .update({ deposit_amount: newDeposit, status: newStatus })
    .eq("id", customOrderId)
    .select("*")
    .single();

  if (updateErr || !updated) return c.json({ error: { message: updateErr?.message ?? "Update failed" } }, 500);

  const [garmentRes, customerMap] = await Promise.all([
    supabaseAdmin.from("garments").select("*").eq("order_id", customOrderId),
    fetchCustomerMap(updated.customer_id ? [updated.customer_id] : []),
  ]);

  return c.json({
    data: {
      order: serializeOrder(updated, garmentRes.data ?? [], customerMap.get(updated.customer_id)),
      receipt: {
        provider: "Square (stub)",
        status: "approved",
        amount,
        transactionId: `sqr_stub_${Date.now()}`,
        last4: "4242",
        timestamp: new Date().toISOString(),
      },
    },
  });
});
