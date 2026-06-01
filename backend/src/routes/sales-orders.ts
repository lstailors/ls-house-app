import { Hono } from "hono";
import { getAuthedUser, canSeeFinancials } from "../lib/scope";

export const salesOrdersRouter = new Hono();

const MCP_BASE = process.env.ERPNEXT_MCP_URL ?? 'https://erp-mcp.lstailors.com';
const MCP_TOKEN = process.env.ERPNEXT_MCP_TOKEN ?? '';

async function mcpList<T>(doctype: string, fields: string[], filters: any[] = [], limit = 300, orderBy = ''): Promise<T[]> {
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

function serializeSalesOrder(row: any) {
  return {
    id: row.name,
    erpnextId: row.name,
    customer: row.customer ? { name: row.customer } : null,
    makeType: row.make_type ?? null,
    status: row.status ?? 'Draft',
    priceStatus: row.price_status ?? (Number(row.grand_total ?? 0) === 0 ? 'placeholder' : 'priced'),
    total: Number(row.total ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    transactionDate: row.transaction_date ?? null,
    deliveryDate: row.delivery_date ?? null,
    createdAt: row.creation ?? null,
  };
}

// GET /api/sales-orders?status=active|all|Draft|Completed|...
salesOrdersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const statusFilter = c.req.query("status") ?? "active";

  try {
    const filters: any[] = [];
    if (statusFilter === 'active') {
      // Active = not Completed, Cancelled, or Closed
      filters.push(['status', 'not in', ['Completed', 'Cancelled', 'Closed']]);
    } else if (statusFilter && statusFilter !== 'all') {
      filters.push(['status', '=', statusFilter]);
    }

    const rows = await mcpList<any>(
      'Sales Order',
      ['name', 'customer', 'status', 'make_type', 'grand_total', 'total', 'transaction_date', 'delivery_date', 'creation'],
      filters, 300, 'transaction_date desc'
    );

    return c.json({ data: rows.map(serializeSalesOrder) });
  } catch (e: any) {
    console.error('sales orders fetch failed:', e?.message);
    return c.json({ data: [] });
  }
});

salesOrdersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const name = c.req.param("id");
  try {
    const res = await fetch(`${MCP_BASE}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MCP_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 'erp_get', arguments: { doctype: 'Sales Order', name } } }),
    });
    if (!res.ok) return c.json({ error: { message: 'Not found' } }, 404);
    const json: any = await res.json();
    const text = json?.result?.content?.[0]?.text ?? '{}';
    const doc = JSON.parse(text);
    return c.json({ data: serializeSalesOrder(doc) });
  } catch {
    return c.json({ error: { message: 'Not found' } }, 404);
  }
});
