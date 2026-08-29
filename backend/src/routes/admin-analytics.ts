// Admin analytics + Carl Admin PWA (admin.lstailors.com).
// Mix/Buying/Sales/Costs/Locations: super_admin or PIN session.
// PWA money/work/clients/house: PIN session (ADMIN_STAFF_PINS) or super_admin.
// Read-only. Honest empties — never invent revenue or margins.
// Range: day / week / month (PWA) and 7 | 30 | 90 (legacy mix).

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { canAccessSuperAdminPortal, getAuthedUser } from "../lib/scope";
import { erpGet, erpList } from "../lib/erp";

export const adminAnalyticsRouter = new Hono();

const COOKIE = "ls_admin_session";
const SESSION_HOURS = 12;
const FAIL_LIMIT = 5;
const FAIL_LOCK_MS = 60_000;
const failMap = new Map<string, { n: number; until: number }>();

type SessionPayload = {
  v: 1;
  staff: string;
  pinTail: string;
  exp: number;
};

function b64url(bytes: Uint8Array | string): string {
  const u8 = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(out);
}

function sessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.CHECKOUT_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    ""
  );
}

function staffPins(): Array<{ pin: string; name: string }> {
  const raw = (process.env.ADMIN_STAFF_PINS || process.env.ADMIN_STAFF_PIN || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw) as Array<{ pin: string; name?: string }>;
      return arr
        .filter((x) => x?.pin)
        .map((x) => ({
          pin: String(x.pin).replace(/\D/g, "").slice(0, 4),
          name: x.name || "Staff",
        }));
    } catch {
      /* fall through */
    }
  }
  return raw
    .split(",")
    .map((part: string) => {
      const [pinRaw, name] = part.split(":").map((s: string) => s.trim());
      const pin = (pinRaw || "").replace(/\D/g, "").slice(0, 4);
      return { pin, name: name || "Staff" };
    })
    .filter((x: { pin: string; name: string }) => x.pin.length === 4);
}

async function hmacSign(data: string): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error("ADMIN_SESSION_SECRET missing");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function mintSession(staff: string, pin: string): Promise<string> {
  const payload: SessionPayload = {
    v: 1,
    staff,
    pinTail: pin.slice(-2),
    exp: Date.now() + SESSION_HOURS * 3600_000,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = await hmacSign(body);
  return `${body}.${sig}`;
}

async function readSession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const expect = await hmacSign(body);
    if (expect.length !== sig.length) return null;
    let ok = 0;
    for (let i = 0; i < expect.length; i++) ok |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
    if (ok !== 0) return null;
    const payload = JSON.parse(b64urlDecode(body)) as SessionPayload;
    if (payload.v !== 1 || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function deviceKey(c: any): string {
  return (
    c.req.header("x-admin-device") ||
    c.req.header("x-forwarded-for") ||
    c.req.header("cf-connecting-ip") ||
    "unknown"
  );
}

function cookieOpts() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "None" as const,
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  };
}

function isPublicAuthPath(path: string): boolean {
  return /\/auth\/(pin|logout)$/.test(path.replace(/\/+$/, ""));
}

// ─── Auth guard ──────────────────────────────────────────────────────────────
adminAnalyticsRouter.use("*", async (c, next) => {
  if (isPublicAuthPath(c.req.path)) return next();

  const cookie = getCookie(c, COOKIE);
  const sess = await readSession(cookie);
  if (sess) {
    c.set("adminStaff" as never, sess.staff as never);
    return next();
  }

  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  await next();
});

// ─── PIN unlock / session ────────────────────────────────────────────────────
adminAnalyticsRouter.post("/auth/pin", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { pin?: string } | null;
  const pin = String(body?.pin || "").replace(/\D/g, "").slice(0, 4);
  const pins = staffPins();
  if (!pins.length) return c.json({ error: { message: "PIN not configured" } }, 500);
  if (!sessionSecret()) return c.json({ error: { message: "PIN not configured" } }, 500);

  const dk = deviceKey(c);
  const lock = failMap.get(dk);
  if (lock && lock.until > Date.now()) {
    return c.json(
      { error: { message: "Too many attempts — wait a minute", lockMs: lock.until - Date.now() } },
      429,
    );
  }
  if (pin.length !== 4) return c.json({ error: { message: "4-digit PIN required" } }, 400);

  const match = pins.find((p) => p.pin === pin);
  if (!match) {
    const cur = failMap.get(dk) || { n: 0, until: 0 };
    cur.n += 1;
    if (cur.n >= FAIL_LIMIT) {
      cur.until = Date.now() + FAIL_LOCK_MS;
      cur.n = 0;
    }
    failMap.set(dk, cur);
    return c.json({ error: { message: "Wrong PIN" } }, 401);
  }
  failMap.delete(dk);
  const token = await mintSession(match.name, pin);
  setCookie(c, COOKIE, token, cookieOpts());
  return c.json({ data: { ok: true, staff: match.name, hours: SESSION_HOURS } });
});

adminAnalyticsRouter.post("/auth/logout", async (c) => {
  deleteCookie(c, COOKIE, { path: "/", secure: true, sameSite: "None" });
  return c.json({ data: { ok: true } });
});

adminAnalyticsRouter.get("/auth/me", async (c) => {
  const cookie = getCookie(c, COOKIE);
  const sess = await readSession(cookie);
  if (sess) return c.json({ data: { staff: sess.staff, exp: sess.exp } });
  const user = await getAuthedUser(c);
  if (user && canAccessSuperAdminPortal(user.role)) {
    return c.json({ data: { staff: user.email || user.id || "staff", exp: null } });
  }
  return c.json({ error: { message: "Unauthorized" } }, 401);
});

// ─── Date helpers ────────────────────────────────────────────────────────────
function nycNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function nycDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function startDate(days: number): string {
  const d = nycNow();
  d.setDate(d.getDate() - days + 1);
  return nycDate(d);
}

function parseRange(raw: string | undefined): number {
  const n = parseInt(raw ?? "30", 10);
  return [7, 30, 90].includes(n) ? n : 30;
}

function money(n: number | null | undefined): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function ymdAdd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m || 1) - 1, d || 1));
  const dow = dt.getUTCDay(); // 0 Sun
  const back = dow === 0 ? 6 : dow - 1;
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}

function monthStart(ymd: string): string {
  return ymd.slice(0, 7) + "-01";
}

function agingDays(posted: string, today = nycDate()): number {
  if (!posted) return 0;
  const a = Date.parse(posted.slice(0, 10) + "T12:00:00Z");
  const b = Date.parse(today + "T12:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function fmtShort(ymd: string): string {
  if (!ymd || ymd.length < 10) return ymd || "";
  const [y, m, d] = ymd.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`;
}

function weekLabelFor(monday: string): string {
  const [y, m, d] = monday.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Week of ${d} ${months[(m || 1) - 1]}`;
}

function locFrom(cc: string | undefined | null, company?: string | null): "NYC" | "Palm Beach" | "Other" {
  const s = `${cc || ""} ${company || ""}`.toLowerCase();
  if (s.includes("pb") || s.includes("palm")) return "Palm Beach";
  if (s.includes("nyc") || s.includes("ny") || s.includes("61")) return "NYC";
  return "NYC";
}

type Period = "day" | "week" | "month";

function periodWindow(period: Period): { from: string; to: string; prevFrom: string; prevTo: string; title: string; sub: string } {
  const to = nycDate();
  if (period === "day") {
    const from = to;
    const prev = ymdAdd(from, -1);
    return { from, to, prevFrom: prev, prevTo: prev, title: "Today", sub: `${fmtShort(from)} · range` };
  }
  if (period === "month") {
    const from = monthStart(to);
    const prevTo = ymdAdd(from, -1);
    const prevFrom = monthStart(prevTo);
    const title = new Date(`${from}T12:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    return { from, to, prevFrom, prevTo, title, sub: "Month to date · range" };
  }
  const from = mondayOf(to);
  const prevTo = ymdAdd(from, -1);
  const prevFrom = mondayOf(prevTo);
  return { from, to, prevFrom, prevTo, title: "This week", sub: weekLabelFor(from) };
}

async function paymentIns(from: string, to: string, limit = 100) {
  return erpList<any>("Payment Entry", {
    filters: [
      ["docstatus", "=", 1],
      ["payment_type", "=", "Receive"],
      ["posting_date", ">=", from],
      ["posting_date", "<=", to],
    ],
    fields: ["name", "party", "party_name", "paid_amount", "posting_date", "mode_of_payment", "company"],
    limit,
    order_by: "posting_date desc",
  }).catch(() => [] as any[]);
}

async function paymentOuts(from: string, to: string, limit = 100) {
  return erpList<any>("Payment Entry", {
    filters: [
      ["docstatus", "=", 1],
      ["payment_type", "=", "Pay"],
      ["posting_date", ">=", from],
      ["posting_date", "<=", to],
    ],
    fields: ["name", "party", "party_name", "paid_amount", "posting_date", "mode_of_payment", "company"],
    limit,
    order_by: "posting_date desc",
  }).catch(() => [] as any[]);
}

async function purchaseBills(from: string, to: string, limit = 100) {
  return erpList<any>("Purchase Invoice", {
    filters: [
      ["docstatus", "=", 1],
      ["posting_date", ">=", from],
      ["posting_date", "<=", to],
    ],
    fields: ["name", "supplier", "supplier_name", "grand_total", "outstanding_amount", "posting_date", "company"],
    limit,
    order_by: "posting_date desc",
  }).catch(() => [] as any[]);
}

async function openInvoices(limit = 100) {
  return erpList<any>("Sales Invoice", {
    filters: [
      ["docstatus", "=", 1],
      ["outstanding_amount", ">", 0],
    ],
    fields: [
      "name",
      "customer",
      "customer_name",
      "outstanding_amount",
      "grand_total",
      "posting_date",
      "status",
      "cost_center",
      "company",
    ],
    limit,
    order_by: "posting_date asc",
  }).catch(() => [] as any[]);
}

function invoiceRow(inv: any) {
  const aging = agingDays(inv.posting_date);
  return {
    id: inv.name,
    client: inv.customer_name || inv.customer || "—",
    meta: `${inv.name} · ${aging}d`,
    amount: money(inv.outstanding_amount),
    agingDays: aging,
  };
}

function moveFromPe(pe: any, direction: "in" | "out") {
  return {
    id: pe.name,
    name: pe.party_name || pe.party || "—",
    meta: [pe.mode_of_payment, pe.posting_date].filter(Boolean).join(" · "),
    amount: money(pe.paid_amount),
    direction,
    when: pe.posting_date,
  };
}

// ─── GET /api/admin/mix ───────────────────────────────────────────────────────
adminAnalyticsRouter.get("/mix", async (c) => {
  const days = parseRange(c.req.query("range"));
  const from = startDate(days);
  const to = nycDate();

  try {
    const invoices = await erpList<any>("Sales Invoice", {
      filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
      fields: ["name"],
      limit: 100,
    });

    if (!invoices.length) {
      return c.json({ data: { range: days, from, to, totalQty: 0, totalAmount: 0, breakdown: [] } });
    }

    const invoiceNames = invoices.map((i: any) => i.name);
    const items = await erpList<any>("Sales Invoice Item", {
      filters: [["parent", "in", invoiceNames]],
      fields: ["item_name", "item_group", "qty", "amount"],
      limit: 100,
      parent: "Sales Invoice",
    });

    const byGroup: Record<string, { qty: number; amount: number }> = {};
    for (const row of items) {
      const key = row.item_group || row.item_name || "Other";
      if (!byGroup[key]) byGroup[key] = { qty: 0, amount: 0 };
      byGroup[key]!.qty += row.qty ?? 1;
      byGroup[key]!.amount += row.amount ?? 0;
    }

    const breakdown = Object.entries(byGroup)
      .map(([name, v]) => ({ name, qty: v.qty, amount: money(v.amount) }))
      .sort((a, b) => b.qty - a.qty);

    const totalQty = breakdown.reduce((s, r) => s + r.qty, 0);
    const totalAmount = breakdown.reduce((s, r) => s + r.amount, 0);

    return c.json({
      data: { range: days, from, to, totalQty, totalAmount: money(totalAmount), breakdown },
    });
  } catch (_) {
    return c.json({ data: { range: days, from, to, totalQty: 0, totalAmount: 0, breakdown: [] } });
  }
});

// ─── GET /api/admin/buying ────────────────────────────────────────────────────
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

    const bySupplier: Record<string, number> = {};
    for (const b of bills) {
      bySupplier[b.supplier] = (bySupplier[b.supplier] ?? 0) + (b.grand_total ?? 0);
    }
    const supplierBreakdown = Object.entries(bySupplier)
      .map(([supplier, amount]) => ({ supplier, amount: money(amount) }))
      .sort((a, b) => b.amount - a.amount);

    return c.json({
      data: {
        range: days,
        from,
        to,
        openPOs: pos.length,
        totalPOValue: money(totalPOValue),
        totalBilled: money(totalBilled),
        totalOutstanding: money(totalOutstanding),
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
  } catch (_err: any) {
    return c.json({ data: { range: days, from, to, openPOs: 0, totalPOValue: 0, totalBilled: 0, totalOutstanding: 0, pos: [], bills: [], supplierBreakdown: [] } });
  }
});

// ─── GET /api/admin/sales ─────────────────────────────────────────────────────
adminAnalyticsRouter.get("/sales", async (c) => {
  const days = parseRange(c.req.query("range"));
  const from = startDate(days);
  const to = nycDate();

  try {
    const invoices = await erpList<any>("Sales Invoice", {
      filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
      fields: ["name", "customer", "grand_total", "outstanding_amount", "posting_date", "sales_team"],
      limit: 100,
    });

    const totalRevenue = invoices.reduce((s: number, i: any) => s + (i.grand_total ?? 0), 0);
    const totalOutstanding = invoices.reduce((s: number, i: any) => s + (i.outstanding_amount ?? 0), 0);

    const byClient: Record<string, number> = {};
    for (const inv of invoices) {
      byClient[inv.customer] = (byClient[inv.customer] ?? 0) + (inv.grand_total ?? 0);
    }
    const topClients = Object.entries(byClient)
      .map(([customer, amount]) => ({ customer, amount: money(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15);

    const byDate: Record<string, number> = {};
    for (const inv of invoices) {
      const d = inv.posting_date as string;
      byDate[d] = (byDate[d] ?? 0) + (inv.grand_total ?? 0);
    }
    const trend = Object.entries(byDate)
      .map(([date, amount]) => ({ date, amount: money(amount) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return c.json({
      data: {
        range: days,
        from,
        to,
        totalRevenue: money(totalRevenue),
        totalOutstanding: money(totalOutstanding),
        invoiceCount: invoices.length,
        topClients,
        trend,
        salesPersons: [],
      },
    });
  } catch (_err: any) {
    return c.json({ data: { range: days, from, to, totalRevenue: 0, totalOutstanding: 0, invoiceCount: 0, topClients: [], trend: [], salesPersons: [] } });
  }
});

// ─── GET /api/admin/costs ─────────────────────────────────────────────────────
adminAnalyticsRouter.get("/costs", async (c) => {
  const days = parseRange(c.req.query("range"));
  const from = startDate(days);
  const to = nycDate();

  try {
    const [invoices, bills] = await Promise.all([
      erpList<any>("Sales Invoice", {
        filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
        fields: ["grand_total", "posting_date"],
        limit: 100,
      }),
      erpList<any>("Purchase Invoice", {
        filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
        fields: ["supplier", "grand_total", "posting_date"],
        limit: 100,
      }),
    ]);

    const totalRevenue = invoices.reduce((s: number, i: any) => s + (i.grand_total ?? 0), 0);
    const totalCost = bills.reduce((s: number, b: any) => s + (b.grand_total ?? 0), 0);
    // Honest: only report margin when both sides have rows. Empty → 0, never a fake %.
    const grossMargin = invoices.length && bills.length && totalRevenue > 0
      ? ((totalRevenue - totalCost) / totalRevenue) * 100
      : 0;

    const bySupplier: Record<string, number> = {};
    for (const b of bills) {
      bySupplier[b.supplier] = (bySupplier[b.supplier] ?? 0) + (b.grand_total ?? 0);
    }
    const costBreakdown = Object.entries(bySupplier)
      .map(([supplier, amount]) => ({ supplier, amount: money(amount) }))
      .sort((a, b) => b.amount - a.amount);

    const revenueByMonth: Record<string, number> = {};
    for (const i of invoices) {
      const m = String(i.posting_date || "").substring(0, 7);
      if (m) revenueByMonth[m] = (revenueByMonth[m] ?? 0) + (i.grand_total ?? 0);
    }
    const costByMonth: Record<string, number> = {};
    for (const b of bills) {
      const m = String(b.posting_date || "").substring(0, 7);
      if (m) costByMonth[m] = (costByMonth[m] ?? 0) + (b.grand_total ?? 0);
    }
    const months = [...new Set([...Object.keys(revenueByMonth), ...Object.keys(costByMonth)])].sort();
    const monthlyComparison = months.map((m) => ({
      month: m,
      revenue: money(revenueByMonth[m] ?? 0),
      cost: money(costByMonth[m] ?? 0),
    }));

    return c.json({
      data: {
        range: days,
        from,
        to,
        totalRevenue: money(totalRevenue),
        totalCost: money(totalCost),
        grossMargin: Math.round(grossMargin * 10) / 10,
        costBreakdown,
        monthlyComparison,
      },
    });
  } catch (_err: any) {
    return c.json({ data: { range: days, from, to, totalRevenue: 0, totalCost: 0, grossMargin: 0, costBreakdown: [], monthlyComparison: [] } });
  }
});

// ─── GET /api/admin/locations ─────────────────────────────────────────────────
adminAnalyticsRouter.get("/locations", async (c) => {
  const days = parseRange(c.req.query("range"));
  const from = startDate(days);
  const to = nycDate();

  try {
    const [invoices, orders] = await Promise.all([
      erpList<any>("Sales Invoice", {
        filters: [["docstatus", "=", 1], ["posting_date", ">=", from], ["posting_date", "<=", to]],
        fields: ["grand_total", "outstanding_amount", "cost_center", "posting_date", "company"],
        limit: 100,
      }),
      erpList<any>("Sales Order", {
        filters: [["docstatus", "=", 1], ["transaction_date", ">=", from], ["transaction_date", "<=", to]],
        fields: ["grand_total", "cost_center", "status", "company"],
        limit: 100,
      }),
    ]);

    const locs: Record<string, { revenue: number; outstanding: number; orders: number }> = {
      NYC: { revenue: 0, outstanding: 0, orders: 0 },
      "Palm Beach": { revenue: 0, outstanding: 0, orders: 0 },
      Other: { revenue: 0, outstanding: 0, orders: 0 },
    };

    for (const inv of invoices) {
      const loc = locFrom(inv.cost_center, inv.company);
      locs[loc]!.revenue += inv.grand_total ?? 0;
      locs[loc]!.outstanding += inv.outstanding_amount ?? 0;
    }

    for (const so of orders) {
      const loc = locFrom(so.cost_center, so.company);
      locs[loc]!.orders += 1;
    }

    const locations = Object.entries(locs)
      .filter(([, v]) => v.revenue > 0 || v.orders > 0)
      .map(([name, v]) => ({
        name,
        revenue: money(v.revenue),
        outstanding: money(v.outstanding),
        orders: v.orders,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const totalRevenue = locations.reduce((s, l) => s + l.revenue, 0);

    return c.json({
      data: {
        range: days,
        from,
        to,
        totalRevenue: money(totalRevenue),
        locations,
      },
    });
  } catch (_err: any) {
    return c.json({ data: { range: days, from, to, totalRevenue: 0, locations: [] } });
  }
});

// ─── MONEY (PWA) ─────────────────────────────────────────────────────────────
adminAnalyticsRouter.get("/money", async (c) => {
  const to = nycDate();
  const from = mondayOf(to);
  const lastFrom = mondayOf(ymdAdd(from, -1));
  const lastTo = ymdAdd(from, -1);

  const [ins, lastIns, outstanding] = await Promise.all([
    paymentIns(from, to),
    paymentIns(lastFrom, lastTo),
    openInvoices(),
  ]);

  const collected = ins.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const lastCollected = lastIns.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const deltaPct = lastCollected > 0 ? Math.round(((collected - lastCollected) / lastCollected) * 1000) / 10 : null;

  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const thisByDow = [0, 0, 0, 0, 0, 0, 0];
  const lastByDow = [0, 0, 0, 0, 0, 0, 0];
  const spark: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = ymdAdd(from, i);
    if (d > to) {
      spark.push(0);
      continue;
    }
    const sum = ins.filter((r) => r.posting_date === d).reduce((s, r) => s + Number(r.paid_amount || 0), 0);
    thisByDow[i] = sum;
    spark.push(money(sum));
  }
  for (let i = 0; i < 7; i++) {
    const d = ymdAdd(lastFrom, i);
    lastByDow[i] = lastIns.filter((r) => r.posting_date === d).reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  }

  const outstandingTotal = outstanding.reduce((s, r) => s + Number(r.outstanding_amount || 0), 0);
  const rows = [...outstanding]
    .sort((a, b) => Number(b.outstanding_amount || 0) - Number(a.outstanding_amount || 0))
    .slice(0, 8)
    .map(invoiceRow);

  return c.json({
    data: {
      weekLabel: weekLabelFor(from),
      collectedThisWeek: money(collected),
      collected: money(collected),
      deltaPct,
      spark,
      bars: days.map((day, i) => ({ day, thisWeek: money(thisByDow[i]!), lastWeek: money(lastByDow[i]!) })),
      outstandingTotal: money(outstandingTotal),
      outstanding: rows,
      invoices: rows,
    },
  });
});

adminAnalyticsRouter.get("/money/outstanding", async (c) => {
  const outstanding = await openInvoices();
  const total = outstanding.reduce((s, r) => s + Number(r.outstanding_amount || 0), 0);
  const rows = [...outstanding]
    .sort((a, b) => Number(b.outstanding_amount || 0) - Number(a.outstanding_amount || 0))
    .map(invoiceRow);
  return c.json({ data: { total: money(total), rows, invoices: rows } });
});

adminAnalyticsRouter.get("/money/invoices/:id", async (c) => {
  const id = c.req.param("id");
  const inv = await erpGet<any>("Sales Invoice", id);
  if (!inv) {
    return c.json({ data: { id, client: "—", note: "Invoice not found.", outstanding: null, agingDays: null, issued: null, lines: [] } });
  }
  const items = Array.isArray(inv.items) ? inv.items : [];
  const lines = items.map((it: any) => ({
    label: it.item_name || it.description || it.item_code || "Line",
    amount: money(it.amount),
  }));
  const aging = agingDays(inv.posting_date);
  const loc = locFrom(inv.cost_center, inv.company);
  return c.json({
    data: {
      id: inv.name,
      client: inv.customer_name || inv.customer || "—",
      note: [lines.map((l: any) => l.label).slice(0, 2).join(" + "), loc].filter(Boolean).join(" · ") || "Unpaid invoice",
      outstanding: money(inv.outstanding_amount),
      agingDays: aging,
      issued: inv.posting_date ? fmtShort(inv.posting_date) : null,
      lines,
    },
  });
});

adminAnalyticsRouter.get("/money/range", async (c) => {
  const raw = (c.req.query("period") || "week").toLowerCase();
  const period: Period = raw === "day" || raw === "month" ? raw : "week";
  const w = periodWindow(period);
  const [ins, outs, bills, prevIns, prevOuts] = await Promise.all([
    paymentIns(w.from, w.to),
    paymentOuts(w.from, w.to),
    purchaseBills(w.from, w.to),
    paymentIns(w.prevFrom, w.prevTo),
    paymentOuts(w.prevFrom, w.prevTo),
  ]);
  const inTotal = ins.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const outPe = outs.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const outBills = bills.reduce((s, r) => s + Number(r.grand_total || 0), 0);
  const outTotal = outPe > 0 ? outPe : outBills;
  const net = inTotal - outTotal;
  const prevIn = prevIns.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const prevOutPe = prevOuts.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const prevNet = prevIn - prevOutPe;
  let deltaLabel: string | null = null;
  if (prevNet !== 0) {
    const pct = Math.round(((net - prevNet) / Math.abs(prevNet)) * 100);
    deltaLabel = `${pct >= 0 ? "+" : ""}${pct}% vs prior`;
  }

  const spark: number[] = [];
  const days = Math.max(1, Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86400000) + 1);
  const cap = Math.min(days, 31);
  for (let i = 0; i < cap; i++) {
    const d = ymdAdd(w.from, i);
    if (d > w.to) break;
    const dayIn = ins.filter((r) => r.posting_date === d).reduce((s, r) => s + Number(r.paid_amount || 0), 0);
    spark.push(money(dayIn));
  }

  const moves = [
    ...ins.slice(0, 12).map((pe) => moveFromPe(pe, "in")),
    ...outs.slice(0, 12).map((pe) => moveFromPe(pe, "out")),
  ].sort((a, b) => String(b.when).localeCompare(String(a.when)));

  const weekBars = period === "month"
    ? [0, 1, 2, 3].map((i) => {
        const start = ymdAdd(w.from, i * 7);
        const end = ymdAdd(start, 6);
        const h = ins
          .filter((r) => r.posting_date >= start && r.posting_date <= end && r.posting_date <= w.to)
          .reduce((s, r) => s + Number(r.paid_amount || 0), 0);
        return { label: `W${i + 1}`, h: money(h) };
      })
    : undefined;

  return c.json({
    data: {
      period,
      title: w.title,
      sub: w.sub,
      inTotal: money(inTotal),
      in: money(inTotal),
      outTotal: money(outTotal),
      out: money(outTotal),
      net: money(net),
      deltaLabel,
      spark,
      moves,
      rollup: { in: money(inTotal), out: money(outTotal), net: money(net) },
      weekBars,
    },
  });
});

adminAnalyticsRouter.get("/money/ins", async (c) => {
  const w = periodWindow("week");
  const ins = await paymentIns(w.from, w.to);
  const rows = ins.map((pe) => moveFromPe(pe, "in"));
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return c.json({ data: { rows, moves: rows, total: money(total) } });
});

adminAnalyticsRouter.get("/money/outs", async (c) => {
  const w = periodWindow("week");
  const [outs, bills] = await Promise.all([paymentOuts(w.from, w.to), purchaseBills(w.from, w.to)]);
  const peRows = outs.map((pe) => moveFromPe(pe, "out" as const));
  const billRows = peRows.length
    ? []
    : bills.map((b) => ({
        id: b.name,
        name: b.supplier_name || b.supplier || "—",
        meta: `Bill · ${b.posting_date}`,
        amount: money(b.grand_total),
        direction: "out" as const,
        when: b.posting_date,
      }));
  const rows = peRows.length ? peRows : billRows;
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return c.json({ data: { rows, moves: rows, total: money(total) } });
});

// ─── WORK ────────────────────────────────────────────────────────────────────
const READY_STATES = ["Ready", "Ready for Pickup"];
const DONE_STATES = ["Cancelled", "Picked Up", "Completed", "Closed"];

function jobStatus(state: string, due?: string): "late" | "shop" | "ready" | "other" {
  if (READY_STATES.includes(state)) return "ready";
  const today = nycDate();
  if (due && due < today && !DONE_STATES.includes(state)) return "late";
  if (!DONE_STATES.includes(state)) return "shop";
  return "other";
}

adminAnalyticsRouter.get("/work", async (c) => {
  const today = nycDate();
  const [tickets, orders] = await Promise.all([
    erpList<any>("Alteration Ticket", {
      filters: [["workflow_state", "not in", ["Cancelled", "Picked Up"]]],
      fields: [
        "name",
        "customer",
        "customer_name",
        "workflow_state",
        "promised_date",
        "due_date",
        "origin",
        "ticket_total",
      ],
      limit: 100,
      order_by: "modified desc",
    }).catch(() => [] as any[]),
    erpList<any>("Sales Order", {
      filters: [
        ["docstatus", "=", 1],
        ["status", "not in", ["Cancelled", "Completed", "Closed"]],
        ["delivery_date", "<", today],
      ],
      fields: ["name", "customer", "customer_name", "status", "delivery_date", "company", "po_no"],
      limit: 100,
      order_by: "delivery_date asc",
    }).catch(() => [] as any[]),
  ]);

  const ready = tickets.filter((t) => READY_STATES.includes(String(t.workflow_state)));
  const inShop = tickets.filter((t) => !READY_STATES.includes(String(t.workflow_state)));
  const factoryLate = orders;

  const jobs = [
    ...factoryLate.slice(0, 2).map((o) => ({
      id: o.name,
      name: o.customer_name || o.customer || "—",
      meta: [o.po_no || o.name, o.delivery_date ? `due ${fmtShort(o.delivery_date)}` : null].filter(Boolean).join(" · "),
      status: "late" as const,
      statusLabel: "Late",
      where: "Factory",
    })),
    ...inShop.slice(0, 2).map((t) => ({
      id: t.name,
      name: t.customer_name || t.customer || "—",
      meta: [t.workflow_state, t.origin].filter(Boolean).join(" · "),
      status: "shop" as const,
      statusLabel: String(t.workflow_state || "Shop"),
      where: "Shop Floor",
    })),
    ...ready.slice(0, 2).map((t) => ({
      id: t.name,
      name: t.customer_name || t.customer || "—",
      meta: [t.name, "desk"].filter(Boolean).join(" · "),
      status: "ready" as const,
      statusLabel: "Ready",
      where: locFrom(t.origin, null) === "Palm Beach" ? "PB" : "NYC",
    })),
  ].slice(0, 6);

  const now = nycNow();
  const pill = `${now.toLocaleString("en-US", { weekday: "short" })} ${now.getDate()}`;

  return c.json({
    data: {
      sub: "Floor + factory · today",
      pill,
      factoryLate: factoryLate.length,
      inShop: inShop.length,
      ready: ready.length,
      jobs,
    },
  });
});

adminAnalyticsRouter.get("/work/factory-late", async (c) => {
  const today = nycDate();
  const orders = await erpList<any>("Sales Order", {
    filters: [
      ["docstatus", "=", 1],
      ["status", "not in", ["Cancelled", "Completed", "Closed"]],
      ["delivery_date", "<", today],
    ],
    fields: ["name", "customer", "customer_name", "status", "delivery_date", "po_no"],
    limit: 100,
    order_by: "delivery_date asc",
  }).catch(() => [] as any[]);
  const rows = orders.map((o) => ({
    id: o.name,
    name: o.customer_name || o.customer || "—",
    meta: [o.po_no || o.name, o.delivery_date ? `Due ${fmtShort(o.delivery_date)}` : null].filter(Boolean).join(" · "),
    status: "late" as const,
    statusLabel: "Late",
    where: "Factory",
  }));
  return c.json({ data: { jobs: rows, rows } });
});

adminAnalyticsRouter.get("/work/ready", async (c) => {
  const tickets = await erpList<any>("Alteration Ticket", {
    filters: [["workflow_state", "in", READY_STATES]],
    fields: ["name", "customer", "customer_name", "workflow_state", "origin"],
    limit: 100,
    order_by: "modified desc",
  }).catch(() => [] as any[]);
  const rows = tickets.map((t) => ({
    id: t.name,
    name: t.customer_name || t.customer || "—",
    meta: [t.name, "desk"].join(" · "),
    status: "ready" as const,
    statusLabel: "Ready",
    where: locFrom(t.origin, null) === "Palm Beach" ? "PB" : "NYC",
  }));
  return c.json({ data: { jobs: rows, rows } });
});

adminAnalyticsRouter.get("/work/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const ticket = await erpGet<any>("Alteration Ticket", id);
  if (ticket) {
    const due = ticket.promised_date || ticket.due_date || null;
    const state = String(ticket.workflow_state || "");
    return c.json({
      data: {
        id: ticket.name,
        title: ticket.customer_name || ticket.customer || "Job",
        sub: ticket.name,
        client: ticket.customer_name || ticket.customer || "—",
        note: [state, ticket.origin].filter(Boolean).join(" · "),
        garment: ticket.garment_type || ticket.item_name || null,
        stage: state || null,
        due: due ? fmtShort(due) : null,
        where: locFrom(ticket.origin, null),
        status: jobStatus(state, due),
      },
    });
  }
  const so = await erpGet<any>("Sales Order", id);
  if (so) {
    const due = so.delivery_date || null;
    return c.json({
      data: {
        id: so.name,
        title: so.customer_name || so.customer || "Job",
        sub: so.name,
        client: so.customer_name || so.customer || "—",
        note: so.status || "",
        garment: so.po_no || null,
        stage: so.status || null,
        due: due ? fmtShort(due) : null,
        where: "Factory",
        status: jobStatus(String(so.status || ""), due),
      },
    });
  }
  return c.json({
    data: {
      id,
      title: "Job",
      sub: id,
      client: "—",
      note: "Not found.",
      garment: null,
      stage: null,
      due: null,
      where: null,
      status: "",
    },
  });
});

// ─── CLIENTS ─────────────────────────────────────────────────────────────────
adminAnalyticsRouter.get("/clients", async (c) => {
  const filter = (c.req.query("filter") || "owes").toLowerCase();
  const outstanding = await openInvoices();
  const byCust = new Map<string, { id: string; name: string; amount: number; oldest: string; invoices: number }>();
  for (const inv of outstanding) {
    const id = String(inv.customer || inv.name);
    const cur = byCust.get(id) || {
      id,
      name: inv.customer_name || inv.customer || "—",
      amount: 0,
      oldest: inv.posting_date,
      invoices: 0,
    };
    cur.amount += Number(inv.outstanding_amount || 0);
    cur.invoices += 1;
    if (inv.posting_date && inv.posting_date < cur.oldest) cur.oldest = inv.posting_date;
    byCust.set(id, cur);
  }
  const owes = [...byCust.values()].sort((a, b) => b.amount - a.amount);

  let vip: any[] = [];
  if (filter === "vip") {
    vip = await erpList<any>("Customer", {
      filters: [["custom_vip_tier", "not in", ["Standard", ""]]],
      fields: ["name", "customer_name", "custom_vip_tier", "custom_lst_division"],
      limit: 100,
    }).catch(() => [] as any[]);
  }

  let quiet: any[] = [];
  if (filter === "quiet") {
    const cutoff = ymdAdd(nycDate(), -56);
    quiet = await erpList<any>("Customer", {
      filters: [["modified", "<", cutoff]],
      fields: ["name", "customer_name", "modified", "custom_lst_division"],
      limit: 100,
      order_by: "modified asc",
    }).catch(() => [] as any[]);
  }

  const clients =
    filter === "vip"
      ? vip.map((r) => ({
          id: r.name,
          name: r.customer_name || r.name,
          meta: r.custom_vip_tier || "VIP",
          kind: "vip" as const,
          endLabel: "VIP",
          endSub: locFrom(r.custom_lst_division, null) === "Palm Beach" ? "PB" : "NYC",
          amount: null,
        }))
      : filter === "quiet"
        ? quiet.map((r) => ({
            id: r.name,
            name: r.customer_name || r.name,
            meta: r.modified ? `Last ${fmtShort(String(r.modified).slice(0, 10))}` : "Quiet",
            kind: "quiet" as const,
            endLabel: "Quiet",
            endSub: locFrom(r.custom_lst_division, null) === "Palm Beach" ? "PB" : "NYC",
            amount: null,
          }))
        : owes.map((r) => ({
            id: r.id,
            name: r.name,
            meta: `Open ${r.invoices} · ${agingDays(r.oldest)} days`,
            kind: "owes" as const,
            endLabel: "Owes",
            endSub: "",
            amount: money(r.amount),
          }));

  return c.json({
    data: {
      sub: "Who needs a look",
      filters: [
        { id: "owes", label: "Owes", count: owes.length },
        { id: "quiet", label: "Quiet", count: filter === "quiet" ? quiet.length : null },
        { id: "vip", label: "VIP", count: filter === "vip" ? vip.length : null },
      ],
      activeFilter: filter,
      sectionTitle: filter === "owes" ? "Owes" : filter === "quiet" ? "Quiet" : "VIP",
      clients,
    },
  });
});

adminAnalyticsRouter.get("/clients/:id", async (c) => {
  const id = c.req.param("id");
  const cust = await erpGet<any>("Customer", id);
  const invoices = await erpList<any>("Sales Invoice", {
    filters: [["customer", "=", id], ["docstatus", "=", 1]],
    fields: ["name", "outstanding_amount", "grand_total", "posting_date", "status"],
    limit: 100,
    order_by: "posting_date desc",
  }).catch(() => [] as any[]);
  const open = invoices.filter((i) => Number(i.outstanding_amount || 0) > 0.005);
  const lifetime = invoices.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  const openBalance = open.reduce((s, i) => s + Number(i.outstanding_amount || 0), 0);
  const last = invoices[0]?.posting_date || null;
  const loc = locFrom(cust?.custom_lst_division || cust?.territory, cust?.company);
  return c.json({
    data: {
      id: cust?.name || id,
      name: cust?.customer_name || cust?.name || id,
      location: loc,
      lifetime: invoices.length ? money(lifetime) : null,
      openBalance: money(openBalance),
      lastVisit: last ? fmtShort(last) : null,
      lastVisitShort: last ? fmtShort(last) : null,
      openItems: open.map((i) => ({
        id: i.name,
        name: i.name,
        meta: `${agingDays(i.posting_date)} days`,
        end: `$${money(i.outstanding_amount).toLocaleString("en-US")}`,
        endSub: i.status || "Open",
      })),
    },
  });
});

// ─── HOUSE ───────────────────────────────────────────────────────────────────
function apptRow(a: any) {
  const when = String(a.scheduled_time || a.starts_on || "");
  const hhmm = when.slice(11, 16);
  const name = a.customer_name || a.subject || "—";
  return {
    id: a.name,
    name: hhmm ? `${hhmm} · ${name}` : name,
    meta: a.custom_appointment_type || a.status || "",
    who: a.assigned_agent || "",
    dur: "",
  };
}

adminAnalyticsRouter.get("/house", async (c) => {
  const today = nycDate();
  const [appts, ready, late] = await Promise.all([
    erpList<any>("Appointment", {
      filters: [
        ["scheduled_time", ">=", `${today} 00:00:00`],
        ["scheduled_time", "<=", `${today} 23:59:59`],
      ],
      fields: [
        "name",
        "scheduled_time",
        "status",
        "assigned_agent",
        "customer_name",
        "custom_appointment_type",
        "company",
      ],
      limit: 100,
      order_by: "scheduled_time asc",
    }).catch(() => [] as any[]),
    erpList<any>("Alteration Ticket", {
      filters: [["workflow_state", "in", READY_STATES]],
      fields: ["name", "customer_name", "customer", "origin"],
      limit: 100,
    }).catch(() => [] as any[]),
    erpList<any>("Sales Order", {
      filters: [
        ["docstatus", "=", 1],
        ["status", "not in", ["Cancelled", "Completed", "Closed"]],
        ["delivery_date", "<", today],
      ],
      fields: ["name", "customer_name", "customer", "delivery_date"],
      limit: 40,
    }).catch(() => [] as any[]),
  ]);

  const nycBook = appts.filter((a) => locFrom(null, a.company) !== "Palm Beach");
  const pbBook = appts.filter((a) => locFrom(null, a.company) === "Palm Beach");
  const flags = [
    ...late.slice(0, 5).map((o) => ({
      id: o.name,
      title: `${o.customer_name || o.customer || "Order"} late`,
      meta: o.delivery_date ? `Due ${fmtShort(o.delivery_date)}` : o.name,
    })),
    ...ready.slice(0, 5).map((t) => ({
      id: t.name,
      title: `${t.customer_name || t.customer || "Ticket"} at desk`,
      meta: `${t.name} ready · not collected`,
    })),
  ].slice(0, 8);

  const now = nycNow();
  const pill = now.toLocaleString("en-US", { weekday: "long", day: "numeric", month: "short" });

  return c.json({
    data: {
      sub: "Two shops",
      pill,
      shops: [
        {
          id: "nyc",
          city: "NYC",
          statHtml: `${nycBook.length} on the book<br><strong>Open</strong> · 61st`,
          on: true,
        },
        {
          id: "palm-beach",
          city: "Palm Beach",
          statHtml: pbBook.length ? `${pbBook.length} on the book` : "Quiet today<br><strong>Closed book</strong>",
          on: pbBook.length > 0,
        },
      ],
      bookTitle: "Today’s book · NYC",
      book: nycBook.slice(0, 8).map(apptRow),
      flags,
    },
  });
});

adminAnalyticsRouter.get("/house/shops/:id", async (c) => {
  const id = c.req.param("id");
  const pb = id === "palm-beach" || id === "pb";
  const city = pb ? "Palm Beach" : "NYC";
  const today = nycDate();
  const [appts, ready] = await Promise.all([
    erpList<any>("Appointment", {
      filters: [
        ["scheduled_time", ">=", `${today} 00:00:00`],
        ["scheduled_time", "<=", `${today} 23:59:59`],
      ],
      fields: [
        "name",
        "scheduled_time",
        "status",
        "assigned_agent",
        "customer_name",
        "custom_appointment_type",
        "company",
      ],
      limit: 100,
      order_by: "scheduled_time asc",
    }).catch(() => [] as any[]),
    erpList<any>("Alteration Ticket", {
      filters: [["workflow_state", "in", READY_STATES]],
      fields: ["name", "customer_name", "origin"],
      limit: 100,
    }).catch(() => [] as any[]),
  ]);
  const book = appts.filter((a) => (locFrom(null, a.company) === "Palm Beach") === pb);
  const alts = ready.filter((t) => (locFrom(t.origin, null) === "Palm Beach") === pb);
  return c.json({
    data: {
      id: pb ? "palm-beach" : "nyc",
      city,
      sub: `Shop-day · ${fmtShort(today)}`,
      live: !pb,
      appointments: book.length,
      altsReady: alts.length,
      openFlags: 0,
      shop: pb ? "Palm Beach" : "138 East 61st",
      bookLabel: `${book.length} on the book`,
      altsLabel: `${alts.length} ready`,
      extraLabel: pb ? "Flags" : "Palm Beach",
      extraValue: "—",
      book: book.map(apptRow),
      flags: alts.slice(0, 6).map((t) => ({
        id: t.name,
        title: `${t.customer_name || "Ticket"} ready`,
        meta: t.name,
      })),
      emptyFlagsNote: alts.length ? undefined : "No live flags.",
    },
  });
});

adminAnalyticsRouter.get("/house/flags/:id", async (c) => {
  const id = c.req.param("id");
  const ticket = await erpGet<any>("Alteration Ticket", id);
  if (ticket) {
    return c.json({
      data: {
        id: ticket.name,
        title: ticket.name,
        sub: "House flag · read-only",
        flagTitle: `${ticket.customer_name || ticket.customer || "Ticket"} at desk`,
        flagMeta: `${ticket.workflow_state || ""} · not collected`,
        client: ticket.customer_name || ticket.customer || "—",
        clientNote: ticket.origin || "",
        fields: [
          { k: "Ticket", v: ticket.name },
          { k: "State", v: String(ticket.workflow_state || "") },
        ],
        note: "Flag only. No edit, no complete.",
      },
    });
  }
  const so = await erpGet<any>("Sales Order", id);
  if (so) {
    return c.json({
      data: {
        id: so.name,
        title: so.name,
        sub: "House flag · read-only",
        flagTitle: `${so.customer_name || so.customer || "Order"} late`,
        flagMeta: so.delivery_date ? `Due ${fmtShort(so.delivery_date)}` : so.status,
        client: so.customer_name || so.customer || "—",
        clientNote: so.status || "",
        fields: [
          { k: "Order", v: so.name },
          { k: "Due", v: so.delivery_date || "—" },
        ],
        note: "Flag only. No edit, no complete.",
      },
    });
  }
  return c.json({
    data: {
      id,
      title: id,
      sub: "House flag · read-only",
      flagTitle: "Flag",
      flagMeta: "Not found",
      client: "—",
      clientNote: "",
      fields: [],
      note: "Flag only. No edit, no complete.",
    },
  });
});
