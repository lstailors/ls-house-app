// Role-tailored KPIs for the dashboard.
// All queries against public.orders, public.garments, public.deliveries.

import { Hono } from "hono";
import { canSeeFinancials, getAuthedUser, resolveLocationCode } from "../lib/scope";
import { erpList } from "../lib/erp";
import { listSmsMessagesFiltered } from "../lib/erpnext/agents";
import { listLocations } from "../lib/erpnext/locations";
import { DT } from "../lib/erpnext/doctypes";

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
    if (user.supabaseProfileId && user.supabaseProfileId !== user.id) driverIds.push(user.supabaseProfileId);
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

  // LSH Delivery for deliveriesDue
  const deliveryFilters: any[] = [["lsh_status", "in", ["Queued", "Out for Delivery"]]];
  if (locCode) deliveryFilters.push(["origin_location", "=", locCode]);

  // Today's intake from ERPNext SOs
  const todayFilters: any[] = [["docstatus", "=", 1], ["transaction_date", "=", todayDate]];
  if (locCode) todayFilters.push(["company", "like", locCode === "HOU" ? "%TX%" : "%NY%"]);

  const [erpSalesOrders, erpPaidInvoices, erpDeliveriesDue, erpTodaySOs] = await Promise.all([
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
