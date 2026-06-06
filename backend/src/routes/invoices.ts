import { Hono } from "hono";
import { getAuthedUser, canSeeFinancials } from "../lib/scope";
import { erpList, erpGet } from "../lib/erp";

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
    salesOrder: row.po_no ?? null,         // reference field
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

  const filters: any[] = [];
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
        "posting_date", "due_date", "remarks", "company", "po_no",
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
