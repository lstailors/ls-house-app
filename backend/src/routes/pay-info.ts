import { Hono } from 'hono';

export const payInfoRouter = new Hono();

const MCP_BASE = process.env.ERPNEXT_MCP_URL ?? 'https://erp-mcp.lstailors.com';
const MCP_TOKEN = process.env.ERPNEXT_MCP_TOKEN ?? '';

async function mcpGet<T>(doctype: string, name: string): Promise<T | null> {
  try {
    const res = await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MCP_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: { name: 'erp_get', arguments: { doctype, name } },
      }),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const text = json?.result?.content?.[0]?.text ?? '{}';
    const doc = JSON.parse(text);
    return doc?.name ? (doc as T) : null;
  } catch {
    return null;
  }
}

// Public endpoint — no auth required.
// Returns the minimal payment info needed to render the /pay/:id page.
// Tries Sales Invoice first, then Alteration Ticket.
payInfoRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing id' }, 400);

  // Try Sales Invoice (ACC-SINV-*, SINV-*, or any explicit prefix)
  const looksLikeSalesInvoice =
    id.startsWith('ACC-SINV') ||
    id.startsWith('SINV') ||
    id.startsWith('ACC-SI');

  if (looksLikeSalesInvoice) {
    const doc = await mcpGet<any>('Sales Invoice', id);
    if (doc) {
      return c.json({
        data: {
          id: doc.name,
          type: 'sales_invoice',
          customer_name: doc.customer_name ?? doc.customer ?? '',
          grand_total: doc.grand_total ?? 0,
          outstanding_amount: doc.outstanding_amount ?? 0,
          status: doc.status ?? 'Unpaid',
          currency: doc.currency ?? 'USD',
          due_date: doc.due_date ?? null,
          posting_date: doc.posting_date ?? null,
          items: (doc.items ?? []).map((it: any) => ({
            item_name: it.item_name,
            description: it.description,
            amount: it.amount,
          })),
        },
      });
    }
  }

  // Try Alteration Ticket
  const ticket = await mcpGet<any>('Alteration Ticket', id);
  if (ticket) {
    const isPaid = ticket.payment_status === 'Paid';
    return c.json({
      data: {
        id: ticket.name,
        type: 'alteration_ticket',
        customer_name: ticket.customer_name ?? '',
        grand_total: ticket.ticket_total ?? 0,
        outstanding_amount: isPaid ? 0 : (ticket.ticket_total ?? 0),
        status: isPaid ? 'Paid' : 'Unpaid',
        currency: 'USD',
        due_date: ticket.due_date ?? null,
        posting_date: ticket.ticket_date ?? null,
        items: (ticket.garments ?? []).map((g: any) => ({
          item_name: g.garment_type,
          description: g.garment_description,
          amount: null,
        })),
      },
    });
  }

  // Last resort: fall back to Sales Invoice (catches non-standard prefixes)
  if (!looksLikeSalesInvoice) {
    const inv = await mcpGet<any>('Sales Invoice', id);
    if (inv) {
      return c.json({
        data: {
          id: inv.name,
          type: 'sales_invoice',
          customer_name: inv.customer_name ?? inv.customer ?? '',
          grand_total: inv.grand_total ?? 0,
          outstanding_amount: inv.outstanding_amount ?? 0,
          status: inv.status ?? 'Unpaid',
          currency: inv.currency ?? 'USD',
          due_date: inv.due_date ?? null,
          posting_date: inv.posting_date ?? null,
          items: (inv.items ?? []).map((it: any) => ({
            item_name: it.item_name,
            description: it.description,
            amount: it.amount,
          })),
        },
      });
    }
  }

  return c.json({ error: 'Not found' }, 404);
});
