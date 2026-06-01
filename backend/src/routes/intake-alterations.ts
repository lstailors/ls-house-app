import { Hono } from 'hono';
import { supabaseAdmin } from '../lib/supabase';
import { getAuthedUser } from '../lib/scope';

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
  return {
    Authorization: `token ${ERP_TOKEN}`,
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
    const result = await mcpList<any>('Employee', ['name','employee_name','designation'], [['status','=','Active'],['designation','like','%Tailor%']], 50);
    return c.json({ data: result ?? [] });
  } catch {
    return c.json({ data: [] });
  }
});

// 3. GET /customers/search?q=
// Searches ERPNext Customer doctype (primary source for alteration customers)
// and falls back to Supabase customers table for MTM customers.
intakeAlterationsRouter.get('/customers/search', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const q = c.req.query('q') ?? '';
  if (q.length < 2) return c.json({ data: [] });

  // Search ERPNext customers (covers all alteration + MTM customers)
  const erpBase = process.env.ERPNEXT_BASE_URL ?? '';
  const erpKey  = process.env.ERPNEXT_API_KEY  ?? '';
  const erpSec  = process.env.ERPNEXT_API_SECRET ?? '';

  const erpResults: any[] = [];
  if (erpBase && erpKey && erpSec) {
    try {
      const fields = JSON.stringify(['name', 'customer_name', 'mobile_no', 'email_id']);
      const filters = JSON.stringify([['customer_name', 'like', `%${q}%`]]);
      const url = `${erpBase}/api/resource/Customer?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit_page_length=8&order_by=modified%20desc`;
      const res = await fetch(url, {
        headers: { Authorization: `token ${erpKey}:${erpSec}`, Accept: 'application/json' },
      });
      if (res.ok) {
        const json: any = await res.json();
        for (const row of (json.data ?? [])) {
          erpResults.push({
            id: row.name,
            full_name: row.customer_name,
            phone: row.mobile_no ?? '',
            email: row.email_id ?? null,
            customer_number: row.name,
          });
        }
      }
    } catch { /* fall through to Supabase */ }
  }

  // Also search Supabase for MTM customers not in ERPNext
  const { data: sbResults } = await (supabaseAdmin
    ?.from('customers')
    .select('id,full_name,phone,email,customer_number')
    .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(4) ?? { data: [] });

  // Merge, deduplicate by full_name
  const seen = new Set(erpResults.map((r: any) => r.full_name?.toLowerCase()));
  const merged = [
    ...erpResults,
    ...(sbResults ?? []).filter((r: any) => !seen.has(r.full_name?.toLowerCase())),
  ].slice(0, 10);

  return c.json({ data: merged });
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

// 5. GET /tickets/:name
intakeAlterationsRouter.get('/tickets/:name', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  try {
    const doc = await mcpGet<any>('Alteration Ticket', ticketName);
    return c.json({ data: doc });
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
  const payload: Record<string, any> = {
    origin_location: origin ?? 'NYC',
    is_rush: isRush ? 1 : 0,
    payment_method: paymentMethod ?? 'on_account',
    deposit_amount: paymentMethod === 'deposit' ? parseFloat(deposit) || 0 : 0,
    ticket_date: ticket_date ?? new Date().toISOString().split('T')[0],
    garments: garments.map((g: any) => ({
      garment_type: g.garmentType,
      garment_description: g.description || g.garmentType,
      color: g.color || '',
      fabric_notes: g.notes || '',
      lines: (g.lines ?? []).map((l: any) => ({
        preset: l.preset || '',
        description: l.description,
        price: l.price,
        est_minutes: l.estMinutes || null,
      })),
    })),
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
    // ERP returns { name, ticket_total, ... } — normalize to { ticketName }
    return c.json({ data: { ticketName: result?.name ?? result?.ticket_name, ...result } });
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
      body: JSON.stringify({ jsonrpc:'2.0', method:'tools/call', id:1, params:{ name:'erp_update', arguments:{ doctype:'Alteration Ticket', name:ticketName, updates:{ assigned_tailor: tailorId } } } }),
    });
    if (!res.ok) throw new Error(`MCP ${res.status}`);
    return c.json({ data: { ok: true } });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
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

  const sres = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc:'2.0', method:'tools/call', id:1, params:{ name:'erp_update', arguments:{ doctype:'Alteration Ticket', name:ticketName, updates:{ workflow_state: status } } } }),
  });
  if (!sres.ok) return c.json({ error: { message: `MCP ${sres.status}` } }, 500);
  return c.json({ data: { ok: true } });
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
