import { Hono } from 'hono';
import { getAuthedUser } from '../lib/scope';
import { uploadFile, erpFileAbsoluteUrl } from '../lib/erpnext/files';
import { erpList, erpGet as erpGetDoc, erpUpdate, erpPdf, erpRunMethod, erpCreate, erpSubmit } from '../lib/erp';
import { sendSms } from '../lib/twilio';
import { eTicketKey, eTicketKeyValid, eTicketPublicUrl } from '../lib/eticket-token';
import { planDeliveryFee } from './delivery-zones';
import { erpDatetime } from '../lib/delivery';

// ---------------------------------------------------------------------------
// ERPNext config
// ---------------------------------------------------------------------------
const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? 'https://erp.lstailors.com';
const ERP_TOKEN = process.env.ERPNEXT_API_TOKEN ?? process.env.ERPNEXT_MCP_TOKEN ?? '';
const MCP_BASE = process.env.ERPNEXT_MCP_URL ?? 'https://erp-mcp.lstailors.com';
const MCP_TOKEN = process.env.ERPNEXT_MCP_TOKEN ?? '';
const APP_URL = process.env.APP_URL ?? 'https://app.lstailors.com';
const ALTS_URL = (process.env.ALTS_URL || process.env.VITE_ALTS_PUBLIC_URL || 'https://alts.lstailors.com').replace(/\/$/, '');

function eTicketQrUrl(ticketName: string): string {
  const link = eTicketPublicUrl(ticketName);
  return `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&format=png&data=${encodeURIComponent(link)}`;
}

// Unified @ls/erp-client path (STAGE_PLAN rule #3) — replaces prior ad-hoc MCP calls.
async function mcpList<T>(doctype: string, fields: string[], filters: any[] = [], limit = 200, orderBy = ''): Promise<T[]> {
  return erpList<T>(doctype, { fields, filters, limit, order_by: orderBy || undefined });
}

async function mcpGet<T>(doctype: string, name: string): Promise<T> {
  const doc = await erpGetDoc<T>(doctype, name);
  if (!doc) throw new Error(`${doctype} ${name} not found`);
  return doc;
}

function erpHeaders() {
  // Use key:secret token auth (same as erpFetch) — ERP_TOKEN is unused/empty
  const key = process.env.ERPNEXT_API_KEY   ?? '';
  const sec = process.env.ERPNEXT_API_SECRET ?? '';
  return {
    Authorization: `token ${key}:${sec}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function erpCallMethod<T>(method: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${ERP_BASE}/api/method/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: erpHeaders(),
    cache: 'no-store' as RequestCache,
  });
  if (!res.ok) throw new Error(`ERP ${res.status}`);
  const json = (await res.json()) as any;
  return (json.message ?? json) as T;
}

async function erpPost<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${ERP_BASE}/api/method/${method}`, {
    method: 'POST',
    headers: erpHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(parseErpFail(res.status, t));
  }
  const json = (await res.json()) as any;
  return (json.message ?? json) as T;
}

/** Frappe ValidationError → HTTP 417; pull the human message out of the blob. */
function parseErpFail(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    if (j._server_messages) {
      const arr = JSON.parse(j._server_messages);
      const first = typeof arr[0] === 'string' ? JSON.parse(arr[0]) : arr[0];
      const msg = String(first?.message || '').replace(/<[^>]+>/g, '').trim();
      if (msg) return msg;
    }
    if (j.exception) {
      const ex = String(j.exception);
      // "frappe.exceptions.ValidationError: real message"
      const idx = ex.indexOf(': ');
      if (idx > 0) {
        const rest = ex.slice(idx + 2).trim();
        if (rest && !rest.startsWith('Traceback')) return rest;
      }
    }
    if (typeof j.message === 'string' && j.message) return j.message;
  } catch {
    /* fall through */
  }
  return `ERP ${status}: ${body.slice(0, 240)}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const intakeAlterationsRouter = new Hono();

// 0. GET /public/tickets/:name — no auth; full detail requires signed ?k=
intakeAlterationsRouter.get('/public/tickets/:name', async (c) => {
  const ticketName = c.req.param('name');
  const key = c.req.query('k') || c.req.query('key') || '';
  try {
    const doc = await mcpGet<any>('Alteration Ticket', ticketName);
    const unlocked = eTicketKeyValid(ticketName, key);

    // Minimal public status without key (stops casual IDOR of prices/lines)
    if (!unlocked) {
      const first = String(doc.customer_name || 'Client').split(/\s+/)[0] || 'Client';
      return c.json({
        data: {
          name: doc.name,
          customer_name: first,
          workflow_state: doc.workflow_state,
          ticket_date: doc.ticket_date,
          due_date: doc.due_date,
          ticket_total: null,
          payment_status: null,
          origin_location: doc.origin_location,
          garments: [],
          lines: [],
          locked: true,
        },
      });
    }

    return c.json({
      data: {
        name: doc.name,
        customer_name: doc.customer_name,
        workflow_state: doc.workflow_state,
        ticket_date: doc.ticket_date,
        due_date: doc.due_date,
        ticket_total: doc.ticket_total ?? 0,
        payment_status: doc.payment_status,
        origin_location: doc.origin_location,
        garments: (doc.garments ?? []).map((g: any) => ({
          name: g.name,
          garment_id: g.garment_id,
          garment_type: g.garment_type,
          garment_description: g.garment_description,
          color: g.color ?? '',
        })),
        lines: (doc.lines ?? []).map((l: any) => ({
          garment_ref: l.garment_ref,
          description: l.description,
          price: l.price ?? 0,
        })),
        locked: false,
        e_ticket_key: eTicketKey(ticketName),
      },
    });
  } catch {
    return c.json({ error: { message: 'Ticket not found' } }, 404);
  }
});

// 1. GET /presets — active Alteration Preset menu (Geelus hierarchy; NYC default_price)
// SPEC 073 / 041-task-subitem-menu — includes is_group, parent_preset, item_code, quick_pick
intakeAlterationsRouter.get('/presets', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: 'Unauthorized' } }, 401);

  try {
    const list = await mcpList<any>(
      'Alteration Preset',
      [
        'name',
        'preset_name',
        'display_name',
        'garment_type',
        'alteration_category',
        'default_price',
        'default_price_hou',
        'estimated_minutes',
        'is_active',
        'is_group',
        'parent_preset',
        'item_code',
        'quick_pick',
        'in_pos_menu',
        'sort_order',
        'menu_class',
        'description',
      ],
      [
        ['is_active', '=', 1],
        ['in_pos_menu', '=', 1],
      ],
      500,
      'sort_order asc, garment_type asc, preset_name asc',
    );
    const normalized = list.map((p: any) => {
      const isGroup = p.is_group === 1 || p.is_group === true || p.is_group === '1';
      const label = (p.display_name || p.preset_name || p.name || '').trim();
      return {
        id: p.name,
        name: p.name,
        preset_name: p.preset_name || p.name,
        display_name: label,
        garment_type: p.garment_type,
        // Frontend expects garment_types as array; also include 'All' catch-all
        garment_types: p.garment_type ? [p.garment_type] : ['All'],
        category: p.alteration_category,
        price: p.default_price,
        display_price: p.default_price,
        est_minutes: p.estimated_minutes ?? null,
        is_group: isGroup ? 1 : 0,
        parent_preset: p.parent_preset || null,
        item_code: p.item_code || null,
        quick_pick: p.quick_pick === 1 || p.quick_pick === true || p.quick_pick === '1' ? 1 : 0,
        in_pos_menu: p.in_pos_menu === 0 || p.in_pos_menu === false || p.in_pos_menu === '0' ? 0 : 1,
        sort_order: Number(p.sort_order) || 100,
        menu_class: p.menu_class || null,
        description: p.description || label,
      };
    });
    return c.json({ data: normalized });
  } catch (e: any) {
    console.error('presets fetch failed:', e?.message);
    return c.json({ data: [] });
  }
});

// 2. GET /tailors
intakeAlterationsRouter.get('/tailors', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const result = await erpList<{ name: string; employee_name: string; designation: string }>(
      'Employee',
      {
        filters: [['status', '=', 'Active'], ['designation', 'like', '%Tailor%']],
        fields: ['name', 'employee_name', 'designation'],
        limit: 50,
      }
    );
    // Frontend expects { name, full_name } shape
    return c.json({ data: (result ?? []).map(e => ({ name: e.name, full_name: e.employee_name })) });
  } catch {
    return c.json({ data: [] });
  }
});

// 3. GET /customers/search?q=
// Fuzzy search across ERPNext Customer + Contact + Address.
// Returns enriched results: name, phone, email, address line, city.
intakeAlterationsRouter.get('/customers/search', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 1) return c.json({ data: [] });

  const erpBase = process.env.ERPNEXT_BASE_URL ?? '';
  const erpKey  = process.env.ERPNEXT_API_KEY   ?? '';
  const erpSec  = process.env.ERPNEXT_API_SECRET ?? '';

  if (!erpBase || !erpKey || !erpSec) return c.json({ data: [] });

  const auth = { Authorization: `token ${erpKey}:${erpSec}`, Accept: 'application/json' };

  // Use ERPNext's built-in link search which does fuzzy matching on customer_name
  // AND searches across customer_name, mobile_no, email_id simultaneously.
  const searchUrl = `${erpBase}/api/method/frappe.desk.search.search_link?` +
    `txt=${encodeURIComponent(q)}&doctype=Customer&ignore_user_permissions=0&reference_doctype=Alteration+Ticket&page_length=10`;

  let rawHits: { value: string; description?: string }[] = [];
  try {
    const res = await fetch(searchUrl, { headers: auth });
    if (res.ok) {
      const json: any = await res.json();
      rawHits = json.results ?? json.message ?? [];
    }
  } catch { /* fall back to simple filter */ }

  // Fallback: plain filter on name + mobile if search_link returned nothing
  if (!rawHits.length) {
    try {
      const f = JSON.stringify([['customer_name', 'like', `%${q}%`]]);
      const res = await fetch(
        `${erpBase}/api/resource/Customer?filters=${encodeURIComponent(f)}&fields=${encodeURIComponent(JSON.stringify(['name','customer_name']))}&limit_page_length=10`,
        { headers: auth }
      );
      if (res.ok) {
        const json: any = await res.json();
        rawHits = (json.data ?? []).map((r: any) => ({ value: r.name, description: r.customer_name }));
      }
    } catch { /* no results */ }

    // Also search by phone number
    if (q.replace(/\D/g, '').length >= 4) {
      try {
        const phone = q.replace(/\D/g, '');
        const f2 = JSON.stringify([['mobile_no', 'like', `%${phone}%`]]);
        const res2 = await fetch(
          `${erpBase}/api/resource/Customer?filters=${encodeURIComponent(f2)}&fields=${encodeURIComponent(JSON.stringify(['name','customer_name']))}&limit_page_length=5`,
          { headers: auth }
        );
        if (res2.ok) {
          const json2: any = await res2.json();
          const phoneHits = (json2.data ?? []).map((r: any) => ({ value: r.name, description: r.customer_name }));
          const seen = new Set(rawHits.map((h: any) => h.value));
          rawHits = [...rawHits, ...phoneHits.filter((h: any) => !seen.has(h.value))];
        }
      } catch { /* ignore */ }
    }
  }

  // Single bulk query — fetch customer_name, mobile_no, email_id in one request.
  // ERPNext stores mobile_no / email_id as Read Only fields denormalized from
  // the primary contact, so one API call per page of results is sufficient.
  const ids = rawHits.slice(0, 10).map((h: any) => h.value).filter(Boolean);
  if (!ids.length) return c.json({ data: [] });

  let custRows: any[] = [];
  try {
    const f = JSON.stringify([['name', 'in', ids]]);
    const fields = JSON.stringify(['name', 'customer_name', 'mobile_no', 'email_id']);
    const res = await fetch(
      `${erpBase}/api/resource/Customer?filters=${encodeURIComponent(f)}&fields=${encodeURIComponent(fields)}&limit_page_length=10`,
      { headers: auth }
    );
    if (res.ok) { const j: any = await res.json(); custRows = j.data ?? []; }
  } catch { /* use id as name */ }

  const custMap = new Map(custRows.map((r: any) => [r.name, r]));

  const enriched = ids.map((custId: string) => {
    const row = custMap.get(custId);
    return {
      id:        custId,
      full_name: row?.customer_name || custId,
      name:      row?.customer_name || custId,
      phone:     row?.mobile_no     || '',
      email:     row?.email_id      || '',
      address:   '',  // loaded on-demand in the edit sheet
    };
  });

  return c.json({ data: enriched });
});

// 4. GET /tickets?status=&origin=NYC&limit=100 — NYC FOH default
intakeAlterationsRouter.get('/tickets', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const status = c.req.query('status') ?? '';
  const originRaw = (c.req.query('origin') || 'NYC').toUpperCase();
  // Alts is NYC-only; reject HOU filter (legacy clients) by coercing to NYC
  const origin = originRaw === 'ALL' ? null : 'NYC';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 500);

  try {
    const filters: any[] = status
      ? [['workflow_state', '=', status]]
      : [['workflow_state', '!=', 'Cancelled']];
    if (origin) filters.push(['origin_location', '=', origin]);
    const rows = await mcpList<any>('Alteration Ticket',
      ['name','customer_name','customer_phone','customer','origin_location','workflow_state','ticket_date','due_date','is_rush','ticket_total','payment_status','billing_status','assigned_tailor','linked_sales_order','included_in_custom','sales_invoice','delivery_method','notified_ready_at','modified','creation'],
      filters, limit, 'modified desc');
    return c.json({ data: rows });
  } catch (e: any) {
    return c.json({ data: [], error: e.message });
  }
});

// 5. GET /tickets/:name — enriched with customer contact + SI retail lines (SPEC 057)
intakeAlterationsRouter.get('/tickets/:name', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  try {
    const doc = await mcpGet<any>('Alteration Ticket', ticketName);
    // customer_phone is already on the Alteration Ticket doc; fetch Customer only for email
    let customerEmail = '';
    try {
      if (doc.customer) {
        const cust = await mcpGet<any>('Customer', doc.customer);
        customerEmail = cust.email_id ?? '';
      }
    } catch { /* non-fatal */ }

    // Pull SI lines so Walk-in sell items (jeans etc.) show on ticket even though
    // they live on the invoice, not the Alteration Ticket child tables.
    let invoice_items: any[] = [];
    let invoice_grand_total: number | null = null;
    let invoice_name: string | null = doc.sales_invoice ? String(doc.sales_invoice) : null;
    if (invoice_name) {
      try {
        const inv = await mcpGet<any>('Sales Invoice', invoice_name);
        invoice_grand_total = Number(inv.grand_total) || null;
        invoice_items = (inv.items || []).map((it: any) => ({
          item_code: it.item_code,
          item_name: it.item_name,
          description: it.description,
          qty: Number(it.qty) || 1,
          rate: Number(it.rate) || 0,
          amount: Number(it.amount) || 0,
          item_group: it.item_group || '',
          is_alteration:
            String(it.item_group || '').toLowerCase().includes('alteration') ||
            String(it.item_code || '').startsWith('ALT-'),
        }));
      } catch { /* non-fatal */ }
    }
    const sell_items = invoice_items.filter((it) => !it.is_alteration);
    // Prefer SI total when sell lines inflated the bill past ticket_total
    const display_total =
      invoice_grand_total != null && invoice_grand_total > (Number(doc.ticket_total) || 0)
        ? invoice_grand_total
        : Number(doc.ticket_total) || 0;

    return c.json({
      data: {
        ...doc,
        customer_mobile: doc.customer_phone ?? '',
        customer_email: customerEmail,
        e_ticket_key: eTicketKey(ticketName),
        e_ticket_url: eTicketPublicUrl(ticketName),
        invoice_items,
        sell_items,
        invoice_grand_total,
        display_total,
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 404);
  }
});


// SPEC 057 — append Walk-in sell lines onto the ticket SI (stock/item rows).
// SI is usually already submitted by create_sales_invoice; we cancel unpaid SI,
// rebuild with original + sell rows, resubmit, re-link ticket, re-mint pay link.
type SellLineIn = {
  item_code: string;
  item_name?: string;
  qty?: number;
  rate?: number;
  color?: string;
  size?: string;
  availability?: string;
  eta?: string;
  source?: string;
};

async function ensureItemExists(code: string, name: string, rate: number): Promise<string> {
  const existing = await erpGetDoc<any>("Item", code).catch(() => null);
  if (existing && !existing.disabled) return code;
  if (existing && existing.disabled) {
    await erpUpdate("Item", code, { disabled: 0 }).catch(() => {});
    return code;
  }
  // Seed codes (SEED-*) or unknown: fall back to custom alt service line item
  if (code.startsWith("SEED-") || !code) {
    return "ALT-CUSTOM-ALTERATION";
  }
  try {
    await erpCreate("Item", {
      item_code: code,
      item_name: name || code,
      item_group: "Stock Garments",
      stock_uom: "Nos",
      is_stock_item: 0, // non-stock until ops sets inventory
      is_sales_item: 1,
      standard_rate: rate || 0,
      description: name || code,
    });
    return code;
  } catch {
    return "ALT-CUSTOM-ALTERATION";
  }
}

function sellLineDescription(s: SellLineIn): string {
  const bits = [s.item_name || s.item_code];
  if (s.color) bits.push(s.color);
  if (s.size) bits.push(`sz ${s.size}`);
  if (s.qty && s.qty !== 1) bits.push(`×${s.qty}`);
  if (s.availability === "order" && s.eta) bits.push(`ETA ${s.eta}`);
  return bits.join(" · ");
}

async function appendSellItemsToTicketInvoice(opts: {
  ticketName: string;
  customer: string;
  company?: string;
  origin: string;
  sellItems: SellLineIn[];
  existingInvoice: string | null;
}): Promise<{ salesInvoice: string | null; squarePaymentLink: string | null; appPayUrl: string | null; warnings: string[]; invoiceTotal: number | null }> {
  const warnings: string[] = [];
  const warehouse =
    process.env.ALTS_SELL_WAREHOUSE || "NYC Showroom - LSTNY";

  const sellNote = opts.sellItems.map((s) => sellLineDescription(s)).join("; ");

  async function stampTicket(invName: string | null) {
    try {
      const tdoc = await erpGetDoc<any>("Alteration Ticket", opts.ticketName).catch(() => null);
      let grand: number | null = null;
      if (invName) {
        const inv = await erpGetDoc<any>("Sales Invoice", invName).catch(() => null);
        if (inv) grand = Number(inv.grand_total) || null;
      }
      const notes = [
        tdoc?.internal_notes,
        sellNote ? `Sell items: ${sellNote}` : null,
        warnings.length ? warnings.join(" · ") : null,
      ]
        .filter(Boolean)
        .join("\n");
      // de-dupe if sell stamp already present
      const cleanNotes = notes
        .split("\n")
        .filter((line, i, arr) => {
          const s = line.trim();
          if (!s) return false;
          if (s.startsWith("Sell items:") && arr.findIndex((x) => x.trim().startsWith("Sell items:")) !== i)
            return false;
          return true;
        })
        .join("\n");
      const patch: Record<string, unknown> = { internal_notes: cleanNotes || null };
      if (invName) patch.sales_invoice = invName;
      // ticket_total is usually recalculated from alter lines in ERP — do not fight it.
      // FOH display_total comes from SI grand_total via GET /tickets/:name.
      await erpUpdate("Alteration Ticket", opts.ticketName, patch);
      return grand;
    } catch (e: any) {
      warnings.push(`Ticket stamp after sell failed: ${e?.message || e}`);
      return null;
    }
  }

  const sellRows: any[] = [];
  for (const s of opts.sellItems) {
    const qty = Math.max(1, Number(s.qty) || 1);
    const rate = Number(s.rate) || 0;
    const code = await ensureItemExists(s.item_code, s.item_name || s.item_code, rate);
    if (code === "ALT-CUSTOM-ALTERATION" && s.item_code && !s.item_code.startsWith("SEED-")) {
      warnings.push(`Item ${s.item_code} missing — billed as custom line`);
    } else if (s.item_code?.startsWith("SEED-")) {
      warnings.push(`Seed SKU ${s.item_code} → custom service line until RTW catalog stocked`);
    }
    const row: Record<string, unknown> = {
      item_code: code,
      qty,
      rate,
      description: sellLineDescription(s),
    };
    // Only set warehouse for real stock items
    const itemDoc = await erpGetDoc<any>("Item", code).catch(() => null);
    if (itemDoc?.is_stock_item) {
      row.warehouse = warehouse;
    }
    sellRows.push(row);
  }
  if (!sellRows.length) {
    return { salesInvoice: opts.existingInvoice, squarePaymentLink: null, appPayUrl: null, warnings, invoiceTotal: null };
  }

  let baseItems: any[] = [];
  let company = opts.company || "L&S Tailors NY LLC";
  let customer = opts.customer;
  let oldName = opts.existingInvoice;

  if (oldName) {
    const inv = await erpGetDoc<any>("Sales Invoice", oldName).catch(() => null);
    if (inv) {
      company = inv.company || company;
      customer = inv.customer || customer;
      baseItems = (inv.items || []).map((it: any) => ({
        item_code: it.item_code,
        qty: it.qty,
        rate: it.rate,
        description: it.description,
        warehouse: it.warehouse || undefined,
        income_account: it.income_account || undefined,
        cost_center: it.cost_center || undefined,
      }));
      // Already has this sell SKU? Don't double-merge
      const existingCodes = new Set(baseItems.map((b) => String(b.item_code)));
      const freshSell = sellRows.filter((r) => !existingCodes.has(String(r.item_code)));
      if (!freshSell.length) {
        const grand = await stampTicket(oldName);
        return {
          salesInvoice: oldName,
          squarePaymentLink: inv.lsh_square_payment_link || null,
          appPayUrl: `${ALTS_URL}/pay/${encodeURIComponent(oldName)}`,
          warnings,
          invoiceTotal: grand ?? (Number(inv.grand_total) || null),
        };
      }
      // use only missing sell rows for merge
      sellRows.length = 0;
      sellRows.push(...freshSell);

      if (Number(inv.docstatus) === 1) {
        // Cancel unpaid SI so we can rebuild with sell lines
        const paid = Number(inv.paid_amount || 0);
        if (paid > 0.01) {
          warnings.push(`SI ${oldName} already has payment — sell lines not merged; create separate invoice manually`);
          await stampTicket(oldName);
          return {
            salesInvoice: oldName,
            squarePaymentLink: inv.lsh_square_payment_link || null,
            appPayUrl: `${ALTS_URL}/pay/${encodeURIComponent(oldName)}`,
            warnings,
            invoiceTotal: Number(inv.grand_total) || null,
          };
        }
        try {
          await erpRunMethod("frappe.client.cancel", { doctype: "Sales Invoice", name: oldName });
        } catch (e: any) {
          warnings.push(`Could not cancel ${oldName} to add sell lines: ${e?.message || e}`);
          await stampTicket(oldName);
          return { salesInvoice: oldName, squarePaymentLink: null, appPayUrl: null, warnings, invoiceTotal: null };
        }
      } else if (Number(inv.docstatus) === 0) {
        // Draft: update in place
        const merged = [...baseItems, ...sellRows];
        await erpUpdate("Sales Invoice", oldName, { items: merged });
        try {
          await erpSubmit("Sales Invoice", oldName);
        } catch (e: any) {
          warnings.push(`Submit draft SI failed: ${e?.message || e}`);
        }
        const grand = await stampTicket(oldName);
        let squarePaymentLink: string | null = null;
        try {
          const linkRes = (await erpRunMethod("ls_alterations.ls_square.pos.create_payment_link", {
            invoice: oldName,
          }).catch(() => null)) as any;
          const lm = linkRes?.message ?? linkRes;
          if (lm?.url) squarePaymentLink = String(lm.url);
        } catch { /* */ }
        return {
          salesInvoice: oldName,
          squarePaymentLink,
          appPayUrl: `${ALTS_URL}/pay/${encodeURIComponent(oldName)}`,
          warnings,
          invoiceTotal: grand,
        };
      }
    }
  }

  const merged = [...baseItems, ...sellRows];
  const today = new Date().toISOString().split("T")[0];
  let newInv: any = null;
  try {
    newInv = await erpCreate<any>("Sales Invoice", {
      customer,
      company,
      posting_date: today,
      due_date: today,
      is_pos: 0,
      update_stock: 0, // avoid stock entry failures for showroom edge cases
      items: merged,
      remarks: `Alteration ticket ${opts.ticketName} (incl. sell items)`,
      alteration_ticket_ref: opts.ticketName,
    });
  } catch (e: any) {
    warnings.push(`Create SI with sell lines failed: ${e?.message || e}`);
    await stampTicket(oldName);
    return { salesInvoice: oldName, squarePaymentLink: null, appPayUrl: null, warnings, invoiceTotal: null };
  }
  const newName = newInv?.name;
  if (!newName) {
    warnings.push("SI create returned no name");
    await stampTicket(oldName);
    return { salesInvoice: oldName, squarePaymentLink: null, appPayUrl: null, warnings, invoiceTotal: null };
  }
  try {
    await erpSubmit("Sales Invoice", newName);
  } catch (e: any) {
    warnings.push(`Submit new SI failed: ${e?.message || e}`);
  }
  const grand = await stampTicket(newName);
  let squarePaymentLink: string | null = null;
  try {
    const linkRes = (await erpRunMethod("ls_alterations.ls_square.pos.create_payment_link", {
      invoice: newName,
    }).catch(() => null)) as any;
    const lm = linkRes?.message ?? linkRes;
    if (lm?.url) squarePaymentLink = String(lm.url);
  } catch { /* */ }
  return {
    salesInvoice: newName,
    squarePaymentLink,
    appPayUrl: `${ALTS_URL}/pay/${encodeURIComponent(newName)}`,
    warnings,
    invoiceTotal: grand,
  };
}

// 6. POST /tickets
intakeAlterationsRouter.post('/tickets', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const body = (await c.req.json()) as any;
  const { customer, newCustomer, isRush, origin, paymentMethod, deposit, ticket_date } = body;
  let garments = body.garments;

  // Validate — SPEC 057: Walk-in may be items-only (sell lines, no alter garments)
  const sellItemsIn: SellLineIn[] = Array.isArray(body.sellItems)
    ? body.sellItems
    : Array.isArray(body.sell_items)
      ? body.sell_items
      : [];
  let garmentsIn = Array.isArray(garments) ? garments : [];
  if (garmentsIn.length === 0 && sellItemsIn.length > 0) {
    // Synthetic shell so create_ticket still has a garment row
    garmentsIn = [{
      ref: 'G1',
      garmentType: 'Other',
      description: 'Retail / stock sale',
      color: '',
      notes: sellItemsIn.map((s: SellLineIn) => sellLineDescription(s)).join('; '),
      lines: [],
    }];
  }
  if (!garmentsIn.length) {
    return c.json({ error: 'garments or sellItems required' }, 400);
  }
  if (!customer && !(newCustomer && newCustomer.name)) {
    return c.json({ error: 'customer or newCustomer.name is required' }, 400);
  }
  // Every alter garment needs at least one work line (billable and non-billable).
  // Sell-only tickets use the synthetic "Retail / stock sale" shell with empty lines.
  const isSellOnlyShell =
    garmentsIn.length === 1 &&
    sellItemsIn.length > 0 &&
    String(garmentsIn[0]?.description || '').toLowerCase().includes('retail');
  if (!isSellOnlyShell) {
    const bare = garmentsIn.filter((g: any) => !Array.isArray(g.lines) || g.lines.length === 0);
    if (bare.length) {
      return c.json({ error: 'Each garment needs at least one work line' }, 400);
    }
  }
  garments = garmentsIn;

  // Build payload
  const today = new Date().toISOString().split('T')[0];
  // Default due_date = 7 days from ticket_date
  const ticketDateStr = ticket_date ?? today;
  const defaultDue = new Date(new Date(ticketDateStr).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const billingStatus: string =
    body.billing_status === 'Included in Custom Order' || body.billing_status === 'Warranty' || body.billing_status === 'Billable'
      ? body.billing_status
      : body.included_in_custom
        ? 'Included in Custom Order'
        : 'Billable';
  const linkedSo = body.linked_sales_order || body.linkedSalesOrder || null;
  const includedInCustom =
    billingStatus === 'Included in Custom Order' || body.included_in_custom === 1 || body.included_in_custom === true ? 1 : 0;

  // Delivery block (SPEC delivery-scheduling-zones) — 3 methods only
  const deliveryMethodRaw = String(body.delivery_method || body.deliveryMethod || 'Pickup');
  const deliveryMethod =
    deliveryMethodRaw === 'Ship (FedEx)' || deliveryMethodRaw === 'Ship' || deliveryMethodRaw === 'FedEx'
      ? 'Ship (FedEx)'
      : deliveryMethodRaw === 'Hand Delivery' || deliveryMethodRaw === 'Courier'
        ? 'Hand Delivery'
        : 'Pickup';
  const deliveryScheduled =
    body.delivery_scheduled === 1 ||
    body.delivery_scheduled === true ||
    body.deliveryScheduled === true ||
    (deliveryMethod !== 'Pickup' && Boolean(body.delivery_zip || body.deliveryZip || body.delivery_address));

  const payload: Record<string, any> = {
    // Alts FOH is NYC-only — coerce any HOU claim
    origin_location: 'NYC',
    is_rush: isRush ? 1 : 0,
    taxes_and_charges: '',   // Alterations are tax-exempt
    payment_method: paymentMethod ?? 'on_account',
    deposit_amount: paymentMethod === 'deposit' ? parseFloat(deposit) || 0 : 0,
    ticket_date: ticketDateStr,
    due_date: body.due_date ?? defaultDue,
    promised_date: body.promised_date ?? body.due_date ?? defaultDue,
    due_time: body.due_time || body.dueTime || null,
    // Billing intent on create so ERP never mints SI for Warranty / Included
    billing_status: billingStatus,
    included_in_custom: includedInCustom,
    // ERPNext create_ticket expects garments + lines as separate top-level arrays.
    // garments: metadata only (garment_type, description, color, fabric_notes)
    // lines: flat list of all alteration lines with garment_ref linking back to G1, G2...
    garments: garments.map((g: any) => ({
      garment_type: g.garmentType,
      garment_description: g.description || g.garmentType,
      color: g.color || '',
      fabric_notes: g.notes || '',
      fabric_type: g.fabric || '',
      garment_condition: g.condition || '',
      fit_area: Array.isArray(g.fitAreas) ? g.fitAreas.join(', ') : (g.fitAreas || ''),
      complexity: g.complexity || '',
    })),
    lines: garments.flatMap((g: any) =>
    (g.lines ?? []).map((l: any) => ({
      garment_ref: g.ref,          // e.g. "G1", "G2"
      preset: l.preset || null,    // optional — null = custom line (Lucia 030)
      description: l.description,
      price: l.price,              // always full shop price (internal value even if non-billable)
      // Capacity / job card minutes; custom lines default 15 if client omits
      estimated_minutes: Number(l.estMinutes ?? l.est_minutes ?? l.estimated_minutes) || 15,
      line_notes: l.notes || l.line_notes || null,
      // Intake cart line id — photo upload matches this (P2-7)
      client_line_key: l.id || l.client_line_key || l.clientKey || null,
    }))
    ),
    };
    if (linkedSo) payload.linked_sales_order = linkedSo;
    if (body.internal_notes) payload.internal_notes = body.internal_notes;
    if (body.customer_notes) payload.customer_notes = body.customer_notes;
    // Real idempotency key (client UUID). Double-submit on flaky wifi returns same ticket.
    const idempotencyKey = (body.idempotency_key || body.idempotencyKey || '').toString().trim();
    if (idempotencyKey) payload.idempotency_key = idempotencyKey;
    payload.delivery_method = deliveryMethod;
    if (deliveryScheduled && deliveryMethod !== 'Pickup') {
      payload.delivery_scheduled = 1;
      if (body.delivery_requested_date || body.deliveryRequestedDate) {
        payload.delivery_requested_date = body.delivery_requested_date || body.deliveryRequestedDate;
      }
      if (body.delivery_time_window || body.deliveryTimeWindow) {
        payload.delivery_time_window = body.delivery_time_window || body.deliveryTimeWindow;
      }
      if (body.delivery_address || body.deliveryAddress) {
        payload.delivery_address = body.delivery_address || body.deliveryAddress;
      }
      if (body.delivery_apt || body.deliveryApt) payload.delivery_apt = body.delivery_apt || body.deliveryApt;
      if (body.delivery_city || body.deliveryCity) payload.delivery_city = body.delivery_city || body.deliveryCity || 'New York';
      if (body.delivery_state || body.deliveryState) payload.delivery_state = body.delivery_state || body.deliveryState || 'NY';
      if (body.delivery_zip || body.deliveryZip) payload.delivery_zip = body.delivery_zip || body.deliveryZip;
      if (body.delivery_lat != null) payload.delivery_lat = body.delivery_lat;
      if (body.delivery_lng != null) payload.delivery_lng = body.delivery_lng;
      if (body.delivery_notes || body.deliveryNotes) payload.delivery_notes = body.delivery_notes || body.deliveryNotes;
      if (body.delivery_fee_override || body.deliveryFeeOverride) {
        payload.delivery_fee_override = 1;
        payload.delivery_fee = Number(body.delivery_fee ?? body.deliveryFee) || 0;
        if (body.delivery_fee_override_reason || body.deliveryFeeOverrideReason) {
          payload.delivery_fee_override_reason =
            body.delivery_fee_override_reason || body.deliveryFeeOverrideReason;
        }
      }
    }

  if (customer) {
    payload.customer = customer.id ?? customer.name;
  } else {
    payload.new_customer = {
      customer_name: newCustomer.name,
      mobile_no: newCustomer.phone ?? '',
      email_id: newCustomer.email ?? '',
    };
  }

  try {
    const result = await erpPost<any>('ls_alterations.api.create_ticket', {
      payload: JSON.stringify(payload),
    });
    // ERPNext may return a plain string (ticket name) or an object
    const ticketName: string | undefined =
      typeof result === 'string'
        ? result
        : (result?.name ?? result?.ticket_name ?? result?.docname ?? result?.ticket ?? undefined);

    if (!ticketName) {
      console.error('[intake-alterations] create_ticket returned unexpected shape:', JSON.stringify(result));
      return c.json({ error: { message: 'Ticket may have been created in ERPNext but no ticket number was returned. Please check ERPNext.' } }, 502);
    }

    // Apply billing intent after create (also sent on create_ticket now — belt-and-suspenders).
    // Non-billable: payment N/A, clear any SI if one slipped through.
    try {
      const patch: Record<string, any> = {
        billing_status: billingStatus,
        included_in_custom: includedInCustom,
      };
      if (linkedSo) patch.linked_sales_order = linkedSo;
      if (body.internal_notes) patch.internal_notes = body.internal_notes;
      if (body.customer_notes) patch.customer_notes = body.customer_notes;
      if (body.due_date || body.due_time || body.dueTime || body.promised_date) {
        if (body.due_date) patch.due_date = body.due_date;
        if (body.promised_date || body.due_date) patch.promised_date = body.promised_date || body.due_date;
        const dt = body.due_time || body.dueTime;
        if (dt) patch.due_time = dt.length === 5 ? `${dt}:00` : dt;
      }
      if (typeof body.isRush === 'boolean' || typeof body.is_rush !== 'undefined') {
        patch.is_rush = body.isRush || body.is_rush ? 1 : 0;
      }
      if (billingStatus === 'Warranty' || billingStatus === 'Included in Custom Order') {
        patch.payment_status = 'N/A';
      }
      await erpUpdate('Alteration Ticket', ticketName, patch);

      if (billingStatus === 'Warranty' || billingStatus === 'Included in Custom Order') {
        const t = await erpGetDoc<any>('Alteration Ticket', ticketName).catch(() => null);
        const inv = t?.sales_invoice;
        if (inv) {
          try {
            // Best-effort: cancel draft/submitted SI so client is never charged.
            await erpRunMethod('frappe.client.cancel', { doctype: 'Sales Invoice', name: inv }).catch(async () => {
              await erpUpdate('Sales Invoice', inv, { docstatus: 2 }).catch(() => {});
            });
          } catch { /* non-fatal */ }
          await erpUpdate('Alteration Ticket', ticketName, {
            sales_invoice: null,
            payment_status: 'N/A',
          }).catch(() => {});
        }
      }
    } catch (e: any) {
      console.error('[intake-alterations] billing patch after create failed:', e?.message);
    }

    // Billable: ensure SI is submitted + Square pay link minted immediately
    // so intake/print/pay work before Ready/Picked Up.
    let salesInvoice: string | null = null;
    let squarePaymentLink: string | null = null;
    let appPayUrl: string | null = null;
    if (billingStatus === 'Billable') {
      try {
        const prep = await erpRunMethod(
          'ls_alterations.ls_alterations.api.invoices.prepare_alteration_invoice',
          { ticket: ticketName },
        ).catch(() => null) as any;
        const msg = prep?.message ?? prep;
        if (msg?.invoice) {
          salesInvoice = String(msg.invoice);
          squarePaymentLink = msg.square_payment_link ? String(msg.square_payment_link) : null;
          appPayUrl = msg.app_pay_url
            ? String(msg.app_pay_url)
            : `${ALTS_URL}/pay/${encodeURIComponent(salesInvoice)}`;
        } else {
          // Fallback: read ticket SI + call create_payment_link
          const t = await erpGetDoc<any>('Alteration Ticket', ticketName).catch(() => null);
          salesInvoice = t?.sales_invoice ? String(t.sales_invoice) : null;
          if (salesInvoice) {
            const linkRes = await erpRunMethod(
              'ls_alterations.ls_square.pos.create_payment_link',
              { invoice: salesInvoice },
            ).catch(() => null) as any;
            const lm = linkRes?.message ?? linkRes;
            if (lm?.url) squarePaymentLink = String(lm.url);
            appPayUrl = `${ALTS_URL}/pay/${encodeURIComponent(salesInvoice)}`;
          }
        }
      } catch (e: any) {
        console.error('[intake-alterations] prepare pay link after create:', e?.message);
      }
    }

    // SPEC 057 — attach sell stock/item rows onto SI (Walk-in mixed cart)
    let sellWarnings: string[] = [];
    let invoiceTotal: number | null = null;
    if (billingStatus === 'Billable' && sellItemsIn.length > 0) {
      try {
        const tdoc = await erpGetDoc<any>('Alteration Ticket', ticketName).catch(() => null);
        const cust = (tdoc?.customer as string) || (customer?.id ?? customer?.name) || '';
        const company = 'L&S Tailors NY LLC';
        const merged = await appendSellItemsToTicketInvoice({
          ticketName,
          customer: cust,
          company,
          origin: 'NYC',
          sellItems: sellItemsIn,
          existingInvoice: salesInvoice || (tdoc?.sales_invoice ? String(tdoc.sales_invoice) : null),
        });
        if (merged.salesInvoice) salesInvoice = merged.salesInvoice;
        if (merged.squarePaymentLink) squarePaymentLink = merged.squarePaymentLink;
        if (merged.appPayUrl) appPayUrl = merged.appPayUrl;
        if (merged.invoiceTotal != null) invoiceTotal = merged.invoiceTotal;
        sellWarnings = merged.warnings || [];
      } catch (e: any) {
        console.error('[intake-alterations] sell items merge failed:', e?.message);
        sellWarnings.push(String(e?.message || e));
      }
    }

    // Delivery schedule + zone fee (Parts 4–10)
    let deliveryMeta: Record<string, unknown> | null = null;
    if (deliveryMethod !== 'Pickup' && deliveryScheduled) {
      try {
        const plan = await planDeliveryFee({
          delivery_method: deliveryMethod,
          delivery_scheduled: true,
          delivery_zip: body.delivery_zip || body.deliveryZip,
          delivery_fee_override: body.delivery_fee_override || body.deliveryFeeOverride,
          delivery_fee: body.delivery_fee ?? body.deliveryFee,
          included_in_custom: includedInCustom,
          billing_status: billingStatus,
          linked_sales_order: linkedSo,
          origin_location: 'NYC',
        });

        const feePatch: Record<string, unknown> = {
          delivery_method: plan.method === 'Ship (FedEx)' ? 'Ship (FedEx)' : deliveryMethod,
          delivery_scheduled: 1,
          delivery_zone: plan.zone,
          delivery_fee: plan.fee,
        };
        if (body.delivery_requested_date || body.deliveryRequestedDate) {
          feePatch.delivery_requested_date = body.delivery_requested_date || body.deliveryRequestedDate;
        }
        if (body.delivery_time_window || body.deliveryTimeWindow) {
          feePatch.delivery_time_window = body.delivery_time_window || body.deliveryTimeWindow;
        }
        if (body.delivery_address || body.deliveryAddress) {
          feePatch.delivery_address = body.delivery_address || body.deliveryAddress;
        }
        if (body.delivery_apt || body.deliveryApt) feePatch.delivery_apt = body.delivery_apt || body.deliveryApt;
        if (body.delivery_city || body.deliveryCity) {
          feePatch.delivery_city = body.delivery_city || body.deliveryCity || 'New York';
        }
        if (body.delivery_state || body.deliveryState) {
          feePatch.delivery_state = body.delivery_state || body.deliveryState || 'NY';
        }
        if (body.delivery_zip || body.deliveryZip) {
          feePatch.delivery_zip = body.delivery_zip || body.deliveryZip;
        }
        if (body.delivery_notes || body.deliveryNotes) {
          feePatch.delivery_notes = body.delivery_notes || body.deliveryNotes;
        }

        // ticket_total = alter lines + fee
        const tNow = await erpGetDoc<any>('Alteration Ticket', ticketName).catch(() => null);
        const linesSum = Array.isArray(tNow?.lines)
          ? tNow.lines.reduce((s: number, l: any) => s + (Number(l.price) || 0), 0)
          : Number(tNow?.ticket_total) || 0;
        feePatch.ticket_total = linesSum + (plan.fee || 0);
        await erpUpdate('Alteration Ticket', ticketName, feePatch).catch((e: any) => {
          console.warn('[intake] delivery feePatch', e?.message);
        });

        // Create or update LSH Delivery (idempotent on ticket link)
        const existingDel = await erpList<any>('LSH Delivery', {
          filters: [['lsh_alteration_ticket', '=', ticketName]],
          fields: ['name'],
          limit: 1,
        }).catch(() => []);
        const windowStart: Record<string, string> = {
          'Morning (9–12)': '09:00:00',
          'Afternoon (12–4)': '12:00:00',
          'Evening (4–7)': '16:00:00',
          Anytime: '12:00:00',
        };
        const tw = String(body.delivery_time_window || body.deliveryTimeWindow || 'Anytime');
        const reqDate = String(body.delivery_requested_date || body.deliveryRequestedDate || tNow?.due_date || '');
        const scheduledAt = reqDate ? `${reqDate} ${windowStart[tw] || '12:00:00'}` : null;
        const gcount = Array.isArray(tNow?.garments) ? tNow.garments.length : garmentsIn.length;
        const gsum = Array.isArray(tNow?.garments)
          ? tNow.garments.map((g: any) => g.garment_type || g.garment_description).filter(Boolean).join(' · ')
          : '';

        const delDoc: Record<string, unknown> = {
          lsh_status: 'Queued',
          lsh_delivery_method: plan.method === 'Ship (FedEx)' ? 'Ship Direct' : 'Hand Delivery',
          lsh_origin_location: 'NYC',
          lsh_alteration_ticket: ticketName,
          customer: tNow?.customer || payload.customer,
          customer_name: tNow?.customer_name || null,
          customer_phone: tNow?.customer_phone || null,
          lsh_delivery_address: feePatch.delivery_address || null,
          lsh_delivery_apt: feePatch.delivery_apt || null,
          lsh_delivery_city: feePatch.delivery_city || 'New York',
          lsh_delivery_state: feePatch.delivery_state || 'NY',
          lsh_delivery_zip: feePatch.delivery_zip || null,
          lsh_scheduled_at: scheduledAt,
          lsh_queued_at: erpDatetime(),
          lsh_garment_count: gcount,
          lsh_garment_summary: gsum || null,
          lsh_notify_phone: tNow?.customer_phone || null,
          lsh_delivery_notes: feePatch.delivery_notes || null,
          lsh_carrier: plan.method === 'Ship (FedEx)' ? 'FedEx' : null,
        };

        let deliveryName: string | null = null;
        if (existingDel?.[0]?.name) {
          deliveryName = existingDel[0].name;
          await erpUpdate('LSH Delivery', deliveryName, delDoc);
        } else {
          const created = await erpCreate<any>('LSH Delivery', {
            naming_series: 'DN-NYC-.YYYY.-',
            ...delDoc,
            lsh_timeline: [
              {
                doctype: 'LSH Delivery Timeline',
                event_type: 'Queued',
                event_at: erpDatetime(),
                actor_label: user.name || user.email || 'Staff',
                message: `Booked with ticket ${ticketName}`,
              },
            ],
          });
          deliveryName = created?.name || null;
        }
        if (deliveryName) {
          await erpUpdate('Alteration Ticket', ticketName, { linked_delivery: deliveryName }).catch(() => {});
        }

        // Append fee Item line on SI when billable
        if (billingStatus === 'Billable' && plan.item_code) {
          let invName = salesInvoice;
          if (!invName) {
            const t2 = await erpGetDoc<any>('Alteration Ticket', ticketName).catch(() => null);
            invName = t2?.sales_invoice ? String(t2.sales_invoice) : null;
          }
          if (invName) {
            const inv = await erpGetDoc<any>('Sales Invoice', invName).catch(() => null);
            if (inv && Number(inv.docstatus) === 0) {
              const items = (inv.items || []).map((it: any) => ({
                item_code: it.item_code,
                item_name: it.item_name,
                description: it.description,
                qty: it.qty,
                rate: it.rate,
                uom: it.uom || 'Nos',
              }));
              const already = items.some((it: any) => String(it.item_code || '').startsWith('DEL-'));
              if (!already) {
                items.push({
                  item_code: plan.item_code,
                  item_name: plan.free_custom
                    ? 'Delivery — Included'
                    : plan.zone_name
                      ? `Hand Delivery — ${plan.zone_name}`
                      : plan.method === 'Ship (FedEx)'
                        ? 'Shipping — FedEx'
                        : 'Delivery',
                  description: plan.free_custom
                    ? 'Custom-order delivery included'
                    : plan.zone
                      ? `Zone ${plan.zone}`
                      : 'Delivery fee',
                  qty: 1,
                  rate: plan.fee,
                  uom: 'Nos',
                });
                await erpUpdate('Sales Invoice', invName, { items });
                const refreshed = await erpGetDoc<any>('Sales Invoice', invName).catch(() => null);
                if (refreshed?.grand_total != null) invoiceTotal = Number(refreshed.grand_total);
              }
            }
          }
        }

        deliveryMeta = {
          method: plan.method,
          zone: plan.zone,
          zone_name: plan.zone_name,
          fee: plan.fee,
          item_code: plan.item_code,
          free_custom: plan.free_custom,
          delivery_name: deliveryName,
        };
      } catch (e: any) {
        console.error('[intake-alterations] delivery schedule failed:', e?.message);
        sellWarnings.push(`delivery: ${e?.message || e}`);
      }
    }

    return c.json({
      data: {
        ticketName,
        salesInvoice,
        squarePaymentLink,
        appPayUrl,
        invoiceTotal: invoiceTotal ?? undefined,
        sellWarnings: sellWarnings.length ? sellWarnings : undefined,
        delivery: deliveryMeta ?? undefined,
      },
    });
  } catch (e: any) {
    console.error('[intake-alterations] ticket create error:', e?.message);
    return c.json({ error: { message: e?.message || 'Failed to create ticket' } }, 502);
  }
});

// FOH-safe Sales Order search (no financials role required)
intakeAlterationsRouter.get('/sales-orders/search', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const q = (c.req.query('q') || '').trim();
  const limit = Math.min(Number(c.req.query('limit') || 12), 30);

  try {
    const fields = [
      'name', 'customer', 'customer_name', 'status', 'make_type',
      'grand_total', 'transaction_date', 'delivery_date', 'delivery_status',
    ];

    let rows: any[] = [];
    if (q.length >= 2) {
      const like = `%${q}%`;
      // name match
      const byName = await mcpList<any>(
        'Sales Order',
        fields,
        [['name', 'like', like], ['status', 'not in', ['Cancelled', 'Closed']]],
        limit,
        'modified desc',
      );
      const byCust = await mcpList<any>(
        'Sales Order',
        fields,
        [['customer_name', 'like', like], ['status', 'not in', ['Cancelled', 'Closed', 'Completed']]],
        limit,
        'modified desc',
      );
      const seen = new Set<string>();
      for (const r of [...byName, ...byCust]) {
        if (!seen.has(r.name)) {
          seen.add(r.name);
          rows.push(r);
        }
      }
      rows = rows.slice(0, limit);
    } else {
      // Recent open orders for "fitting stage this week" panel
      rows = await mcpList<any>(
        'Sales Order',
        fields,
        [['status', 'not in', ['Cancelled', 'Closed', 'Completed']]],
        limit,
        'modified desc',
      );
    }

    return c.json({
      data: rows.map((r) => ({
        name: r.name,
        id: r.name,
        customer: r.customer,
        customer_name: r.customer_name,
        status: r.status,
        make_type: r.make_type,
        grand_total: r.grand_total,
        transaction_date: r.transaction_date,
        delivery_date: r.delivery_date,
        delivery_status: r.delivery_status,
      })),
    });
  } catch (e: any) {
    console.error('[so-search]', e?.message);
    return c.json({ data: [], error: e?.message });
  }
});

/** Map SO line → garment piece chips for alteration cart (suit expands). */
function expandSoItemToPieces(it: any): Array<{ garmentType: string; label: string; sourceItem: string }> {
  const code = String(it.item_code || '').toUpperCase();
  const name = String(it.item_name || '').toUpperCase();
  const blob = `${code} ${name}`;
  const src = it.item_name || it.item_code || 'Item';
  if (/3\s*-?\s*PC|3PC|THREE.?PIECE|SUIT.?3/.test(blob)) {
    return [
      { garmentType: 'Jacket', label: `${src} · Jacket`, sourceItem: src },
      { garmentType: 'Trouser', label: `${src} · Trouser`, sourceItem: src },
      { garmentType: 'Vest', label: `${src} · Vest`, sourceItem: src },
    ];
  }
  if (/SUIT|2\s*-?\s*PC|2PC|TWO.?PIECE|BESPOKE-SUIT|MTM-SUIT/.test(blob) && !/TROUSER|JACKET|VEST|SHIRT|JEAN/.test(blob.replace(/SUIT/g, ''))) {
    return [
      { garmentType: 'Jacket', label: `${src} · Jacket`, sourceItem: src },
      { garmentType: 'Trouser', label: `${src} · Trouser`, sourceItem: src },
    ];
  }
  if (/JEAN|DENIM|TROUSER|PANT|SLACK/.test(blob)) return [{ garmentType: 'Trouser', label: src, sourceItem: src }];
  if (/JACKET|BLAZER|SPORT.?COAT/.test(blob)) return [{ garmentType: 'Jacket', label: src, sourceItem: src }];
  if (/COAT|OVERCOAT|TOPCOAT|TRENCH/.test(blob)) return [{ garmentType: 'Coat', label: src, sourceItem: src }];
  if (/VEST|WAISTCOAT/.test(blob)) return [{ garmentType: 'Vest', label: src, sourceItem: src }];
  if (/SHIRT/.test(blob)) return [{ garmentType: 'Shirt', label: src, sourceItem: src }];
  if (/DRESS/.test(blob)) return [{ garmentType: 'Dress', label: src, sourceItem: src }];
  if (/SKIRT/.test(blob)) return [{ garmentType: 'Skirt', label: src, sourceItem: src }];
  return [{ garmentType: 'Other', label: src, sourceItem: src }];
}

// FOH-safe Sales Order detail + line items → seed alteration cart
// Must stay after /sales-orders/search so "search" is not captured as :name
intakeAlterationsRouter.get('/sales-orders/:name', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const name = c.req.param('name');
  try {
    const doc = await mcpGet<any>('Sales Order', name);
    let customerPhone = '';
    let customerEmail = '';
    try {
      if (doc.customer) {
        const cust = await mcpGet<any>('Customer', doc.customer);
        customerPhone = cust.mobile_no || cust.phone || '';
        customerEmail = cust.email_id || '';
      }
    } catch { /* non-fatal */ }

    const items = (doc.items || []).map((it: any, idx: number) => ({
      id: it.name || `row-${idx}`,
      key: it.name || `row-${idx}`,
      idx: it.idx || idx + 1,
      item_code: it.item_code,
      item_name: it.item_name,
      description: String(it.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      qty: Number(it.qty) || 1,
      rate: Number(it.rate) || 0,
      amount: Number(it.amount) || 0,
      item_group: it.item_group,
      pieces: expandSoItemToPieces(it),
    }));

    return c.json({
      data: {
        name: doc.name,
        customer: doc.customer,
        customer_name: doc.customer_name,
        customer_phone: customerPhone || doc.contact_mobile || doc.contact_phone || '',
        customer_email: customerEmail || doc.contact_email || '',
        status: doc.status,
        make_type: doc.make_type,
        grand_total: doc.grand_total,
        delivery_date: doc.delivery_date,
        yz_order_no: doc.yz_order_no,
        mtmpro_order: doc.mtmpro_order,
        items,
      },
    });
  } catch (e: any) {
    console.error('[so-get]', e?.message);
    return c.json({ error: { message: e?.message || 'Failed to load sales order' } }, 502);
  }
});

// 7. PATCH /tickets/:name/tailor
intakeAlterationsRouter.patch('/tickets/:name/tailor', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const body = (await c.req.json()) as any;
  const { tailorId } = body;

  try {
    await erpUpdate('Alteration Ticket', ticketName, { assigned_tailor: tailorId || null });
    return c.json({ data: { ok: true } });
  } catch (e: any) {
    console.error('[tailor patch] ERP error:', e?.message);
    return c.json({ error: { message: 'ERPNext update failed: ' + (e?.message || '').slice(0, 150) } }, 502);
  }
});

// 8. PATCH /tickets/:name/status — applies Frappe workflow transitions
intakeAlterationsRouter.patch('/tickets/:name/status', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const { status } = (await c.req.json()) as { status: string };

  // Frappe Workflow: direct writes to workflow_state are reverted by the engine.
  // Must apply named transition actions instead.
  const FORWARD = ['Received', 'In Progress', 'Ready', 'Picked Up'] as const;
  const DIRECT: Record<string, Record<string, string>> = {
    'Received':    { 'In Progress': 'Start Work',    'Cancelled': 'Cancel' },
    'In Progress': { 'Ready':       'Mark Ready',     'Cancelled': 'Cancel' },
    'Ready':       { 'Picked Up':   'Mark Picked Up', 'Cancelled': 'Cancel' },
    'Cancelled':   { 'Received':    'Reopen' },
  };

  function actionPath(from: string, to: string): string[] | null {
    if (from === to) return [];
    if (DIRECT[from]?.[to]) return [DIRECT[from][to]];
    const fi = FORWARD.indexOf(from as any);
    const ti = FORWARD.indexOf(to as any);
    if (fi >= 0 && ti > fi) {
      const path: string[] = [];
      for (let i = fi; i < ti; i++) {
        const fromState = FORWARD[i];
        const toState = FORWARD[i + 1];
        if (!fromState || !toState) return null;
        const a = DIRECT[fromState]?.[toState];
        if (!a) return null;
        path.push(a);
      }
      return path;
    }
    return null;
  }

  try {
    const doc = await mcpGet<any>('Alteration Ticket', ticketName);
    const path = actionPath(doc.workflow_state, status);

    if (path === null) {
      return c.json({ error: { message: `No workflow path from "${doc.workflow_state}" to "${status}"` } }, 400);
    }
    if (path.length === 0) {
      return c.json({ data: { ok: true } }); // already at target
    }

    // Apply each transition via frappe.model.workflow.apply_workflow (same approach as alterations.ts)
    for (const action of path) {
      const res = await fetch(
        `${ERP_BASE}/api/method/frappe.model.workflow.apply_workflow`,
        {
          method: 'POST',
          headers: erpHeaders(),
          body: JSON.stringify({ doc: JSON.stringify({ doctype: 'Alteration Ticket', name: ticketName }), action }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as any;
        return c.json({ error: { message: `Workflow action "${action}" failed: ${err._server_messages ?? err.message ?? res.status}` } }, 502);
      }
    }

    // Pickup allowed WITHOUT payment. If still unpaid → Sofia/Twilio SMS
    // (released + balance + pay links, v5 multi-bubble).
    let unpaid_release_sms: { sent: boolean; sids?: string[]; reason?: string } | undefined;
    if (status === "Picked Up") {
      unpaid_release_sms = await notifyUnpaidRelease(ticketName).catch((e: any) => ({
        sent: false,
        reason: e?.message ?? "sms_failed",
      }));
    }

    return c.json({ data: { ok: true, unpaid_release_sms } });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502);
  }
});

/** Multi-bubble unpaid-release SMS. No-op if paid / N/A / no phone / zero balance. */
async function notifyUnpaidRelease(
  ticketName: string,
): Promise<{ sent: boolean; sids?: string[]; reason?: string }> {
  const ticket = await mcpGet<any>("Alteration Ticket", ticketName);
  const payStatus = String(ticket.payment_status ?? "");
  if (payStatus === "Paid" || payStatus === "N/A") {
    return { sent: false, reason: "paid_or_na" };
  }

  let outstanding = Number(ticket.ticket_total ?? 0);
  let invoiceName = ticket.sales_invoice as string | undefined;
  let squareLink = "";
  if (invoiceName) {
    try {
      const inv = await mcpGet<any>("Sales Invoice", invoiceName);
      outstanding = Number(inv.outstanding_amount ?? outstanding);
      squareLink = String(inv.lsh_square_payment_link ?? "");
      if (Number(inv.docstatus) === 2 || String(inv.status) === "Paid") {
        return { sent: false, reason: "invoice_paid" };
      }
    } catch {
      /* use ticket totals */
    }
  }
  if (!(outstanding > 0.001)) {
    return { sent: false, reason: "zero_balance" };
  }

  const phone = String(ticket.customer_phone || ticket.customer_mobile || "").trim();
  if (!phone) return { sent: false, reason: "no_phone" };

  const first = String(ticket.customer_name || "there").split(/\s+/)[0] || "there";
  const amt = outstanding.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const payUrl = invoiceName
    ? `${ALTS_URL}/pay/${encodeURIComponent(invoiceName)}`
    : eTicketPublicUrl(ticketName);

  // Bubble 1 prose only; 2 app pay; 3 Square if present (SMS v5 shape).
  const b1 = `Hi ${first}, your alterations were released from L&S Custom Tailors. Balance due ${amt} — pay anytime when convenient.`;
  const sids: string[] = [];

  const sid1 = await sendSms(phone, b1);
  if (!sid1) return { sent: false, reason: "twilio_failed" };
  sids.push(sid1);

  const sid2 = await sendSms(phone, payUrl);
  if (sid2) sids.push(sid2);

  if (squareLink) {
    const sid3 = await sendSms(phone, squareLink);
    if (sid3) sids.push(sid3);
  }

  try {
    const now = new Date().toISOString().replace("T", " ").split(".")[0];
    await erpRunMethod("frappe.client.add_comment", {
      reference_doctype: "Alteration Ticket",
      reference_name: ticketName,
      content: `Unpaid release SMS sent (${sids.length} bubbles). Balance ${amt}. ${now}`,
      comment_email: "carl@lstailors.com",
      comment_by: "L&S POS",
    });
  } catch {
    /* non-fatal */
  }

  return { sent: true, sids };
}

// 9b. POST /tickets/:name/notify-unpaid-release — manual resend
intakeAlterationsRouter.post("/tickets/:name/notify-unpaid-release", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const ticketName = c.req.param("name");
  try {
    const result = await notifyUnpaidRelease(ticketName);
    if (!result.sent) {
      return c.json({ error: { message: result.reason ?? "not_sent" }, data: result }, 400);
    }
    return c.json({ data: result });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502);
  }
});

// 9. PATCH /tickets/:name/due-date — also syncs promised_date (P2-11)
intakeAlterationsRouter.patch('/tickets/:name/due-date', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const body = (await c.req.json()) as any;
  const due_date = body.due_date;
  if (!due_date) return c.json({ error: 'due_date required' }, 400);
  const promised_date = body.promised_date || due_date;

  try {
    await erpUpdate('Alteration Ticket', ticketName, { due_date, promised_date });
    return c.json({ data: { ok: true, due_date, promised_date } });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502);
  }
});

// 10. PATCH /tickets/:name/transfer (location and/or at-home tailor)
// origin_location is NYC-only for alts. "Home" is at-home work via assigned_tailor —
// never write origin_location="Home" (Frappe 417 ValidationError).
intakeAlterationsRouter.patch('/tickets/:name/transfer', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const body = (await c.req.json()) as any;
  const { location, tailorId, note } = body;

  const loc = typeof location === 'string' ? location.trim() : '';
  const locUpper = loc.toUpperCase();
  const isHome =
    !loc ||
    locUpper === 'HOME' ||
    loc.toLowerCase() === 'at-home' ||
    loc.toLowerCase() === 'at home';

  const doc: Record<string, any> = {};

  if (isHome) {
    if (!tailorId) {
      return c.json(
        { error: { message: 'Pick an at-home tailor — Home is not a store location' } },
        400,
      );
    }
    // Keep existing origin_location (store of record). Only assign tailor.
    doc.assigned_tailor = tailorId;
  } else if (locUpper === 'NYC') {
    doc.origin_location = 'NYC';
    // Back in shop: clear at-home tailor unless explicitly re-set
    if (tailorId !== undefined) doc.assigned_tailor = tailorId || null;
    else doc.assigned_tailor = null;
  } else if (locUpper === 'HOU') {
    return c.json(
      { error: { message: 'Houston is retired — use NYC Store or at-home tailor' } },
      400,
    );
  } else if (loc) {
    return c.json(
      { error: { message: 'Location must be NYC or Home (at-home tailor)' } },
      400,
    );
  } else if (tailorId !== undefined) {
    doc.assigned_tailor = tailorId || null;
  }

  if (note) doc.transfer_note = note;

  if (!Object.keys(doc).length) {
    return c.json({ error: { message: 'location or tailorId required' } }, 400);
  }

  try {
    await erpUpdate('Alteration Ticket', ticketName, doc);
    return c.json({ data: { ok: true, ...doc } });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502);
  }
});

// 11. POST /tickets/:name/sms
intakeAlterationsRouter.post('/tickets/:name/sms', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const body = (await c.req.json()) as any;
  const { phone, message, includeQr } = body;

  if (!phone) return c.json({ error: { message: 'phone required' } }, 400);
  if (!message) return c.json({ error: { message: 'message required' } }, 400);

  const mediaUrl = includeQr ? eTicketQrUrl(ticketName) : undefined;
  const sid = await sendSms(phone, message, mediaUrl);
  if (!sid) return c.json({ error: { message: 'SMS send failed — check Twilio credentials' } }, 502);

  return c.json({ data: { ok: true, sid } });
});

// 12. POST /tickets/:name/notify-ready — send MMS (with QR) + stamp notified_ready_at
intakeAlterationsRouter.post('/tickets/:name/notify-ready', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const body = (await c.req.json()) as any;
  const { phone, message } = body;

  if (!phone) return c.json({ error: { message: 'phone required' } }, 400);
  if (!message) return c.json({ error: { message: 'message required' } }, 400);

  // Always attach QR code image — iOS auto-scans it from the Messages app
  const sid = await sendSms(phone, message, eTicketQrUrl(ticketName));
  if (!sid) return c.json({ error: { message: 'SMS send failed — check Twilio credentials' } }, 502);

  // Stamp notified_ready_at in ERPNext (non-fatal)
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  try {
    await erpUpdate('Alteration Ticket', ticketName, { notified_ready_at: now });
  } catch { /* non-fatal */ }

  return c.json({ data: { ok: true, sid } });
});

// 13. POST /tickets/:name/email (via ERPNext sendmail)
intakeAlterationsRouter.post('/tickets/:name/email', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const body = (await c.req.json()) as any;
  const { to_email, subject, message } = body;

  if (!to_email) return c.json({ error: { message: 'to_email required' } }, 400);

  const key = process.env.ERPNEXT_API_KEY ?? '';
  const sec = process.env.ERPNEXT_API_SECRET ?? '';
  const ERP_BASE_URL = process.env.ERPNEXT_BASE_URL ?? 'https://erp.lstailors.com';

  try {
    const res = await fetch(`${ERP_BASE_URL}/api/method/frappe.core.doctype.communication.email.make`, {
      method: 'POST',
      headers: { Authorization: `token ${key}:${sec}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipients: to_email,
        subject: subject ?? `Update on your alteration ticket ${ticketName}`,
        content: message,
        doctype: 'Alteration Ticket',
        name: ticketName,
        send_email: 1,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return c.json({ error: { message: `ERPNext email failed: ${t.slice(0, 200)}` } }, 502);
    }
    return c.json({ data: { ok: true } });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502);
  }
});

// ---------------------------------------------------------------------------
// Customer detail + edit (reads/writes ERPNext Customer, Contact, Address)
// ---------------------------------------------------------------------------

// Helper: direct ERP fetch (uses ERPNEXT_API_KEY/SECRET set in Vercel env)
async function erpFetch(path: string, method = 'GET', body?: object) {
  const base = process.env.ERPNEXT_BASE_URL ?? '';
  const key  = process.env.ERPNEXT_API_KEY   ?? '';
  const sec  = process.env.ERPNEXT_API_SECRET ?? '';
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `token ${key}:${sec}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`ERP ${res.status} ${path}`);
  return res.json() as Promise<any>;
}

// GET /customers/:id — multi phones, emails, addresses, contacts (client + assistants)
intakeAlterationsRouter.get('/customers/:id', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const linkFilter = JSON.stringify([
    ['Dynamic Link', 'link_doctype', '=', 'Customer'],
    ['Dynamic Link', 'link_name', '=', id],
  ]);

  try {
    const { data: cust } = await erpFetch(
      `/api/resource/Customer/${encodeURIComponent(id)}`
    );

    // All linked contacts (client + assistants)
    const { data: contactRows } = await erpFetch(
      `/api/resource/Contact?filters=${encodeURIComponent(linkFilter)}&fields=${encodeURIComponent(JSON.stringify(['name','first_name','last_name','full_name','mobile_no','phone','email_id','designation','is_primary_contact']))}&limit_page_length=20`
    ).catch(() => ({ data: [] as any[] }));

    const people: any[] = [];
    const phones: any[] = [];
    const emails: any[] = [];
    let primaryContact: any = null;

    for (const row of contactRows ?? []) {
      let full: any = row;
      try {
        const got = await erpFetch(`/api/resource/Contact/${encodeURIComponent(row.name)}`);
        full = got.data ?? got.message ?? row;
      } catch { /* keep list row */ }

      const name =
        full.full_name ||
        [full.first_name, full.last_name].filter(Boolean).join(' ') ||
        row.name;
      const roleRaw = String(full.designation || '').trim();
      const isPrimary =
        !!full.is_primary_contact ||
        full.name === cust.customer_primary_contact ||
        (!cust.customer_primary_contact && people.length === 0 && !roleRaw);
      const role =
        isPrimary && !/assistant/i.test(roleRaw)
          ? 'Client'
          : roleRaw || (isPrimary ? 'Client' : 'Other');

      people.push({
        id: full.name,
        name,
        role,
        phone: full.mobile_no || full.phone || '',
        email: full.email_id || '',
        isPrimary,
      });

      if (isPrimary || full.name === cust.customer_primary_contact) primaryContact = full;

      // Child table phone_nos
      const phoneRows = Array.isArray(full.phone_nos) ? full.phone_nos : [];
      for (const p of phoneRows) {
        const num = String(p.phone || '').trim();
        if (!num) continue;
        phones.push({
          id: p.name || undefined,
          number: num,
          label: p.is_primary_mobile_no ? 'Mobile' : p.is_primary_phone ? 'Phone' : 'Other',
          isPrimary: !!(p.is_primary_mobile_no || p.is_primary_phone),
          contactId: full.name,
        });
      }
      // Top-level fields if not already in child table
      if (full.mobile_no && !phones.some((p) => p.number === full.mobile_no && p.contactId === full.name)) {
        phones.push({
          number: full.mobile_no,
          label: isPrimary ? 'Mobile' : role === 'Assistant' ? 'Assistant' : 'Mobile',
          isPrimary: isPrimary && !phones.some((p) => p.isPrimary),
          contactId: full.name,
        });
      }
      if (full.phone && full.phone !== full.mobile_no && !phones.some((p) => p.number === full.phone && p.contactId === full.name)) {
        phones.push({
          number: full.phone,
          label: isPrimary ? 'Work' : role === 'Assistant' ? 'Assistant' : 'Phone',
          isPrimary: false,
          contactId: full.name,
        });
      }

      const emailRows = Array.isArray(full.email_ids) ? full.email_ids : [];
      for (const e of emailRows) {
        const em = String(e.email_id || '').trim();
        if (!em) continue;
        emails.push({
          id: e.name || undefined,
          email: em,
          isPrimary: !!e.is_primary,
          contactId: full.name,
        });
      }
      if (full.email_id && !emails.some((e) => e.email === full.email_id && e.contactId === full.name)) {
        emails.push({
          email: full.email_id,
          isPrimary: isPrimary && !emails.some((e) => e.isPrimary),
          contactId: full.name,
        });
      }
    }

    // All linked addresses (residences, billing, shipping, …)
    const { data: addrRows } = await erpFetch(
      `/api/resource/Address?filters=${encodeURIComponent(linkFilter)}&fields=${encodeURIComponent(JSON.stringify([
        'name','address_title','address_type','address_line1','address_line2','city','state','pincode','country',
        'is_primary_address','is_shipping_address','disabled','phone','email_id',
      ]))}&limit_page_length=20`
    ).catch(() => ({ data: [] as any[] }));

    const addresses = (addrRows ?? [])
      .filter((a: any) => !a.disabled)
      .map((a: any) => ({
        id: a.name,
        title: a.address_title || a.address_type || '',
        type: a.address_type || 'Personal',
        line1: a.address_line1 || '',
        line2: a.address_line2 || '',
        city: a.city || '',
        state: a.state || '',
        zip: a.pincode || '',
        country: a.country || 'United States',
        isBilling: !!a.is_primary_address || a.name === cust.customer_primary_address,
        isShipping: !!a.is_shipping_address,
      }));

    const primaryAddr =
      addresses.find((a: any) => a.isBilling) ||
      addresses.find((a: any) => a.isShipping) ||
      addresses[0] ||
      null;

    const mobile =
      phones.find((p) => p.isPrimary)?.number ||
      primaryContact?.mobile_no ||
      primaryContact?.phone ||
      cust.mobile_no ||
      '';
    const email =
      emails.find((e) => e.isPrimary)?.email ||
      primaryContact?.email_id ||
      cust.email_id ||
      '';

    return c.json({
      data: {
        id: cust.name,
        name: cust.customer_name,
        mobile,
        email,
        notes: cust.custom_client_notes || cust.customer_details || '',
        contactName: cust.customer_primary_contact || primaryContact?.name || null,
        image: cust.image || null,
        vipFlag: !!cust.vip_flag,
        preferredName: cust.preferred_name || null,
        profession: cust.profession || null,
        birthday: cust.date_of_birth || null,
        anniversary: cust.anniversary_date || null,
        styleNotes: cust.style_notes || null,
        fitNotes: cust.fit_notes || null,
        // backward-compat single address
        address: primaryAddr
          ? {
              id: primaryAddr.id,
              line1: primaryAddr.line1,
              line2: primaryAddr.line2,
              city: primaryAddr.city,
              state: primaryAddr.state,
              zip: primaryAddr.zip,
              country: primaryAddr.country,
            }
          : null,
        phones,
        emails,
        addresses,
        people,
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 500);
  }
});

// POST /photos — upload garment photo to ERPNext File
intakeAlterationsRouter.post('/photos', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const path = formData.get('path') as string | null;
  const ticketName = formData.get('ticketName') as string | null;
  const garmentRef = (formData.get('garmentRef') as string | null) || '';
  const lineRef = (formData.get('lineRef') as string | null) || '';
  const lineIdxRaw = formData.get('lineIdx');
  const lineIdxParsed =
    lineIdxRaw != null && String(lineIdxRaw).trim() !== ''
      ? Number(lineIdxRaw)
      : NaN;

  if (!file || !path) return c.json({ error: 'file and path required' }, 400);

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const base = path.split('/').pop() ?? file.name ?? 'photo.jpg';
    // Durable File naming: G1-L0-<clientKey8>-photo.jpg (parsed by GET /photos)
    const idxPart = Number.isFinite(lineIdxParsed) ? `L${lineIdxParsed}` : null;
    const keyPart = lineRef ? lineRef.slice(0, 8) : null;
    const filename = [garmentRef || null, idxPart, keyPart, base].filter(Boolean).join('-');
    const { fileUrl, fileId } = await uploadFile({
      file: buffer,
      filename,
      contentType: file.type || 'image/jpeg',
      doctype: ticketName ? 'Alteration Ticket' : undefined,
      docname: ticketName ?? undefined,
      isPrivate: false,
    });

    let resolvedLineName: string | null = null;
    let resolvedLineIdx: number | null = Number.isFinite(lineIdxParsed) ? lineIdxParsed : null;

    // Append URL onto the matching line's line_photos (P2-7: client_line_key → lineIdx → last on garment)
    if (ticketName && (lineRef || garmentRef || Number.isFinite(lineIdxParsed))) {
      try {
        const t = await erpGetDoc<any>('Alteration Ticket', ticketName);
        const lines = Array.isArray(t?.lines) ? t.lines : [];
        const abs = erpFileAbsoluteUrl(fileUrl);
        const gLines = lines
          .filter((ln: any) => !garmentRef || ln.garment_ref === garmentRef)
          .sort((a: any, b: any) => (Number(a.idx) || 0) - (Number(b.idx) || 0));

        let target: any = null;
        if (lineRef) {
          target = gLines.find((ln: any) => String(ln.client_line_key || '') === lineRef) || null;
        }
        if (!target && Number.isFinite(lineIdxParsed) && lineIdxParsed >= 0) {
          target = gLines[lineIdxParsed] || null;
        }
        if (!target && garmentRef) {
          target = gLines[gLines.length - 1] || null;
        }

        if (target?.name) {
          resolvedLineName = String(target.name);
          if (resolvedLineIdx == null) {
            const i = gLines.findIndex((ln: any) => ln.name === target.name);
            resolvedLineIdx = i >= 0 ? i : null;
          }
          const prev = String(target.line_photos || '').trim();
          const next = prev ? `${prev},${abs}` : abs;
          const patch: Record<string, unknown> = { line_photos: next };
          // Backfill client key when ERP field exists and line was matched by index
          if (lineRef && !target.client_line_key) {
            patch.client_line_key = lineRef;
          }
          await erpUpdate('Alteration Ticket Line', target.name, patch).catch(() => {});
        }
      } catch { /* non-fatal — File attachment still saved */ }
    }

    return c.json({
      data: {
        url: erpFileAbsoluteUrl(fileUrl),
        path,
        fileId,
        garmentRef,
        lineRef: lineRef || null,
        lineIdx: resolvedLineIdx,
        lineName: resolvedLineName,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    return c.json({ error: message }, 500);
  }
});

// GET /tickets/:name/photos — files attached to ticket
intakeAlterationsRouter.get('/tickets/:name/photos', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const ticketName = c.req.param('name');
  try {
    const rows = await mcpList<any>(
      'File',
      ['name', 'file_name', 'file_url', 'creation', 'file_size'],
      [
        ['attached_to_doctype', '=', 'Alteration Ticket'],
        ['attached_to_name', '=', ticketName],
      ],
      100,
      'creation desc',
    );
    const data = (rows ?? []).map((f: any) => {
      const name = String(f.file_name || '');
      // G1-L0-abcd1234-photo.jpg  |  G1-abcd1234-photo.jpg  |  G1-photo.jpg
      const m = name.match(/^(G\d+)(?:-L(\d+))?(?:-([a-zA-Z0-9]{4,8}))?-/i);
      return {
        id: f.name,
        name,
        url: erpFileAbsoluteUrl(f.file_url),
        creation: f.creation,
        size: f.file_size,
        garmentRef: m?.[1] || name.match(/^(G\d+)/i)?.[1] || null,
        lineIdx: m?.[2] != null ? Number(m[2]) : null,
        lineKey: m?.[3] || null,
      };
    });
    return c.json({ data });
  } catch (e: any) {
    return c.json({ data: [], error: e.message });
  }
});

// PATCH /customers/:id — multi phones, emails, addresses, people (assistants) + notes
intakeAlterationsRouter.patch('/customers/:id', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const body = (await c.req.json()) as {
    mobile?: string;
    email?: string;
    notes?: string;
    address?: { line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string; title?: string; type?: string };
    phones?: Array<{ number: string; label?: string; isPrimary?: boolean }>;
    emails?: Array<{ email: string; isPrimary?: boolean }>;
    addresses?: Array<{
      id?: string;
      title?: string;
      type?: string;
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
      isBilling?: boolean;
      isShipping?: boolean;
      _delete?: boolean;
    }>;
    people?: Array<{
      id?: string;
      name: string;
      role?: string;
      phone?: string;
      email?: string;
      isPrimary?: boolean;
      _delete?: boolean;
    }>;
  };

  const linkFilter = JSON.stringify([
    ['Dynamic Link', 'link_doctype', '=', 'Customer'],
    ['Dynamic Link', 'link_name', '=', id],
  ]);

  try {
    const custWrap = await erpFetch(`/api/resource/Customer/${encodeURIComponent(id)}`);
    const cust = custWrap.data ?? custWrap.message;
    const custName = cust?.customer_name || id;
    const nameParts = String(custName).split(' ');
    const firstName = nameParts[0] || custName;
    const lastName = nameParts.slice(1).join(' ') || '';

    // 1. Notes
    if (body.notes !== undefined) {
      await erpFetch(`/api/resource/Customer/${encodeURIComponent(id)}`, 'PUT', {
        customer_details: body.notes,
      });
    }

    // Resolve / ensure primary client contact
    async function ensurePrimaryContact(): Promise<string> {
      if (cust.customer_primary_contact) return cust.customer_primary_contact;
      const { data: contacts } = await erpFetch(
        `/api/resource/Contact?filters=${encodeURIComponent(linkFilter)}&fields=${encodeURIComponent(JSON.stringify(['name','is_primary_contact']))}&limit_page_length=5`
      ).catch(() => ({ data: [] as any[] }));
      const hit = (contacts ?? []).find((x: any) => x.is_primary_contact) || contacts?.[0];
      if (hit?.name) {
        await erpFetch(`/api/resource/Customer/${encodeURIComponent(id)}`, 'PUT', {
          customer_primary_contact: hit.name,
        });
        return hit.name;
      }
      const created = await erpFetch('/api/resource/Contact', 'POST', {
        first_name: firstName,
        last_name: lastName,
        is_primary_contact: 1,
        links: [{ link_doctype: 'Customer', link_name: id }],
      });
      const cname = created?.data?.name || created?.message?.name;
      if (cname) {
        await erpFetch(`/api/resource/Customer/${encodeURIComponent(id)}`, 'PUT', {
          customer_primary_contact: cname,
        });
      }
      return cname;
    }

    // Build phone list: multi array or legacy single mobile
    let phoneList = body.phones;
    if (!phoneList && body.mobile !== undefined) {
      phoneList = body.mobile.trim()
        ? [{ number: body.mobile.trim(), label: 'Mobile', isPrimary: true }]
        : [];
    }
    let emailList = body.emails;
    if (!emailList && body.email !== undefined) {
      emailList = body.email.trim()
        ? [{ email: body.email.trim(), isPrimary: true }]
        : [];
    }

    if (phoneList || emailList) {
      const contactId = await ensurePrimaryContact();
      if (contactId) {
        const patch: any = {};
        if (phoneList) {
          const cleaned = phoneList
            .map((p) => ({ number: String(p.number || '').trim(), label: p.label || 'Mobile', isPrimary: !!p.isPrimary }))
            .filter((p) => p.number);
          if (!cleaned.some((p) => p.isPrimary) && cleaned[0]) cleaned[0].isPrimary = true;
          const primary = cleaned.find((p) => p.isPrimary) || cleaned[0];
          patch.mobile_no = primary?.number || '';
          patch.phone = cleaned.find((p) => !p.isPrimary)?.number || '';
          patch.phone_nos = cleaned.map((p) => ({
            phone: p.number,
            is_primary_mobile_no: p.isPrimary || /mobile/i.test(p.label) ? 1 : 0,
            is_primary_phone: !p.isPrimary && /work|office|phone/i.test(p.label) ? 1 : 0,
          }));
        }
        if (emailList) {
          const cleaned = emailList
            .map((e) => ({ email: String(e.email || '').trim(), isPrimary: !!e.isPrimary }))
            .filter((e) => e.email);
          if (!cleaned.some((e) => e.isPrimary) && cleaned[0]) cleaned[0].isPrimary = true;
          patch.email_id = cleaned.find((e) => e.isPrimary)?.email || cleaned[0]?.email || '';
          patch.email_ids = cleaned.map((e) => ({
            email_id: e.email,
            is_primary: e.isPrimary ? 1 : 0,
          }));
        }
        await erpFetch(`/api/resource/Contact/${encodeURIComponent(contactId)}`, 'PUT', patch);
      }
    }

    // 2. Addresses — multi residences / billing / shipping
    let addressList = body.addresses;
    if (!addressList && body.address) {
      addressList = [{ ...body.address, type: body.address.type || 'Personal', isBilling: true }];
    }
    if (addressList) {
      let primaryAddrName: string | null = null;
      for (const a of addressList) {
        if (a._delete && a.id) {
          await erpFetch(`/api/resource/Address/${encodeURIComponent(a.id)}`, 'PUT', { disabled: 1 }).catch(() => {});
          continue;
        }
        if (!(a.line1 || '').trim() && !(a.city || '').trim()) continue;

        const addrPayload: any = {
          address_title: (a.title || a.type || custName).trim() || custName,
          address_type: a.type || 'Personal',
          address_line1: a.line1 || '',
          address_line2: a.line2 || '',
          city: a.city || 'New York',
          state: a.state || '',
          pincode: a.zip || '',
          country: a.country || 'United States',
          is_primary_address: a.isBilling ? 1 : 0,
          is_shipping_address: a.isShipping ? 1 : 0,
          links: [{ link_doctype: 'Customer', link_name: id }],
        };

        if (a.id) {
          await erpFetch(`/api/resource/Address/${encodeURIComponent(a.id)}`, 'PUT', addrPayload);
          if (a.isBilling) primaryAddrName = a.id;
        } else {
          const created = await erpFetch('/api/resource/Address', 'POST', addrPayload);
          const aname = created?.data?.name || created?.message?.name;
          if (a.isBilling && aname) primaryAddrName = aname;
        }
      }
      if (primaryAddrName) {
        await erpFetch(`/api/resource/Customer/${encodeURIComponent(id)}`, 'PUT', {
          customer_primary_address: primaryAddrName,
        });
      }
    }

    // 3. People — assistants / extra contacts (non-primary)
    if (body.people) {
      for (const person of body.people) {
        if (person._delete && person.id) {
          // Soft-unlink: clear designation not delete Contact (safer)
          await erpFetch(`/api/resource/Contact/${encodeURIComponent(person.id)}`, 'PUT', {
            status: 'Passive',
          }).catch(() => {});
          continue;
        }
        const pName = String(person.name || '').trim();
        if (!pName) continue;
        const parts = pName.split(/\s+/);
        const pFirst = parts[0];
        const pLast = parts.slice(1).join(' ') || '';
        const role = (person.role || 'Assistant').trim() || 'Assistant';
        const isPrimary = !!person.isPrimary || role === 'Client';

        if (isPrimary) {
          // Update primary client contact names/phones rather than creating a second primary
          const cid = await ensurePrimaryContact();
          if (cid) {
            await erpFetch(`/api/resource/Contact/${encodeURIComponent(cid)}`, 'PUT', {
              first_name: pFirst,
              last_name: pLast,
              mobile_no: person.phone || undefined,
              email_id: person.email || undefined,
              designation: '',
              is_primary_contact: 1,
            });
          }
          continue;
        }

        const payload: any = {
          first_name: pFirst,
          last_name: pLast,
          designation: role,
          mobile_no: person.phone || '',
          email_id: person.email || '',
          is_primary_contact: 0,
          links: [{ link_doctype: 'Customer', link_name: id }],
        };
        if (person.id) {
          await erpFetch(`/api/resource/Contact/${encodeURIComponent(person.id)}`, 'PUT', payload);
        } else {
          await erpFetch('/api/resource/Contact', 'POST', payload);
        }
      }
    }

    return c.json({ data: { ok: true } });
  } catch (e: any) {
    return c.json({ error: { message: e.message || String(e) } }, 500);
  }
});

// GET /tickets/:name/receipt — proxy ERPNext PDF
intakeAlterationsRouter.get('/tickets/:name/receipt', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const name = c.req.param('name');
  const erpRes = await erpPdf('Alteration Ticket', name, 'LSH Alteration Receipt');
  if (!erpRes.ok) return c.json({ error: { message: 'Could not generate PDF' } }, 502);
  const buf = await erpRes.arrayBuffer();
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}-receipt.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});
