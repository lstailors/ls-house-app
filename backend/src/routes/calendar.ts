import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";

export const calendarRouter = new Hono();

// GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD&feeds=appointments,production,pickups
calendarRouter.get("/events", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });

  const start = c.req.query("start") ?? new Date().toISOString().split("T")[0];
  const end = c.req.query("end") ?? new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
  const feeds = (c.req.query("feeds") ?? "appointments,production,pickups").split(",");

  const events: any[] = [];

  // ── 1. Appointments (NYC + Houston from Supabase, synced from Cal.com) ──────
  if (feeds.includes("appointments")) {
    const { data: appts } = await supabaseAdmin
      .from("appointments")
      .select("id,customer_id,event_type,status,start_time,end_time,location,assigned_tailor,calcom_booking_uid")
      .gte("start_time", `${start}T00:00:00Z`)
      .lte("start_time", `${end}T23:59:59Z`)
      .neq("status", "cancelled")
      .order("start_time");

    for (const a of appts ?? []) {
      // Get customer name
      let customerName = "";
      if (a.customer_id) {
        const { data: cust } = await supabaseAdmin
          .from("customers").select("full_name").eq("id", a.customer_id).single();
        customerName = cust?.full_name ?? "";
      }

      const loc = (a.location ?? "").toLowerCase();
      const feed = loc.includes("hou") || loc.includes("houston") || loc.includes("tx")
        ? "houston_appointments"
        : "nyc_appointments";

      events.push({
        id: a.id,
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
  }

  // ── 2. Production — alteration tickets with due dates ────────────────────────
  if (feeds.includes("production")) {
    const { data: alts } = await supabaseAdmin
      .from("alteration_tickets")
      .select("id,customer_id,ticket_number,status,promise_date,origin_location")
      .gte("promise_date", start)
      .lte("promise_date", end)
      .not("status", "in", '("Picked Up","Cancelled")')
      .order("promise_date");

    for (const a of alts ?? []) {
      let customerName = "";
      if (a.customer_id) {
        const { data: cust } = await supabaseAdmin
          .from("customers").select("full_name").eq("id", a.customer_id).single();
        customerName = cust?.full_name ?? "";
      }
      events.push({
        id: `alt-${a.id}`,
        feed: "production_alterations",
        title: `Due: ${customerName || a.ticket_number}`,
        customer: customerName,
        start: `${a.promise_date}T00:00:00Z`,
        end: `${a.promise_date}T23:59:59Z`,
        status: a.status,
        location: a.origin_location ?? "NYC",
        allDay: true,
      });
    }

  }

  // ── 3. App Deliveries (from app.lstailors.com dispatch board) ───────────────
  if (feeds.includes("app_deliveries")) {
    const { data: deliveries } = await supabaseAdmin
      .from("deliveries")
      .select("id,delivery_no,status,scheduled_at,scheduled_date,delivered_at,address_line,pod_photo_1_path,pod_method,customer_id,driver_id")
      .or(`scheduled_at.gte.${start}T00:00:00Z,scheduled_date.gte.${start}`)
      .or(`scheduled_at.lte.${end}T23:59:59Z,scheduled_date.lte.${end}`)
      .not("status", "in", '("Cancelled","Stale","stale")')
      .order("scheduled_at");

    // Batch fetch customer names
    const customerIds = [...new Set((deliveries ?? []).filter(d => d.customer_id).map(d => d.customer_id))];
    const customerMap: Record<string, string> = {};
    if (customerIds.length) {
      const { data: custs } = await supabaseAdmin
        .from("customers").select("id,full_name").in("id", customerIds);
      (custs ?? []).forEach((c: any) => { customerMap[c.id] = c.full_name; });
    }

    for (const d of deliveries ?? []) {
      const customerName = customerMap[d.customer_id] ?? "";
      const dateStr = d.scheduled_at
        ? d.scheduled_at.slice(0, 10)
        : d.scheduled_date;
      if (!dateStr) continue;
      const isDelivered = ["delivered", "Delivered", "Picked Up"].includes(d.status ?? "");
      const eventDate = isDelivered && d.delivered_at ? d.delivered_at.slice(0, 10) : dateStr;
      events.push({
        id: `dlv-${d.id}`,
        feed: "app_deliveries",
        title: customerName || d.delivery_no || "Delivery",
        customer: customerName || null,
        start: d.scheduled_at ?? `${dateStr}T09:00:00Z`,
        end: d.scheduled_at ?? `${dateStr}T09:00:00Z`,
        status: d.status,
        location: d.address_line ?? null,
        deliveryNo: d.delivery_no ?? null,
        hasPod: !!d.pod_photo_1_path,
        podMethod: d.pod_method ?? null,
        allDay: !d.scheduled_at,
      } as any);
    }
  }

  // ── 4. Pickups & Deliveries ──────────────────────────────────────────────────
  if (feeds.includes("pickups")) {
    const { data: tasks } = await supabaseAdmin
      .from("ls_tasks")
      .select("id,title,task_type,status,scheduled_for,for_customer_id")
      .gte("scheduled_for", `${start}T00:00:00Z`)
      .lte("scheduled_for", `${end}T23:59:59Z`)
      .in("task_type", ["Pickup", "Delivery", "pickup", "delivery"])
      .order("scheduled_for");

    for (const t of tasks ?? []) {
      let customerName = "";
      if (t.for_customer_id) {
        const { data: cust } = await supabaseAdmin
          .from("customers").select("full_name").eq("id", t.for_customer_id).single();
        customerName = cust?.full_name ?? "";
      }
      events.push({
        id: `task-${t.id}`,
        feed: "pickups_deliveries",
        title: t.title ?? `${t.task_type}: ${customerName}`,
        customer: customerName,
        start: t.scheduled_for,
        end: t.scheduled_for,
        status: t.status,
      });
    }
  }

  // ── 4. YZ Ship Plan — Sales Orders by yz_ship_plan date ─────────────────────
  if (feeds.includes("yz_ship") || feeds.includes("production")) {
    const yzOrders = await erpList<any>("Sales Order", {
      filters: [
        ["yz_ship_plan", ">=", start],
        ["yz_ship_plan", "<=", end],
        ["yz_ship_plan", "!=", ""],
        ["status", "not in", ["Cancelled", "Closed"]],
      ],
      fields: ["name", "customer_name", "yz_ship_plan", "delivery_date", "status"],
      limit: 200,
      order_by: "yz_ship_plan asc",
    });

    for (const o of yzOrders) {
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
  }

  // Sort all by start
  events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return c.json({ data: events });
});
