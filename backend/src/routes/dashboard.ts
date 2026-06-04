// Role-tailored KPIs for the dashboard.
// All queries against public.orders, public.garments, public.deliveries.

import { Hono } from "hono";
import { canSeeFinancials, getAuthedUser, resolveLocationCode } from "../lib/scope";
import { supabaseAdmin } from "../lib/supabase";
import { erpList } from "../lib/erp";

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
  if (!supabaseAdmin) {
    return c.json({ data: { revenue: 0, ordersByStage: {}, deliveriesDue: 0, openAlterations: 0, customInProduction: 0, depositsPending: 0, todayIntakeCount: 0, myDeliveriesToday: 0, myDeliveriesCompletedToday: 0 } });
  }

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
    const driverFilter = driverIds.length === 2
      ? `courier_user_id.eq.${driverIds[0]},courier_user_id.eq.${driverIds[1]}`
      : `courier_user_id.eq.${driverIds[0]}`;

    const [todayRes, completedRes] = await Promise.all([
      supabaseAdmin.from("deliveries")
        .select("*", { count: "exact", head: true })
        .or(driverFilter)
        .eq("scheduled_date", todayDate)
        .not("status", "in", '("Delivered","delivered","Picked Up","Cancelled","Stale","failed","Failed")'),
      supabaseAdmin.from("deliveries")
        .select("*", { count: "exact", head: true })
        .or(driverFilter)
        .in("status", ["Delivered", "delivered", "Picked Up"])
        .gte("delivered_at", startOfDay.toISOString())
        .lte("delivered_at", endOfDay.toISOString()),
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
        myDeliveriesToday: todayRes.count ?? 0,
        myDeliveriesCompletedToday: completedRes.count ?? 0,
      },
    });
  }

  // ── Manager / Salesperson path ───────────────────────────────────────────────

  const [orderDataRes, deliveriesDueRes, garmentsProdRes, todayOrdersRes] = await Promise.all([
    // All orders for location — fetch status + financials
    (() => {
      let q = supabaseAdmin!.from("orders").select("status,order_total,deposit_amount,created_at");
      if (locCode) q = q.eq("origin_location", locCode);
      if (user.role === "salesperson") {
        const createdBy = user.supabaseProfileId || user.id;
        q = q.eq("sales_rep_id", createdBy);
      }
      return q;
    })(),

    // Deliveries not yet completed
    (() => {
      let q = supabaseAdmin!
        .from("deliveries")
        .select("*", { count: "exact", head: true })
        .not("status", "in", '("Delivered","delivered","Picked Up","Cancelled","Stale","failed","Failed")');
      if (locCode) q = q.eq("origin_location", locCode);
      return q;
    })(),

    // Garments in active production
    (() => {
      return supabaseAdmin!
        .from("garments")
        .select("status")
        .in("status", ["Ordered", "Pattern Draft", "Cutting", "Sewing", "Basting", "First Fitting", "Alterations", "Second Fitting"])
        .limit(500);
    })(),

    // Today's intake (orders created today)
    (() => {
      let q = supabaseAdmin!
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startOfDay.toISOString())
        .lte("created_at", endOfDay.toISOString());
      if (locCode) q = q.eq("origin_location", locCode);
      if (user.role === "salesperson") {
        const createdBy = user.supabaseProfileId || user.id;
        q = q.eq("sales_rep_id", createdBy);
      }
      return q;
    })(),
  ]);

  const orders = (orderDataRes.data as any[]) ?? [];

  const ordersByStage: Record<string, number> = {};
  let revenue = 0;
  let depositsPending = 0;

  for (const o of orders) {
    const stage = toAppStatus(o.status);
    ordersByStage[stage] = (ordersByStage[stage] ?? 0) + 1;
    if (canSeeFinancials(user.role)) revenue += Number(o.order_total ?? 0);
    if (stage === "quote") depositsPending++;
  }

  const customInProduction = ordersByStage["in_production"] ?? 0;

  const garmentRows = (garmentsProdRes as any).data ?? [];
  const garmentsProd = garmentRows.length;
  const garmentsByStage: Record<string, number> = {};
  for (const g of garmentRows) {
    garmentsByStage[g.status] = (garmentsByStage[g.status] ?? 0) + 1;
  }

  const depositsPendingAmount = orders.filter((o: any) => toAppStatus(o.status) === "quote").reduce((s: number, o: any) => s + Number(o.order_total ?? 0), 0);

  // Low-activity locations for super_admin
  let lowActivityLocations: any[] | undefined;
  if (user.role === "super_admin") {
    const { data: locs } = await supabaseAdmin
      .from("locations")
      .select("code,name,id,active")
      .eq("active", true);

    if (locs) {
      const locCounts = await Promise.all(
        locs.map(async (loc: any) => {
          if (!loc.code) return { loc, count: 0 };
          const { count } = await supabaseAdmin!
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("origin_location", loc.code)
            .gte("created_at", weekAgo.toISOString());
          return { loc, count: count ?? 0 };
        }),
      );
      lowActivityLocations = locCounts
        .filter((x) => x.count < 2)
        .map((x) => ({ locationId: x.loc.id, locationName: x.loc.name, locationCode: x.loc.code, orders7d: x.count }));
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
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStartStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

  const [altReadyTickets, altOverdueTickets, altRushTickets, altRevTickets] = await Promise.all([
    erpList("Alteration Ticket", { filters: [...erpLocFilter, ["workflow_state", "=", "Ready"]], fields: ["name"], limit: 500 }).catch(() => []),
    erpList("Alteration Ticket", { filters: [...erpLocFilter, ["workflow_state", "in", ["Received", "In Progress"]], ["due_date", "<", todayStr]], fields: ["name"], limit: 200 }).catch(() => []),
    erpList("Alteration Ticket", { filters: [...erpLocFilter, ["workflow_state", "in", ["Received", "In Progress"]], ["is_rush", "=", 1]], fields: ["name"], limit: 200 }).catch(() => []),
    erpList<{ name: string; ticket_total: number }>("Alteration Ticket", { filters: [...erpLocFilter, ["ticket_date", ">=", monthStartStr]], fields: ["name", "ticket_total"], limit: 500 }).catch(() => []),
  ]);

  const altReady = altReadyTickets.length;
  const altOverdue = altOverdueTickets.length;
  const altRush = altRushTickets.length;
  const altRevenueMTD = altRevTickets.reduce((s, t: any) => s + Number(t.ticket_total ?? 0), 0);
  const altByStatus = {
    received: altWithStatus.filter((t) => t.workflow_state === "Received").length,
    inProgress: altWithStatus.filter((t) => t.workflow_state === "In Progress").length,
    ready: altReady,
  };

  // Unanswered SMS threads
  let unansweredSms = 0;
  if (supabaseAdmin) {
    const { data: recentSms } = await supabaseAdmin
      .from("sms_messages")
      .select("client_phone, direction, timestamp")
      .order("timestamp", { ascending: false })
      .limit(200);
    if (recentSms) {
      const lastByPhone = new Map<string, string>();
      for (const msg of recentSms) {
        if (!lastByPhone.has(msg.client_phone)) lastByPhone.set(msg.client_phone, msg.direction);
      }
      unansweredSms = Array.from(lastByPhone.values()).filter((d) => d === "inbound").length;
    }
  }

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const mtdOrders = orders.filter((o: any) => new Date(o.created_at) >= startOfMonth);
  const customRevenueMTD = canSeeFinancials(user.role) ? mtdOrders.reduce((s: number, o: any) => s + Number(o.order_total ?? 0), 0) : 0;
  const revenueMTD = customRevenueMTD + altRevenueMTD;

  return c.json({
    data: {
      revenue,
      ordersByStage,
      deliveriesDue: deliveriesDueRes.count ?? 0,
      openAlterations,
      customInProduction,
      depositsPending,
      todayIntakeCount: todayOrdersRes.count ?? 0,
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

  // ── Sales by rep from Supabase orders ────────────────────────────────────
  let salesByRep: Array<{ name: string; orders: number; revenue: number }> = [];
  if (supabaseAdmin) {
    let repQ = supabaseAdmin.from("orders").select("sales_rep_id, order_total, created_at");
    if (locCode) repQ = repQ.eq("origin_location", locCode);
    const { data: repOrders } = await repQ.limit(2000);
    if (repOrders?.length) {
      const repMap = new Map<string, { orders: number; revenue: number }>();
      for (const o of repOrders) {
        const id = o.sales_rep_id ?? "unknown";
        const e = repMap.get(id) ?? { orders: 0, revenue: 0 };
        e.orders += 1;
        e.revenue += Number(o.order_total ?? 0);
        repMap.set(id, e);
      }
      const repIds = [...repMap.keys()].filter(id => id !== "unknown");
      const { data: profiles } = repIds.length
        ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", repIds)
        : { data: [] };
      const nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name ?? "Unknown"]));
      salesByRep = [...repMap.entries()]
        .map(([id, d]) => ({ name: nameById.get(id) ?? (id === "unknown" ? "Unassigned" : id.slice(0, 8)), orders: d.orders, revenue: d.revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);
    }
  }

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
