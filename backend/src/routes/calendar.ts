import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";

export const calendarRouter = new Hono();

// GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD
calendarRouter.get("/events", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });

  const start = c.req.query("start") ?? new Date().toISOString().split("T")[0];
  const end   = c.req.query("end")   ?? new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  // ── Fetch all feeds in parallel ───────────────────────────────────────────────
  const [apptsRes, altsRes, deliveriesRes, tasksRes, yzOrdersRes] = await Promise.all([
    // 1. Appointments
    supabaseAdmin
      .from("appointments")
      .select("id,customer_id,event_type,status,start_time,end_time,location,assigned_tailor,calcom_booking_uid")
      .gte("start_time", `${start}T00:00:00Z`)
      .lte("start_time", `${end}T23:59:59Z`)
      .neq("status", "cancelled")
      .order("start_time"),

    // 2. Alteration tickets
    supabaseAdmin
      .from("alteration_tickets")
      .select("id,customer_id,ticket_number,status,promise_date,origin_location")
      .gte("promise_date", start)
      .lte("promise_date", end)
      .not("status", "in", '("Picked Up","Cancelled")')
      .order("promise_date"),

    // 3. App deliveries
    supabaseAdmin
      .from("deliveries")
      .select("id,delivery_no,status,scheduled_at,scheduled_date,delivered_at,address_line,pod_photo_1_path,pod_method,customer_id,driver_id")
      .gte("scheduled_at", `${start}T00:00:00Z`)
      .lte("scheduled_at", `${end}T23:59:59Z`)
      .not("status", "in", '("Cancelled","Stale","stale")')
      .order("scheduled_at"),

    // 4. Pickup/delivery tasks
    supabaseAdmin
      .from("ls_tasks")
      .select("id,title,task_type,status,scheduled_for,for_customer_id")
      .gte("scheduled_for", `${start}T00:00:00Z`)
      .lte("scheduled_for", `${end}T23:59:59Z`)
      .in("task_type", ["Pickup", "Delivery", "pickup", "delivery"])
      .order("scheduled_for"),

    // 5. YZ Ship Plan from ERPNext
    erpList<any>("Sales Order", {
      filters: [
        ["yz_ship_plan", ">=", start],
        ["yz_ship_plan", "<=", end],
        ["yz_ship_plan", "!=", ""],
        ["status", "not in", ["Cancelled", "Closed"]],
      ],
      fields: ["name", "customer_name", "yz_ship_plan", "status"],
      limit: 200,
      order_by: "yz_ship_plan asc",
    }).catch(() => [] as any[]),
  ]);

  const appts     = apptsRes.data ?? [];
  const alts      = altsRes.data ?? [];
  const deliveries = deliveriesRes.data ?? [];
  const tasks     = tasksRes.data ?? [];
  const yzOrders  = yzOrdersRes ?? [];

  // ── Single batch customer lookup for all Supabase rows ───────────────────────
  const allCustomerIds = [
    ...appts.filter(a => a.customer_id).map(a => a.customer_id),
    ...alts.filter(a => a.customer_id).map(a => a.customer_id),
    ...deliveries.filter(d => d.customer_id).map(d => d.customer_id),
    ...tasks.filter(t => t.for_customer_id).map(t => t.for_customer_id),
  ];
  const uniqueIds = [...new Set(allCustomerIds)];

  const customerMap: Record<string, string> = {};
  if (uniqueIds.length) {
    const { data: custs } = await supabaseAdmin
      .from("customers").select("id,full_name").in("id", uniqueIds);
    (custs ?? []).forEach((c: any) => { customerMap[c.id] = c.full_name ?? ""; });
  }

  // ── Build events ──────────────────────────────────────────────────────────────
  const events: any[] = [];

  // 1. Appointments
  for (const a of appts) {
    const customerName = customerMap[a.customer_id] ?? "";
    const loc = (a.location ?? "").toLowerCase();
    const feed = loc.includes("hou") || loc.includes("houston") || loc.includes("tx")
      ? "houston_appointments" : "nyc_appointments";
    events.push({
      id: a.id, feed,
      title: a.event_type ?? customerName ?? "Appointment",
      customer: customerName,
      start: a.start_time, end: a.end_time,
      status: a.status, location: a.location ?? null,
      tailor: a.assigned_tailor ?? null,
      calcomUid: a.calcom_booking_uid ?? null,
    });
  }

  // 2. Alteration due dates
  for (const a of alts) {
    const customerName = customerMap[a.customer_id] ?? "";
    events.push({
      id: `alt-${a.id}`, feed: "production_alterations",
      title: `Due: ${customerName || a.ticket_number}`,
      customer: customerName,
      start: `${a.promise_date}T00:00:00Z`,
      end: `${a.promise_date}T23:59:59Z`,
      status: a.status, location: a.origin_location ?? "NYC", allDay: true,
    });
  }

  // 3. App deliveries
  for (const d of deliveries) {
    const customerName = customerMap[d.customer_id] ?? "";
    const dateStr = d.scheduled_at ? d.scheduled_at.slice(0, 10) : d.scheduled_date;
    if (!dateStr) continue;
    events.push({
      id: `dlv-${d.id}`, feed: "app_deliveries",
      title: customerName || d.delivery_no || "Delivery",
      customer: customerName || null,
      start: d.scheduled_at ?? `${dateStr}T09:00:00Z`,
      end: d.scheduled_at ?? `${dateStr}T09:00:00Z`,
      status: d.status, location: d.address_line ?? null,
      deliveryNo: d.delivery_no ?? null,
      hasPod: !!d.pod_photo_1_path,
      podMethod: d.pod_method ?? null,
      allDay: !d.scheduled_at,
    });
  }

  // 4. Pickup/delivery tasks
  for (const t of tasks) {
    const customerName = customerMap[t.for_customer_id] ?? "";
    events.push({
      id: `task-${t.id}`, feed: "pickups_deliveries",
      title: t.title ?? `${t.task_type}: ${customerName}`,
      customer: customerName,
      start: t.scheduled_for, end: t.scheduled_for,
      status: t.status,
    });
  }

  // 5. YZ Ship Plan
  for (const o of yzOrders) {
    if (!o.yz_ship_plan) continue;
    events.push({
      id: `yz-${o.name}`, feed: "yz_ship",
      title: o.customer_name || o.name,
      customer: o.customer_name || null,
      start: `${o.yz_ship_plan}T00:00:00Z`,
      end: `${o.yz_ship_plan}T23:59:59Z`,
      status: o.status, erpName: o.name, allDay: true,
    });
  }

  events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return c.json({ data: events });
});
