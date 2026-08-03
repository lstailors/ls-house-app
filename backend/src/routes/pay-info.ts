import { Hono } from 'hono';
import {
  buildSimpleInvoicePdf,
  formatMoneyUsd,
} from '../lib/simpleInvoicePdf';

export const payInfoRouter = new Hono();

const MCP_BASE = process.env.ERPNEXT_MCP_URL ?? 'https://erp-mcp.lstailors.com';
const MCP_TOKEN = (process.env.ERPNEXT_MCP_TOKEN ?? '').trim();
const ERP_BASE = (process.env.ERPNEXT_BASE_URL ?? 'https://erp.lstailors.com').replace(/\/$/, '');
const ALTS_URL = (process.env.ALTS_URL || process.env.VITE_ALTS_PUBLIC_URL || 'https://alts.lstailors.com').replace(/\/$/, '');

function erpAuth(): string {
  const key = (process.env.ERPNEXT_API_KEY ?? '').trim();
  const secret = (process.env.ERPNEXT_API_SECRET ?? '').trim();
  return `token ${key}:${secret}`;
}

function hasErpCreds(): boolean {
  return Boolean((process.env.ERPNEXT_API_KEY ?? '').trim() && (process.env.ERPNEXT_API_SECRET ?? '').trim());
}

/** Direct Frappe REST get — primary path (public ERP). Browser UA avoids CF 1010. */
async function erpGet<T>(doctype: string, name: string): Promise<T | null> {
  if (!hasErpCreds()) return null;
  try {
    const url = `${ERP_BASE}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: erpAuth(),
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 L&S-House-Pay',
      },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const doc = json?.data;
    return doc?.name ? (doc as T) : null;
  } catch {
    return null;
  }
}

/** MCP fallback if direct ERP fails. */
async function mcpGet<T>(doctype: string, name: string): Promise<T | null> {
  if (!MCP_TOKEN) return null;
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
    const parsed = JSON.parse(text);
    // erp_get may return doc directly or {document}/{name}
    const doc = parsed?.name ? parsed : parsed?.document ?? parsed?.data ?? null;
    return doc?.name ? (doc as T) : null;
  } catch {
    return null;
  }
}

async function getDoc<T>(doctype: string, name: string): Promise<T | null> {
  const viaErp = await erpGet<T>(doctype, name);
  if (viaErp) return viaErp;
  return mcpGet<T>(doctype, name);
}

async function persistLinkToInvoice(invoiceId: string, url: string): Promise<void> {
  if (!hasErpCreds()) return;
  try {
    await fetch(`${ERP_BASE}/api/method/frappe.client.set_value`, {
      method: 'POST',
      headers: {
        Authorization: erpAuth(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 L&S-House-Pay',
      },
      body: JSON.stringify({
        doctype: 'Sales Invoice',
        name: invoiceId,
        fieldname: 'lsh_square_payment_link',
        value: url,
      }),
    });
  } catch {
    /* non-fatal */
  }
}

/**
 * HER-63 P0-2: mint ONLY via ERP `ls_square.pos.create_payment_link`.
 * That path writes a `Square Checkout` row so webhooks can reconcile.
 * The old direct Square `online-checkout/payment-links` fallback minted a
 * bare `square.link` with no map — every hit guaranteed a webhook miss and
 * manufactured duplicate open links. Do not restore it.
 */
async function createSquareLink(
  invoiceId: string,
  _amountCents: number,
  _customerName: string,
): Promise<string | null> {
  if (!hasErpCreds() || !invoiceId) return null;

  try {
    const erpRes = await fetch(
      `${ERP_BASE}/api/method/ls_alterations.ls_square.pos.create_payment_link`,
      {
        method: 'POST',
        headers: {
          Authorization: erpAuth(),
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 L&S-House-Pay',
        },
        body: JSON.stringify({ invoice: invoiceId }),
      },
    );
    if (!erpRes.ok) return null;
    const j: any = await erpRes.json().catch(() => ({}));
    const msg = j?.message ?? j;
    const url = msg?.url || msg?.payment_url || msg?.data?.url;
    if (typeof url === 'string' && url.startsWith('http')) return url;
    return null;
  } catch {
    return null;
  }
}

async function resolvePaymentLink(
  invoiceId: string,
  storedLink: string | null | undefined,
  outstanding: number,
  customerName: string,
  opts?: { mint?: boolean },
): Promise<string | null> {
  const prior = (storedLink || '').trim();
  if (prior.startsWith('http')) return prior;
  if (outstanding <= 0) return null;
  // Public GET must be side-effect free — do not mint Square links on page load.
  // Self-heal path: POST /:id/ensure-link (customer Pay button) sets mint=true.
  if (!opts?.mint) return null;
  const amountCents = Math.round(Number(outstanding) * 100);
  const url = await createSquareLink(invoiceId, amountCents, customerName);
  if (url) void persistLinkToInvoice(invoiceId, url);
  return url;
}

function stripFactoryCost(desc: string | null | undefined): string {
  if (!desc) return '';
  const plain = String(desc).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain.includes('factory $')) {
    return (plain.split('factory $')[0] ?? plain).replace(/[·\s]+$/g, '').trim();
  }
  return plain;
}

function mapSalesInvoice(doc: any, paymentLink: string | null) {
  return {
    id: doc.name,
    type: 'sales_invoice' as const,
    customer_name: doc.customer_name ?? doc.customer ?? '',
    grand_total: doc.grand_total ?? 0,
    outstanding_amount: doc.outstanding_amount ?? 0,
    net_total: doc.net_total ?? doc.total ?? null,
    total_taxes_and_charges: doc.total_taxes_and_charges ?? 0,
    discount_amount: doc.discount_amount ?? 0,
    status: doc.status ?? 'Unpaid',
    currency: doc.currency ?? 'USD',
    due_date: doc.due_date ?? null,
    posting_date: doc.posting_date ?? null,
    square_payment_link: paymentLink,
    items: (doc.items ?? []).map((it: any) => ({
      item_name: it.item_name || it.item_code || 'Item',
      description: stripFactoryCost(it.description),
      qty: it.qty ?? 1,
      rate: it.rate ?? null,
      amount: it.amount ?? null,
    })),
  };
}

// Link-preview / Open Graph HTML for iMessage & social crawlers.
// Served at /api/pay-info/:id/og — middleware rewrites bot hits on /pay/:id here.
payInfoRouter.get('/:id/og', async (c) => {
  const rawId = c.req.param('id');
  if (!rawId) return c.text('Missing id', 400);
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = rawId;
  }

  let doc = await getDoc<any>('Sales Invoice', id);
  if (!doc) doc = await getDoc<any>('Alteration Ticket', id);

  const pageUrl = `${ALTS_URL}/pay/${encodeURIComponent(id)}`;
  const logo = 'https://erp.lstailors.com/files/ls-logo-email-192.png';

  let title = `Invoice ${id} — L&S Custom Tailors`;
  let description = 'Review your L&S Custom Tailors invoice, then pay securely.';

  if (doc) {
    const customer = String(doc.customer_name || doc.customer || '').trim();
    const outstanding = Number(
      doc.outstanding_amount != null
        ? doc.outstanding_amount
        : doc.payment_status === 'Paid'
          ? 0
          : (doc.ticket_total ?? doc.grand_total ?? 0),
    );
    const currency = String(doc.currency || 'USD');
    const total = Number(doc.grand_total ?? doc.ticket_total ?? outstanding ?? 0);
    const amountLabel =
      outstanding > 0
        ? `${currency} ${outstanding.toFixed(2)} due`
        : `${currency} ${total.toFixed(2)} · paid`;
    title =
      outstanding > 0
        ? `L&S Invoice ${id} · ${amountLabel}`
        : `L&S Invoice ${id} · Paid in full`;
    const who = customer ? `${customer} · ` : '';
    description = `${who}${amountLabel}. Open to review items, then pay with Apple Pay or card.`;
  }

  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const html = [
    '<!DOCTYPE html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    '<meta name="theme-color" content="#1F3A2E" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="L&S Custom Tailors" />',
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(pageUrl)}" />`,
    `<meta property="og:image" content="${esc(logo)}" />`,
    '<meta property="og:image:width" content="192" />',
    '<meta property="og:image:height" content="192" />',
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(logo)}" />`,
    `<link rel="canonical" href="${esc(pageUrl)}" />`,
    '</head>',
    '<body style="margin:0;background:#163524;color:#F1E9D6;font-family:Georgia,serif;padding:32px;text-align:center;">',
    '<p style="font-style:italic;font-size:22px;">L&amp;S Custom Tailors</p>',
    `<p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#C9C0AB;">${esc(title)}</p>`,
    `<p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;"><a href="${esc(pageUrl)}" style="color:#B08D57;">Open invoice</a></p>`,
    `<script>location.replace(${JSON.stringify(pageUrl)});</script>`,
    '</body></html>',
  ].join('');

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
});

/**
 * Public client PDF — Liquid Glass "L&S Sales Invoice".
 * Auth is server-side (ERP token); the invoice id is the capability.
 * Registered before GET /:id so Hono does not swallow the path.
 */
payInfoRouter.get('/:id/pdf', async (c) => {
  const rawId = c.req.param('id');
  if (!rawId) return c.json({ error: 'Missing id' }, 400);
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = rawId;
  }

  let doc = await getDoc<any>('Sales Invoice', id);
  if (!doc) {
    const ticket = await getDoc<any>('Alteration Ticket', id);
    const linked = ticket?.sales_invoice || ticket?.invoice;
    if (linked) doc = await getDoc<any>('Sales Invoice', String(linked));
  }
  if (!doc?.name) return c.json({ error: 'Not found' }, 404);
  if (!hasErpCreds()) {
    return c.json({ error: 'PDF service unavailable', code: 'NO_ERP_CREDS' }, 503);
  }

  const invoiceName = String(doc.name);
  const safeName = invoiceName.replace(/[^A-Za-z0-9._-]+/g, '_');
  const formats = ['L&S Sales Invoice', 'L&S Alteration Invoice', 'Standard'];
  const headers = {
    Authorization: erpAuth(),
    Accept: 'application/pdf,*/*',
    'User-Agent': 'Mozilla/5.0 L&S-House-Pay',
  };

  for (const format of formats) {
    try {
      const url =
        `${ERP_BASE}/api/method/frappe.utils.print_format.download_pdf` +
        `?doctype=${encodeURIComponent('Sales Invoice')}` +
        `&name=${encodeURIComponent(invoiceName)}` +
        `&format=${encodeURIComponent(format)}` +
        `&no_letterhead=0`;
      const res = await fetch(url, { method: 'GET', headers });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength < 200) continue;
      // PDF magic %PDF-
      const head = new Uint8Array(buf.slice(0, 5));
      const isPdf =
        head[0] === 0x25 &&
        head[1] === 0x50 &&
        head[2] === 0x44 &&
        head[3] === 0x46;
      if (!isPdf) continue;
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${safeName}.pdf"`,
          'Cache-Control': 'private, max-age=120',
          'X-LSH-Print-Format': format,
        },
      });
    } catch {
      /* try next format */
    }
  }

  // Fallback: Edge-safe simple PDF when ERP print engine is down
  // (wkhtmltopdf / broken image links). Still a real .pdf for the client.
  const outstanding = Number(doc.outstanding_amount ?? 0);
  const paid = outstanding <= 0 || String(doc.status || '') === 'Paid';
  const amount = paid ? Number(doc.grand_total ?? 0) : outstanding;
  const items = Array.isArray(doc.items) ? doc.items : [];
  const pdfBytes = buildSimpleInvoicePdf({
    title: 'Invoice',
    invoiceId: invoiceName,
    customerName: String(doc.customer_name || doc.customer || 'Valued Customer'),
    postingDate: doc.posting_date ? String(doc.posting_date) : null,
    statusLabel: paid ? 'Paid in Full' : 'Balance Due',
    amountLabel: formatMoneyUsd(amount),
    lines: items.map((it: any) => ({
      name: String(it.item_name || it.item_code || 'Item'),
      description: stripFactoryCost(it.description).slice(0, 120) || undefined,
      amountLabel:
        it.amount != null && Number.isFinite(Number(it.amount))
          ? formatMoneyUsd(Number(it.amount))
          : undefined,
    })),
    subtotalLabel:
      doc.net_total != null &&
      Math.abs(Number(doc.net_total) - Number(doc.grand_total ?? 0)) > 0.001
        ? formatMoneyUsd(Number(doc.net_total))
        : null,
    taxLabel:
      Number(doc.total_taxes_and_charges ?? 0) > 0
        ? formatMoneyUsd(Number(doc.total_taxes_and_charges))
        : null,
    discountLabel:
      Number(doc.discount_amount ?? 0) > 0
        ? formatMoneyUsd(Number(doc.discount_amount))
        : null,
  });

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}.pdf"`,
      'Cache-Control': 'private, max-age=120',
      'X-LSH-Print-Format': 'LSH-Simple-Fallback',
    },
  });
});

// Public endpoint — no auth required.
payInfoRouter.get('/:id', async (c) => {
  const rawId = c.req.param('id');
  if (!rawId) return c.json({ error: 'Missing id' }, 400);
  // Decode once; Hono usually already decodes path params
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = rawId;
  }

  const looksLikeSalesInvoice =
    id.startsWith('ACC-SINV') ||
    id.startsWith('SINV') ||
    id.startsWith('ACC-SI') ||
    id.includes('-SINV-') ||
    id.startsWith('LSTNY-') ||
    id.startsWith('LSTX-');

  const respondSi = async (doc: any) => {
    const outstanding = Number(doc.outstanding_amount ?? 0);
    const customerName = doc.customer_name ?? doc.customer ?? '';
    const payment_link = await resolvePaymentLink(
      doc.name,
      doc.lsh_square_payment_link,
      outstanding,
      customerName,
    );
    return c.json({ data: mapSalesInvoice(doc, payment_link) });
  };

  if (looksLikeSalesInvoice) {
    const doc = await getDoc<any>('Sales Invoice', id);
    if (doc) return respondSi(doc);
  }

  const ticket = await getDoc<any>('Alteration Ticket', id);
  if (ticket) {
    const isPaid = ticket.payment_status === 'Paid';
    const outstanding = isPaid ? 0 : Number(ticket.ticket_total ?? 0);
    const customerName = ticket.customer_name ?? '';
    const stored =
      ticket.lsh_square_payment_link || ticket.square_payment_link || null;
    // Prefer linked SI for payment link generation
    const linkedInvoice = ticket.sales_invoice || ticket.invoice || null;
    let payment_link: string | null = null;
    if (linkedInvoice) {
      const inv = await getDoc<any>('Sales Invoice', String(linkedInvoice));
      payment_link = await resolvePaymentLink(
        String(linkedInvoice),
        inv?.lsh_square_payment_link || stored,
        outstanding,
        customerName,
      );
    } else {
      payment_link = await resolvePaymentLink(ticket.name, stored, outstanding, customerName);
    }

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

  // Last resort: any name as Sales Invoice
  if (!looksLikeSalesInvoice) {
    const inv = await getDoc<any>('Sales Invoice', id);
    if (inv) return respondSi(inv);
  }

  return c.json({ error: 'Not found' }, 404);
});

// D5 (HER-22): retired. Was unauthenticated and accepted caller-controlled
// amount_cents straight into Square. No in-repo caller. Pay flow uses Square
// hosted links / terminal paths instead. Do not re-enable without:
//   1) server-side amount from the invoice (ignore body amount), and
//   2) explicit product go-ahead.
payInfoRouter.post('/:id/charge', async (c) => {
  return c.json(
    {
      error:
        'This charge endpoint has been disabled. Use the Square hosted checkout link on the pay page.',
      code: 'CHARGE_ENDPOINT_DISABLED',
    },
    410,
  );
});

/**
 * Self-heal: mint (or reuse) Square pay link when SI field is blank.
 * Public POST — only mints for submitted unpaid invoices; amount always
 * comes from ERP outstanding (never from the client body).
 */
payInfoRouter.post('/:id/ensure-link', async (c) => {
  const rawId = c.req.param('id');
  if (!rawId) return c.json({ error: 'Missing id' }, 400);
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = rawId;
  }

  let doc = await getDoc<any>('Sales Invoice', id);
  let ticket: any = null;
  if (!doc) {
    ticket = await getDoc<any>('Alteration Ticket', id);
    if (ticket?.sales_invoice || ticket?.invoice) {
      doc = await getDoc<any>('Sales Invoice', String(ticket.sales_invoice || ticket.invoice));
    }
  }
  if (!doc) return c.json({ error: 'Not found' }, 404);

  const outstanding = Number(doc.outstanding_amount ?? 0);
  if (outstanding <= 0) {
    return c.json({
      data: {
        id: doc.name,
        square_payment_link: null,
        outstanding_amount: outstanding,
        status: 'already_paid',
      },
    });
  }

  const customerName = doc.customer_name ?? doc.customer ?? '';
  const payment_link = await resolvePaymentLink(
    doc.name,
    doc.lsh_square_payment_link,
    outstanding,
    customerName,
    { mint: true },
  );

  if (!payment_link) {
    return c.json(
      {
        error: 'Could not create payment link. Please call (212) 308-4431.',
        code: 'LINK_MINT_FAILED',
      },
      502,
    );
  }

  return c.json({
    data: {
      id: doc.name,
      square_payment_link: payment_link,
      outstanding_amount: outstanding,
      status: 'ok',
    },
  });
});
