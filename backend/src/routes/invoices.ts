import { Hono } from "hono";
import { getAuthedUser, canSeeFinancials } from "../lib/scope.js";

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
  // Surface JSON-RPC errors (HTTP 200 but error in payload)
  if (json?.result?.isError) throw new Error(`MCP error: ${json.result?.content?.[0]?.text ?? 'unknown'}`);
  const text = json?.result?.content?.[0]?.text ?? '{}';
  const data = JSON.parse(text);
  if (data?.error) throw new Error(`ERP error: ${JSON.stringify(data.error)}`);
  return (data?.documents ?? []) as T[];
}

async function mcpGet(doctype: string, name: string): Promise<any> {
  const res = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'erp_get', arguments: { doctype, name } } }),
  });
  if (!res.ok) throw new Error(`MCP get ${res.status}`);
  const json: any = await res.json();
  if (json?.result?.isError) throw new Error(json.result?.content?.[0]?.text ?? 'MCP error');
  const text = json?.result?.content?.[0]?.text ?? '{}';
  const doc = JSON.parse(text);
  if (doc?.exc_type) throw new Error(doc.exc_type);
  return doc;
}

async function mcpUpdate(doctype: string, name: string, values: Record<string, any>): Promise<void> {
  const res = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'erp_update', arguments: { doctype, name, values } } }),
  });
  if (!res.ok) throw new Error(`MCP update ${res.status}`);
  const json: any = await res.json();
  if (json?.result?.isError) throw new Error(json.result?.content?.[0]?.text ?? 'update failed');
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
    alterationTicketRef: (() => { const m = (row.remarks ?? '').match(/\b(ALT-\d+)\b/i); return m ? m[1] : null; })(),
    type: detectType(row),
  };
}

function serializeInvoiceDetail(doc: any) {
  const base = serializeInvoice(doc);
  return {
    ...base,
    customerName: doc.customer_name ?? doc.customer ?? null,
    billingAddress: (doc.billing_address_display ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim() || null,
    contactEmail: doc.contact_email ?? null,
    contactMobile: doc.contact_mobile ?? null,
    paymentTerms: doc.payment_terms_template ?? null,
    netTotal: Number(doc.net_total ?? doc.total ?? 0),
    totalTaxes: Number(doc.total_taxes_and_charges ?? 0),
    discountAmount: Number(doc.discount_amount ?? 0),
    additionalDiscountPct: Number(doc.additional_discount_percentage ?? 0),
    writeOffAmount: Number(doc.write_off_amount ?? 0),
    items: (doc.items ?? []).map((item: any) => ({
      itemCode: item.item_code ?? null,
      itemName: item.item_name ?? '',
      description: item.description ?? null,
      qty: Number(item.qty ?? 1),
      rate: Number(item.rate ?? 0),
      amount: Number(item.amount ?? 0),
      uom: item.uom ?? null,
    })),
    taxes: (doc.taxes ?? []).map((tax: any) => ({
      description: tax.description ?? tax.account_head ?? '',
      rate: Number(tax.rate ?? 0),
      taxAmount: Number(tax.tax_amount ?? 0),
    })),
    payments: (doc.payments ?? []).map((p: any) => ({
      modeOfPayment: p.mode_of_payment ?? '',
      amount: Number(p.amount ?? 0),
      referenceNo: p.reference_no ?? null,
      referenceDate: p.reference_date ?? null,
    })),
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
      ['name', 'customer', 'status', 'grand_total', 'outstanding_amount', 'paid_amount', 'posting_date', 'due_date', 'remarks'],
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
    const doc = await mcpGet('Sales Invoice', name);
    return c.json({ data: serializeInvoiceDetail(doc) });
  } catch (e: any) {
    console.error('invoice get failed:', e?.message);
    return c.json({ error: { message: 'Not found' } }, 404);
  }
});

invoicesRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const name = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const allowed = ['remarks', 'due_date', 'posting_date'];
  const values: Record<string, any> = {};
  for (const field of allowed) {
    if (field in body) values[field] = body[field];
  }
  if (Object.keys(values).length === 0) {
    return c.json({ error: { message: 'No editable fields provided' } }, 400);
  }

  try {
    await mcpUpdate('Sales Invoice', name, values);
    const doc = await mcpGet('Sales Invoice', name);
    return c.json({ data: serializeInvoiceDetail(doc) });
  } catch (e: any) {
    console.error('invoice patch failed:', e?.message);
    return c.json({ error: { message: e?.message ?? 'Update failed' } }, 500);
  }
});
