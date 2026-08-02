// Role-tailored KPIs for the dashboard.
// All queries against public.orders, public.garments, public.deliveries.

import { Hono } from "hono";
import { canSeeFinancials, getAuthedUser, resolveLocationCode } from "../lib/scope";
import { erpList } from "../lib/erp";
import {
  listSmsMessagesFiltered,
  insertAgentBrief,
  listAgentBriefsFiltered,
} from "../lib/erpnext/agents";
import { listLocations } from "../lib/erpnext/locations";
import { DT } from "../lib/erpnext/doctypes";
import { grokChat } from "../lib/grok";

export const dashboardRouter = new Hono();

function toAppStatus(dbStatus: string): string {
  if (["Submitted", "Consultation"].includes(dbStatus)) return "quote";
  if (dbStatus === "Ordered") return "deposit_paid";
  if (["Pattern", "Cutting", "Sewing", "First Fitting", "Alterations", "Second Fitting", "Final QC", "In Transit", "Arrived"].includes(dbStatus)) return "in_production";
  if (dbStatus === "Complete") return "ready";
  if (dbStatus === "Delivered") return "delivered";
  if (dbStatus === "Cancelled") return "cancelled";
  return "quote";
}

dashboardRouter.get("/kpis", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const locCode = resolveLocationCode(user, c.req.query("locationId"));

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const todayDate = now.toISOString().slice(0, 10);

  // ── Driver path ──────────────────────────────────────────────────────────────
  if (user.role === "driver") {
    const driverIds = [user.id];
    const driverFilter: unknown[] = [["lsh_courier_user_id", "in", driverIds]];

    const [todayDeliveries, completedDeliveries] = await Promise.all([
      erpList("LSH Delivery", {
        filters: [...driverFilter, ["lsh_scheduled_date", "=", todayDate], ["lsh_status", "not in", ["Delivered", "Cancelled", "Failed"]]],
        fields: ["name"],
        limit: 500,
      }).catch(() => []),
      erpList("LSH Delivery", {
        filters: [...driverFilter, ["lsh_status", "in", ["Delivered", "Picked Up"]], ["lsh_delivered_at", ">=", startOfDay.toISOString()], ["lsh_delivered_at", "<=", endOfDay.toISOString()]],
        fields: ["name"],
        limit: 500,
      }).catch(() => []),
    ]);

    return c.json({
      data: {
        revenue: 0,
        ordersByStage: {},
        deliveriesDue: 0,
        openAlterations: 0,
        customInProduction: 0,
        depositsPending: 0,
        todayIntakeCount: 0,
        myDeliveriesToday: todayDeliveries.length,
        myDeliveriesCompletedToday: completedDeliveries.length,
      },
    });
  }

  // ── Manager / Salesperson path ───────────────────────────────────────────────

  // ERPNext SO status → dashboard stage
  function soStageKpi(status: string): string {
    if (["Draft", "On Hold", "To Pay"].includes(status)) return "quote";
    if (status === "To Deliver and Bill" || status === "To Deliver") return "in_production";
    if (status === "To Bill") return "ready";
    if (status === "Completed" || status === "Closed") return "delivered";
    return "other";
  }

  const monthStartStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  // ERPNext Sales Orders for ordersByStage, revenue, depositsPending
  const soFilters: any[] = [["docstatus", "=", 1]];
  if (locCode) soFilters.push(["company", "like", locCode === "HOU" ? "%TX%" : "%NY%"]);

  // ERPNext Paid Sales Invoices for revenueMTD
  const siFilters: any[] = [["docstatus", "=", 1], ["status", "=", "Paid"], ["posting_date", ">=", monthStartStr]];
  if (locCode) siFilters.push(["company", "like", locCode === "HOU" ? "%TX%" : "%NY%"]);

  // LSH Delivery for deliveriesDue + day split
  const deliveryFilters: any[] = [["lsh_status", "in", ["Queued", "Out for Delivery"]]];
  if (locCode) deliveryFilters.push(["lsh_origin_location", "=", locCode]);

  const deliveredTodayFilters: any[] = [
    ["lsh_status", "=", "Delivered"],
    ["lsh_delivered_at", ">=", startOfDay.toISOString().replace("T", " ").slice(0, 19)],
    ["lsh_delivered_at", "<=", endOfDay.toISOString().replace("T", " ").slice(0, 19)],
  ];
  if (locCode) deliveredTodayFilters.push(["lsh_origin_location", "=", locCode]);

  const outFilters: any[] = [["lsh_status", "=", "Out for Delivery"]];
  if (locCode) outFilters.push(["lsh_origin_location", "=", locCode]);

  // Today's intake from ERPNext SOs
  const todayFilters: any[] = [["docstatus", "=", 1], ["transaction_date", "=", todayDate]];
  if (locCode) todayFilters.push(["company", "like", locCode === "HOU" ? "%TX%" : "%NY%"]);

  const [erpSalesOrders, erpPaidInvoices, erpDeliveriesDue, erpDeliveredToday, erpOutForDelivery, erpTodaySOs] = await Promise.all([
    erpList<{ name: string; grand_total: number; status: string; transaction_date: string }>("Sales Order", {
      filters: soFilters,
      fields: ["name", "grand_total", "status", "transaction_date"],
      limit: 2000,
    }).catch(() => []),
    erpList<{ name: string; grand_total: number }>("Sales Invoice", {
      filters: siFilters,
      fields: ["name", "grand_total"],
      limit: 2000,
    }).catch(() => []),
    erpList<{ name: string }>("LSH Delivery", {
      filters: deliveryFilters,
      fields: ["name"],
      limit: 500,
    }).catch(() => []),
    erpList<{ name: string }>("LSH Delivery", {
      filters: deliveredTodayFilters,
      fields: ["name"],
      limit: 500,
    }).catch(() => []),
    erpList<{ name: string }>("LSH Delivery", {
      filters: outFilters,
      fields: ["name"],
      limit: 500,
    }).catch(() => []),
    erpList<{ name: string }>("Sales Order", {
      filters: todayFilters,
      fields: ["name"],
      limit: 500,
    }).catch(() => []),
  ]);

  const ordersByStage: Record<string, number> = {};
  let revenue = 0;
  let depositsPending = 0;
  let depositsPendingAmount = 0;

  for (const o of erpSalesOrders) {
    const stage = soStageKpi(o.status);
    if (stage === "other") continue;
    ordersByStage[stage] = (ordersByStage[stage] ?? 0) + 1;
    if (canSeeFinancials(user.role)) revenue += Number(o.grand_total ?? 0);
    if (stage === "quote") {
      depositsPending++;
      depositsPendingAmount += Number(o.grand_total ?? 0);
    }
  }

  const customInProduction = ordersByStage["in_production"] ?? 0;

  const garmentRows = await erpList<any>(DT.CUSTOM_ORDER_GARMENT, {
    filters: [["garment_status", "in", ["Ordered", "Pattern Draft", "Cutting", "Sewing", "Basting", "First Fitting", "Alterations", "Second Fitting"]]],
    fields: ["name", "garment_status"],
    limit: 500,
  }).catch(() => []);
  const garmentsProd = garmentRows.length;
  const garmentsByStage: Record<string, number> = {};
  for (const g of garmentRows) {
    garmentsByStage[g.garment_status] = (garmentsByStage[g.garment_status] ?? 0) + 1;
  }

  let lowActivityLocations: any[] | undefined;
  if (user.role === "super_admin") {
    const locs = await listLocations({ activeOnly: true });
    if (locs.length) {
      const weekAgoStr = weekAgo.toISOString().slice(0, 10);
      const locCounts = await Promise.all(
        locs.map(async (loc: any) => {
          if (!loc.location_code) return { loc, count: 0 };
          const companyLike = loc.location_code === "HOU" ? "%TX%" : "%NY%";
          const rows = await erpList("Sales Order", {
            filters: [["docstatus", "=", 1], ["transaction_date", ">=", weekAgoStr], ["company", "like", companyLike]],
            fields: ["name"],
            limit: 500,
          }).catch(() => []);
          return { loc, count: rows.length };
        }),
      );
      lowActivityLocations = locCounts
        .filter((x) => x.count < 2)
        .map((x) => ({ locationId: x.loc.location_code, locationName: x.loc.location_name, locationCode: x.loc.location_code, orders7d: x.count }));
    }
  }

  // Fetch open alteration tickets from ERPNext (Received + In Progress) — includes workflow_state for breakdown
  const erpFilters: unknown[] = [["workflow_state", "in", ["Received", "In Progress"]]];
  if (locCode) erpFilters.push(["origin_location", "=", locCode]);
  const altWithStatus = await erpList<{ name: string; workflow_state: string }>("Alteration Ticket", {
    filters: erpFilters,
    fields: ["name", "workflow_state"],
    limit: 500,
  }).catch(() => []);
  const openAlterations = altWithStatus.length;

  // Additional alteration stats from ERPNext
  const erpLocFilter: unknown[] = locCode ? [["origin_location", "=", locCode]] : [];
  const todayStr = todayDate;

  const [altReadyTickets, altOverdueTickets, altRushTickets, altRevTickets] = await Promise.all([
    erpList("Alteration Ticket", { filters: [...erpLocFilter, ["workflow_state", "=", "Ready"]], fields: ["name"], limit: 500 }).catch(() => []),
    erpList("Alteration Ticket", { filters: [...erpLocFilter, ["workflow_state", "in", ["Received", "In Progress"]], ["due_date", "<", todayStr]], fields: ["name"], limit: 200 }).catch(() => []),
    erpList("Alteration Ticket", { filters: [...erpLocFilter, ["workflow_state", "in", ["Received", "In Progress"]], ["is_rush", "=", 1]], fields: ["name"], limit: 200 }).catch(() => []),
    erpList<{ name: string; ticket_total: number }>("Alteration Ticket", { filters: [...erpLocFilter, ["ticket_date", ">=", monthStartStr]], fields: ["name", "ticket_total"], limit: 500 }).catch(() => []),
  ]);

  const altReady = altReadyTickets.length;
  const altOverdue = altOverdueTickets.length;
  const altRush = altRushTickets.length;
  const altRevenueMTD = (altRevTickets as any[]).reduce((s: number, t) => s + Number(t.ticket_total ?? 0), 0);
  const altByStatus = {
    received: altWithStatus.filter((t) => t.workflow_state === "Received").length,
    inProgress: altWithStatus.filter((t) => t.workflow_state === "In Progress").length,
    ready: altReady,
  };

  let unansweredSms = 0;
  try {
    const recentSms = await listSmsMessagesFiltered({ limit: 200 });
    const lastByPhone = new Map<string, string>();
    for (const msg of recentSms) {
      if (!lastByPhone.has(msg.client_phone)) lastByPhone.set(msg.client_phone, msg.direction);
    }
    unansweredSms = Array.from(lastByPhone.values()).filter((d) => d === "inbound").length;
  } catch {}

  // revenueMTD: paid invoices this month (custom) + alteration revenue MTD
  const customRevenueMTD = canSeeFinancials(user.role)
    ? (erpPaidInvoices as any[]).reduce((s: number, i) => s + Number(i.grand_total ?? 0), 0)
    : 0;
  const revenueMTD = customRevenueMTD + altRevenueMTD;

  return c.json({
    data: {
      revenue,
      ordersByStage,
      deliveriesDue: erpDeliveriesDue.length,
      deliveriesOutForDelivery: erpOutForDelivery.length,
      deliveriesDeliveredToday: erpDeliveredToday.length,
      openAlterations,
      customInProduction,
      depositsPending,
      todayIntakeCount: erpTodaySOs.length,
      garmentsProd,
      garmentsByStage,
      lowActivityLocations,
      fabricDelayAlerts: user.role === "super_admin" ? 2 : undefined,
      altReady,
      altOverdue,
      altRush,
      altByStatus,
      altRevenueMTD,
      revenueMTD,
      unansweredSms,
      depositsPendingAmount,
    },
  });
});

dashboardRouter.get("/financials", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);

  const now = new Date();
  const locCode = resolveLocationCode(user, c.req.query("locationId"));
  const empty = { revenue: 0, revenueMTD: 0, revenueLastMonth: 0, revenueChange: 0, salesOrderCount: 0, avgOrderValue: 0, depositsPendingTotal: 0, depositsPendingCount: 0, cogs: 0, grossProfit: 0, marginPct: 58, trend: [], pipeline: [], topGarments: [], arOutstanding: 0, invoiceCount: 0 };

  // ── ERPNext Sales Orders (source of truth for revenue) ──────────────────
  const soFilters: any[] = [["docstatus", "=", 1]]; // submitted only
  if (locCode) soFilters.push(["company", "like", locCode === "HOU" ? "%TX%" : "%NY%"]);

  const [allSalesOrders, arInvoices, soItems] = await Promise.all([
    erpList<any>("Sales Order", {
      filters: soFilters,
      fields: ["name", "grand_total", "total", "advance_paid", "status", "transaction_date", "customer_name"],
      limit: 2000,
      order_by: "transaction_date desc",
    }).catch(() => []),
    erpList<any>("Sales Invoice", {
      filters: [["docstatus", "=", 1], ["outstanding_amount", ">", 0]],
      fields: ["name", "outstanding_amount"],
      limit: 500,
    }).catch(() => []),
    erpList<any>("Sales Order Item", {
      filters: soFilters.map(f => f[0] === "docstatus" ? ["docstatus", "=", 1] : f),
      fields: ["item_name", "amount", "qty", "parent"],
      limit: 5000,
    }).catch(() => []),
  ]);

  if (!allSalesOrders.length) return c.json({ data: empty });

  // ── ERPNext SO status → pipeline stage ──────────────────────────────────
  function soStage(status: string): string {
    if (["Draft", "On Hold", "To Pay"].includes(status)) return "quote";
    if (status === "To Deliver and Bill" || status === "To Deliver") return "in_production";
    if (status === "To Bill") return "ready";
    if (status === "Completed" || status === "Closed") return "delivered";
    return "other";
  }

  // ── Revenue totals ───────────────────────────────────────────────────────
  const revenue = allSalesOrders.reduce((s: number, o: any) => s + Number(o.grand_total ?? 0), 0);
  const salesOrderCount = allSalesOrders.length;
  const avgOrderValue = salesOrderCount > 0 ? Math.round(revenue / salesOrderCount) : 0;

  // ── MTD & last month ─────────────────────────────────────────────────────
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const samePointLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().slice(0, 10);

  const mtdOrders = allSalesOrders.filter((o: any) => (o.transaction_date ?? "") >= startOfMonth);
  const lmOrders = allSalesOrders.filter((o: any) => (o.transaction_date ?? "") >= startOfLastMonth && (o.transaction_date ?? "") <= samePointLastMonth);
  const revenueMTD = mtdOrders.reduce((s: number, o: any) => s + Number(o.grand_total ?? 0), 0);
  const revenueLastMonth = lmOrders.reduce((s: number, o: any) => s + Number(o.grand_total ?? 0), 0);
  const revenueChange = revenueLastMonth > 0 ? Math.round(((revenueMTD - revenueLastMonth) / revenueLastMonth) * 100) : 0;

  // ── Deposits pending (quote stage) ──────────────────────────────────────
  const pendingOrders = allSalesOrders.filter((o: any) => soStage(o.status) === "quote");
  const depositsPendingTotal = pendingOrders.reduce((s: number, o: any) => s + Number(o.grand_total ?? 0), 0);
  const depositsPendingCount = pendingOrders.length;

  // ── 6-month trend ────────────────────────────────────────────────────────
  const trendMap = new Map<string, { revenue: number; orders: number }>();
  for (const o of allSalesOrders) {
    const month = (o.transaction_date ?? "").slice(0, 7);
    if (!month) continue;
    const e = trendMap.get(month) ?? { revenue: 0, orders: 0 };
    e.revenue += Number(o.grand_total ?? 0);
    e.orders += 1;
    trendMap.set(month, e);
  }
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    const e = trendMap.get(key) ?? { revenue: 0, orders: 0 };
    trend.push({ month: label, revenue: e.revenue, orders: e.orders });
  }

  // ── Pipeline by stage ────────────────────────────────────────────────────
  const stageMap = new Map<string, { count: number; value: number }>();
  for (const o of allSalesOrders) {
    const stage = soStage(o.status);
    if (stage === "other") continue;
    const e = stageMap.get(stage) ?? { count: 0, value: 0 };
    e.count += 1;
    e.value += Number(o.grand_total ?? 0);
    stageMap.set(stage, e);
  }
  const STAGE_LABELS: Record<string, string> = {
    quote: "Quote / Deposit Due",
    in_production: "In Production",
    ready: "Ready for Pickup",
    delivered: "Delivered",
  };
  const stageOrder = ["quote", "in_production", "ready", "delivered"];
  const pipeline = stageOrder
    .filter(s => stageMap.has(s))
    .map(stage => ({ stage, label: STAGE_LABELS[stage], ...(stageMap.get(stage)!) }));

  // ── Top garments from SO Items ───────────────────────────────────────────
  const garmentMap = new Map<string, { units: number; revenue: number }>();
  for (const item of soItems) {
    const type = (item.item_name as string | null) ?? "Other";
    const e = garmentMap.get(type) ?? { units: 0, revenue: 0 };
    e.units += Number(item.qty ?? 1);
    e.revenue += Number(item.amount ?? 0);
    garmentMap.set(type, e);
  }
  const topGarments = [...garmentMap.entries()]
    .map(([type, d]) => ({ type, units: d.units, revenue: d.revenue, avgPrice: d.units > 0 ? Math.round(d.revenue / d.units) : 0 }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 8);

  // ── AR Outstanding ───────────────────────────────────────────────────────
  const arOutstanding = arInvoices.reduce((s: any, i: any) => s + Number(i.outstanding_amount ?? 0), 0);
  const invoiceCount = arInvoices.length;

  // ── Top customers from ERPNext SOs ───────────────────────────────────────
  const customerMap = new Map<string, { orders: number; revenue: number }>();
  for (const o of allSalesOrders) {
    const name = (o.customer_name as string | null) ?? "Unknown";
    const e = customerMap.get(name) ?? { orders: 0, revenue: 0 };
    e.orders += 1;
    e.revenue += Number(o.grand_total ?? 0);
    customerMap.set(name, e);
  }
  const topCustomers = [...customerMap.entries()]
    .map(([name, d]) => ({ name, orders: d.orders, revenue: d.revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  let salesByRep: Array<{ name: string; orders: number; revenue: number }> = [];
  try {
    const repOrders = await erpList<any>("Sales Order", {
      filters: soFilters,
      fields: ["name", "grand_total", "sales_team"],
      limit: 2000,
    }).catch(() => []);
    if (repOrders.length) {
      const repMap = new Map<string, { orders: number; revenue: number }>();
      for (const o of repOrders) {
        const rep = (o.sales_team?.[0]?.sales_person as string | undefined) ?? "Unassigned";
        const e = repMap.get(rep) ?? { orders: 0, revenue: 0 };
        e.orders += 1;
        e.revenue += Number(o.grand_total ?? 0);
        repMap.set(rep, e);
      }
      salesByRep = [...repMap.entries()]
        .map(([name, d]) => ({ name, orders: d.orders, revenue: d.revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);
    }
  } catch {}

  const cogs = revenue * 0.42;
  const grossProfit = revenue * 0.58;

  return c.json({
    data: {
      revenue, revenueMTD, revenueLastMonth, revenueChange,
      salesOrderCount, avgOrderValue,
      depositsPendingTotal, depositsPendingCount,
      cogs, grossProfit, marginPct: Math.round((grossProfit / revenue) * 100) || 58,
      trend, pipeline, topGarments, topCustomers, salesByRep,
      arOutstanding, invoiceCount,
    },
  });
});

// ── Rocco floor brief (alts home) ────────────────────────────────────────────
// GET  /api/dashboard/floor-brief          → latest cached brief + stats (authed)
// POST /api/dashboard/floor-brief/refresh  → force regenerate (authed FOH)
// POST /api/dashboard/floor-brief/ask      → query Rocco (authed FOH, no brief row)
// GET  /api/dashboard/floor-brief/trigger  → Vercel cron (no auth, work-week)

const ROCCO_FLOOR_SOURCE = "rocco";
const ROCCO_FLOOR_TYPE = "floor_brief";
const FLOOR_BRIEF_MAX_AGE_MS = 2.5 * 60 * 60 * 1000; // 2.5h
const ASK_MAX_CHARS = 240;
const ASK_RATE_LIMIT = 8;
const ASK_RATE_WINDOW_MS = 60_000;

/** In-memory rolling window per user. Single-instance OK; multi-instance needs Redis later. */
const askRateBuckets = new Map<string, number[]>();

function takeAskRateSlot(userKey: string): boolean {
  const now = Date.now();
  const prev = askRateBuckets.get(userKey) ?? [];
  const recent = prev.filter((t) => now - t < ASK_RATE_WINDOW_MS);
  if (recent.length >= ASK_RATE_LIMIT) {
    askRateBuckets.set(userKey, recent);
    return false;
  }
  recent.push(now);
  askRateBuckets.set(userKey, recent);
  return true;
}

/** Latest espresso body only — never forces a re-brew. */
async function getCachedEspressoBody(): Promise<string | null> {
  try {
    const rows = await listAgentBriefsFiltered({
      source: ROCCO_FLOOR_SOURCE,
      type: ROCCO_FLOOR_TYPE,
      limit: 1,
    });
    const body = rows[0]?.body;
    return typeof body === "string" && body.trim() ? body.trim() : null;
  } catch {
    return null;
  }
}

function nycToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nycNowLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

function isWorkWeekNy(): boolean {
  // Mon–Sat (0=Sun). Shop closed Sunday; summer Mon–Fri still get Sat brief if open.
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date());
  return wd !== "Sun";
}

async function collectFloorSnapshot() {
  const today = nycToday();
  const [tickets, deliveries, openInvoices] = await Promise.all([
    erpList<any>("Alteration Ticket", {
      filters: [["workflow_state", "not in", ["Picked Up", "Cancelled", "Delivered"]]],
      fields: [
        "name",
        "customer_name",
        "workflow_state",
        "due_date",
        "origin_location",
        "assigned_tailor",
        "is_rush",
        "payment_status",
        "delivery_method",
      ],
      limit: 400,
      order_by: "due_date asc",
    }).catch(() => [] as any[]),
    erpList<any>("LSH Delivery", {
      filters: [["lsh_status", "not in", ["Delivered", "Cancelled", "Failed"]]],
      fields: [
        "name",
        "customer_name",
        "lsh_status",
        "lsh_scheduled_date",
        "lsh_scheduled_at",
        "lsh_courier_name",
        "lsh_origin_location",
      ],
      limit: 200,
      order_by: "modified desc",
    }).catch(() => [] as any[]),
    erpList<any>("Sales Invoice", {
      filters: [
        ["docstatus", "=", 1],
        ["outstanding_amount", ">", 0],
      ],
      fields: ["name", "customer_name", "outstanding_amount", "status", "due_date", "alteration_ticket_ref"],
      limit: 100,
      order_by: "due_date asc",
    }).catch(() => [] as any[]),
  ]);

  let open = 0;
  let ready = 0;
  let dueToday = 0;
  let overdue = 0;
  let outToTailors = 0;
  let rush = 0;
  const dueTodayNames: string[] = [];
  const overdueNames: string[] = [];
  const readyNames: string[] = [];

  for (const t of tickets) {
    const st = t.workflow_state ?? "";
    open += 1;
    if (st === "Ready") {
      ready += 1;
      if (readyNames.length < 8) readyNames.push(`${t.name} · ${t.customer_name || "—"}`);
    }
    if (t.is_rush) rush += 1;
    if (t.due_date) {
      if (t.due_date < today) {
        overdue += 1;
        if (overdueNames.length < 10) overdueNames.push(`${t.name} · ${t.customer_name || "—"} due ${t.due_date}`);
      } else if (t.due_date === today) {
        dueToday += 1;
        if (dueTodayNames.length < 10) dueTodayNames.push(`${t.name} · ${t.customer_name || "—"}`);
      }
    }
    const ol = String(t.origin_location || "").toLowerCase();
    if (ol.includes("home") || (t.assigned_tailor && ol && ol !== "nyc" && ol !== "hou")) {
      outToTailors += 1;
    }
  }

  let outForDelivery = 0;
  let queuedDelivery = 0;
  let deliveryToday = 0;
  const deliveryNames: string[] = [];
  for (const d of deliveries) {
    const st = String(d.lsh_status || "");
    if (st === "Out for Delivery") {
      outForDelivery += 1;
      if (deliveryNames.length < 8) deliveryNames.push(`${d.name} · ${d.customer_name || "—"} (out)`);
    } else if (st === "Queued" || st === "Scheduled") {
      queuedDelivery += 1;
      if (deliveryNames.length < 8) deliveryNames.push(`${d.name} · ${d.customer_name || "—"} (${st})`);
    }
    const sched = String(d.lsh_scheduled_date || d.lsh_scheduled_at || "").slice(0, 10);
    if (sched === today) deliveryToday += 1;
  }

  const arTotal = openInvoices.reduce((s, i) => s + Number(i.outstanding_amount || 0), 0);
  const arNames = openInvoices.slice(0, 6).map(
    (i) =>
      `${i.name} · ${i.customer_name || "—"} $${Number(i.outstanding_amount || 0).toFixed(0)} (${i.status})`,
  );

  const stats = {
    open,
    ready,
    dueToday,
    overdue,
    outToTailors,
    rush,
    outForDelivery,
    queuedDelivery,
    deliveryToday,
    openInvoices: openInvoices.length,
    arOutstanding: Math.round(arTotal * 100) / 100,
  };

  const dataBlock = [
    `TIME: ${nycNowLabel()} (America/New_York)`,
    `ALTERATIONS open=${open} ready_pickup=${ready} due_today=${dueToday} overdue=${overdue} out_to_tailors=${outToTailors} rush=${rush}`,
    dueTodayNames.length ? `DUE TODAY: ${dueTodayNames.join("; ")}` : "DUE TODAY: none listed",
    overdueNames.length ? `OVERDUE: ${overdueNames.join("; ")}` : "OVERDUE: none",
    readyNames.length ? `READY: ${readyNames.join("; ")}` : "READY: none",
    `DELIVERIES active queued/scheduled=${queuedDelivery} out_for_delivery=${outForDelivery} scheduled_today=${deliveryToday}`,
    deliveryNames.length ? `DELIVERY BOARD: ${deliveryNames.join("; ")}` : "DELIVERY BOARD: quiet",
    `OPEN AR: ${openInvoices.length} invoices · $${arTotal.toFixed(0)}`,
    arNames.length ? `TOP AR: ${arNames.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { stats, dataBlock, today };
}

async function generateRoccoFloorBrief(force = false): Promise<{
  body: string;
  title: string;
  stats: Record<string, number>;
  createdAt: string;
  fromCache: boolean;
}> {
  // Fresh cache?
  if (!force) {
    try {
      const rows = await listAgentBriefsFiltered({
        source: ROCCO_FLOOR_SOURCE,
        type: ROCCO_FLOOR_TYPE,
        limit: 1,
      });
      const row = rows[0];
      if (row?.body && row.creation) {
        const age = Date.now() - new Date(row.creation).getTime();
        if (age >= 0 && age < FLOOR_BRIEF_MAX_AGE_MS) {
          let stats: Record<string, number> = {};
          try {
            const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
            if (meta?.stats) stats = meta.stats;
          } catch {
            /* ignore */
          }
          return {
            body: row.body,
            title: row.title || "Daily Espresso ☕",
            stats,
            createdAt: row.creation,
            fromCache: true,
          };
        }
      }
    } catch {
      /* regenerate */
    }
  }

  const snap = await collectFloorSnapshot();
  let body = "";
  try {
    body = await grokChat(
      [
        {
          role: "system",
          content:
            "You are Rocco — production and delivery manager at L&S Custom Tailors. " +
            "Write the Daily Espresso ☕ — a short, lively floor brief for FOH on iPad/phone. " +
            "FORMAT (strict):\n" +
            "- 4 to 7 lines, each on its own line (use real newlines).\n" +
            "- Start every line with ONE emoji then a space, then plain text.\n" +
            "- Use: 🔴 overdue · 📅 due today · ✅ ready pickup · 🚚 delivery · 💰 AR/invoices · ☑️ calm/OK · ⚡ rush · 👉 next action.\n" +
            "- Keep each line short (under ~90 chars). Name clients when listed.\n" +
            "- No markdown, no asterisks, no bold markers.\n" +
            "- Last line must be the next action starting with 👉\n" +
            "- Sign off alone on the final line: — Rocco ☕",
        },
        {
          role: "user",
          content: `Floor sweep data:\n${snap.dataBlock}\n\nWrite the Daily Espresso now (emoji lines + newlines).`,
        },
      ],
      { maxTokens: 320, temperature: 0.25 },
    );
  } catch {
    body = "";
  }

  if (!body) {
    const s = snap.stats;
    body = [
      s.overdue > 0 ? `🔴 ${s.overdue} overdue — work the late rack first` : `☑️ No overdue`,
      s.dueToday > 0 ? `📅 ${s.dueToday} due today` : `📅 Nothing due today`,
      s.ready > 0 ? `✅ ${s.ready} ready for pickup` : `✅ Pickup rack clear`,
      s.outForDelivery > 0 || s.queuedDelivery > 0
        ? `🚚 ${s.outForDelivery} out · ${s.queuedDelivery} queued`
        : `🚚 Delivery board quiet`,
      s.openInvoices > 0
        ? `💰 ${s.openInvoices} open invoices · $${Number(s.arOutstanding).toLocaleString("en-US")}`
        : `💰 AR clear`,
      s.overdue > 0 ? `👉 Clear overdue, then ready pickups` : `👉 Keep the rack moving`,
      `— Rocco ☕`,
    ].join("\n");
  }

  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
    10,
  );
  const period = hour < 11 ? "Morning" : hour < 15 ? "Midday" : hour < 18 ? "Afternoon" : "Close";
  const title = `Daily Espresso · ${period} ☕`;

  try {
    await insertAgentBrief({
      type: ROCCO_FLOOR_TYPE,
      title,
      body,
      severity: snap.stats.overdue > 0 ? "warning" : "info",
      source: ROCCO_FLOOR_SOURCE,
      metadata: JSON.stringify({
        channel: "alts_floor_sweep",
        stats: snap.stats,
        generated_at: new Date().toISOString(),
      }),
    });
  } catch (e: any) {
    console.error("[floor-brief] save:", e?.message);
  }

  return {
    body,
    title,
    stats: snap.stats,
    createdAt: new Date().toISOString(),
    fromCache: false,
  };
}

/** Latest Rocco floor brief for alts home. */
dashboardRouter.get("/floor-brief", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);

  try {
    const brief = await generateRoccoFloorBrief(false);
    return c.json({ data: brief });
  } catch (e: any) {
    console.error("[floor-brief] get:", e?.message);
    return c.json({ error: { message: e?.message ?? "Floor brief failed" } }, 502);
  }
});

/** Force a fresh Rocco sweep (FOH refresh button). */
dashboardRouter.post("/floor-brief/refresh", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);

  try {
    const brief = await generateRoccoFloorBrief(true);
    return c.json({ data: brief });
  } catch (e: any) {
    return c.json({ error: { message: e?.message ?? "Refresh failed" } }, 502);
  }
});

/**
 * Ask Rocco — answer a floor question from live snapshot + cached espresso.
 * Does NOT insert a floor_brief row (keeps Brew history clean).
 */
dashboardRouter.post("/floor-brief/ask", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON body" } }, 400);
  }

  const rawQ =
    body && typeof body === "object" && body !== null && "question" in body
      ? (body as { question?: unknown }).question
      : undefined;
  const question = typeof rawQ === "string" ? rawQ.trim() : "";
  if (!question) {
    return c.json({ error: { message: "Question is required" } }, 400);
  }
  if (question.length > ASK_MAX_CHARS) {
    return c.json(
      { error: { message: `Question must be ${ASK_MAX_CHARS} characters or fewer` } },
      400,
    );
  }

  const rateKey = user.id || user.email || "anon";
  if (!takeAskRateSlot(rateKey)) {
    return c.json(
      { error: { message: "Too many asks — wait a minute and try again" } },
      429,
    );
  }

  try {
    const [snap, briefBody] = await Promise.all([
      collectFloorSnapshot(),
      getCachedEspressoBody(),
    ]);

    const askedAt = new Date().toISOString();
    const answer = (
      await grokChat(
        [
          {
            role: "system",
            content:
              "You are Rocco — production and delivery manager at L&S Custom Tailors. " +
              "Answer the owner's or FOH question using ONLY the floor data provided.\n" +
              "Rules:\n" +
              "- Be direct, short (2-6 sentences or short bullets with newlines).\n" +
              "- Name tickets/clients when the data lists them.\n" +
              "- No markdown bold/asterisks. Emoji sparingly ok.\n" +
              "- If data is insufficient, say what you don't know and where to look " +
              "(Shop Floor, Pickup, Deliveries, Invoices).\n" +
              "- Do NOT invent prices, promise dates, or client commitments.\n" +
              "- Do NOT draft client SMS or emails.\n" +
              "- Floor / production / delivery / AR only — refuse unrelated topics in one line.\n" +
              "- Sign nothing, or a single trailing — Rocco if natural.",
          },
          {
            role: "user",
            content:
              `FLOOR SNAPSHOT:\n${snap.dataBlock}\n\n` +
              `LATEST ESPRESSO BRIEF:\n${briefBody || "(none)"}\n\n` +
              `QUESTION:\n${question}`,
          },
        ],
        { maxTokens: 400, temperature: 0.2 },
      )
    ).trim();

    if (!answer) {
      return c.json(
        { error: { message: "Rocco couldn't reach the floor AI — try again in a moment" } },
        502,
      );
    }

    return c.json({
      data: {
        answer,
        askedAt,
        model: "grok",
      },
    });
  } catch (e: any) {
    console.error("[floor-brief/ask]", e?.message);
    return c.json(
      { error: { message: e?.message ?? "Ask failed — floor data unavailable" } },
      502,
    );
  }
});

/**
 * Vercel cron — work-week floor sweep every few hours.
 * No auth (same pattern as sofia/briefing/trigger).
 */
dashboardRouter.get("/floor-brief/trigger", async (c) => {
  if (!isWorkWeekNy()) {
    return c.json({ ok: true, skipped: true, reason: "weekend" });
  }
  try {
    const brief = await generateRoccoFloorBrief(true);
    return c.json({ ok: true, title: brief.title, fromCache: brief.fromCache, stats: brief.stats });
  } catch (e: any) {
    console.error("[floor-brief/trigger]", e?.message);
    return c.json({ ok: false, error: e?.message ?? "failed" }, 500);
  }
});
