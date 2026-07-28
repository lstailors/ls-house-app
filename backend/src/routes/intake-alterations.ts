import { Hono } from 'hono';
import { getAuthedUser } from '../lib/scope';
import { uploadFile, erpFileAbsoluteUrl } from '../lib/erpnext/files';
import { erpList, erpGet as erpGetDoc, erpUpdate, erpPdf, erpRunMethod } from '../lib/erp';
import { sendSms } from '../lib/twilio';

// ---------------------------------------------------------------------------
// ERPNext config
// ---------------------------------------------------------------------------
const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? 'https://erp.lstailors.com';
const ERP_TOKEN = process.env.ERPNEXT_API_TOKEN ?? process.env.ERPNEXT_MCP_TOKEN ?? '';
const MCP_BASE = process.env.ERPNEXT_MCP_URL ?? 'https://erp-mcp.lstailors.com';
const MCP_TOKEN = process.env.ERPNEXT_MCP_TOKEN ?? '';
const APP_URL = process.env.APP_URL ?? 'https://app.lstailors.com';

function eTicketQrUrl(ticketName: string): string {
  const link = `${APP_URL}/e-ticket/${encodeURIComponent(ticketName)}`;
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
    throw new Error(`ERP ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  return (json.message ?? json) as T;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const intakeAlterationsRouter = new Hono();

// 0. GET /public/tickets/:name — no auth, customer-safe data for e-ticket page
intakeAlterationsRouter.get('/public/tickets/:name', async (c) => {
  const ticketName = c.req.param('name');
  try {
    const doc = await mcpGet<any>('Alteration Ticket', ticketName);
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
      },
    });
  } catch {
    return c.json({ error: { message: 'Ticket not found' } }, 404);
  }
});

// 1. GET /presets?origin=NYC|HOU
intakeAlterationsRouter.get('/presets', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: 'Unauthorized' } }, 401);

  const origin = c.req.query('origin') ?? 'NYC';
  try {
    const list = await mcpList<any>('Alteration Preset',
      ['name','preset_name','garment_type','alteration_category','default_price','default_price_hou','estimated_minutes','is_active'],
      [['is_active','=','1']], 200, 'garment_type asc, preset_name asc');
    const normalized = list.map((p: any) => ({
      id: p.name,
      name: p.name,
      preset_name: p.preset_name,
      garment_type: p.garment_type,
      // Frontend expects garment_types as array; also include 'All' catch-all
      garment_types: p.garment_type ? [p.garment_type] : ['All'],
      category: p.alteration_category,
      price: (origin === 'HOU' && p.default_price_hou > 0) ? p.default_price_hou : p.default_price,
      display_price: (origin === 'HOU' && p.default_price_hou > 0) ? p.default_price_hou : p.default_price,
      est_minutes: p.estimated_minutes ?? null,
    }));
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

// 4. GET /tickets?status=&origin=NYC|HOU&limit=100
intakeAlterationsRouter.get('/tickets', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const status = c.req.query('status') ?? '';
  const limit = c.req.query('limit') ?? '100';

  try {
    const filters = status ? [['workflow_state','=',status]] : [['workflow_state','!=','Cancelled']];
    const rows = await mcpList<any>('Alteration Ticket',
      ['name','customer_name','customer_phone','origin_location','workflow_state','ticket_date','due_date','is_rush','ticket_total','payment_status','billing_status','assigned_tailor','linked_sales_order','included_in_custom','sales_invoice'],
      filters, parseInt(limit) || 100, 'modified desc');
    return c.json({ data: rows });
  } catch (e: any) {
    return c.json({ data: [], error: e.message });
  }
});

// 5. GET /tickets/:name — enriched with customer contact info
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
    return c.json({ data: { ...doc, customer_mobile: doc.customer_phone ?? '', customer_email: customerEmail } });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 404);
  }
});

// 6. POST /tickets
intakeAlterationsRouter.post('/tickets', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const body = (await c.req.json()) as any;
  const { customer, newCustomer, garments, isRush, origin, paymentMethod, deposit, ticket_date } = body;

  // Validate
  if (!garments || !Array.isArray(garments) || garments.length === 0) {
    return c.json({ error: 'garments is required' }, 400);
  }
  if (!customer && !(newCustomer && newCustomer.name)) {
    return c.json({ error: 'customer or newCustomer.name is required' }, 400);
  }

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

  const payload: Record<string, any> = {
    origin_location: origin ?? 'NYC',
    is_rush: isRush ? 1 : 0,
    taxes_and_charges: '',   // Alterations are tax-exempt
    payment_method: paymentMethod ?? 'on_account',
    deposit_amount: paymentMethod === 'deposit' ? parseFloat(deposit) || 0 : 0,
    ticket_date: ticketDateStr,
    due_date: body.due_date ?? defaultDue,
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
      est_minutes: l.estMinutes || null,
      line_notes: l.notes || l.line_notes || null,
    }))
    ),
    };
    if (linkedSo) payload.linked_sales_order = linkedSo;
    if (body.internal_notes) payload.internal_notes = body.internal_notes;
    if (body.customer_notes) payload.customer_notes = body.customer_notes;

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

    return c.json({ data: { ticketName } });
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
        const a = DIRECT[FORWARD[i]]?.[FORWARD[i + 1]];
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
    ? `${APP_URL}/pay/${encodeURIComponent(invoiceName)}`
    : `${APP_URL}/e-ticket/${encodeURIComponent(ticketName)}`;

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

// 9. PATCH /tickets/:name/due-date
intakeAlterationsRouter.patch('/tickets/:name/due-date', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const body = (await c.req.json()) as any;
  const { due_date } = body;

  try {
    await erpUpdate('Alteration Ticket', ticketName, { due_date });
    return c.json({ data: { ok: true } });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502);
  }
});

// 10. PATCH /tickets/:name/transfer (location and/or at-home tailor)
intakeAlterationsRouter.patch('/tickets/:name/transfer', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const body = (await c.req.json()) as any;
  const { location, tailorId, note } = body;

  const doc: Record<string, any> = {};
  if (location) doc.origin_location = location;
  if (tailorId !== undefined) doc.assigned_tailor = tailorId || null;
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
        notes: cust.customer_details || '',
        contactName: cust.customer_primary_contact || primaryContact?.name || null,
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

  if (!file || !path) return c.json({ error: 'file and path required' }, 400);

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const base = path.split('/').pop() ?? file.name ?? 'photo.jpg';
    const filename = lineRef
      ? `${garmentRef || 'G'}-${lineRef.slice(0, 8)}-${base}`
      : garmentRef
        ? `${garmentRef}-${base}`
        : base;
    const { fileUrl, fileId } = await uploadFile({
      file: buffer,
      filename,
      contentType: file.type || 'image/jpeg',
      doctype: ticketName ? 'Alteration Ticket' : undefined,
      docname: ticketName ?? undefined,
      isPrivate: false,
    });

    // Append URL onto matching line's line_photos when we can resolve garment_ref + description seed
    if (ticketName && lineRef) {
      try {
        const t = await erpGetDoc<any>('Alteration Ticket', ticketName);
        const lines = t?.lines || [];
        // Best-effort: match by description embed in filename or append to last line of garment
        // Clients should also send notes at create; photos are supplemental evidence.
        // Store on ticket-level for now if no row match — line_photos updated when line_id known.
        const abs = erpFileAbsoluteUrl(fileUrl);
        // Prefer garment-scoped first matching empty-ish line_photos or any line on garment
        const gLines = lines.filter((ln: any) => ln.garment_ref === garmentRef);
        const target = gLines[gLines.length - 1];
        if (target?.name) {
          const prev = String(target.line_photos || '').trim();
          const next = prev ? `${prev},${abs}` : abs;
          await erpUpdate('Alteration Ticket Line', target.name, { line_photos: next }).catch(() => {});
        }
      } catch { /* non-fatal */ }
    }

    return c.json({
      data: {
        url: erpFileAbsoluteUrl(fileUrl),
        path,
        fileId,
        garmentRef,
        lineRef: lineRef || null,
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
    const data = (rows ?? []).map((f: any) => ({
      id: f.name,
      name: f.file_name,
      url: erpFileAbsoluteUrl(f.file_url),
      creation: f.creation,
      size: f.file_size,
      garmentRef: (f.file_name || '').match(/^(G\d+)-/)?.[1] || null,
    }));
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
