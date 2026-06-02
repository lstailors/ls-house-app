import { Hono } from "hono";
import { getAuthedUser, canSeeFinancials } from "../lib/scope";
import { erpList, erpGet } from "../lib/erp";

export const salesOrdersRouter = new Hono();

function serializeSalesOrder(row: any) {
  return {
    id: row.name,
    erpnextId: row.name,
    customer: row.customer ? { id: row.customer, name: row.customer_name ?? row.customer } : null,
    makeType: row.make_type ?? null,
    status: row.status ?? "Draft",
    billingStatus: row.billing_status ?? null,
    deliveryStatus: row.delivery_status ?? null,
    perBilled: row.per_billed ?? 0,
    perDelivered: row.per_delivered ?? 0,
    advancePaid: Number(row.advance_paid ?? 0),
    total: Number(row.total ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    transactionDate: row.transaction_date ?? null,
    deliveryDate: row.delivery_date ?? null,
    contactMobile: row.contact_mobile ?? null,
    createdAt: row.creation ?? null,
  };
}

// GET /api/sales-orders?status=active|all|Draft|Completed|...
salesOrdersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const statusFilter = c.req.query("status") ?? "active";
  const page = Number(c.req.query("page") ?? "1");
  const limit = Number(c.req.query("limit") ?? "50");
  const start = (page - 1) * limit;

  const filters: any[] = [];
  if (statusFilter === "active") {
    filters.push(["status", "not in", ["Completed", "Cancelled", "Closed"]]);
  } else if (statusFilter && statusFilter !== "all") {
    filters.push(["status", "=", statusFilter]);
  }

  try {
    const rows = await erpList<any>("Sales Order", {
      filters,
      fields: [
        "name", "customer", "customer_name", "status", "make_type",
        "grand_total", "total", "advance_paid", "transaction_date",
        "delivery_date", "creation", "contact_mobile",
        "billing_status", "delivery_status", "per_billed", "per_delivered",
      ],
      limit,
      order_by: "transaction_date desc",
    });

    // Get total count
    const allRows = await erpList<any>("Sales Order", {
      filters,
      fields: ["name"],
      limit: 5000,
    });

    return c.json({
      data: rows.map(serializeSalesOrder),
      total: allRows.length,
      page,
      limit,
    });
  } catch (e: any) {
    console.error("sales orders fetch failed:", e?.message);
    return c.json({ data: [], total: 0, page, limit });
  }
});

// GET /api/sales-orders/:id
salesOrdersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  try {
    const id = c.req.param("id");
    const doc = await erpGet<any>("Sales Order", id);
    if (!doc) return c.json({ error: { message: "Not found" } }, 404);

    // Fetch linked Sales Invoices
    const invoices = await erpList<any>("Sales Invoice", {
      filters: [["sales_order", "=", id]],
      fields: ["name", "status", "grand_total", "outstanding_amount", "posting_date", "due_date"],
      limit: 20,
    }).catch(() => []);

    // Fetch customer details
    const customer = doc.customer
      ? await erpGet<any>("Customer", doc.customer).catch(() => null)
      : null;

    return c.json({
      data: {
        // Core fields
        name: doc.name,
        customer: doc.customer,
        customerName: doc.customer_name,
        status: doc.status,
        makeType: doc.make_type ?? null,
        company: doc.company,
        transactionDate: doc.transaction_date,
        deliveryDate: doc.delivery_date,

        // Contact
        contactPhone: doc.contact_phone ?? null,
        contactMobile: doc.contact_mobile ?? null,
        contactEmail: doc.contact_email ?? null,
        addressDisplay: doc.address_display ?? null,
        shippingAddress: doc.shipping_address ?? null,

        // Financials
        total: Number(doc.total ?? 0),
        grandTotal: Number(doc.grand_total ?? 0),
        advancePaid: Number(doc.advance_paid ?? 0),
        totalTaxes: Number(doc.total_taxes_and_charges ?? 0),
        taxesAndCharges: doc.taxes_and_charges ?? null,
        billingStatus: doc.billing_status ?? null,
        deliveryStatus: doc.delivery_status ?? null,
        perBilled: doc.per_billed ?? 0,
        perDelivered: doc.per_delivered ?? 0,

        // Line items
        items: (doc.items ?? []).map((i: any) => ({
          name: i.name,
          item_code: i.item_code,
          item_name: i.item_name,
          description: i.description ?? null,
          qty: i.qty,
          rate: Number(i.rate ?? 0),
          amount: Number(i.amount ?? 0),
          warehouse: i.warehouse ?? null,
          deliveredQty: i.delivered_qty ?? 0,
          billedAmt: i.billed_amt ?? 0,
        })),

        // Linked docs
        invoices,

        // Customer enrichment
        customerMobile: customer?.mobile_no ?? null,
        customerEmail: customer?.email_id ?? null,
        customerGroup: customer?.customer_group ?? null,

        // Meta
        creation: doc.creation,
        modified: doc.modified,
        docstatus: doc.docstatus,
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 500);
  }
});
