import { erpList, erpGet, erpCreate, erpUpdate } from "../erp";
import { findCustomerByPhone, createCustomer, getCustomersByIds } from "./customers";
import { DT } from "./doctypes";
import { isMtmStatus } from "../qc";

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
    orderStatus: order.order_status || (isMtmStatus(order.status) ? order.status : null),
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

/** Map ERP Sales Order status → CustomOrder app status. */
function soToAppStatus(status: string): string {
  if (["Draft", "On Hold", "To Pay"].includes(status)) return "quote";
  if (status === "To Deliver and Bill" || status === "To Deliver") return "in_production";
  if (status === "To Bill") return "ready";
  if (status === "Completed" || status === "Closed") return "delivered";
  if (status === "Cancelled") return "cancelled";
  return "in_production";
}

/** Live MTM book = Sales Order when LSH Custom Order is empty (prod has 0 rows). */
async function listCustomOrdersFromSalesOrders(opts: {
  locationCode?: string | null;
  customerId?: string;
  limit?: number;
}) {
  const filters: unknown[] = [
    ["docstatus", "=", 1],
    ["status", "not in", ["Cancelled"]],
  ];
  if (opts.locationCode === "HOU") {
    filters.push(["company", "like", "%TX%"]);
  } else if (opts.locationCode === "NYC") {
    filters.push(["company", "like", "%NY%"]);
  }
  if (opts.customerId) filters.push(["customer", "=", opts.customerId]);

  const rows = await erpList<any>("Sales Order", {
    filters,
    fields: [
      "name",
      "customer",
      "customer_name",
      "status",
      "grand_total",
      "advance_paid",
      "transaction_date",
      "delivery_date",
      "company",
      "owner",
      "creation",
      "modified",
    ],
    order_by: "transaction_date desc",
    limit: opts.limit ?? 200,
  }).catch(() => []);

  if (!rows.length) return [];

  // Pull first line item names for garment label
  const names = rows.map((r: any) => r.name);
  const items = await erpList<any>("Sales Order Item", {
    filters: [["parent", "in", names]],
    fields: ["name", "parent", "item_name", "amount", "qty"],
    limit: Math.min(names.length * 8, 2000),
  }).catch(() => []);

  const itemsByParent = new Map<string, any[]>();
  for (const it of items) {
    const arr = itemsByParent.get(it.parent) ?? [];
    arr.push(it);
    itemsByParent.set(it.parent, arr);
  }

  const customerIds = [...new Set(rows.map((r: any) => r.customer).filter(Boolean))] as string[];
  const customerMap = await getCustomersByIds(customerIds);

  return rows.map((o: any) => {
    const lineItems = itemsByParent.get(o.name) ?? [];
    const first = lineItems[0];
    const company = String(o.company ?? "");
    const locationId = company.includes("TX") || company.includes("HOU") ? "HOU" : "NYC";
    const customerRow = customerMap.get(o.customer);
    return {
      id: o.name,
      customerId: o.customer,
      customer: customerRow ? serializeCustomer(customerRow) : {
        id: o.customer,
        name: o.customer_name,
        phone: null,
        email: null,
        locationId,
        createdById: null,
        dossier: { vip: false, preferences: null },
        createdAt: o.creation,
        updatedAt: o.modified,
      },
      locationId,
      garmentType: first?.item_name ?? "custom",
      quotedPrice: Number(o.grand_total ?? 0),
      priceTbd: false,
      depositAmount: Number(o.advance_paid ?? 0),
      status: soToAppStatus(o.status ?? ""),
      notes: null,
      spec: {
        yzOrderNumber: null,
        garments: lineItems.map((g: any) => ({
          id: g.name,
          type: g.item_name,
          status: o.status,
          price: Number(g.amount ?? 0),
        })),
        source: "Sales Order",
      },
      createdById: o.owner ?? null,
      createdAt: o.creation ?? o.transaction_date,
      updatedAt: o.modified,
      erpName: o.name,
      orderStatus: null,
    };
  });
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
      "name", "customer", "customer_name", "origin_location", "status", "order_status", "order_total",
      "deposit_amount", "special_instructions", "yz_order_number", "erp_sales_order",
      "sales_rep", "garment_type", "creation", "modified",
    ],
    order_by: "creation desc",
    limit: opts.limit ?? 200,
  }).catch(() => []);

  // Prod: LSH Custom Order is empty — fall through to live Sales Orders.
  if (!rows.length) {
    return listCustomOrdersFromSalesOrders(opts);
  }

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
  const row = await erpGet<any>(DT.CUSTOM_ORDER, id).catch(() => null);
  if (row) {
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

  // Fallback: treat id as Sales Order name (live MTM book).
  const so = await erpGet<any>("Sales Order", id).catch(() => null);
  if (!so) return null;
  const items = await erpList<any>("Sales Order Item", {
    filters: [["parent", "=", id]],
    fields: ["name", "item_name", "amount", "qty"],
    limit: 50,
  }).catch(() => []);
  const customerMap = so.customer ? await getCustomersByIds([so.customer]) : new Map();
  const customerRow = customerMap.get(so.customer);
  const company = String(so.company ?? "");
  const locationId = company.includes("TX") || company.includes("HOU") ? "HOU" : "NYC";
  const first = items[0];
  return {
    id: so.name,
    customerId: so.customer,
    customer: customerRow ? serializeCustomer(customerRow) : {
      id: so.customer,
      name: so.customer_name,
      phone: null,
      email: null,
      locationId,
      createdById: null,
      dossier: { vip: false, preferences: null },
      createdAt: so.creation,
      updatedAt: so.modified,
    },
    locationId,
    garmentType: first?.item_name ?? "custom",
    quotedPrice: Number(so.grand_total ?? 0),
    priceTbd: false,
    depositAmount: Number(so.advance_paid ?? 0),
    status: soToAppStatus(so.status ?? ""),
    notes: so.notes ?? null,
    spec: {
      yzOrderNumber: null,
      garments: items.map((g: any) => ({
        id: g.name,
        type: g.item_name,
        status: so.status,
        price: Number(g.amount ?? 0),
      })),
      source: "Sales Order",
    },
    createdById: so.owner ?? null,
    createdAt: so.creation,
    updatedAt: so.modified,
    erpName: so.name,
    orderStatus: null,
    erp: so,
    grandTotal: Number(so.grand_total ?? 0),
    advancePaid: Number(so.advance_paid ?? 0),
    balanceDue: Math.max(0, Number(so.grand_total ?? 0) - Number(so.advance_paid ?? 0)),
  };
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
