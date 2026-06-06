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

    // Custom orders with delivery dates — pull from ERPNext directly for customer names
    const orders = await erpList<any>("Sales Order", {
      filters: [
        ["delivery_date", ">=", start],
        ["delivery_date", "<=", end],
        ["status", "not in", ["Cancelled", "Closed"]],
      ],
      fields: ["name", "customer_name", "delivery_date", "status"],
      limit: 200,
      order_by: "delivery_date asc",
    });

    for (const o of orders) {
      events.push({
        id: `so-erp-${o.name}`,
        feed: "production_custom",
        title: o.customer_name || o.name,
        customer: o.customer_name || null,
        start: `${o.delivery_date}T00:00:00Z`,
        end: `${o.delivery_date}T23:59:59Z`,
        status: o.status,
        erpName: o.name,
        allDay: true,
      });
    }
  }

  // ── 3. Pickups & Deliveries ──────────────────────────────────────────────────
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
