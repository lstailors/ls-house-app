// Admin analytics endpoints — Mix, Buying, Sales, Costs, Locations
// All routes require super_admin or store_manager role.
// Range param: 7 | 30 | 90 (days). Default 30.

import { Hono } from "hono";
import { canAccessSuperAdminPortal, getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";

export const adminAnalyticsRouter = new Hono();

// ─── Auth guard ──────────────────────────────────────────────────────────────
adminAnalyticsRouter.use("*", async (c, next) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  await next();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function nycDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function startDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return nycDate(d);
}

function parseRange(raw: string | undefined): number {
  const n = parseInt(raw ?? "30", 10);
  return [7, 30, 90].includes(n) ? n : 30;
}

// ─── GET /api/admin/mix ───────────────────────────────────────────────────────
// "What we made" — garment volume by type from Sales Invoice Items
adminAnalyticsRouter.get("/mix", async (c) => {
  const days = parseRange(c.req.query("range"));
  const from = startDate(days);
  const to = nycDate();

  try {
    // Get submitted invoices in range
    const invoices = await erpList<any>("Sales Invoice", {
      filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
      fields: ["name"],
      limit: 500,
    });

    if (!invoices.length) {
      return c.json({ data: { range: days, from, to, totalQty: 0, totalAmount: 0, breakdown: [] } });
    }

    // Get items for those invoices
    const invoiceNames = invoices.map((i: any) => i.name);
    const items = await erpList<any>("Sales Invoice Item", {
      filters: [["parent", "in", invoiceNames]],
      fields: ["item_name", "item_group", "qty", "amount"],
      limit: 2000,
    });

    // Group by item_group
    const byGroup: Record<string, { qty: number; amount: number }> = {};
    for (const row of items) {
      const key = row.item_group || row.item_name || "Other";
      if (!byGroup[key]) byGroup[key] = { qty: 0, amount: 0 };
      byGroup[key]!.qty += row.qty ?? 1;
      byGroup[key]!.amount += row.amount ?? 0;
    }

    const breakdown = Object.entries(byGroup)
      .map(([name, v]) => ({ name, qty: v.qty, amount: Math.round(v.amount * 100) / 100 }))
      .sort((a, b) => b.qty - a.qty);

    const totalQty = breakdown.reduce((s, r) => s + r.qty, 0);
    const totalAmount = breakdown.reduce((s, r) => s + r.amount, 0);

    return c.json({
      data: { range: days, from, to, totalQty, totalAmount: Math.round(totalAmount * 100) / 100, breakdown },
    });
  } catch (_) {
    return c.json({ data: { range: days, from, to, totalQty: 0, totalAmount: 0, breakdown: [] } });
  }
});

// ─── GET /api/admin/buying ────────────────────────────────────────────────────
// PO board + supplier bills
adminAnalyticsRouter.get("/buying", async (c) => {
  const days = parseRange(c.req.query("range"));
  const from = startDate(days);
  const to = nycDate();
  const yzOnly = c.req.query("yz") === "true";

  try {
    const poFilters: any[] = [["docstatus", "=", 1]];
    if (yzOnly) poFilters.push(["supplier", "like", "%YZ%"]);
    else poFilters.push(["transaction_date", ">=", from]);

    const pos = await erpList<any>("Purchase Order", {
      filters: poFilters,
      fields: ["name", "supplier", "grand_total", "status", "transaction_date", "per_billed"],
      limit: 100,
    });

    const bills = await erpList<any>("Purchase Invoice", {
      filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
      fields: ["name", "supplier", "grand_total", "outstanding_amount", "posting_date"],
      limit: 100,
    });

    const totalPOValue = pos.reduce((s: number, p: any) => s + (p.grand_total ?? 0), 0);
    const totalBilled = bills.reduce((s: number, b: any) => s + (b.grand_total ?? 0), 0);
    const totalOutstanding = bills.reduce((s: number, b: any) => s + (b.outstanding_amount ?? 0), 0);

    // Group bills by supplier
    const bySupplier: Record<string, number> = {};
    for (const b of bills) {
      bySupplier[b.supplier] = (bySupplier[b.supplier] ?? 0) + (b.grand_total ?? 0);
    }
    const supplierBreakdown = Object.entries(bySupplier)
      .map(([supplier, amount]) => ({ supplier, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount);

    return c.json({
      data: {
        range: days,
        from,
        to,
        openPOs: pos.length,
        totalPOValue: Math.round(totalPOValue * 100) / 100,
        totalBilled: Math.round(totalBilled * 100) / 100,
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        pos: pos.slice(0, 20).map((p: any) => ({
          name: p.name,
          supplier: p.supplier,
          amount: p.grand_total,
          status: p.status,
          date: p.transaction_date,
          perBilled: p.per_billed,
        })),
        bills: bills.slice(0, 20).map((b: any) => ({
          name: b.name,
          supplier: b.supplier,
          amount: b.grand_total,
          outstanding: b.outstanding_amount,
          date: b.posting_date,
        })),
        supplierBreakdown,
      },
    });
  } catch (err: any) {
    return c.json({ data: { range: days, from, to, openPOs: 0, totalPOValue: 0, totalBilled: 0, totalOutstanding: 0, pos: [], bills: [], supplierBreakdown: [] } });
  }
});

// ─── GET /api/admin/sales ─────────────────────────────────────────────────────
// Sales by person + commission base
adminAnalyticsRouter.get("/sales", async (c) => {
  const days = parseRange(c.req.query("range"));
  const from = startDate(days);
  const to = nycDate();

  try {
    const invoices = await erpList<any>("Sales Invoice", {
      filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
      fields: ["name", "customer", "grand_total", "outstanding_amount", "posting_date", "sales_team"],
      limit: 500,
    });

    const totalRevenue = invoices.reduce((s: number, i: any) => s + (i.grand_total ?? 0), 0);
    const totalOutstanding = invoices.reduce((s: number, i: any) => s + (i.outstanding_amount ?? 0), 0);

    // Top clients by revenue
    const byClient: Record<string, number> = {};
    for (const inv of invoices) {
      byClient[inv.customer] = (byClient[inv.customer] ?? 0) + (inv.grand_total ?? 0);
    }
    const topClients = Object.entries(byClient)
      .map(([customer, amount]) => ({ customer, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15);

    // Daily trend
    const byDate: Record<string, number> = {};
    for (const inv of invoices) {
      const d = inv.posting_date as string;
      byDate[d] = (byDate[d] ?? 0) + (inv.grand_total ?? 0);
    }
    const trend = Object.entries(byDate)
      .map(([date, amount]) => ({ date, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return c.json({
      data: {
        range: days,
        from,
        to,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        invoiceCount: invoices.length,
        topClients,
        trend,
        // Sales person breakdown — populated once sales_team field is set in ERP
        salesPersons: [],
      },
    });
  } catch (err: any) {
    return c.json({ data: { range: days, from, to, totalRevenue: 0, totalOutstanding: 0, invoiceCount: 0, topClients: [], trend: [], salesPersons: [] } });
  }
});

// ─── GET /api/admin/costs ─────────────────────────────────────────────────────
// Actual cost pools — YZ factory vs revenue
adminAnalyticsRouter.get("/costs", async (c) => {
  const days = parseRange(c.req.query("range"));
  const from = startDate(days);
  const to = nycDate();

  try {
    const [invoices, bills] = await Promise.all([
      erpList<any>("Sales Invoice", {
        filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
        fields: ["grand_total", "posting_date"],
        limit: 500,
      }),
      erpList<any>("Purchase Invoice", {
        filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
        fields: ["supplier", "grand_total", "posting_date"],
        limit: 500,
      }),
    ]);

    const totalRevenue = invoices.reduce((s: number, i: any) => s + (i.grand_total ?? 0), 0);
    const totalCost = bills.reduce((s: number, b: any) => s + (b.grand_total ?? 0), 0);
    const grossMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;

    // Cost by supplier
    const bySupplier: Record<string, number> = {};
    for (const b of bills) {
      bySupplier[b.supplier] = (bySupplier[b.supplier] ?? 0) + (b.grand_total ?? 0);
    }
    const costBreakdown = Object.entries(bySupplier)
      .map(([supplier, amount]) => ({ supplier, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount);

    // Monthly comparison (last 6 months of revenue vs cost using available data)
    const revenueByMonth: Record<string, number> = {};
    for (const i of invoices) {
      const m = (i.posting_date as string).substring(0, 7);
      revenueByMonth[m] = (revenueByMonth[m] ?? 0) + (i.grand_total ?? 0);
    }
    const costByMonth: Record<string, number> = {};
    for (const b of bills) {
      const m = (b.posting_date as string).substring(0, 7);
      costByMonth[m] = (costByMonth[m] ?? 0) + (b.grand_total ?? 0);
    }
    const months = [...new Set([...Object.keys(revenueByMonth), ...Object.keys(costByMonth)])].sort();
    const monthlyComparison = months.map(m => ({
      month: m,
      revenue: Math.round((revenueByMonth[m] ?? 0) * 100) / 100,
      cost: Math.round((costByMonth[m] ?? 0) * 100) / 100,
    }));

    return c.json({
      data: {
        range: days,
        from,
        to,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        grossMargin: Math.round(grossMargin * 10) / 10,
        costBreakdown,
        monthlyComparison,
      },
    });
  } catch (err: any) {
    return c.json({ data: { range: days, from, to, totalRevenue: 0, totalCost: 0, grossMargin: 0, costBreakdown: [], monthlyComparison: [] } });
  }
});

// ─── GET /api/admin/locations ─────────────────────────────────────────────────
// NYC + Palm Beach financials comparison
adminAnalyticsRouter.get("/locations", async (c) => {
  const days = parseRange(c.req.query("range"));
  const from = startDate(days);
  const to = nycDate();

  try {
    const [invoices, orders] = await Promise.all([
      erpList<any>("Sales Invoice", {
        filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
        fields: ["grand_total", "outstanding_amount", "cost_center", "posting_date"],
        limit: 500,
      }),
      erpList<any>("Sales Order", {
        filters: [["docstatus", "=", 1], ["transaction_date", ">=", from], ["transaction_date", "<=", to]],
        fields: ["grand_total", "cost_center", "status"],
        limit: 500,
      }),
    ]);

    // Split by cost center — NYC vs PB (Palm Beach)
    const locs: Record<string, { revenue: number; outstanding: number; orders: number }> = {
      NYC: { revenue: 0, outstanding: 0, orders: 0 },
      "Palm Beach": { revenue: 0, outstanding: 0, orders: 0 },
      Other: { revenue: 0, outstanding: 0, orders: 0 },
    };

    for (const inv of invoices) {
      const cc = (inv.cost_center as string) ?? "";
      const loc = cc.includes("PB") || cc.toLowerCase().includes("palm") ? "Palm Beach"
        : cc.includes("NYC") || cc.includes("NY") ? "NYC" : "NYC"; // default NYC
      locs[loc]!.revenue += inv.grand_total ?? 0;
      locs[loc]!.outstanding += inv.outstanding_amount ?? 0;
    }

    for (const so of orders) {
      const cc = (so.cost_center as string) ?? "";
      const loc = cc.includes("PB") || cc.toLowerCase().includes("palm") ? "Palm Beach"
        : cc.includes("NYC") || cc.includes("NY") ? "NYC" : "NYC";
      locs[loc]!.orders += 1;
    }

    const locations = Object.entries(locs)
      .filter(([, v]) => v.revenue > 0 || v.orders > 0)
      .map(([name, v]) => ({
        name,
        revenue: Math.round(v.revenue * 100) / 100,
        outstanding: Math.round(v.outstanding * 100) / 100,
        orders: v.orders,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const totalRevenue = locations.reduce((s, l) => s + l.revenue, 0);

    return c.json({
      data: {
        range: days,
        from,
        to,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        locations,
      },
    });
  } catch (err: any) {
    return c.json({ data: { range: days, from, to, totalRevenue: 0, locations: [] } });
  }
});
