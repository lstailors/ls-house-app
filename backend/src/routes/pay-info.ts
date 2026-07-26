import { Hono } from 'hono';

export const payInfoRouter = new Hono();

const MCP_BASE = process.env.ERPNEXT_MCP_URL ?? 'https://erp-mcp.lstailors.com';
const MCP_TOKEN = process.env.ERPNEXT_MCP_TOKEN ?? '';

async function mcpGet<T>(doctype: string, name: string): Promise<T | null> {
  try {
    const res = await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `token ${MCP_TOKEN}`,
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

// Best-effort: persist a generated Square hosted link back onto the Sales Invoice
// custom field `lsh_square_payment_link` so email/SMS/pay-page all share one link.
async function persistLinkToInvoice(invoiceId: string, url: string): Promise<void> {
  try {
    await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `token ${MCP_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 1,
        params: {
          name: 'erp_update',
          arguments: {
            doctype: 'Sales Invoice',
            name: invoiceId,
            fieldname: 'lsh_square_payment_link',
            value: url,
          },
        },
      }),
    });
  } catch {
    // non-fatal — the freshly generated link is still returned to the caller
  }
}

// Create a Square hosted payment link (quick_pay) for a given amount.
// Returns the short square.link URL, or null on failure.
async function createSquareLink(
  invoiceId: string,
  amountCents: number,
  customerName: string,
): Promise<string | null> {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN ?? '';
  const locationId = process.env.SQUARE_LOCATION_ID ?? '';
  if (!accessToken || !locationId || amountCents <= 0) return null;

  try {
    const res = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-12-18',
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        quick_pay: {
          name: `L&S Custom Tailors — Invoice ${invoiceId}`,
          price_money: { amount: amountCents, currency: 'USD' },
          location_id: locationId,
        },
        checkout_options: {
          allow_tipping: false,
          ask_for_shipping_address: false,
        },
        payment_note: `Invoice ${invoiceId}${customerName ? ` — ${customerName}` : ''}`,
      }),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    return json?.payment_link?.url ?? null;
  } catch {
    return null;
  }
}

// Resolve a hosted Square pay link for an invoice: reuse the stored one if present,
// otherwise mint a new one and persist it. Never throws.
async function resolvePaymentLink(
  invoiceId: string,
  storedLink: string | null | undefined,
  outstanding: number,
  customerName: string,
): Promise<string | null> {
  if (storedLink && storedLink.startsWith('http')) return storedLink;
  if (outstanding <= 0) return null;
  const amountCents = Math.round(outstanding * 100);
  const url = await createSquareLink(invoiceId, amountCents, customerName);
  if (url) void persistLinkToInvoice(invoiceId, url);
  return url;
}

// Public endpoint — no auth required.
// Returns the minimal payment info needed to render the /pay/:id page.
// Tries Sales Invoice first, then Alteration Ticket.
payInfoRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing id' }, 400);

  // Try Sales Invoice (ACC-SINV-*, SINV-*, LSTNY-SINV-*, or any explicit prefix)
  const looksLikeSalesInvoice =
    id.startsWith('ACC-SINV') ||
    id.startsWith('SINV') ||
    id.startsWith('ACC-SI') ||
    id.includes('-SINV-');

  if (looksLikeSalesInvoice) {
    const doc = await mcpGet<any>('Sales Invoice', id);
    if (doc) {
      const outstanding = doc.outstanding_amount ?? 0;
      const customerName = doc.customer_name ?? doc.customer ?? '';
      const payment_link = await resolvePaymentLink(
        doc.name, doc.lsh_square_payment_link, outstanding, customerName,
      );
      return c.json({
        data: {
          id: doc.name,
          type: 'sales_invoice',
          customer_name: customerName,
          grand_total: doc.grand_total ?? 0,
          outstanding_amount: outstanding,
          status: doc.status ?? 'Unpaid',
          currency: doc.currency ?? 'USD',
          due_date: doc.due_date ?? null,
          posting_date: doc.posting_date ?? null,
          square_payment_link: payment_link,
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
    const outstanding = isPaid ? 0 : (ticket.ticket_total ?? 0);
    const customerName = ticket.customer_name ?? '';
    const payment_link = await resolvePaymentLink(
      ticket.name, ticket.lsh_square_payment_link, outstanding, customerName,
    );
    return c.json({
      data: {
        id: ticket.name,
        type: 'alteration_ticket',
        customer_name: customerName,
        grand_total: ticket.ticket_total ?? 0,
        outstanding_amount: outstanding,
        status: isPaid ? 'Paid' : 'Unpaid',
        currency: 'USD',
        due_date: ticket.due_date ?? null,
        posting_date: ticket.ticket_date ?? null,
        square_payment_link: payment_link,
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
      const outstanding = inv.outstanding_amount ?? 0;
      const customerName = inv.customer_name ?? inv.customer ?? '';
      const payment_link = await resolvePaymentLink(
        inv.name, inv.lsh_square_payment_link, outstanding, customerName,
      );
      return c.json({
        data: {
          id: inv.name,
          type: 'sales_invoice',
          customer_name: customerName,
          grand_total: inv.grand_total ?? 0,
          outstanding_amount: outstanding,
          status: inv.status ?? 'Unpaid',
          currency: inv.currency ?? 'USD',
          due_date: inv.due_date ?? null,
          posting_date: inv.posting_date ?? null,
          square_payment_link: payment_link,
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

// Public charge endpoint — no auth required (customer payment link).
payInfoRouter.post('/:id/charge', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  if (!body?.source_id || !body?.amount_cents) {
    return c.json({ error: 'source_id and amount_cents are required' }, 400);
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN ?? '';
  const locationId  = process.env.SQUARE_LOCATION_ID ?? '';

  if (!accessToken || !locationId) {
    return c.json({ error: 'Payment processing is not configured' }, 500);
  }

  const squareRes = await fetch('https://connect.squareup.com/v2/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-12-18',
    },
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      source_id: body.source_id,
      amount_money: { amount: body.amount_cents, currency: 'USD' },
      reference_id: id,
      note: `L&S Custom Tailors — ${id}`,
      location_id: locationId,
    }),
  });

  const squareData: any = await squareRes.json();

  if (!squareRes.ok) {
    const code = squareData?.errors?.[0]?.code ?? '';
    const ERRORS: Record<string, string> = {
      CARD_DECLINED: 'Your card was declined. Please try a different card.',
      VERIFY_CVV_FAILURE: 'CVV did not match. Please check your card details.',
      INSUFFICIENT_FUNDS: 'Insufficient funds on this card.',
      CARD_EXPIRED: 'This card has expired. Please use a different card.',
      INVALID_EXPIRATION: 'Card expiration date is invalid.',
    };
    return c.json({ error: ERRORS[code] ?? 'Payment could not be processed. Please try again.' }, 422);
  }

  const payment = squareData.payment;
  if (payment?.status !== 'COMPLETED') {
    return c.json({ error: 'Payment was not completed. Please try again.' }, 422);
  }

  return c.json({ data: { payment_id: payment.id as string, status: 'success' } });
});
