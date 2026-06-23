import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import { storeList } from "../lib/erpnext/store";
import { DT } from "../lib/erpnext/doctypes";
import { getCustomersByIds } from "../lib/erpnext/customers";

export const calendarRouter = new Hono();

calendarRouter.get("/events", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const start = c.req.query("start") ?? new Date().toISOString().split("T")[0];
  const end = c.req.query("end") ?? new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const [appts, alts, deliveries, tasks, yzOrdersRes] = await Promise.all([
    storeList<any>(DT.APPOINTMENT, {
      filters: [["start_time", ">=", `${start}T00:00:00Z`], ["start_time", "<=", `${end}T23:59:59Z`], ["status", "!=", "cancelled"]],
      fields: ["name", "customer", "event_type", "status", "start_time", "end_time", "location", "assigned_tailor", "calcom_booking_uid"],
      orderBy: "start_time asc",
      limit: 500,
    }),
    erpList<any>("Alteration Ticket", {
      filters: [["due_date", ">=", start], ["due_date", "<=", end], ["workflow_state", "not in", ["Picked Up", "Cancelled"]]],
      fields: ["name", "customer", "customer_name", "workflow_state", "due_date", "origin_location"],
      limit: 500,
      order_by: "due_date asc",
    }).catch(() => []),
    erpList<any>("LSH Delivery", {
      filters: [["lsh_scheduled_date", ">=", start], ["lsh_scheduled_date", "<=", end], ["lsh_status", "not in", ["Cancelled", "Stale"]]],
      fields: ["name", "customer", "customer_name", "lsh_status", "lsh_scheduled_at", "lsh_scheduled_date", "delivery_address"],
      limit: 500,
    }).catch(() => []),
    storeList<any>(DT.LS_TASK, {
      filters: [["scheduled_for", ">=", `${start}T00:00:00Z`], ["scheduled_for", "<=", `${end}T23:59:59Z`], ["task_type", "in", ["Pickup", "Delivery", "pickup", "delivery"]]],
      fields: ["name", "title", "task_type", "status", "scheduled_for", "for_customer"],
      orderBy: "scheduled_for asc",
      limit: 500,
    }),
    erpList<any>("Sales Order", {
      filters: [["yz_ship_plan", ">=", start], ["yz_ship_plan", "<=", end], ["yz_ship_plan", "!=", ""], ["status", "not in", ["Cancelled", "Closed"]]],
      fields: ["name", "customer_name", "yz_ship_plan", "status"],
      limit: 200,
      order_by: "yz_ship_plan asc",
    }).catch(() => []),
  ]);

  const allCustomerIds = [
    ...appts.filter((a: any) => a.customer).map((a: any) => a.customer),
    ...alts.filter((a: any) => a.customer).map((a: any) => a.customer),
    ...deliveries.filter((d: any) => d.customer).map((d: any) => d.customer),
    ...tasks.filter((t: any) => t.for_customer).map((t: any) => t.for_customer),
  ];
  const uniqueIds = [...new Set(allCustomerIds)];
  const customerMapRaw = await getCustomersByIds(uniqueIds);
  const customerMap: Record<string, string> = {};
  for (const [id, row] of customerMapRaw) customerMap[id] = row.customer_name ?? "";

  const events: any[] = [];

  for (const a of appts) {
    const customerName = customerMap[a.customer] ?? "";
    const loc = (a.location ?? "").toLowerCase();
    const feed = loc.includes("hou") || loc.includes("houston") || loc.includes("tx") ? "houston_appointments" : "nyc_appointments";
    events.push({
      id: a.name,
      feed,
      title: a.event_type ?? customerName ?? "Appointment",
      customer: customerName,
      start: a.start_time,
      end: a.end_time,
      status: a.status,
      location: a.location ?? null,
      tailor: a.assigned_tailor ?? null,
      calcomUid: a.calcom_booking_uid ?? null,
    });
  }

  for (const a of alts) {
    events.push({
      id: `alt-${a.name}`,
      feed: "production_alterations",
      title: `Due: ${a.customer_name || a.name}`,
      customer: a.customer_name ?? "",
      start: `${a.due_date}T00:00:00Z`,
      end: `${a.due_date}T23:59:59Z`,
      status: a.workflow_state,
      location: a.origin_location ?? "NYC",
      allDay: true,
    });
  }

  for (const d of deliveries) {
    const dateStr = d.lsh_scheduled_at ? String(d.lsh_scheduled_at).slice(0, 10) : d.lsh_scheduled_date;
    if (!dateStr) continue;
    events.push({
      id: `dlv-${d.name}`,
      feed: "app_deliveries",
      title: d.customer_name || d.name,
      customer: d.customer_name || null,
      start: d.lsh_scheduled_at ?? `${dateStr}T09:00:00Z`,
      end: d.lsh_scheduled_at ?? `${dateStr}T09:00:00Z`,
      status: d.lsh_status,
      location: d.delivery_address ?? null,
      deliveryNo: d.name,
      allDay: !d.lsh_scheduled_at,
    });
  }

  for (const t of tasks) {
    const customerName = customerMap[t.for_customer] ?? "";
    events.push({
      id: `task-${t.name}`,
      feed: "pickups_deliveries",
      title: t.title ?? `${t.task_type}: ${customerName}`,
      customer: customerName,
      start: t.scheduled_for,
      end: t.scheduled_for,
      status: t.status,
    });
  }

  for (const o of yzOrdersRes) {
    if (!o.yz_ship_plan) continue;
    events.push({
      id: `yz-${o.name}`,
      feed: "yz_ship",
      title: o.customer_name || o.name,
      customer: o.customer_name || null,
      start: `${o.yz_ship_plan}T00:00:00Z`,
      end: `${o.yz_ship_plan}T23:59:59Z`,
      status: o.status,
      erpName: o.name,
      allDay: true,
    });
  }

  events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return c.json({ data: events });
});
