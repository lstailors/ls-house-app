import { Hono } from "hono";
import { getAuthedUser, canSeeFinancials } from "../lib/scope";

export const invoicesRouter = new Hono();

const MCP_BASE = process.env.ERPNEXT_MCP_URL ?? 'https://erp-mcp.lstailors.com';
const MCP_TOKEN = process.env.ERPNEXT_MCP_TOKEN ?? '';

async function mcpList<T>(doctype: string, fields: string[], filters: any[] = [], limit = 200, orderBy = ''): Promise<T[]> {
  const args: any = { doctype, fields, filters, limit };
  if (orderBy) args.order_by = orderBy;
  const res = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'erp_list', arguments: args } }),
  });
  if (!res.ok) throw new Error(`MCP ${res.status}`);
  const json: any = await res.json();
  const text = json?.result?.content?.[0]?.text ?? '{}';
  const data = JSON.parse(text);
  return (data?.documents ?? []) as T[];
}

function detectType(row: any): 'alteration' | 'custom' {
  const remarks = (row.remarks ?? '').toLowerCase();
  if (remarks.includes('alteration ticket') || remarks.includes('alt-')) return 'alteration';
  return 'custom';
}

function normalizeStatus(raw: string): string {
  if (!raw) return 'draft';
  const s = raw.toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'partly paid') return 'partly_paid';
  if (s === 'unpaid' || s === 'submitted') return 'unpaid';
  if (s === 'overdue') return 'overdue';
  if (s === 'cancelled') return 'void';
  if (s === 'draft') return 'draft';
  return s;
}

function serializeInvoice(row: any) {
  return {
    id: row.name,
    erpnextId: row.name,
    customer: row.customer ? { name: row.customer } : null,
    status: normalizeStatus(row.status),
    total: Number(row.total ?? row.grand_total ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    outstandingAmount: Number(row.outstanding_amount ?? 0),
    paidAmount: Number(row.paid_amount ?? 0),
    postingDate: row.posting_date ?? null,
    dueDate: row.due_date ?? null,
    remarks: row.remarks ?? null,
    salesOrderId: row.sales_order ?? null,
    alterationTicketRef: (() => { const m = (row.remarks ?? '').match(/\b(ALT-\d+)\b/i); return m ? m[1] : null; })(),
    type: detectType(row),
  };
}

// GET /api/invoices?type=custom|alteration|all
invoicesRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const typeFilter = c.req.query("type") ?? "all"; // custom | alteration | all
  const statusFilter = c.req.query("status") ?? ""; // paid | unpaid | draft | all

  try {
    const filters: any[] = [];
    if (statusFilter && statusFilter !== 'all') {
      // Map app status to ERP status values
      const statusMap: Record<string, string[]> = {
        paid: ['Paid'],
        partly_paid: ['Partly Paid'],
        unpaid: ['Unpaid'],
        overdue: ['Overdue'],
        draft: ['Draft'],
        void: ['Cancelled'],
      };
      const erpStatuses = statusMap[statusFilter];
      if (erpStatuses?.length === 1) filters.push(['status', '=', erpStatuses[0]]);
    }

    const rows = await mcpList<any>(
      'Sales Invoice',
      ['name', 'customer', 'status', 'grand_total', 'outstanding_amount', 'paid_amount', 'posting_date', 'due_date', 'remarks', 'sales_order'],
      filters, 300, 'posting_date desc'
    );

    let invoices = rows.map(serializeInvoice);

    // Filter by type after fetch (remarks-based detection)
    if (typeFilter === 'alteration') {
      invoices = invoices.filter(i => i.type === 'alteration');
    } else if (typeFilter === 'custom') {
      invoices = invoices.filter(i => i.type === 'custom');
    }

    return c.json({ data: invoices });
  } catch (e: any) {
    console.error('invoices fetch failed:', e?.message);
    return c.json({ data: [] });
  }
});

invoicesRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const name = c.req.param("id");
  try {
    const res = await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'erp_get', arguments: { doctype: 'Sales Invoice', name } } }),
    });
    if (!res.ok) return c.json({ error: { message: 'Not found' } }, 404);
    const json: any = await res.json();
    const text = json?.result?.content?.[0]?.text ?? '{}';
    const doc = JSON.parse(text);
    return c.json({ data: serializeInvoice(doc) });
  } catch {
    return c.json({ error: { message: 'Not found' } }, 404);
  }
});
