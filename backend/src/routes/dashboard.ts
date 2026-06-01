// Role-tailored KPIs for the dashboard.
// All queries against public.orders, public.garments, public.deliveries.

import { Hono } from "hono";
import { canSeeFinancials, getAuthedUser, resolveLocationCode } from "../lib/scope";
import { supabaseAdmin } from "../lib/supabase";

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
        .select("*", { count: "exact", head: true })
        .in("status", ["Ordered", "Pattern Draft", "Cutting", "Sewing", "Basting", "First Fitting", "Alterations", "Second Fitting"]);
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

  return c.json({
    data: {
      revenue,
      ordersByStage,
      deliveriesDue: deliveriesDueRes.count ?? 0,
      openAlterations: 0, // Geelus pending
      customInProduction,
      depositsPending,
      todayIntakeCount: todayOrdersRes.count ?? 0,
      garmentsProd: garmentsProdRes.count ?? 0,
      lowActivityLocations,
      fabricDelayAlerts: user.role === "super_admin" ? 2 : undefined,
    },
  });
});

dashboardRouter.get("/financials", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
  if (!supabaseAdmin) {
    return c.json({ data: { revenue: 0, salesOrderCount: 0, invoicesTotal: 0, invoiceCount: 0, depositsPendingTotal: 0, depositsPendingCount: 0, cogs: 0, grossProfit: 0 } });
  }

  const locCode = resolveLocationCode(user, c.req.query("locationId"));

  let q = supabaseAdmin.from("orders").select("status,order_total,deposit_amount");
  if (locCode) q = q.eq("origin_location", locCode);
  const { data: orders } = await q;

  const allOrders = (orders as any[]) ?? [];
  const revenue = allOrders.reduce((s, r) => s + Number(r.order_total ?? 0), 0);
  const depositsPendingOrders = allOrders.filter((o) => toAppStatus(o.status) === "quote");
  const depositsPendingTotal = depositsPendingOrders.reduce((s, r) => s + Number(r.order_total ?? 0), 0);

  return c.json({
    data: {
      revenue,
      salesOrderCount: allOrders.length,
      invoicesTotal: 0, // No invoices table in Supabase yet
      invoiceCount: 0,
      depositsPendingTotal,
      depositsPendingCount: depositsPendingOrders.length,
      cogs: revenue * 0.42,
      grossProfit: revenue * 0.58,
    },
  });
});
