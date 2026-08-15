// Owner Dashboard aggregate — super_admin financial overview.
// GET /api/dashboard/owner?range=30d
// Sources: Sales Invoice, Alteration Ticket (workflow_state), HD Ticket, LSH Delivery.

import { Hono } from "hono";
import { canSeeFinancials, getAuthedUser } from "../lib/scope";
import { erpList, erpCount } from "../lib/erp";
import { metricFilters } from "../lib/metrics";

export const ownerDashboardRouter = new Hono();

type RangeKey = "today" | "7d" | "30d" | "90d" | "ytd";

const RANGE_DAYS: Record<RangeKey, number | null> = {
  today: 0,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  ytd: null,
};

function nycDateISO(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

function parseRange(raw: string | undefined): {
  key: RangeKey;
  start: string;
  end: string;
  priorStart: string;
  priorEnd: string;
  label: string;
} {
  const key = (["today", "7d", "30d", "90d", "ytd"].includes(raw ?? "")
    ? raw
    : "30d") as RangeKey;
  const end = nycDateISO();
  let start: string;
  if (key === "today") start = end;
  else if (key === "ytd") start = `${end.slice(0, 4)}-01-01`;
  else start = addDaysISO(end, -(RANGE_DAYS[key] as number) + 1);

  const days =
    key === "today"
      ? 1
      : key === "ytd"
        ? Math.max(
            1,
            Math.round(
              (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
                86_400_000,
            ) + 1,
          )
        : (RANGE_DAYS[key] as number);

  const priorEnd = addDaysISO(start, -1);
  const priorStart = addDaysISO(priorEnd, -(days - 1));

  return {
    key,
    start,
    end,
    priorStart,
    priorEnd,
    label: key.toUpperCase(),
  };
}

function locFromCompany(company: string | null | undefined): "NYC" | "HOU" | "Other" {
  const c = (company ?? "").toUpperCase();
  if (c.includes("TX") || c.includes("HOU") || c.includes("HOUSTON")) return "HOU";
  if (c.includes("NY") || c.includes("NEW YORK")) return "NYC";
  return "Other";
}

function agingBucket(postingDate: string, asOf: string): "0-30" | "31-60" | "61-90" | "90+" {
  const days = Math.max(
    0,
    Math.round(
      (Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${postingDate}T12:00:00Z`)) /
        86_400_000,
    ),
  );
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

function pctDelta(curr: number, prior: number): number {
  if (prior === 0) return curr === 0 ? 0 : 100;
  return Math.round(((curr - prior) / prior) * 100);
}

function sparklineFromDaily(map: Map<string, number>, start: string, end: string): number[] {
  const out: number[] = [];
  let cur = start;
  // Cap sparkline points at ~30 for long ranges
  const totalDays =
    Math.round(
      (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000,
    ) + 1;
  const step = totalDays > 30 ? Math.ceil(totalDays / 30) : 1;
  let i = 0;
  while (cur <= end) {
    if (i % step === 0) out.push(map.get(cur) ?? 0);
    cur = addDaysISO(cur, 1);
    i++;
    if (out.length > 40) break;
  }
  return out.length ? out : [0];
}

type SiRow = {
  name: string;
  customer: string;
  customer_name: string;
  grand_total: number;
  outstanding_amount: number;
  posting_date: string;
  status: string;
  company: string;
};

ownerDashboardRouter.get("/owner", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  // Brief: role-gated to super_admin (financial owner view). store_manager keeps /financials.
  if (user.role !== "super_admin" && !canSeeFinancials(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  if (user.role !== "super_admin") {
    return c.json({ error: { message: "Forbidden — owner dashboard is super_admin only" } }, 403);
  }

  const range = parseRange(c.req.query("range") ?? undefined);
  // Pull enough SI history for AR aging + prior period + trend (up to ~14 months)
  const historyStart = addDaysISO(range.start, -400);

  const [
    invoices,
    altTickets,
    openHd,
    hdOpenCount,
  ] = await Promise.all([
    erpList<SiRow>("Sales Invoice", {
      filters: [
        ["docstatus", "=", 1],
        ["posting_date", ">=", historyStart],
      ],
      fields: [
        "name",
        "customer",
        "customer_name",
        "grand_total",
        "outstanding_amount",
        "posting_date",
        "status",
        "company",
      ],
      limit: 5000,
      order_by: "posting_date desc",
    }).catch(() => [] as SiRow[]),
    erpList<{
      name: string;
      workflow_state: string;
      origin_location: string;
      ticket_total: number;
      payment_status: string;
      assigned_tailor: string;
      ticket_date: string;
      customer_name: string;
    }>("Alteration Ticket", {
      filters: [["workflow_state", "!=", "Cancelled"]],
      fields: [
        "name",
        "workflow_state",
        "origin_location",
        "ticket_total",
        "payment_status",
        "assigned_tailor",
        "ticket_date",
        "customer_name",
      ],
      limit: 2000,
    }).catch(() => []),
    erpList<{
      name: string;
      priority: string;
      status: string;
      _assign: string;
      subject: string;
      creation: string;
    }>("HD Ticket", {
      filters: [["status", "not in", ["Closed", "Resolved"]]],
      fields: ["name", "priority", "status", "_assign", "subject", "creation"],
      limit: 500,
      order_by: "modified desc",
    }).catch(() => []),
    erpCount("HD Ticket", metricFilters(nycDateISO()).hdOpen),
  ]);

  // ── Period SI slices ────────────────────────────────────────────────────
  const inPeriod = invoices.filter(
    (i) => i.posting_date >= range.start && i.posting_date <= range.end,
  );
  const inPrior = invoices.filter(
    (i) => i.posting_date >= range.priorStart && i.posting_date <= range.priorEnd,
  );

  const sumBilled = (rows: SiRow[]) =>
    rows.reduce((s, r) => s + Number(r.grand_total ?? 0), 0);
  const sumCollected = (rows: SiRow[]) =>
    rows.reduce(
      (s, r) => s + (Number(r.grand_total ?? 0) - Number(r.outstanding_amount ?? 0)),
      0,
    );

  const revenue = sumBilled(inPeriod);
  const collected = sumCollected(inPeriod);
  const priorRevenue = sumBilled(inPrior);
  const priorCollected = sumCollected(inPrior);

  // All open AR (any age)
  const openAr = invoices.filter((i) => Number(i.outstanding_amount ?? 0) > 0.005);
  const arOutstanding = openAr.reduce((s, r) => s + Number(r.outstanding_amount ?? 0), 0);
  // Prior AR snapshot is approximate — use open AR created in prior window remaining open
  const priorArApprox = openAr
    .filter((i) => i.posting_date <= range.priorEnd)
    .reduce((s, r) => s + Number(r.outstanding_amount ?? 0), 0);

  const avgTicket = inPeriod.length ? revenue / inPeriod.length : 0;
  const priorAvg = inPrior.length ? priorRevenue / inPrior.length : 0;
  const collectionRate = revenue > 0 ? Math.round((collected / revenue) * 1000) / 10 : 0;
  const priorCollectionRate =
    priorRevenue > 0 ? Math.round((priorCollected / priorRevenue) * 1000) / 10 : 0;

  // Daily billed sparkline
  const dailyBilled = new Map<string, number>();
  for (const r of inPeriod) {
    dailyBilled.set(
      r.posting_date,
      (dailyBilled.get(r.posting_date) ?? 0) + Number(r.grand_total ?? 0),
    );
  }
  const sparkRevenue = sparklineFromDaily(dailyBilled, range.start, range.end);

  // ── Revenue trend (monthly billed vs collected, last 6 months incl current) ──
  const now = new Date();
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  const monthMap = new Map<string, { billed: number; collected: number; count: number }>();
  for (const k of monthKeys) monthMap.set(k, { billed: 0, collected: 0, count: 0 });
  for (const r of invoices) {
    const m = (r.posting_date ?? "").slice(0, 7);
    const e = monthMap.get(m);
    if (!e) continue;
    const gt = Number(r.grand_total ?? 0);
    const out = Number(r.outstanding_amount ?? 0);
    e.billed += gt;
    e.collected += gt - out;
    e.count += 1;
  }
  const revenueTrend = monthKeys.map((k) => {
    const [y, mo] = k.split("-").map(Number);
    const label = new Date(y!, mo! - 1, 1).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });
    const e = monthMap.get(k)!;
    return { month: label, key: k, billed: e.billed, collected: e.collected, count: e.count };
  });

  // ── A/R aging ───────────────────────────────────────────────────────────
  const agingInit = {
    "0-30": { amount: 0, count: 0 },
    "31-60": { amount: 0, count: 0 },
    "61-90": { amount: 0, count: 0 },
    "90+": { amount: 0, count: 0 },
  };
  for (const r of openAr) {
    const b = agingBucket(r.posting_date, range.end);
    agingInit[b].amount += Number(r.outstanding_amount ?? 0);
    agingInit[b].count += 1;
  }
  const arAging = (["0-30", "31-60", "61-90", "90+"] as const).map((bucket) => ({
    bucket,
    amount: Math.round(agingInit[bucket].amount * 100) / 100,
    count: agingInit[bucket].count,
  }));
  const ar90plus = agingInit["90+"].amount;

  // ── Revenue by location (company → NYC/HOU) ─────────────────────────────
  const locMap = { NYC: 0, HOU: 0, Other: 0 };
  for (const r of inPeriod) {
    locMap[locFromCompany(r.company)] += Number(r.grand_total ?? 0);
  }
  const revenueByLocation = [
    { location: "NYC", amount: locMap.NYC },
    { location: "HOU", amount: locMap.HOU },
    ...(locMap.Other > 0 ? [{ location: "Other", amount: locMap.Other }] : []),
  ];

  // ── Top customers (billed last 90d fixed window per brief) ──────────────
  const top90start = addDaysISO(range.end, -89);
  const custMap = new Map<
    string,
    { customer: string; name: string; billed: number; outstanding: number; invoices: number }
  >();
  for (const r of invoices) {
    if (r.posting_date < top90start || r.posting_date > range.end) continue;
    const key = r.customer || r.customer_name || "Unknown";
    const e = custMap.get(key) ?? {
      customer: r.customer,
      name: r.customer_name || r.customer || "Unknown",
      billed: 0,
      outstanding: 0,
      invoices: 0,
    };
    e.billed += Number(r.grand_total ?? 0);
    e.outstanding += Number(r.outstanding_amount ?? 0);
    e.invoices += 1;
    custMap.set(key, e);
  }
  const topCustomers = [...custMap.values()]
    .sort((a, b) => b.billed - a.billed)
    .slice(0, 12)
    .map((c) => ({
      customer: c.customer,
      name: c.name,
      billed: Math.round(c.billed * 100) / 100,
      outstanding: Math.round(c.outstanding * 100) / 100,
      invoices: c.invoices,
    }));

  // ── Outstanding by customer ─────────────────────────────────────────────
  const arByCust = new Map<
    string,
    { customer: string; name: string; outstanding: number; invoices: number; oldest: string }
  >();
  for (const r of openAr) {
    const key = r.customer || r.customer_name || "Unknown";
    const e = arByCust.get(key) ?? {
      customer: r.customer,
      name: r.customer_name || r.customer || "Unknown",
      outstanding: 0,
      invoices: 0,
      oldest: r.posting_date,
    };
    e.outstanding += Number(r.outstanding_amount ?? 0);
    e.invoices += 1;
    if (r.posting_date < e.oldest) e.oldest = r.posting_date;
    arByCust.set(key, e);
  }
  const outstandingByCustomer = [...arByCust.values()]
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 25)
    .map((c) => {
      const oldestDays = Math.max(
        0,
        Math.round(
          (Date.parse(`${range.end}T12:00:00Z`) - Date.parse(`${c.oldest}T12:00:00Z`)) /
            86_400_000,
        ),
      );
      return {
        customer: c.customer,
        name: c.name,
        outstanding: Math.round(c.outstanding * 100) / 100,
        invoices: c.invoices,
        oldest: c.oldest,
        oldestDays,
      };
    });

  // ── Live feed (recent invoices) ─────────────────────────────────────────
  const liveFeed = [...invoices]
    .sort((a, b) => (b.posting_date || "").localeCompare(a.posting_date || "") || b.name.localeCompare(a.name))
    .slice(0, 20)
    .map((r) => {
      const out = Number(r.outstanding_amount ?? 0);
      let tone: "paid" | "open" | "overdue" = "open";
      if (out <= 0.005 || r.status === "Paid") tone = "paid";
      else if (r.status === "Overdue" || agingBucket(r.posting_date, range.end) === "90+")
        tone = "overdue";
      return {
        name: r.name,
        customer: r.customer_name || r.customer,
        amount: Number(r.grand_total ?? 0),
        outstanding: out,
        status: r.status,
        tone,
        postingDate: r.posting_date,
        location: locFromCompany(r.company),
      };
    });

  // ── Alteration pipeline (workflow_state) ────────────────────────────────
  const PIPELINE_ORDER = ["Received", "In Progress", "Ready", "Picked Up"] as const;
  const pipeMap = new Map<string, number>();
  for (const s of PIPELINE_ORDER) pipeMap.set(s, 0);
  for (const t of altTickets) {
    const ws = t.workflow_state || "Received";
    if (ws === "Cancelled") continue;
    pipeMap.set(ws, (pipeMap.get(ws) ?? 0) + 1);
  }
  const alterationPipeline = PIPELINE_ORDER.map((stage) => ({
    stage,
    count: pipeMap.get(stage) ?? 0,
  }));
  const openAlts = (pipeMap.get("Received") ?? 0) + (pipeMap.get("In Progress") ?? 0) + (pipeMap.get("Ready") ?? 0);

  // ── HD priority + workload ──────────────────────────────────────────────
  const priMap: Record<string, number> = { Urgent: 0, High: 0, Medium: 0, Low: 0 };
  let unassigned = 0;
  const agentMap = new Map<string, number>();
  for (const t of openHd) {
    const p = (t.priority || "Medium").trim();
    const key = p in priMap ? p : "Medium";
    priMap[key] = (priMap[key] ?? 0) + 1;
    const raw = (t._assign || "").trim();
    // _assign is often a JSON list string like '["user@x.com"]'
    let assignees: string[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) assignees = parsed.map(String);
        else if (typeof parsed === "string") assignees = [parsed];
      } catch {
        assignees = raw.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    if (!assignees.length) {
      unassigned += 1;
      agentMap.set("Unassigned", (agentMap.get("Unassigned") ?? 0) + 1);
    } else {
      for (const a of assignees) {
        const label = a.includes("@")
          ? a.split("@")[0]!.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
          : a;
        agentMap.set(label, (agentMap.get(label) ?? 0) + 1);
      }
    }
  }
  const ticketPriority = (["Urgent", "High", "Medium", "Low"] as const).map((p) => ({
    priority: p,
    count: priMap[p] ?? 0,
  }));
  const agentWorkload = [...agentMap.entries()]
    .map(([agent, count]) => ({ agent, count }))
    .sort((a, b) => {
      if (a.agent === "Unassigned") return -1;
      if (b.agent === "Unassigned") return 1;
      return b.count - a.count;
    });

  // ── Delivery status ─────────────────────────────────────────────────────
  // Deliveries: open board + failed flag + delivered today (not all-time Delivered)
  const todayStart = `${range.end} 00:00:00`;
  const todayEnd = `${range.end} 23:59:59`;
  const [openDels, failedDels, deliveredToday] = await Promise.all([
    erpList<{ name: string; lsh_status: string }>("LSH Delivery", {
      filters: [["lsh_status", "in", ["Queued", "Out for Delivery"]]],
      fields: ["name", "lsh_status"],
      limit: 500,
    }).catch(() => []),
    erpList<{ name: string }>("LSH Delivery", {
      filters: [["lsh_status", "=", "Failed"]],
      fields: ["name"],
      limit: 200,
    }).catch(() => []),
    erpList<{ name: string }>("LSH Delivery", {
      filters: [
        ["lsh_status", "=", "Delivered"],
        ["lsh_delivered_at", ">=", todayStart],
        ["lsh_delivered_at", "<=", todayEnd],
      ],
      fields: ["name"],
      limit: 500,
    }).catch(() => []),
  ]);
  const deliveryStatus = {
    queued: openDels.filter((d) => d.lsh_status === "Queued").length,
    outForDelivery: openDels.filter((d) => d.lsh_status === "Out for Delivery").length,
    delivered: deliveredToday.length,
    failed: failedDels.length,
  };

  // ── Alerts ──────────────────────────────────────────────────────────────
  const oldestUnpaid = openAr
    .slice()
    .sort((a, b) => (a.posting_date || "").localeCompare(b.posting_date || ""))[0];
  const highPri = (priMap.Urgent ?? 0) + (priMap.High ?? 0);
  const alerts: Array<{
    id: string;
    tone: "critical" | "warning";
    label: string;
    value: string;
    href?: string;
  }> = [];
  if (unassigned > 0 && highPri > 0) {
    alerts.push({
      id: "hd-unassigned-urgent",
      tone: "critical",
      label: "Unassigned high/urgent tickets",
      value: String(unassigned),
      href: "/helpdesk",
    });
  } else if (unassigned > 0) {
    alerts.push({
      id: "hd-unassigned",
      tone: "warning",
      label: "Unassigned tickets",
      value: String(unassigned),
      href: "/helpdesk",
    });
  }
  const ar31to90 = agingInit["31-60"].amount + agingInit["61-90"].amount;
  const ar31to90Count = agingInit["31-60"].count + agingInit["61-90"].count;
  if (ar31to90 > 0) {
    alerts.push({
      id: "deposit-ledger-31d",
      tone: "warning",
      label: "Deposit ledger >30d",
      value: `${ar31to90Count} inv · $${Math.round(ar31to90).toLocaleString("en-US")}`,
      href: "/invoices",
    });
  }
  if (ar90plus > 0) {
    alerts.push({
      id: "ar-90",
      tone: "critical",
      label: "90+ day overdue",
      value: `$${Math.round(ar90plus).toLocaleString("en-US")}`,
      href: "/invoices",
    });
  }
  if (highPri > 0) {
    alerts.push({
      id: "hd-high",
      tone: highPri >= 3 ? "critical" : "warning",
      label: "High-priority tickets",
      value: String(highPri),
      href: "/helpdesk",
    });
  }
  if (oldestUnpaid) {
    alerts.push({
      id: "oldest-unpaid",
      tone: "warning",
      label: "Oldest unpaid",
      value: `${oldestUnpaid.customer_name || oldestUnpaid.customer} · ${oldestUnpaid.posting_date}`,
      href: `/invoices/${oldestUnpaid.name}`,
    });
  }
  if (deliveryStatus.failed > 0) {
    alerts.push({
      id: "del-failed",
      tone: "critical",
      label: "Failed deliveries",
      value: String(deliveryStatus.failed),
      href: "/deliveries",
    });
  }

  // ── Payment method mix (from alt tickets square_payment_method when set) ─
  // Full SI payment mix needs Payment Entry — partial from alts for now
  const payMixMap = new Map<string, number>();
  const altWithPay = await erpList<{
    square_payment_method: string;
    ticket_total: number;
    payment_status: string;
  }>("Alteration Ticket", {
    filters: [
      ["payment_status", "=", "Paid"],
      ["ticket_date", ">=", range.start],
      ["ticket_date", "<=", range.end],
    ],
    fields: ["square_payment_method", "ticket_total", "payment_status"],
    limit: 1000,
  }).catch(() => []);
  for (const t of altWithPay) {
    const m = (t.square_payment_method || "Other").trim() || "Other";
    payMixMap.set(m, (payMixMap.get(m) ?? 0) + Number(t.ticket_total ?? 0));
  }
  const paymentMethodMix = [...payMixMap.entries()]
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);
  const paymentMixPartial = paymentMethodMix.length > 0;

  // ── Placeholders still soft ─────────────────────────────────────────────
  const placeholders = {
    appointments: {
      available: false,
      reason: "Wire Event/Appointment list in follow-up",
    },
    leadConversion: {
      available: false,
      reason: "CRM Deal uses status (not stage) — funnel next",
    },
    retentionLtv: {
      available: false,
      reason: "Needs lifetime aggregation pass",
    },
    paymentMethodMix: {
      available: paymentMixPartial,
      reason: paymentMixPartial
        ? "Partial — Square method on paid alteration tickets only"
        : "No Square method tags in period",
    },
  };

  return c.json({
    data: {
      generatedAt: new Date().toISOString(),
      range: {
        key: range.key,
        start: range.start,
        end: range.end,
        label: range.label,
        priorStart: range.priorStart,
        priorEnd: range.priorEnd,
      },
      kpis: {
        revenue: {
          value: Math.round(revenue * 100) / 100,
          deltaPct: pctDelta(revenue, priorRevenue),
          sparkline: sparkRevenue,
          href: "/invoices",
        },
        arOutstanding: {
          value: Math.round(arOutstanding * 100) / 100,
          deltaPct: pctDelta(arOutstanding, priorArApprox),
          sparkline: arAging.map((b) => b.amount),
          href: "/invoices",
        },
        openTickets: {
          value: hdOpenCount,
          deltaPct: 0,
          sparkline: ticketPriority.map((p) => p.count),
          href: "/helpdesk",
        },
        avgTicket: {
          value: Math.round(avgTicket * 100) / 100,
          deltaPct: pctDelta(avgTicket, priorAvg),
          sparkline: sparkRevenue,
          href: "/invoices",
        },
        collectionRate: {
          value: collectionRate,
          deltaPct: pctDelta(collectionRate, priorCollectionRate),
          sparkline: revenueTrend.map((m) =>
            m.billed > 0 ? Math.round((m.collected / m.billed) * 100) : 0,
          ),
          href: "/financials",
        },
      },
      alerts,
      revenueTrend,
      arAging,
      revenueByLocation,
      paymentMethodMix,
      topCustomers,
      alterationPipeline,
      openAlterations: openAlts,
      ticketPriority,
      agentWorkload,
      deliveryStatus,
      outstandingByCustomer,
      liveFeed,
      meta: {
        invoiceCountPeriod: inPeriod.length,
        openArCount: openAr.length,
        openHdCount: hdOpenCount,
      },
      placeholders,
    },
  });
});

// Floor-scoped reports for alts tablet
// GET /api/dashboard/floor-reports?location=NYC
ownerDashboardRouter.get("/floor-reports", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const locRaw = (c.req.query("location") || c.req.query("locationId") || "").toUpperCase();
  const loc =
    locRaw === "HOU" || locRaw === "HOUSTON" || locRaw === "TX"
      ? "HOU"
      : locRaw === "NYC" || locRaw === "NY" || locRaw === "NEW YORK"
        ? "NYC"
        : "";

  const today = nycDateISO();
  const weekStart = addDaysISO(today, -6);

  const altFilters: unknown[] = [["workflow_state", "!=", "Cancelled"]];
  if (loc) altFilters.push(["origin_location", "=", loc]);

  const siCompanyLike = loc === "HOU" ? "%TX%" : loc === "NYC" ? "%NY%" : null;

  const hdFilters = metricFilters(today).hdOpen;
  const [alts, hdOpenCount, hdPri, openDels, failedDels, deliveredToday, siToday, siWeek] = await Promise.all([
    erpList<{
      name: string;
      workflow_state: string;
      origin_location: string;
      ticket_total: number;
      assigned_tailor: string;
      customer_name: string;
      ticket_date: string;
      due_date: string;
      payment_status: string;
    }>("Alteration Ticket", {
      filters: altFilters,
      fields: [
        "name",
        "workflow_state",
        "origin_location",
        "ticket_total",
        "assigned_tailor",
        "customer_name",
        "ticket_date",
        "due_date",
        "payment_status",
      ],
      limit: 2000,
      order_by: "modified desc",
    }).catch(() => []),
    erpCount("HD Ticket", hdFilters),
    Promise.all([
      erpCount("HD Ticket", [...hdFilters, ["priority", "=", "Urgent"]]),
      erpCount("HD Ticket", [...hdFilters, ["priority", "=", "High"]]),
      erpCount("HD Ticket", [...hdFilters, ["priority", "=", "Medium"]]),
      erpCount("HD Ticket", [...hdFilters, ["priority", "=", "Low"]]),
    ]),
    erpList<{ name: string; lsh_status: string }>("LSH Delivery", {
      filters: [
        ["lsh_status", "in", ["Queued", "Out for Delivery"]],
        ...(loc ? [["lsh_origin_location", "=", loc] as unknown[]] : []),
      ],
      fields: ["name", "lsh_status"],
      limit: 500,
    }).catch(() => []),
    erpList<{ name: string }>("LSH Delivery", {
      filters: [
        ["lsh_status", "=", "Failed"],
        ...(loc ? [["lsh_origin_location", "=", loc] as unknown[]] : []),
      ],
      fields: ["name"],
      limit: 100,
    }).catch(() => []),
    erpList<{ name: string }>("LSH Delivery", {
      filters: [
        ["lsh_status", "=", "Delivered"],
        ["lsh_delivered_at", ">=", `${today} 00:00:00`],
        ["lsh_delivered_at", "<=", `${today} 23:59:59`],
        ...(loc ? [["lsh_origin_location", "=", loc] as unknown[]] : []),
      ],
      fields: ["name"],
      limit: 500,
    }).catch(() => []),
    erpList<{ name: string; grand_total: number }>("Sales Invoice", {
      filters: [
        ["docstatus", "=", 1],
        ["posting_date", "=", today],
        ...(siCompanyLike ? [["company", "like", siCompanyLike] as unknown[]] : []),
      ],
      fields: ["name", "grand_total"],
      limit: 500,
    }).catch(() => []),
    erpList<{ name: string; grand_total: number; posting_date: string }>("Sales Invoice", {
      filters: [
        ["docstatus", "=", 1],
        ["posting_date", ">=", weekStart],
        ["posting_date", "<=", today],
        ...(siCompanyLike ? [["company", "like", siCompanyLike] as unknown[]] : []),
      ],
      fields: ["name", "grand_total", "posting_date"],
      limit: 1000,
    }).catch(() => []),
  ]);

  const PIPELINE_ORDER = ["Received", "In Progress", "Ready", "Picked Up"] as const;
  const pipeMap = new Map<string, number>();
  for (const s of PIPELINE_ORDER) pipeMap.set(s, 0);
  const tailorMap = new Map<string, number>();
  for (const t of alts) {
    const ws = t.workflow_state || "Received";
    if (ws === "Cancelled") continue;
    pipeMap.set(ws, (pipeMap.get(ws) ?? 0) + 1);
    if (ws === "Received" || ws === "In Progress") {
      const who = (t.assigned_tailor || "Unassigned").trim() || "Unassigned";
      tailorMap.set(who, (tailorMap.get(who) ?? 0) + 1);
    }
  }

  const priMap: Record<string, number> = {
    Urgent: hdPri[0] ?? 0,
    High: hdPri[1] ?? 0,
    Medium: hdPri[2] ?? 0,
    Low: hdPri[3] ?? 0,
  };

  const del = {
    queued: openDels.filter((d) => d.lsh_status === "Queued").length,
    outForDelivery: openDels.filter((d) => d.lsh_status === "Out for Delivery").length,
    delivered: deliveredToday.length,
    failed: failedDels.length,
  };

  const revToday = siToday.reduce((s, r) => s + Number(r.grand_total ?? 0), 0);
  const revWeek = siWeek.reduce((s, r) => s + Number(r.grand_total ?? 0), 0);
  const altsToday = alts.filter((t) => t.ticket_date === today).length;

  const weekEnd = addDaysISO(today, 7);
  const openStages = new Set(["Received", "In Progress", "Ready"]);
  const aging = { overdue: 0, dueToday: 0, dueWeek: 0, later: 0 };
  const overdueTickets: Array<{
    name: string;
    customer: string;
    due: string;
    stage: string;
  }> = [];
  const throughputDays = new Map<string, number>();
  for (const t of alts) {
    if (t.ticket_date && t.ticket_date >= weekStart && t.ticket_date <= today) {
      throughputDays.set(t.ticket_date, (throughputDays.get(t.ticket_date) ?? 0) + 1);
    }
    if (!openStages.has(t.workflow_state || "")) continue;
    const due = String(t.due_date || "").slice(0, 10);
    if (!due) {
      aging.later += 1;
      continue;
    }
    if (due < today) {
      aging.overdue += 1;
      if (overdueTickets.length < 40) {
        overdueTickets.push({
          name: t.name,
          customer: t.customer_name,
          due,
          stage: t.workflow_state,
        });
      }
    } else if (due === today) aging.dueToday += 1;
    else if (due <= weekEnd) aging.dueWeek += 1;
    else aging.later += 1;
  }

  const activity = alts
    .filter((t) => t.ticket_date >= weekStart)
    .slice(0, 25)
    .map((t) => ({
      name: t.name,
      customer: t.customer_name,
      stage: t.workflow_state,
      total: Number(t.ticket_total ?? 0),
      date: t.ticket_date,
      payment: t.payment_status,
    }));

  return c.json({
    data: {
      location: loc || "ALL",
      today,
      snapshot: {
        openAlts:
          (pipeMap.get("Received") ?? 0) +
          (pipeMap.get("In Progress") ?? 0) +
          (pipeMap.get("Ready") ?? 0),
        altsToday,
        revenueToday: Math.round(revToday * 100) / 100,
        revenueWeek: Math.round(revWeek * 100) / 100,
        openHd: hdOpenCount,
        deliveriesQueued: del.queued + del.outForDelivery,
      },
      pipeline: PIPELINE_ORDER.map((stage) => ({
        stage,
        count: pipeMap.get(stage) ?? 0,
      })),
      tailorWorkload: [...tailorMap.entries()]
        .map(([tailor, count]) => ({ tailor, count }))
        .sort((a, b) => b.count - a.count),
      ticketPriority: (["Urgent", "High", "Medium", "Low"] as const).map((p) => ({
        priority: p,
        count: priMap[p] ?? 0,
      })),
      deliveryStatus: del,
      recentActivity: activity,
      aging,
      overdueTickets,
      throughput: [...throughputDays.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, count]) => ({ date, count })),
    },
  });
});
