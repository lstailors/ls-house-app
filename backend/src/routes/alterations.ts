import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";

export const alterationsRouter = new Hono();

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

function normalizeStatus(raw: string): string {
  if (!raw) return 'intake';
  const s = raw.toLowerCase();
  if (s.includes('picked up') || s.includes('complete') || s.includes('done')) return 'picked_up';
  if (s.includes('ready')) return 'ready';
  if (s.includes('progress') || s.includes('wip') || s.includes('in progress')) return 'in_progress';
  if (s.includes('cancel')) return 'cancelled';
  return 'intake';
}

function serializeTicket(row: any) {
  return {
    id: row.name,
    erpName: row.name,
    customer: row.customer_name
      ? { name: row.customer_name, phone: row.customer_phone ?? '', dossier: { vip: false } }
      : null,
    tailor: row.assigned_tailor ? { name: row.assigned_tailor } : null,
    items: [], // ticket list doesn't include garment detail — detail view does
    dueDate: row.due_date ?? null,
    status: normalizeStatus(row.workflow_state ?? row.status ?? ''),
    price: Number(row.ticket_total ?? 0),
    isRush: !!row.is_rush,
    origin: row.origin_location ?? 'NYC',
    createdAt: row.ticket_date ?? null,
  };
}

alterationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const statusFilter = c.req.query("status") ?? '';
  const locationId = c.req.query("locationId") ?? '';

  try {
    const filters: any[] = [['workflow_state', '!=', 'Cancelled']];

    // Map app status strings to ERP workflow states
    if (statusFilter && statusFilter !== 'all') {
      const statusMap: Record<string, string> = {
        intake: 'Received',
        in_progress: 'In Progress',
        ready: 'Ready',
        picked_up: 'Picked Up',
      };
      const erpState = statusMap[statusFilter];
      if (erpState) {
        filters.length = 0; // replace default filter
        filters.push(['workflow_state', '=', erpState]);
      }
    }

    // Location filter — map locationId (UUID) to origin code
    if (locationId) {
      // locationId passed as code (NYC/HOU) or we match on origin_location
      const code = locationId.length <= 5 ? locationId : null;
      if (code) filters.push(['origin_location', '=', code]);
    } else if (user.role !== 'super_admin' && (user as any).locationCode) {
      filters.push(['origin_location', '=', (user as any).locationCode]);
    }

    const rows = await mcpList<any>(
      'Alteration Ticket',
      ['name', 'customer_name', 'assigned_tailor', 'origin_location', 'workflow_state',
       'ticket_date', 'due_date', 'is_rush', 'ticket_total'],
      filters, 200, 'modified desc'
    );

    return c.json({ data: rows.map(serializeTicket) });
  } catch (e: any) {
    console.error('alterations board fetch failed:', e?.message);
    return c.json({ data: [] });
  }
});

alterationsRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const name = c.req.param("id");
  try {
    const res = await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'erp_get', arguments: { doctype: 'Alteration Ticket', name } } }),
    });
    if (!res.ok) return c.json({ error: { message: 'Not found' } }, 404);
    const json: any = await res.json();
    const text = json?.result?.content?.[0]?.text ?? '{}';
    const doc = JSON.parse(text);
    return c.json({ data: doc });
  } catch {
    return c.json({ error: { message: 'Not found' } }, 404);
  }
});
