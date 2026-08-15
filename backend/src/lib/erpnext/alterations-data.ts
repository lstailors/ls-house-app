// Enriched board rows in 3 batched calls. Server-only.
import { erpList, isAltsOrigin } from "../erp";

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

export async function loadAlterationRows(filter: BoardFilter = "all", location?: string): Promise<AlterationRow[]> {
  const filters: any[] = [];
  if (filter !== "all") filters.push(["workflow_state", "in", STATE_GROUPS[filter]]);
  const tickets = await erpList<any>("Alteration Ticket", {
    fields: ["name","customer_name","origin_location","due_date","is_rush","workflow_state","payment_status","ticket_total","sales_invoice","delivery_method","assigned_tailor"],
    filters,
    order_by: "due_date asc",
    limit: 0,
    throwOnError: true,
  });
  const scoped = tickets.filter((t) => {
    if (location) return String(t.origin_location || "").toUpperCase() === location.toUpperCase();
    return isAltsOrigin(t.origin_location);
  });
  if (!scoped.length) return [];
  const names = scoped.map((t) => t.name);

  const garments = await erpList<any>("Alteration Ticket Garment", {
    parent: "Alteration Ticket",
    fields: ["parent", "garment_type"],
    filters: [["parent", "in", names]],
    limit: 0,
    throwOnError: true,
  }).catch(() => []);
  const byTicket = new Map<string, string[]>();
  for (const g of garments) {
    const arr = byTicket.get(g.parent) ?? [];
    if (g.garment_type) arr.push(g.garment_type);
    byTicket.set(g.parent, arr);
  }

  const tailorIds = [...new Set(scoped.map((t) => t.assigned_tailor).filter(Boolean))];
  const tailorMap = new Map<string, string>();
  if (tailorIds.length) {
    const emps = await erpList<any>("Employee", {
      fields: ["name", "employee_name"],
      filters: [["name", "in", tailorIds]],
      limit: 0,
      throwOnError: true,
    }).catch(() => []);
    emps.forEach((e) => tailorMap.set(e.name, e.employee_name));
  }

  return scoped.map((t): AlterationRow => {
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
