import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import { getCustomersByIds } from "../lib/erpnext/customers";

export const calendarRouter = new Hono();

/**
 * Unified calendar feed for app.lstailors.com.
 *
 * Live ERP sources (Aug 2026):
 * - Event (Google-synced: L&S Appointments + L&S Production) — primary
 * - Appointment (CRM Appointment doctype)
 * - Alteration Ticket due_date
 * - LSH Delivery lsh_scheduled_at
 * - Sales Order delivery_date / yz_ship_plan
 *
 * Intentionally does NOT use LSH Appointment / LSH Task — those doctypes
 * are empty or missing on the live site.
 */
calendarRouter.get("/events", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const start = c.req.query("start") ?? new Date().toISOString().split("T")[0];
  const end =
    c.req.query("end") ??
    new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const [
    erpEvents,
    appointments,
    alts,
    deliveries,
    soByDelivery,
    soByYzShip,
  ] = await Promise.all([
    erpList<any>("Event", {
      filters: [
        ["starts_on", ">=", `${start} 00:00:00`],
        ["starts_on", "<=", `${end} 23:59:59`],
        ["status", "!=", "Cancelled"],
      ],
      fields: [
        "name",
        "subject",
        "starts_on",
        "ends_on",
        "status",
        "event_type",
        "event_category",
        "google_calendar",
        "description",
        "all_day",
      ],
      limit: 500,
      order_by: "starts_on asc",
    }).catch(() => []),

    erpList<any>("Appointment", {
      filters: [
        ["scheduled_time", ">=", `${start} 00:00:00`],
        ["scheduled_time", "<=", `${end} 23:59:59`],
        ["status", "not in", ["Closed", "Cancelled"]],
      ],
      fields: [
        "name",
        "scheduled_time",
        "status",
        "customer_name",
        "customer_phone_number",
        "custom_appointment_type",
        "assigned_agent",
        "appointment_with",
      ],
      limit: 300,
      order_by: "scheduled_time asc",
    }).catch(() => []),

    erpList<any>("Alteration Ticket", {
      filters: [
        ["due_date", ">=", start],
        ["due_date", "<=", end],
        ["workflow_state", "not in", ["Picked Up", "Cancelled"]],
      ],
      fields: [
        "name",
        "customer",
        "customer_name",
        "workflow_state",
        "due_date",
        "origin_location",
      ],
      limit: 500,
      order_by: "due_date asc",
    }).catch(() => []),

    // Only lsh_scheduled_at is listable (no lsh_scheduled_date on live meta)
    erpList<any>("LSH Delivery", {
      filters: [
        ["lsh_scheduled_at", ">=", `${start} 00:00:00`],
        ["lsh_scheduled_at", "<=", `${end} 23:59:59`],
        ["lsh_status", "not in", ["Cancelled", "Stale"]],
      ],
      fields: [
        "name",
        "customer",
        "customer_name",
        "lsh_status",
        "lsh_scheduled_at",
        "lsh_delivery_address",
        "lsh_origin_location",
      ],
      limit: 500,
      order_by: "lsh_scheduled_at asc",
    }).catch(() => []),

    erpList<any>("Sales Order", {
      filters: [
        ["docstatus", "=", 1],
        ["delivery_date", ">=", start],
        ["delivery_date", "<=", end],
        ["status", "not in", ["Cancelled", "Closed"]],
      ],
      fields: ["name", "customer_name", "delivery_date", "status"],
      limit: 300,
      order_by: "delivery_date asc",
    }).catch(() => []),

    erpList<any>("Sales Order", {
      filters: [
        ["docstatus", "=", 1],
        ["yz_ship_plan", ">=", start],
        ["yz_ship_plan", "<=", end],
        ["yz_ship_plan", "!=", ""],
        ["status", "not in", ["Cancelled", "Closed"]],
      ],
      fields: ["name", "customer_name", "yz_ship_plan", "status"],
      limit: 200,
      order_by: "yz_ship_plan asc",
    }).catch(() => []),
  ]);

  const allCustomerIds = [
    ...alts.filter((a: any) => a.customer).map((a: any) => a.customer),
    ...deliveries.filter((d: any) => d.customer).map((d: any) => d.customer),
  ];
  const uniqueIds = [...new Set(allCustomerIds)];
  const customerMapRaw = uniqueIds.length
    ? await getCustomersByIds(uniqueIds).catch(() => new Map())
    : new Map();
  const customerMap: Record<string, string> = {};
  for (const [id, row] of customerMapRaw as Map<string, any>) {
    customerMap[id] = row.customer_name ?? "";
  }

  const events: any[] = [];
  const seen = new Set<string>();

  function push(ev: any) {
    if (!ev?.id || seen.has(ev.id)) return;
    seen.add(ev.id);
    events.push(ev);
  }

  // ── ERP Event (Google calendars) ──────────────────────────────────────────
  for (const e of erpEvents) {
    if (!e.starts_on) continue;
    const cal = String(e.google_calendar ?? "").toLowerCase();
    const subject = String(e.subject ?? "");
    let feed = "nyc_appointments";
    if (cal.includes("production") || subject.includes("AUG CLOSED") || subject.includes("In Production") || subject.includes("Ship:")) {
      feed = "yz_ship";
    } else if (cal.includes("houston") || cal.includes("hou")) {
      feed = "houston_appointments";
    } else if (cal.includes("appointment") || cal.includes("l&s appointments")) {
      feed = "nyc_appointments";
    }

    const startIso = String(e.starts_on).includes("T")
      ? e.starts_on
      : String(e.starts_on).replace(" ", "T");
    const endIso = e.ends_on
      ? String(e.ends_on).includes("T")
        ? e.ends_on
        : String(e.ends_on).replace(" ", "T")
      : undefined;
    const allDay =
      Boolean(e.all_day) ||
      String(e.starts_on).endsWith("00:00:00") ||
      feed === "yz_ship";

    push({
      id: `evt-${e.name}`,
      feed,
      title: subject || e.name,
      customer: null,
      start: startIso,
      end: endIso,
      status: e.status,
      location: e.google_calendar || null,
      allDay,
      erpName: e.name,
      source: "Event",
    });
  }

  // ── CRM Appointment ───────────────────────────────────────────────────────
  for (const a of appointments) {
    if (!a.scheduled_time) continue;
    const startIso = String(a.scheduled_time).includes("T")
      ? a.scheduled_time
      : String(a.scheduled_time).replace(" ", "T");
    push({
      id: `apmt-${a.name}`,
      feed: "nyc_appointments",
      title:
        a.custom_appointment_type ||
        a.customer_name ||
        "Appointment",
      customer: a.customer_name || null,
      start: startIso,
      end: startIso,
      status: a.status,
      tailor: a.assigned_agent || null,
      allDay: false,
      erpName: a.name,
      source: "Appointment",
    });
  }

  // ── Alteration due dates ──────────────────────────────────────────────────
  for (const a of alts) {
    if (!a.due_date) continue;
    push({
      id: `alt-${a.name}`,
      feed: "production_alterations",
      title: `Due: ${a.customer_name || customerMap[a.customer] || a.name}`,
      customer: a.customer_name || customerMap[a.customer] || "",
      start: `${a.due_date}T00:00:00`,
      end: `${a.due_date}T23:59:59`,
      status: a.workflow_state,
      location: a.origin_location ?? "NYC",
      allDay: true,
      erpName: a.name,
    });
  }

  // ── Deliveries ────────────────────────────────────────────────────────────
  for (const d of deliveries) {
    if (!d.lsh_scheduled_at) continue;
    const startIso = String(d.lsh_scheduled_at).includes("T")
      ? d.lsh_scheduled_at
      : String(d.lsh_scheduled_at).replace(" ", "T");
    push({
      id: `dlv-${d.name}`,
      feed: "app_deliveries",
      title: d.customer_name || customerMap[d.customer] || d.name,
      customer: d.customer_name || customerMap[d.customer] || null,
      start: startIso,
      end: startIso,
      status: d.lsh_status,
      location: d.lsh_delivery_address ?? d.lsh_origin_location ?? null,
      deliveryNo: d.name,
      allDay: false,
    });
  }

  // ── SO delivery_date + yz_ship_plan ───────────────────────────────────────
  for (const o of soByDelivery) {
    if (!o.delivery_date) continue;
    push({
      id: `so-del-${o.name}`,
      feed: "yz_ship",
      title: o.customer_name || o.name,
      customer: o.customer_name || null,
      start: `${o.delivery_date}T00:00:00`,
      end: `${o.delivery_date}T23:59:59`,
      status: o.status,
      erpName: o.name,
      allDay: true,
    });
  }
  for (const o of soByYzShip) {
    if (!o.yz_ship_plan) continue;
    push({
      id: `yz-${o.name}`,
      feed: "yz_ship",
      title: o.customer_name || o.name,
      customer: o.customer_name || null,
      start: `${o.yz_ship_plan}T00:00:00`,
      end: `${o.yz_ship_plan}T23:59:59`,
      status: o.status,
      erpName: o.name,
      allDay: true,
    });
  }

  events.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  return c.json({
    data: events,
    meta: {
      start,
      end,
      counts: {
        events: erpEvents.length,
        appointments: appointments.length,
        alterations: alts.length,
        deliveries: deliveries.length,
        salesOrders: soByDelivery.length + soByYzShip.length,
        total: events.length,
      },
    },
  });
});
