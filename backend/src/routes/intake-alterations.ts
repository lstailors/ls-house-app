import { Hono } from 'hono';
import { supabaseAdmin } from '../lib/supabase';
import { getAuthedUser } from '../lib/scope';
import { erpList } from '../lib/erp';
import { sendSms } from '../lib/twilio';

// ---------------------------------------------------------------------------
// ERPNext config
// ---------------------------------------------------------------------------
const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? 'https://erp.lstailors.com';
const ERP_TOKEN = process.env.ERPNEXT_API_TOKEN ?? process.env.ERPNEXT_MCP_TOKEN ?? '';
const MCP_BASE = process.env.ERPNEXT_MCP_URL ?? 'https://erp-mcp.lstailors.com';
const MCP_TOKEN = process.env.ERPNEXT_MCP_TOKEN ?? '';

// Query via MCP server (works without direct ERP API key)
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

async function mcpGet<T>(doctype: string, name: string): Promise<T> {
  const res = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'erp_get', arguments: { doctype, name } } }),
  });
  if (!res.ok) throw new Error(`MCP ${res.status}`);
  const json: any = await res.json();
  const text = json?.result?.content?.[0]?.text ?? '{}';
  return JSON.parse(text) as T;
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

async function erpGet<T>(method: string, params: Record<string, string> = {}): Promise<T> {
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

// 1. GET /presets?origin=NYC|HOU
intakeAlterationsRouter.get('/presets', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

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
      ['name','customer_name','origin_location','workflow_state','ticket_date','due_date','is_rush','ticket_total','payment_status'],
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

  const payload: Record<string, any> = {
    origin_location: origin ?? 'NYC',
    is_rush: isRush ? 1 : 0,
    taxes_and_charges: '',   // Alterations are tax-exempt
    payment_method: paymentMethod ?? 'on_account',
    deposit_amount: paymentMethod === 'deposit' ? parseFloat(deposit) || 0 : 0,
    ticket_date: ticketDateStr,
    due_date: body.due_date ?? defaultDue,
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
        preset: null,                // omit preset — referenced Items are disabled; use description+price only
        description: l.description,
        price: l.price,
        est_minutes: l.estMinutes || null,
      }))
    ),
  };

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

    return c.json({ data: { ticketName } });
  } catch (e: any) {
    console.error('[intake-alterations] ticket create error:', e?.message);
    return c.json({ error: { message: e?.message || 'Failed to create ticket' } }, 502);
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
    const res = await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0', method:'tools/call', id:1, params:{ name:'erp_update', arguments:{ doctype:'Alteration Ticket', name:ticketName, doc:{ assigned_tailor: tailorId || null } } } }),
    });
    const json: any = await res.json();
    const content = json?.result?.content?.[0];
    const text = content?.text ?? '';
    if (content?.isError || text.includes('Traceback') || text.includes('traceback')) {
      console.error('[tailor patch] ERP error:', text.slice(0, 300));
      return c.json({ error: { message: 'ERPNext update failed: ' + text.slice(0, 150) } }, 502);
    }
    return c.json({ data: { ok: true } });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502);
  }
});

// 8. PATCH /tickets/:name/status
intakeAlterationsRouter.patch('/tickets/:name/status', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const body = (await c.req.json()) as any;
  const { status } = body as {
    status: 'Received' | 'In Progress' | 'Ready' | 'Picked Up';
  };

  try {
    const res = await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0', method:'tools/call', id:1, params:{ name:'erp_update', arguments:{ doctype:'Alteration Ticket', name:ticketName, doc:{ workflow_state: status } } } }),
    });
    const json: any = await res.json();
    const content = json?.result?.content?.[0];
    const text = content?.text ?? '';
    if (content?.isError || text.includes('Traceback') || text.includes('traceback')) {
      console.error('[status patch] ERP error:', text.slice(0, 300));
      return c.json({ error: { message: 'ERPNext update failed: ' + text.slice(0, 150) } }, 502);
    }
    return c.json({ data: { ok: true } });
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
    const res = await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0', method:'tools/call', id:1, params:{ name:'erp_update', arguments:{ doctype:'Alteration Ticket', name:ticketName, doc:{ due_date } } } }),
    });
    const json: any = await res.json();
    const content = json?.result?.content?.[0];
    if (content?.isError) return c.json({ error: { message: content.text?.slice(0, 150) } }, 502);
    return c.json({ data: { ok: true } });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502);
  }
});

// 10. PATCH /tickets/:name/transfer (change origin_location)
intakeAlterationsRouter.patch('/tickets/:name/transfer', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const body = (await c.req.json()) as any;
  const { location } = body; // 'NYC', 'HOU', 'Home'

  try {
    const res = await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0', method:'tools/call', id:1, params:{ name:'erp_update', arguments:{ doctype:'Alteration Ticket', name:ticketName, doc:{ origin_location: location } } } }),
    });
    const json: any = await res.json();
    const content = json?.result?.content?.[0];
    if (content?.isError) return c.json({ error: { message: content.text?.slice(0, 150) } }, 502);
    return c.json({ data: { ok: true } });
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
  const { phone, message } = body;

  if (!phone) return c.json({ error: { message: 'phone required' } }, 400);
  if (!message) return c.json({ error: { message: 'message required' } }, 400);

  const sid = await sendSms(phone, message);
  if (!sid) return c.json({ error: { message: 'SMS send failed — check Twilio credentials' } }, 502);

  return c.json({ data: { ok: true, sid } });
});

// 12. POST /tickets/:name/email (via ERPNext sendmail)
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

// GET /customers/:id — full customer with primary contact + address + notes
intakeAlterationsRouter.get('/customers/:id', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');

  try {
    const { message: cust } = await erpFetch(
      `/api/resource/Customer/${encodeURIComponent(id)}`
    );

    // Fetch primary contact (has phone + email)
    let contact: any = null;
    if (cust.customer_primary_contact) {
      try {
        const { message: ct } = await erpFetch(
          `/api/resource/Contact/${encodeURIComponent(cust.customer_primary_contact)}`
        );
        contact = ct;
      } catch { /* no contact */ }
    } else {
      // Search for any contact linked to this customer
      try {
        const { data: contacts } = await erpFetch(
          `/api/resource/Contact?filters=${encodeURIComponent(JSON.stringify([['Dynamic Link','link_doctype','=','Customer'],['Dynamic Link','link_name','=',id]]))}&fields=${encodeURIComponent(JSON.stringify(['name','first_name','last_name','mobile_no','phone','email_id']))}&limit_page_length=1`
        );
        if (contacts?.length) contact = contacts[0];
      } catch { /* no contact */ }
    }

    // Fetch primary address
    let address: any = null;
    if (cust.customer_primary_address) {
      try {
        const { message: addr } = await erpFetch(
          `/api/resource/Address/${encodeURIComponent(cust.customer_primary_address)}`
        );
        address = addr;
      } catch { /* no address */ }
    } else {
      // Search for any address linked to this customer
      try {
        const { data: addrs } = await erpFetch(
          `/api/resource/Address?filters=${encodeURIComponent(JSON.stringify([['Dynamic Link','link_doctype','=','Customer'],['Dynamic Link','link_name','=',id]]))}&fields=${encodeURIComponent(JSON.stringify(['name','address_line1','address_line2','city','state','pincode','country','phone','email_id']))}&limit_page_length=1`
        );
        if (addrs?.length) address = addrs[0];
      } catch { /* no address */ }
    }

    return c.json({
      data: {
        id: cust.name,
        name: cust.customer_name,
        mobile: contact?.mobile_no || contact?.phone || cust.mobile_no || '',
        email: contact?.email_id || cust.email_id || '',
        notes: cust.customer_details || '',
        contactName: cust.customer_primary_contact || contact?.name || null,
        address: address ? {
          id: address.name,
          line1: address.address_line1 || '',
          line2: address.address_line2 || '',
          city: address.city || '',
          state: address.state || '',
          zip: address.pincode || '',
          country: address.country || '',
        } : null,
      },
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /photos — upload garment photo to Supabase storage
intakeAlterationsRouter.post('/photos', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const path = formData.get('path') as string | null;

  if (!file || !path) return c.json({ error: 'file and path required' }, 400);

  if (!supabaseAdmin) return c.json({ error: 'Storage unavailable' }, 503);

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const { data, error } = await supabaseAdmin.storage
    .from('garment-photos')
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (error) return c.json({ error: error.message }, 500);

  const { data: urlData } = supabaseAdmin.storage
    .from('garment-photos')
    .getPublicUrl(data.path);

  return c.json({ data: { url: urlData.publicUrl, path: data.path } });
});

// PATCH /customers/:id — update phone, email, address, notes in ERPNext
intakeAlterationsRouter.patch('/customers/:id', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const body = (await c.req.json()) as {
    mobile?: string;
    email?: string;
    notes?: string;
    address?: { line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string };
  };

  try {
    // 1. Update customer_details (notes) on the Customer record
    if (body.notes !== undefined) {
      await erpFetch(`/api/resource/Customer/${encodeURIComponent(id)}`, 'PUT', {
        customer_details: body.notes,
      });
    }

    // 2. Update/create Contact for phone + email
    if (body.mobile !== undefined || body.email !== undefined) {
      // Find existing contact
      const { data: contacts } = await erpFetch(
        `/api/resource/Contact?filters=${encodeURIComponent(JSON.stringify([['Dynamic Link','link_doctype','=','Customer'],['Dynamic Link','link_name','=',id]]))}&fields=${encodeURIComponent(JSON.stringify(['name','first_name']))}&limit_page_length=1`
      ).catch(() => ({ data: [] }));

      const custResp = await erpFetch(`/api/resource/Customer/${encodeURIComponent(id)}`);
      const cust = custResp.message;
      const nameParts = (cust.customer_name || id).split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || '';

      if (contacts?.length) {
        // Update existing
        const patch: any = {};
        if (body.mobile !== undefined) patch.mobile_no = body.mobile;
        if (body.email !== undefined) patch.email_id = body.email;
        if (Object.keys(patch).length) {
          await erpFetch(`/api/resource/Contact/${contacts[0].name}`, 'PUT', patch);
        }
      } else {
        // Create new contact
        const newContact: any = {
          first_name: firstName,
          last_name: lastName,
          links: [{ link_doctype: 'Customer', link_name: id }],
        };
        if (body.mobile) newContact.mobile_no = body.mobile;
        if (body.email) newContact.email_id = body.email;
        const created = await erpFetch('/api/resource/Contact', 'POST', newContact);
        // Set as primary contact on customer
        if (created?.message?.name) {
          await erpFetch(`/api/resource/Customer/${encodeURIComponent(id)}`, 'PUT', {
            customer_primary_contact: created.message.name,
          });
        }
      }
    }

    // 3. Update/create Address
    if (body.address) {
      const { data: addrs } = await erpFetch(
        `/api/resource/Address?filters=${encodeURIComponent(JSON.stringify([['Dynamic Link','link_doctype','=','Customer'],['Dynamic Link','link_name','=',id]]))}&fields=${encodeURIComponent(JSON.stringify(['name']))}&limit_page_length=1`
      ).catch(() => ({ data: [] }));

      const addrPayload: any = {};
      if (body.address.line1 !== undefined) addrPayload.address_line1 = body.address.line1;
      if (body.address.line2 !== undefined) addrPayload.address_line2 = body.address.line2;
      if (body.address.city  !== undefined) addrPayload.city          = body.address.city;
      if (body.address.state !== undefined) addrPayload.state         = body.address.state;
      if (body.address.zip   !== undefined) addrPayload.pincode       = body.address.zip;
      if (body.address.country !== undefined) addrPayload.country     = body.address.country;

      if (addrs?.length) {
        await erpFetch(`/api/resource/Address/${addrs[0].name}`, 'PUT', addrPayload);
      } else {
        // Create
        const custResp2 = await erpFetch(`/api/resource/Customer/${encodeURIComponent(id)}`);
        const addrCreate = {
          ...addrPayload,
          address_title: custResp2.message?.customer_name || id,
          address_type: 'Billing',
          links: [{ link_doctype: 'Customer', link_name: id }],
        };
        const createdAddr = await erpFetch('/api/resource/Address', 'POST', addrCreate);
        if (createdAddr?.message?.name) {
          await erpFetch(`/api/resource/Customer/${encodeURIComponent(id)}`, 'PUT', {
            customer_primary_address: createdAddr.message.name,
          });
        }
      }
    }

    return c.json({ data: { ok: true } });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});
