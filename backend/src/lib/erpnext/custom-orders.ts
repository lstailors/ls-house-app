import { erpList, erpGet, erpCreate, erpUpdate } from "../erp";
import { findCustomerByPhone, createCustomer, getCustomersByIds } from "./customers";
import { DT } from "./doctypes";

function toAppStatus(dbStatus: string): string {
  if (["Submitted", "Consultation", "Draft"].includes(dbStatus)) return "quote";
  if (dbStatus === "Ordered") return "deposit_paid";
  if (["Pattern", "Cutting", "Sewing", "First Fitting", "Alterations", "Second Fitting", "Final QC", "In Transit", "Arrived", "In Production"].includes(dbStatus)) return "in_production";
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
    id: row.name,
    name: row.customer_name,
    phone: row.mobile_no,
    email: row.email_id,
    locationId: row.custom_lst_division,
    createdById: null,
    dossier: { vip: row.custom_vip_tier !== "Standard", preferences: row.custom_style_preferences || null },
    createdAt: row.creation,
    updatedAt: row.modified,
  };
}

export function serializeOrder(order: any, garments: any[], customerRow: any) {
  const firstGarment = garments?.[0];
  return {
    id: order.name,
    customerId: order.customer,
    customer: customerRow ? serializeCustomer(customerRow) : undefined,
    locationId: order.origin_location,
    garmentType: firstGarment?.garment_type ?? order.garment_type ?? "suit",
    quotedPrice: Number(order.order_total ?? 0),
    priceTbd: false,
    depositAmount: Number(order.deposit_amount ?? 0),
    status: toAppStatus(order.status ?? "Submitted"),
    notes: order.special_instructions ?? null,
    spec: {
      yzOrderNumber: order.yz_order_number ?? null,
      garments: garments?.map((g) => ({
        id: g.name,
        type: g.garment_type,
        status: g.garment_status ?? g.status,
        price: Number(g.price ?? 0),
      })) ?? [],
    },
    createdById: order.sales_rep ?? null,
    createdAt: order.creation,
    updatedAt: order.modified,
    erpName: order.erp_sales_order ?? order.name,
  };
}

export async function listGarmentsForOrders(orderNames: string[]) {
  if (!orderNames.length) return new Map<string, any[]>();
  const garments = await erpList<any>(DT.CUSTOM_ORDER_GARMENT, {
    filters: [["parent", "in", orderNames]],
    fields: ["name", "parent", "garment_type", "garment_status", "price", "construction"],
    limit: 500,
  });
  const byOrder = new Map<string, any[]>();
  for (const g of garments) {
    const arr = byOrder.get(g.parent) ?? [];
    arr.push(g);
    byOrder.set(g.parent, arr);
  }
  return byOrder;
}

export async function listCustomOrders(opts: {
  locationCode?: string | null;
  customerId?: string;
  salesRepId?: string;
  limit?: number;
}) {
  const filters: unknown[] = [["docstatus", "!=", 2]];
  if (opts.locationCode) filters.push(["origin_location", "=", opts.locationCode]);
  if (opts.customerId) filters.push(["customer", "=", opts.customerId]);
  if (opts.salesRepId) filters.push(["sales_rep", "=", opts.salesRepId]);

  const rows = await erpList<any>(DT.CUSTOM_ORDER, {
    filters,
    fields: [
      "name", "customer", "customer_name", "origin_location", "status", "order_total",
      "deposit_amount", "special_instructions", "yz_order_number", "erp_sales_order",
      "sales_rep", "garment_type", "creation", "modified",
    ],
    order_by: "creation desc",
    limit: opts.limit ?? 200,
  });

  const orderNames = rows.map((r) => r.name);
  const customerIds = [...new Set(rows.map((r) => r.customer).filter(Boolean))] as string[];
  const [customerMap, garmentsByOrder] = await Promise.all([
    getCustomersByIds(customerIds),
    listGarmentsForOrders(orderNames),
  ]);

  return rows.map((r) =>
    serializeOrder(r, garmentsByOrder.get(r.name) ?? [], customerMap.get(r.customer))
  );
}

export async function getCustomOrder(id: string) {
  const row = await erpGet<any>(DT.CUSTOM_ORDER, id);
  if (!row) return null;
  const garments = await erpList<any>(DT.CUSTOM_ORDER_GARMENT, {
    filters: [["parent", "=", id]],
    fields: ["name", "garment_type", "garment_status", "price", "construction"],
    limit: 50,
  });
  const customerMap = row.customer ? await getCustomersByIds([row.customer]) : new Map();
  let erpData: any = null;
  if (row.erp_sales_order) {
    erpData = await erpGet("Sales Order", row.erp_sales_order).catch(() => null);
  }
  const serialized = serializeOrder(row, garments, customerMap.get(row.customer));
  return erpData ? {
    ...serialized,
    erp: erpData,
    grandTotal: Number((erpData as any).grand_total ?? serialized.quotedPrice ?? 0),
    advancePaid: Number((erpData as any).advance_paid ?? serialized.depositAmount ?? 0),
    balanceDue: Math.max(0, Number((erpData as any).grand_total ?? 0) - Number((erpData as any).advance_paid ?? 0)),
  } : serialized;
}

export async function createCustomOrder(body: any, user: { email: string; locationCode?: string | null }) {
  const locCode = body.locationId || user.locationCode;
  if (!locCode) throw new Error("Location required");

  let customerId = body.customerId;
  if (!customerId) {
    const existing = await findCustomerByPhone(body.customerPhone);
    if (existing) {
      customerId = existing.name;
    } else {
      const created = await createCustomer({
        full_name: body.customerName,
        phone: body.customerPhone,
        email: body.customerEmail,
        division: locCode,
      });
      if (!created) throw new Error("Could not create customer");
      customerId = created.id;
    }
  }

  const dbStatus = body.depositAmount > 0 ? "Ordered" : "Submitted";
  const order = await erpCreate<any>(DT.CUSTOM_ORDER, {
    customer: customerId,
    customer_name: body.customerName,
    origin_location: locCode,
    status: dbStatus,
    order_total: body.quotedPrice,
    deposit_amount: body.depositAmount ?? 0,
    special_instructions: body.notes ?? null,
    sales_rep: user.email,
    garment_type: body.garmentType,
    source_channel: "Bespoke In-Shop",
  });
  if (!order) throw new Error("Failed to create order");

  await erpCreate(DT.CUSTOM_ORDER_GARMENT, {
    parent: order.name,
    parenttype: DT.CUSTOM_ORDER,
    parentfield: "garments",
    garment_type: body.garmentType,
    construction: "Made-to-Measure",
    garment_status: "Ordered",
    price: body.quotedPrice,
  });

  try {
    const erpSO = await erpCreate("Sales Order", {
      customer: customerId,
      order_type: "Sales",
      transaction_date: new Date().toISOString().slice(0, 10),
      delivery_date: body.expectedDelivery ?? null,
      po_no: order.name,
      custom_location_code: locCode,
      items: [{
        item_code: `MTM-${(body.garmentType ?? "SUIT").toUpperCase().replace(/ /g, "-")}`,
        qty: 1,
        rate: Number(body.quotedPrice ?? 0),
      }],
    });
    if ((erpSO as any)?.name) {
      order.erp_sales_order = (erpSO as any).name;
      await erpUpdate(DT.CUSTOM_ORDER, order.name, { erp_sales_order: (erpSO as any).name });
    }
  } catch (e) {
    console.error("[custom-orders] ERP SO create failed:", e);
  }

  const customerMap = await getCustomersByIds([customerId]);
  const garments = await erpList<any>(DT.CUSTOM_ORDER_GARMENT, {
    filters: [["parent", "=", order.name]],
    limit: 10,
  });
  return serializeOrder(order, garments, customerMap.get(customerId));
}

export async function updateCustomOrderDeposit(id: string, amount: number) {
  const existing = await erpGet<any>(DT.CUSTOM_ORDER, id);
  if (!existing) throw new Error("Order not found");
  const newDeposit = Number(existing.deposit_amount ?? 0) + amount;
  const newStatus = existing.status === "Submitted" ? "Ordered" : existing.status;
  const updated = await erpUpdate<any>(DT.CUSTOM_ORDER, id, {
    deposit_amount: newDeposit,
    status: newStatus,
  });
  if (!updated) throw new Error("Update failed");
  return updated;
}

export async function updateCustomOrderStatus(id: string, appStatus: string) {
  const updated = await erpUpdate<any>(DT.CUSTOM_ORDER, id, { status: toDbStatus(appStatus) });
  if (!updated) throw new Error("Update failed");
  return updated;
}

export { toDbStatus, toAppStatus };
