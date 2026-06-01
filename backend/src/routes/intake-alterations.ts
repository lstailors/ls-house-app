import { Hono } from 'hono';
import { supabaseAdmin } from '../lib/supabase';
import { getAuthedUser } from '../lib/scope';

// ---------------------------------------------------------------------------
// ERPNext config
// ---------------------------------------------------------------------------
const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? 'https://erp.lstailors.com';
const ERP_TOKEN = process.env.ERPNEXT_API_TOKEN ?? process.env.ERPNEXT_MCP_TOKEN ?? '';

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
    const presets = await erpGet<any[]>('ls_alterations.api.get_active_presets', {
      origin_location: origin,
    });
    return c.json({ data: presets ?? [] });
  } catch {
    return c.json({ data: [] });
  }
});

// 2. GET /tailors
intakeAlterationsRouter.get('/tailors', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const result = await erpGet<any[]>('frappe.client.get_list', {
      doctype: 'Employee',
      fields: JSON.stringify(['name', 'employee_name', 'designation']),
      filters: JSON.stringify([
        ['status', '=', 'Active'],
        ['designation', 'like', '%Tailor%'],
      ]),
      limit_page_length: '50',
    });
    return c.json({ data: result ?? [] });
  } catch {
    return c.json({ data: [] });
  }
});

// 3. GET /customers/search?q=
intakeAlterationsRouter.get('/customers/search', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const q = c.req.query('q') ?? '';
  if (q.length < 2) return c.json({ data: [] });

  const { data: results } = await supabaseAdmin
    .from('customers')
    .select('id,full_name,phone,email,customer_number')
    .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(8);

  return c.json({ data: results ?? [] });
});

// 4. GET /tickets?status=&origin=NYC|HOU&limit=100
intakeAlterationsRouter.get('/tickets', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const status = c.req.query('status') ?? '';
  const limit = c.req.query('limit') ?? '100';

  try {
    const rows = await erpGet<any[]>('frappe.client.get_list', {
      doctype: 'Alteration Ticket',
      fields: JSON.stringify([
        'name',
        'customer_name',
        'origin_location',
        'workflow_state',
        'ticket_date',
        'due_date',
        'is_rush',
        'ticket_total',
        'payment_status',
      ]),
      filters: JSON.stringify(
        status
          ? [['workflow_state', '=', status]]
          : [['workflow_state', '!=', 'Cancelled']]
      ),
      limit_page_length: limit,
      order_by: 'modified desc',
    });
    return c.json({ data: rows ?? [] });
  } catch (e: any) {
    return c.json({ data: [], error: e.message });
  }
});

// 5. GET /tickets/:name
intakeAlterationsRouter.get('/tickets/:name', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const ticketName = c.req.param('name');
  const doc = await erpGet<any>('frappe.client.get', {
    doctype: 'Alteration Ticket',
    name: ticketName,
  });
  return c.json({ data: doc });
});

// 6. POST /tickets
intakeAlterationsRouter.post('/tickets', async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const body = (await c.req.json()) as any;
  const { customer, newCustomer, garments, isRush, origin, paymentMethod, deposit } = body;

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
    return c.json({ data: result });
  } catch {
    return c.json({
      data: { ticket_name: `DRAFT-${Date.now()}`, status: 'draft_offline' },
    });
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
    await erpPost('frappe.client.set_value', {
      doctype: 'Alteration Ticket',
      name: ticketName,
      fieldname: 'assigned_tailor',
      value: tailorId,
    });
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

  await erpPost('frappe.client.set_value', {
    doctype: 'Alteration Ticket',
    name: ticketName,
    fieldname: 'workflow_state',
    value: status,
  });
  return c.json({ data: { ok: true } });
});
