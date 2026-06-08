import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getAuthedUser, canSeeFinancials } from "../lib/scope";
import { erpList, erpGet, erpCreate, erpSubmit, erpUpdate } from "../lib/erp";

export const invoicesRouter = new Hono();

function normalizeStatus(raw: string): string {
  if (!raw) return 'draft';
  const s = raw.toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'partly paid') return 'partly_paid';
  if (s === 'unpaid') return 'unpaid';
  if (s === 'overdue') return 'overdue';
  if (s === 'cancelled') return 'void';
  if (s === 'draft') return 'draft';
  return s;
}

function serializeInvoice(row: any) {
  return {
    id: row.name,
    erpnextId: row.name,
    customer: row.customer ? { id: row.customer, name: row.customer_name ?? row.customer } : null,
    status: normalizeStatus(row.status),
    total: Number(row.total ?? row.grand_total ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    outstandingAmount: Number(row.outstanding_amount ?? 0),
    paidAmount: Number(row.paid_amount ?? 0),
    postingDate: row.posting_date ?? null,
    dueDate: row.due_date ?? null,
    salesOrder: row.alteration_ticket_ref ?? row.po_no ?? null,
    alterationTicketRef: row.remarks?.match(/ALT-[A-Z]+-\d{4}-\d+/)?.[0] ?? null,
    remarks: row.remarks ?? null,
    company: row.company ?? null,
  };
}

// GET /api/invoices
invoicesRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const statusFilter = c.req.query("status") ?? "";
  const customerFilter = c.req.query("customer") ?? ""; // ERPNext customer name/id

  const filters: any[] = [];
  if (customerFilter) filters.push(['customer', '=', customerFilter]);
  if (statusFilter && statusFilter !== 'all') {
    const statusMap: Record<string, string> = {
      paid: 'Paid', partly_paid: 'Partly Paid', unpaid: 'Unpaid',
      overdue: 'Overdue', draft: 'Draft', void: 'Cancelled',
    };
    if (statusMap[statusFilter]) filters.push(['status', '=', statusMap[statusFilter]]);
  }

  try {
    const rows = await erpList<any>("Sales Invoice", {
      filters,
      fields: [
        "name", "customer", "customer_name", "status",
        "grand_total", "total", "outstanding_amount", "paid_amount",
        "posting_date", "due_date", "remarks", "company", "alteration_ticket_ref", "po_no",
      ],
      limit: 300,
      order_by: "posting_date desc",
    });

    const invoices = rows.map(serializeInvoice);

    // KPI summary
    const paid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.grandTotal, 0);
    const outstanding = invoices.filter(i => ['unpaid','overdue','partly_paid'].includes(i.status)).reduce((s, i) => s + i.outstandingAmount, 0);

    return c.json({ data: invoices, summary: { paid, outstanding } });
  } catch (e: any) {
    console.error('invoices fetch failed:', e?.message);
    return c.json({ data: [], summary: { paid: 0, outstanding: 0 } });
  }
});

// GET /api/invoices/:id — full invoice detail
invoicesRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  try {
    const doc = await erpGet<any>("Sales Invoice", c.req.param("id"));
    if (!doc) return c.json({ error: { message: "Not found" } }, 404);
    return c.json({ data: { ...serializeInvoice(doc), items: doc.items ?? [], payments: doc.payments ?? [] } });
  } catch {
    return c.json({ error: { message: "Not found" } }, 404);
  }
});

// POST /api/invoices/:id/payment — record a payment against a Sales Invoice
const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.string().default("Cash"), // e.g. "Cash", "Bank", "Cheque"
});

invoicesRouter.post(
  "/:id/payment",
  zValidator("json", paymentSchema),
  async (c) => {
    const user = await getAuthedUser(c);
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
    if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

    const invoiceId = c.req.param("id");
    const { amount, method } = c.req.valid("json");

    try {
      // Fetch the invoice to get customer + company
      const doc = await erpGet<any>("Sales Invoice", invoiceId);
      if (!doc) return c.json({ error: { message: "Invoice not found" } }, 404);

      // Create a Payment Entry linked to this Sales Invoice
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
        docstatus: 1, // submit immediately
      });

      return c.json({ data: { paymentEntryId: (payment as any)?.name ?? null } });
    } catch (e: any) {
      console.error("payment creation failed:", e?.message);
      return c.json({ error: { message: e?.message ?? "Payment failed" } }, 422);
    }
  }
);

// POST /api/invoices/:id/mark-paid — mark a Sales Invoice as paid
invoicesRouter.post("/:id/mark-paid", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const id = decodeURIComponent(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));

  // Submit the invoice first if not submitted
  try {
    await erpSubmit("Sales Invoice", id);
  } catch { /* may already be submitted */ }

  // Update outstanding_amount to 0 and status to Paid
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

// GET /api/invoices/:id/pdf — return ERPNext PDF URL for the invoice
invoicesRouter.get("/:id/pdf", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const id = decodeURIComponent(c.req.param("id"));
  const erpBase = process.env.ERPNEXT_BASE_URL ?? "";
  const pdfUrl = `${erpBase}/api/method/frappe.utils.print_format.download_pdf?doctype=Sales%20Invoice&name=${encodeURIComponent(id)}&format=Standard`;
  return c.json({ data: { url: pdfUrl } });
});
