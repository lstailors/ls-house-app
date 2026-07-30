import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getAuthedUser, canSeeFinancials } from "../lib/scope";
import { erpList, erpGet, erpCreate, erpSubmit, erpUpdate } from "../lib/erp";

export const invoicesRouter = new Hono();

/** FOH (salesperson+) can list/view/charge; driver blocked. */
function canAccessInvoices(role: string): boolean {
  return role !== "driver";
}

function normalizeStatus(raw: string): string {
  if (!raw) return "draft";
  const s = raw.toLowerCase();
  if (s === "cancelled") return "void";
  if (s === "draft") return "draft";
  if (s.includes("overdue")) return "overdue";
  if (s.includes("partly paid")) return "partly_paid";
  if (s === "paid" || s.startsWith("paid ")) return "paid";
  if (s.includes("unpaid")) return "unpaid";
  if (s === "return" || s.includes("credit note")) return "void";
  return s.replace(/\s+/g, "_");
}

/** Alteration SI vs custom-made / MTM / other. */
function detectKind(row: any): "alteration" | "custom" | "other" {
  const remarks = String(row.remarks || "");
  const ticketRef = row.alteration_ticket_ref || remarks.match(/ALT-[A-Z]+-\d{4}-\d+/)?.[0];
  if (ticketRef || /alteration ticket|auto-generated from alteration/i.test(remarks)) {
    return "alteration";
  }
  if (
    /against customer order|sales order|custom|mtm|made.to.measure/i.test(remarks) ||
    row.po_no
  ) {
    return "custom";
  }
  // Name series heuristic: LSTNY-SINV often mixed; default custom for non-ALT
  return ticketRef ? "alteration" : "custom";
}

function serializeInvoice(row: any) {
  const remarks = row.remarks ?? null;
  const altRef =
    row.alteration_ticket_ref ||
    (typeof remarks === "string" ? remarks.match(/ALT-[A-Z]+-\d{4}-\d+/)?.[0] : null) ||
    null;
  const kind = detectKind(row);
  return {
    id: row.name,
    erpnextId: row.name,
    customer: row.customer ? { id: row.customer, name: row.customer_name ?? row.customer } : null,
    customerName: row.customer_name ?? row.customer ?? null,
    status: normalizeStatus(row.status),
    kind,
    type: kind === "alteration" ? "Alteration" : kind === "custom" ? "Custom" : "Invoice",
    total: Number(row.total ?? row.grand_total ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    outstandingAmount: Number(row.outstanding_amount ?? 0),
    paidAmount: Number(row.paid_amount ?? 0),
    postingDate: row.posting_date ?? null,
    dueDate: row.due_date ?? null,
    // sales_order is not list-queryable on SI — prefer po_no
    salesOrder: row.po_no ?? null,
    poNo: row.po_no ?? null,
    alterationTicketRef: altRef,
    remarks,
    company: row.company ?? null,
    currency: row.currency ?? "USD",
    squarePaymentLink:
      (row.lsh_square_payment_link || row.square_payment_link || "").trim() || null,
    endCustomer: row.end_customer ?? null,
  };
}

function serializeDetail(doc: any) {
  const base = serializeInvoice(doc);
  const items = (doc.items ?? []).map((it: any) => ({
    itemCode: it.item_code ?? null,
    itemName: it.item_name ?? it.description ?? "Item",
    description: it.description ?? null,
    qty: Number(it.qty ?? 1),
    rate: Number(it.rate ?? 0),
    amount: Number(it.amount ?? 0),
    uom: it.uom ?? null,
  }));
  return {
    ...base,
    netTotal: Number(doc.net_total ?? base.total),
    totalTaxes: Number(doc.total_taxes_and_charges ?? 0),
    discountAmount: Number(doc.discount_amount ?? 0),
    additionalDiscountPct: Number(doc.additional_discount_percentage ?? 0),
    contactEmail: doc.contact_email ?? null,
    contactMobile: doc.contact_mobile ?? doc.contact_mobile_no ?? null,
    billingAddress: doc.address_display ?? null,
    paymentTerms: doc.payment_terms_template ?? null,
    items,
    taxes: (doc.taxes ?? []).map((t: any) => ({
      description: t.description ?? t.account_head ?? "Tax",
      rate: Number(t.rate ?? 0),
      taxAmount: Number(t.tax_amount ?? 0),
    })),
    payments: (doc.payments ?? []).map((p: any) => ({
      modeOfPayment: p.mode_of_payment ?? "—",
      amount: Number(p.amount ?? 0),
      referenceNo: p.reference_no ?? null,
      referenceDate: p.reference_date ?? null,
    })),
  };
}

// GET /api/invoices
// Query: status=unpaid|overdue|paid|open|all  kind=alteration|custom|all  q=  limit=
invoicesRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessInvoices(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const statusFilter = (c.req.query("status") ?? "open").toLowerCase();
  const kindFilter = (c.req.query("kind") ?? "all").toLowerCase();
  const customerFilter = c.req.query("customer") ?? "";
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "300", 10) || 300, 500);

  const filters: any[] = [["docstatus", "=", 1]]; // submitted only — drafts not for FOH charge
  if (customerFilter) filters.push(["customer", "=", customerFilter]);

  if (statusFilter === "open") {
    // Money still due — server-side so we don't miss open SI outside a paid-heavy first page
    filters.push(["outstanding_amount", ">", 0]);
  } else if (statusFilter && statusFilter !== "all") {
    const statusMap: Record<string, string> = {
      paid: "Paid",
      partly_paid: "Partly Paid",
      unpaid: "Unpaid",
      overdue: "Overdue",
      draft: "Draft",
      void: "Cancelled",
    };
    if (statusMap[statusFilter]) filters.push(["status", "=", statusMap[statusFilter]]);
  }

  try {
    const rows = await erpList<any>("Sales Invoice", {
      filters,
      // NOTE: do NOT request virtual/child fields like `sales_order` — Frappe
      // returns 417 "Field not permitted in query" and erpList silently [].
      fields: [
        "name",
        "customer",
        "customer_name",
        "status",
        "grand_total",
        "total",
        "outstanding_amount",
        "paid_amount",
        "posting_date",
        "due_date",
        "remarks",
        "company",
        "currency",
        "alteration_ticket_ref",
        "po_no",
        "lsh_square_payment_link",
        "end_customer",
      ],
      limit,
      order_by: "posting_date desc",
      throwOnError: true,
    });

    let invoices = rows.map(serializeInvoice);

    // Belt-and-suspenders for open tab (already ERP-filtered)
    if (statusFilter === "open") {
      invoices = invoices.filter((i) => i.outstandingAmount > 0.005);
    }

    if (kindFilter === "alteration" || kindFilter === "custom") {
      invoices = invoices.filter((i) => i.kind === kindFilter);
    }

    if (q) {
      invoices = invoices.filter((i) => {
        const hay = [
          i.id,
          i.customerName,
          i.customer?.name,
          i.alterationTicketRef,
          i.salesOrder,
          i.poNo,
          i.remarks,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const paid = invoices
      .filter((i) => i.status === "paid")
      .reduce((s, i) => s + i.grandTotal, 0);
    const outstanding = invoices
      .filter((i) => i.outstandingAmount > 0.005)
      .reduce((s, i) => s + i.outstandingAmount, 0);
    const openCount = invoices.filter((i) => i.outstandingAmount > 0.005).length;

    return c.json({
      data: invoices,
      summary: {
        paid: Math.round(paid * 100) / 100,
        outstanding: Math.round(outstanding * 100) / 100,
        openCount,
        count: invoices.length,
      },
    });
  } catch (e: any) {
    console.error("invoices fetch failed:", e?.message);
    return c.json(
      {
        data: [],
        summary: { paid: 0, outstanding: 0, openCount: 0, count: 0 },
        error: { message: e?.message ?? "Failed to load invoices from ERP" },
      },
      502,
    );
  }
});

// GET /api/invoices/:id — full invoice detail
invoicesRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessInvoices(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  try {
    const doc = await erpGet<any>("Sales Invoice", decodeURIComponent(c.req.param("id")));
    if (!doc) return c.json({ error: { message: "Not found" } }, 404);
    return c.json({ data: serializeDetail(doc) });
  } catch {
    return c.json({ error: { message: "Not found" } }, 404);
  }
});

// POST /api/invoices/:id/payment — record a payment against a Sales Invoice
const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.string().default("Cash"),
});

invoicesRouter.post(
  "/:id/payment",
  zValidator("json", paymentSchema),
  async (c) => {
    const user = await getAuthedUser(c);
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
    // Manual PE still finance-gated; Square terminal/link is on /api/payments/*
    if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

    const invoiceId = decodeURIComponent(c.req.param("id"));
    const { amount, method } = (c.req as any).valid("json");

    try {
      const doc = await erpGet<any>("Sales Invoice", invoiceId);
      if (!doc) return c.json({ error: { message: "Invoice not found" } }, 404);

      const payment = await erpCreate<any>("Payment Entry", {
        payment_type: "Receive",
        party_type: "Customer",
        party: doc.customer,
        paid_amount: amount,
        received_amount: amount,
        paid_to_account_currency: doc.currency ?? "USD",
        company: doc.company,
        mode_of_payment: method,
        references: [
          {
            reference_doctype: "Sales Invoice",
            reference_name: invoiceId,
            allocated_amount: amount,
          },
        ],
        docstatus: 1,
      });

      return c.json({ data: { paymentEntryId: (payment as any)?.name ?? null } });
    } catch (e: any) {
      console.error("payment creation failed:", e?.message);
      return c.json({ error: { message: e?.message ?? "Payment failed" } }, 422);
    }
  },
);

// POST /api/invoices/:id/mark-paid
invoicesRouter.post("/:id/mark-paid", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  const id = decodeURIComponent(c.req.param("id"));

  try {
    await erpSubmit("Sales Invoice", id);
  } catch {
    /* may already be submitted */
  }

  try {
    const updated = await erpUpdate("Sales Invoice", id, {
      status: "Paid",
      outstanding_amount: 0,
    });
    return c.json({ data: updated });
  } catch (e: any) {
    console.error("mark-paid failed:", e?.message);
    return c.json({ error: { message: e?.message ?? "Mark paid failed" } }, 422);
  }
});

// GET /api/invoices/:id/pdf
invoicesRouter.get("/:id/pdf", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessInvoices(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  const id = decodeURIComponent(c.req.param("id"));
  const erpBase = process.env.ERPNEXT_BASE_URL ?? "";
  const pdfUrl = `${erpBase}/api/method/frappe.utils.print_format.download_pdf?doctype=Sales%20Invoice&name=${encodeURIComponent(id)}&format=Standard`;
  return c.json({ data: { url: pdfUrl } });
});
