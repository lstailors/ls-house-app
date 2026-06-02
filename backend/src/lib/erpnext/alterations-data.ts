// Enriched board rows in 3 batched calls. Server-only.
const ERP_URL = process.env.ERPNEXT_BASE_URL ?? process.env.ERP_URL ?? "https://erp.lstailors.com";
const authHeaders = {
  Authorization: `token ${process.env.ERPNEXT_API_KEY ?? process.env.ERP_API_KEY}:${process.env.ERPNEXT_API_SECRET ?? process.env.ERP_API_SECRET}`,
  Accept: "application/json",
};

export type BoardFilter = "all" | "in_progress" | "complete" | "delivered";
const STATE_GROUPS: Record<Exclude<BoardFilter, "all">, string[]> = {
  in_progress: ["Received", "In Progress"],
  complete: ["Ready", "Complete"],
  delivered: ["Delivered"],
};

export interface AlterationRow {
  name: string; customerName: string; location: string; garmentCount: number; garmentSummary: string;
  tailor: string | null; dueDate: string | null; isRush: boolean; status: string;
  paymentStatus: string; price: number; invoice: string | null; deliveryMethod: string | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${ERP_URL}${path}`, { headers: authHeaders, cache: "no-store" });
  if (!res.ok) throw new Error(`ERPNext ${res.status} on ${path}`);
  return (await res.json()).data as T;
}

export async function loadAlterationRows(filter: BoardFilter = "all", location?: string): Promise<AlterationRow[]> {
  const filters: any[] = [];
  if (filter !== "all") filters.push(["workflow_state", "in", STATE_GROUPS[filter]]);
  if (location) filters.push(["origin_location", "=", location]);
  const q = new URLSearchParams({
    fields: JSON.stringify(["name","customer_name","origin_location","due_date","is_rush","workflow_state","payment_status","ticket_total","sales_invoice","delivery_method","assigned_tailor"]),
    filters: JSON.stringify(filters), order_by: "due_date asc", limit_page_length: "0",
  });
  const tickets = await get<any[]>(`/api/resource/Alteration Ticket?${q}`);
  if (!tickets.length) return [];
  const names = tickets.map((t) => t.name);

  const gq = new URLSearchParams({
    parent: "Alteration Ticket", fields: JSON.stringify(["parent","garment_type"]),
    filters: JSON.stringify([["parent","in",names]]), limit_page_length: "0",
  });
  const garments = await get<any[]>(`/api/resource/Alteration Ticket Garment?${gq}`);
  const byTicket = new Map<string, string[]>();
  for (const g of garments) {
    const arr = byTicket.get(g.parent) ?? [];
    if (g.garment_type) arr.push(g.garment_type);
    byTicket.set(g.parent, arr);
  }

  const tailorIds = [...new Set(tickets.map((t) => t.assigned_tailor).filter(Boolean))];
  const tailorMap = new Map<string, string>();
  if (tailorIds.length) {
    const eq = new URLSearchParams({ fields: JSON.stringify(["name","employee_name"]), filters: JSON.stringify([["name","in",tailorIds]]), limit_page_length: "0" });
    const emps = await get<any[]>(`/api/resource/Employee?${eq}`);
    emps.forEach((e) => tailorMap.set(e.name, e.employee_name));
  }

  return tickets.map((t): AlterationRow => {
    const types = byTicket.get(t.name) ?? [];
    return {
      name: t.name, customerName: t.customer_name, location: t.origin_location,
      garmentCount: types.length, garmentSummary: summarizeTypes(types),
      tailor: t.assigned_tailor ? tailorMap.get(t.assigned_tailor) ?? t.assigned_tailor : null,
      dueDate: t.due_date, isRush: !!t.is_rush, status: t.workflow_state,
      paymentStatus: t.payment_status, price: t.ticket_total ?? 0,
      invoice: t.sales_invoice ?? null, deliveryMethod: t.delivery_method ?? null,
    };
  });
}

function summarizeTypes(types: string[]): string {
  if (!types.length) return "";
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([type, n]) => (n > 1 ? `${n} ${type.toLowerCase()}s` : type)).join(", ");
}
