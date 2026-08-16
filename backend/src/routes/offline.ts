/**
 * GET /api/offline/snapshot — hot dataset for the alts IndexedDB cache.
 * Counts still come from /api/metrics. This payload is names and headers only.
 */
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, isAltsOrigin } from "../lib/erp";
import { DT } from "../lib/erpnext/doctypes";
import { addDaysIso, nyTodayIso } from "../lib/shop-time";

export const offlineRouter = new Hono();

function deny(c: any, status: 401 | 403 = 401) {
  return c.json({ error: { message: status === 401 ? "Unauthorized" : "Forbidden" } }, status);
}

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

offlineRouter.get("/snapshot", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return deny(c, 401);
  if (user.role === "driver" || user.role === "customer") return deny(c, 403);

  const today = nyTodayIso();
  const until = addDaysIso(today, 7);
  const since = (c.req.query("since") || "").trim();
  const ticketFilters: unknown[] = [["workflow_state", "not in", ["Picked Up", "Cancelled"]]];
  if (since) ticketFilters.push(["modified", ">=", since]);

  const invoiceFilters: unknown[] = [
    ["docstatus", "=", 1],
    ["outstanding_amount", ">", 0],
  ];
  if (since) invoiceFilters.push(["modified", ">=", since]);

  const qcFilters: unknown[] = [["qc_result", "in", ["Pending", "Fail"]]];
  if (since) qcFilters.push(["modified", ">=", since]);

  const [
    ticketsRaw,
    customOrders,
    appointments,
    calEvents,
    invoices,
    presets,
    qc,
    customers,
  ] = await Promise.all([
    settled(
      erpList<Record<string, unknown>>("Alteration Ticket", {
        filters: ticketFilters,
        fields: [
          "name",
          "customer",
          "customer_name",
          "customer_phone",
          "origin_location",
          "workflow_state",
          "ticket_date",
          "due_date",
          "due_time",
          "is_rush",
          "ticket_total",
          "payment_status",
          "billing_status",
          "assigned_tailor",
          "linked_sales_order",
          "sales_invoice",
          "notified_ready_at",
          "modified",
          "creation",
        ],
        limit: 500,
        order_by: "modified desc",
      }),
      [],
    ),
    settled(
      erpList<Record<string, unknown>>(DT.CUSTOM_ORDER, {
        filters: [["status", "not in", ["Delivered", "Cancelled", "Complete"]]],
        fields: [
          "name",
          "customer",
          "customer_name",
          "status",
          "order_status",
          "order_total",
          "origin_location",
          "modified",
        ],
        limit: 300,
        order_by: "modified desc",
      }),
      [],
    ),
    settled(
      erpList<Record<string, unknown>>("Appointment", {
        filters: [
          ["scheduled_time", ">=", `${today} 00:00:00`],
          ["scheduled_time", "<=", `${until} 23:59:59`],
        ],
        fields: [
          "name",
          "scheduled_time",
          "status",
          "assigned_agent",
          "customer_name",
          "customer_phone_number",
          "custom_appointment_type",
        ],
        limit: 300,
        order_by: "scheduled_time asc",
      }),
      [],
    ),
    settled(
      erpList<Record<string, unknown>>("Event", {
        filters: [
          ["google_calendar", "=", "L&S Appointments"],
          ["status", "!=", "Cancelled"],
          ["starts_on", ">=", `${today} 00:00:00`],
          ["starts_on", "<=", `${until} 23:59:59`],
        ],
        fields: ["name", "subject", "starts_on", "ends_on", "status"],
        limit: 300,
        order_by: "starts_on asc",
      }),
      [],
    ),
    settled(
      erpList<Record<string, unknown>>("Sales Invoice", {
        filters: invoiceFilters,
        fields: [
          "name",
          "customer",
          "customer_name",
          "outstanding_amount",
          "grand_total",
          "posting_date",
          "due_date",
          "status",
          "modified",
        ],
        limit: 500,
        order_by: "posting_date asc",
      }),
      [],
    ),
    settled(
      erpList<Record<string, unknown>>("Alteration Preset", {
        filters: [["is_active", "=", 1]],
        fields: [
          "name",
          "preset_name",
          "display_name",
          "garment_type",
          "alteration_category",
          "default_price",
          "estimated_minutes",
          "is_group",
          "parent_preset",
          "item_code",
          "quick_pick",
          "sort_order",
        ],
        limit: 2000,
        order_by: "sort_order asc",
      }),
      [],
    ),
    settled(
      erpList<Record<string, unknown>>(DT.QC_INSPECTION, {
        filters: qcFilters,
        fields: ["name", "customer_name", "qc_result", "result", "modified", "garment_summary", "status"],
        limit: 200,
        order_by: "modified desc",
      }),
      [],
    ),
    settled(listSlimCustomers(since), []),
  ]);

  const tickets = ticketsRaw.filter((t) => isAltsOrigin(String(t.origin_location ?? "")));
  const now = new Date().toISOString();

  return c.json({
    data: {
      generated_at: now,
      today,
      since: since || null,
      collections: {
        tickets: { lastSyncedAt: now, rows: tickets },
        houseOrders: { lastSyncedAt: now, rows: customOrders },
        appointments: {
          lastSyncedAt: now,
          rows: [
            ...appointments.map((a) => ({ ...a, _kind: "appointment" })),
            ...calEvents.map((e) => ({ ...e, _kind: "event" })),
          ],
        },
        customers: { lastSyncedAt: now, rows: customers },
        invoices: { lastSyncedAt: now, rows: invoices },
        catalog: { lastSyncedAt: now, rows: presets },
        qc: { lastSyncedAt: now, rows: qc },
      },
    },
  });
});

async function listSlimCustomers(since: string) {
  const filters: unknown[] = [["disabled", "=", 0]];
  if (since) filters.push(["modified", ">=", since]);
  const page = 1000;
  const out: Array<{
    name: string;
    customer_name?: string;
    mobile_no?: string;
    email_id?: string;
    modified?: string;
  }> = [];
  for (let start = 0; start < 10_000; start += page) {
    const rows = await erpList<{
      name: string;
      customer_name?: string;
      mobile_no?: string;
      email_id?: string;
      modified?: string;
    }>("Customer", {
      filters,
      fields: ["name", "customer_name", "mobile_no", "email_id", "modified"],
      limit: page,
      start,
      order_by: "modified desc",
    });
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}
