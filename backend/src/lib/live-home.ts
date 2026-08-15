/**
 * Live home payload — visual layer on top of Prompt-1 COUNTs.
 *
 * Integers on the dashboard come from `getAltsMetrics()` (erpCount).
 * Lists here are names, cards, sparklines — never badge sources.
 */

import { erpList, isAltsOrigin } from "./erp";
import { DT } from "./erpnext/doctypes";
import { storeDayAvailability } from "./booking/store-hours";
import { getAltsMetrics } from "./metrics";
import { qcResultOf } from "./qc";
import {
  addDaysIso,
  formatNyClock,
  hoursAgoNySql,
  nyMinutesFromMidnight,
  nyTodayIso,
  parseErpDateMs,
  weekStartMonday,
} from "./shop-time";
import type {
  AltsMetrics,
  LiveActivity,
  LiveAging,
  LiveException,
  LiveHome,
  LiveRailMark,
} from "../types";

const TERMINAL = new Set(["picked up", "cancelled", "canceled", "delivered", "closed", "completed", "paid"]);

export function isTerminalStatus(status?: string | null): boolean {
  const s = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ");
  return TERMINAL.has(s);
}

export function daysOverdue(due: string | undefined, today: string): number {
  if (!due) return 0;
  const a = Date.parse(`${due.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

export function agingBucket(days: number): keyof LiveAging {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function emptyAging(): LiveAging {
  return { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
}

export function weekDeltaPct(week: number, last: number): number {
  if (!last && !week) return 0;
  if (!last) return 100;
  return Math.round(((week - last) / last) * 100);
}

const KIND_RANK: Record<LiveException["kind"], number> = {
  overdue: 0,
  invoice_90: 1,
  qc_fail: 2,
  unanswered_text: 3,
  stalled: 4,
  qc_wait: 5,
};

export function rankExceptions(items: LiveException[], max = 8): LiveException[] {
  return [...items]
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "urgent" ? -1 : 1;
      const kr = KIND_RANK[a.kind] - KIND_RANK[b.kind];
      if (kr) return kr;
      return a.rank - b.rank;
    })
    .slice(0, max)
    .map((item, i) => ({ ...item, rank: i }));
}

function firstName(full?: string | null): string {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  return parts[0] || "Client";
}

function shortName(full?: string | null): string {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "Client";
  if (parts.length === 2) return parts.join(" ");
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
}

function initialSurname(full?: string | null): string {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Client";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]![0]}. ${parts[parts.length - 1]}`;
}

function locBucket(origin?: string | null): "nyc" | "hou" {
  const v = String(origin || "").toUpperCase();
  if (v.includes("HOU") || v.includes("HOUSTON")) return "hou";
  return "nyc";
}

function minutesFromErp(raw?: string | null): number {
  if (!raw) return 12 * 60;
  const m = String(raw).match(/(\d{1,2}):(\d{2})/);
  if (!m) return 12 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function moneyShort(n: number): string {
  if (Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  }
  return `$${Math.round(n)}`;
}

function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  return p.catch(() => fallback);
}

type TicketRow = {
  name: string;
  customer_name?: string;
  workflow_state?: string;
  due_date?: string;
  due_time?: string;
  assigned_tailor?: string;
  origin_location?: string;
  notified_ready_at?: string | null;
  modified?: string;
  creation?: string;
  lsh_delay_reason?: string | null;
  ticket_total?: number;
};

type InvoiceRow = {
  name: string;
  customer_name?: string;
  outstanding_amount?: number;
  posting_date?: string;
  due_date?: string;
  grand_total?: number;
};

type DeliveryRow = {
  name: string;
  lsh_status?: string;
  lsh_delivered_at?: string | null;
  lsh_scheduled_at?: string | null;
  customer_name?: string;
  modified?: string;
};

type EventRow = {
  name: string;
  subject?: string;
  starts_on?: string;
  ends_on?: string;
  status?: string;
};

type QcRow = {
  name: string;
  customer_name?: string;
  qc_result?: string;
  result?: string;
  modified?: string;
  creation?: string;
  garment_summary?: string;
};

type SmsRow = {
  name: string;
  client_phone?: string;
  client_name?: string;
  direction?: string;
  content?: string;
  body?: string;
  timestamp?: string;
  creation?: string;
};

type CustomRow = {
  name: string;
  origin_location?: string;
  status?: string;
  order_status?: string;
  order_total?: number;
  grand_total?: number;
};

export async function getLiveHome(opts?: {
  today?: string;
  now?: Date;
  metrics?: AltsMetrics;
}): Promise<LiveHome> {
  const now = opts?.now ?? new Date();
  const today = opts?.today ?? nyTodayIso(now);
  const metrics = opts?.metrics ?? (await getAltsMetrics({ today }));
  const floor = metrics.floor ?? {
    overdue: 0,
    due_today: 0,
    ready: 0,
    in_progress: 0,
    at_home: 0,
    stalled_48h: 0,
    ready_not_texted: 0,
    invoices_90: 0,
  };

  const weekStart = weekStartMonday(today);
  const lastWeekStart = addDaysIso(weekStart, -7);
  const lastWeekEnd = addDaysIso(weekStart, -1);
  const sparkStart = addDaysIso(today, -6);
  const stalledBefore = hoursAgoNySql(48, now);
  const qcWaitBefore = hoursAgoNySql(24, now);
  const textBefore = hoursAgoNySql(4, now);
  const hours = storeDayAvailability(today);
  const openMin = hours.open ? (hours.ranges[0]?.startMin ?? 9 * 60) : 9 * 60;
  const closeMin = hours.open ? (hours.ranges[0]?.endMin ?? 18 * 60) : 18 * 60;
  const nowMin = nyMinutesFromMidnight(now);

  const [
    tickets,
    invoices,
    deliveries,
    appointments,
    qcRows,
    smsRows,
    siRev,
    customOrders,
    lastGarment,
    lastCustomer,
  ] = await Promise.all([
    settled(
      erpList<TicketRow>("Alteration Ticket", {
        filters: [["workflow_state", "!=", "Cancelled"]],
        fields: [
          "name",
          "customer_name",
          "workflow_state",
          "due_date",
          "due_time",
          "assigned_tailor",
          "origin_location",
          "notified_ready_at",
          "modified",
          "creation",
          "lsh_delay_reason",
          "ticket_total",
        ],
        limit: 400,
        order_by: "modified desc",
      }),
      [],
    ),
    settled(
      erpList<InvoiceRow>("Sales Invoice", {
        filters: [
          ["docstatus", "=", 1],
          ["outstanding_amount", ">", 0],
        ],
        fields: ["name", "customer_name", "outstanding_amount", "posting_date", "due_date", "grand_total"],
        limit: 500,
        order_by: "posting_date asc",
      }),
      [],
    ),
    settled(
      erpList<DeliveryRow>("LSH Delivery", {
        fields: ["name", "lsh_status", "lsh_delivered_at", "lsh_scheduled_at", "customer_name", "modified"],
        limit: 200,
        order_by: "modified desc",
      }),
      [],
    ),
    settled(
      erpList<EventRow>("Event", {
        filters: [
          ["google_calendar", "=", "L&S Appointments"],
          ["status", "!=", "Cancelled"],
          ["starts_on", ">=", `${today} 00:00:00`],
          ["starts_on", "<=", `${today} 23:59:59`],
        ],
        fields: ["name", "subject", "starts_on", "ends_on", "status"],
        limit: 80,
        order_by: "starts_on asc",
      }),
      [],
    ),
    settled(
      erpList<QcRow>(DT.QC_INSPECTION, {
        filters: [["qc_result", "in", ["Pending", "Fail"]]],
        fields: ["name", "customer_name", "qc_result", "result", "modified", "creation", "garment_summary"],
        limit: 80,
        order_by: "modified desc",
      }),
      [],
    ),
    settled(
      erpList<SmsRow>(DT.SMS_MESSAGE, {
        fields: [
          "name",
          "client_phone",
          "client_name",
          "direction",
          "content",
          "body",
          "timestamp",
          "creation",
        ],
        limit: 120,
        order_by: "timestamp desc",
      }),
      [],
    ),
    settled(
      erpList<{ name: string; grand_total?: number; posting_date?: string }>("Sales Invoice", {
        filters: [
          ["docstatus", "=", 1],
          ["posting_date", ">=", lastWeekStart],
          ["posting_date", "<=", today],
        ],
        fields: ["name", "grand_total", "posting_date"],
        limit: 1000,
        order_by: "posting_date asc",
      }),
      [],
    ),
    settled(
      erpList<CustomRow>(DT.CUSTOM_ORDER, {
        filters: [["status", "not in", ["Delivered", "Cancelled", "Complete"]]],
        fields: ["name", "origin_location", "status", "order_status", "order_total"],
        limit: 400,
        order_by: "modified desc",
      }),
      [],
    ),
    settled(
      erpList<{
        parent?: string;
        garment_type?: string;
        completed_by?: string;
        completed_at?: string;
      }>("Alteration Ticket Garment", {
        parent: "Alteration Ticket",
        filters: [["completed_at", "is", "set"]],
        fields: ["parent", "garment_type", "completed_by", "completed_at"],
        limit: 8,
        order_by: "completed_at desc",
      }),
      [],
    ),
    settled(
      erpList<{ name: string; customer_name?: string; modified?: string }>("Customer", {
        filters: [["disabled", "=", 0]],
        fields: ["name", "customer_name", "modified"],
        limit: 1,
        order_by: "modified desc",
      }),
      [],
    ),
  ]);

  const nycTickets = tickets.filter((t) => isAltsOrigin(t.origin_location));
  const openTickets = nycTickets.filter((t) => !isTerminalStatus(t.workflow_state));

  const exceptions: LiveException[] = [];

  for (const t of openTickets) {
    const due = String(t.due_date || "").slice(0, 10);
    if (due && due < today) {
      const days = daysOverdue(due, today);
      exceptions.push({
        id: `overdue:${t.name}`,
        kind: "overdue",
        severity: "urgent",
        name: shortName(t.customer_name || t.name),
        number: `${days}d`,
        icon: "⏱",
        href: `/shop-floor?filter=overdue&focus=${encodeURIComponent(t.name)}`,
        action: "open",
        subtitle: t.workflow_state || "Open",
        rank: -days,
      });
    }
    const modified = t.modified || "";
    if (modified && modified < stalledBefore) {
      exceptions.push({
        id: `stalled:${t.name}`,
        kind: "stalled",
        severity: "attention",
        name: shortName(t.customer_name || t.name),
        number: "48h+",
        icon: "🪡",
        href: `/shop-floor?focus=${encodeURIComponent(t.name)}`,
        action: "open",
        subtitle: t.assigned_tailor || t.lsh_delay_reason || "No movement",
        rank: parseErpDateMs(modified) || 0,
      });
    }
  }

  for (const q of qcRows) {
    const result = qcResultOf(q as Record<string, unknown>);
    const who = shortName(q.customer_name || q.name);
    if (result === "Fail") {
      exceptions.push({
        id: `qcfail:${q.name}`,
        kind: "qc_fail",
        severity: "urgent",
        name: who,
        number: "Fail",
        icon: "◎",
        href: `/qc/${encodeURIComponent(q.name)}`,
        action: "open",
        subtitle: q.garment_summary || "QC",
        rank: parseErpDateMs(q.modified) || 0,
      });
    } else if (result === "Pending") {
      const stamp = q.modified || q.creation || "";
      if (stamp && stamp < qcWaitBefore) {
        exceptions.push({
          id: `qcwait:${q.name}`,
          kind: "qc_wait",
          severity: "attention",
          name: who,
          number: "24h+",
          icon: "◎",
          href: `/qc/${encodeURIComponent(q.name)}`,
          action: "open",
          subtitle: "Waiting QC",
          rank: parseErpDateMs(stamp) || 0,
        });
      }
    }
  }

  const byPhone = new Map<string, SmsRow[]>();
  for (const m of smsRows) {
    const phone = m.client_phone || "unknown";
    const arr = byPhone.get(phone) ?? [];
    arr.push(m);
    byPhone.set(phone, arr);
  }
  for (const [phone, msgs] of byPhone) {
    const last = msgs[0];
    if (!last) continue;
    const dir = String(last.direction || "").toLowerCase();
    if (dir !== "inbound" && dir !== "received") continue;
    const stamp = last.timestamp || last.creation || "";
    if (!stamp || stamp >= textBefore) continue;
    const hours = Math.max(4, Math.round((now.getTime() - (parseErpDateMs(stamp) || now.getTime())) / 3600_000));
    exceptions.push({
      id: `sms:${last.name}`,
      kind: "unanswered_text",
      severity: hours >= 8 ? "urgent" : "attention",
      name: shortName(last.client_name || phone),
      number: `${hours}h`,
      icon: "✉",
      href: `/messages?phone=${encodeURIComponent(phone)}`,
      action: "text",
      subtitle: String(last.content || last.body || "").slice(0, 42),
      rank: -(parseErpDateMs(stamp) || 0),
    });
  }

  const nowMs = now.getTime();
  const aging = emptyAging();
  let oldestUnpaidDays: number | null = null;
  let oldestUnpaidInvoiceId: string | null = null;
  for (const inv of invoices) {
    const anchor = inv.posting_date || inv.due_date;
    const days = anchor
      ? Math.max(0, Math.floor((nowMs - Date.parse(`${anchor.slice(0, 10)}T12:00:00Z`)) / 86_400_000))
      : 0;
    const bucket = agingBucket(days);
    aging[bucket] += Number(inv.outstanding_amount) || 0;
    if (oldestUnpaidDays == null || days > oldestUnpaidDays) {
      oldestUnpaidDays = days;
      oldestUnpaidInvoiceId = inv.name || null;
    }
    if (days > 90) {
      exceptions.push({
        id: `inv90:${inv.name}`,
        kind: "invoice_90",
        severity: "urgent",
        name: shortName(inv.customer_name || inv.name),
        number: moneyShort(Number(inv.outstanding_amount) || 0),
        icon: "✉",
        href: `/invoices/${encodeURIComponent(inv.name)}`,
        action: "charge",
        subtitle: `${days}d · ${inv.name}`,
        rank: -days,
      });
    }
  }
  for (const k of Object.keys(aging) as (keyof LiveAging)[]) {
    aging[k] = Math.round(aging[k] * 100) / 100;
  }

  const ranked = rankExceptions(exceptions);

  const dueOuts: LiveRailMark[] = openTickets
    .filter((t) => String(t.due_date || "").slice(0, 10) === today)
    .slice(0, 16)
    .map((t) => ({
      id: t.name,
      minutes: minutesFromErp(t.due_time) || closeMin - 30,
      label: firstName(t.customer_name || t.name),
      href: `/shop-floor?filter=today&focus=${encodeURIComponent(t.name)}`,
      kind: "due_out" as const,
    }));

  const apptMarks: LiveRailMark[] = appointments.map((ev) => ({
    id: ev.name,
    minutes: minutesFromErp(ev.starts_on),
    label: firstName((ev.subject || "").replace(/^[^:]+:\s*/, "").split(/[—–-]/)[0] || ev.subject || "Appt"),
    href: `/appointments?focus=${encodeURIComponent(ev.name)}`,
    kind: "appointment" as const,
  }));

  const delivMarks: LiveRailMark[] = deliveries
    .filter((d) => {
      const st = (d.lsh_status || "").toLowerCase();
      const when = String(d.lsh_scheduled_at || d.lsh_delivered_at || "").slice(0, 10);
      return (st === "queued" || st === "out for delivery" || st === "scheduled") && (!when || when === today);
    })
    .slice(0, 12)
    .map((d) => ({
      id: d.name,
      minutes: minutesFromErp(d.lsh_scheduled_at) || openMin + 90,
      label: firstName(d.customer_name || d.name),
      href: `/deliveries`,
      kind: "delivery" as const,
    }));

  const nextAppt = [...appointments]
    .filter((ev) => minutesFromErp(ev.starts_on) >= nowMin - 5)
    .sort((a, b) => minutesFromErp(a.starts_on) - minutesFromErp(b.starts_on))[0]
    ?? appointments[0];

  let nextApptGlimpse: { time: string; type: string; client: string } | null = null;
  if (nextAppt) {
    const sub = nextAppt.subject || "Appointment";
    const typeMatch = sub.match(/\b(Fitting|Consult|Pickup|Drop.?off|Alteration)\b/i);
    const client = sub.replace(/^[A-Za-z]+:\s*/, "").split(/[—–-]/)[0]?.trim() || sub;
    const mins = minutesFromErp(nextAppt.starts_on);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    nextApptGlimpse = {
      time: `${h % 12 || 12}:${String(m).padStart(2, "0")}`,
      type: typeMatch?.[1] || "Appt",
      client: initialSurname(client),
    };
  }

  const sparkDays: string[] = [];
  for (let i = 6; i >= 0; i--) sparkDays.push(addDaysIso(today, -i));
  const sparkMap = new Map(sparkDays.map((d) => [d, 0]));
  let weekRev = 0;
  let lastWeekRev = 0;
  let revToday = 0;
  for (const row of siRev) {
    const day = String(row.posting_date || "").slice(0, 10);
    const amt = Number(row.grand_total) || 0;
    if (sparkMap.has(day)) sparkMap.set(day, (sparkMap.get(day) ?? 0) + amt);
    if (day === today) revToday += amt;
    if (day >= weekStart && day <= today) weekRev += amt;
    if (day >= lastWeekStart && day <= lastWeekEnd) lastWeekRev += amt;
  }
  const revSpark = sparkDays.map((d) => Math.round((sparkMap.get(d) ?? 0) * 100) / 100);
  revToday = Math.round(revToday * 100) / 100;
  weekRev = Math.round(weekRev * 100) / 100;
  lastWeekRev = Math.round(lastWeekRev * 100) / 100;

  const pipeline = { nyc: 0, hou: 0, total: 0 };
  for (const t of tickets) {
    if (isTerminalStatus(t.workflow_state)) continue;
    const amt = Number(t.ticket_total) || 0;
    pipeline[locBucket(t.origin_location)] += amt;
  }
  for (const o of customOrders) {
    const st = String(o.status || o.order_status || "");
    if (isTerminalStatus(st)) continue;
    const amt = Number(o.order_total ?? o.grand_total) || 0;
    pipeline[locBucket(o.origin_location)] += amt;
  }
  pipeline.nyc = Math.round(pipeline.nyc * 100) / 100;
  pipeline.hou = Math.round(pipeline.hou * 100) / 100;
  pipeline.total = Math.round((pipeline.nyc + pipeline.hou) * 100) / 100;

  const tailorMap = new Map<string, { name: string; inProgress: number; stalled: number }>();
  let lateTransferCount = 0;
  const lateNames: string[] = [];
  const stalledReasons: Record<string, number> = {};
  let newest: TicketRow | null = null;
  for (const t of openTickets) {
    const st = t.workflow_state || "";
    const tailor = (t.assigned_tailor || "").trim();
    if (tailor && (st === "In Progress" || st === "Received")) {
      const row = tailorMap.get(tailor) ?? { name: firstName(tailor), inProgress: 0, stalled: 0 };
      row.inProgress += 1;
      if ((t.modified || "") < stalledBefore) row.stalled += 1;
      tailorMap.set(tailor, row);
    }
    if (tailor && st !== "Ready" && t.due_date && t.due_date < today) {
      lateTransferCount += 1;
      const cn = (t.customer_name || t.name || "").trim();
      if (cn && !lateNames.includes(cn) && lateNames.length < 3) lateNames.push(cn);
    }
    if (t.lsh_delay_reason) {
      stalledReasons[t.lsh_delay_reason] = (stalledReasons[t.lsh_delay_reason] ?? 0) + 1;
    }
    if (!newest || (t.creation || "") > (newest.creation || "")) newest = t;
  }

  const readyTickets = openTickets.filter((t) => t.workflow_state === "Ready");
  const pickupNames = readyTickets.slice(0, 3).map((t) => ({
    name: shortName(t.customer_name || t.name),
    texted: Boolean(t.notified_ready_at),
    ticket: t.name,
  }));

  const inboundUnread = [...byPhone.values()].filter((msgs) => {
    const last = msgs[0];
    const dir = String(last?.direction || "").toLowerCase();
    return dir === "inbound" || dir === "received";
  });
  const latestUnread = inboundUnread[0]?.[0] ?? null;

  const g0 = lastGarment[0];
  const lastProgress = g0?.completed_at
    ? {
        workerName: firstName(g0.completed_by || "Tailor"),
        garmentLabel: String(g0.garment_type || "garment").split(/\s+/)[0] || "garment",
        completedAt: g0.completed_at,
        ticket: g0.parent,
      }
    : null;
  const cust0 = lastCustomer[0];

  const weekPass = metrics.qc.passed + metrics.qc.failed;
  const passRateWeek = weekPass > 0 ? Math.round((metrics.qc.passed / weekPass) * 100) : 100;

  const activity: LiveActivity[] = [];
  for (const t of nycTickets.slice(0, 12)) {
    activity.push({
      id: `t:${t.name}:${t.modified}`,
      at: formatNyClock(t.modified) || "—",
      atIso: t.modified || t.creation || today,
      text: `${t.workflow_state || "Update"} · ${initialSurname(t.customer_name || t.name)}`,
      href: `/lookup?q=${encodeURIComponent(t.name)}`,
    });
  }
  for (const q of qcRows.slice(0, 6)) {
    const result = qcResultOf(q as Record<string, unknown>);
    if (result !== "Pass" && result !== "Fail") continue;
    activity.push({
      id: `q:${q.name}`,
      at: formatNyClock(q.modified) || "—",
      atIso: q.modified || q.creation || today,
      text: `QC ${result === "Pass" ? "passed" : "failed"} · ${initialSurname(q.customer_name || q.name)}`,
      href: `/qc/${encodeURIComponent(q.name)}`,
    });
  }
  for (const inv of siRev.slice(-8)) {
    const day = String(inv.posting_date || "").slice(0, 10);
    if (day !== today) continue;
    activity.push({
      id: `p:${inv.name}`,
      at: "Paid",
      atIso: `${day}T12:00:00`,
      text: `Paid ${moneyShort(Number(inv.grand_total) || 0)} · Invoice ${inv.name.replace(/^SINV-?/i, "")}`,
      href: `/invoices/${encodeURIComponent(inv.name)}`,
    });
  }
  for (const m of smsRows.slice(0, 6)) {
    if (String(m.direction || "").toLowerCase() !== "inbound") continue;
    activity.push({
      id: `s:${m.name}`,
      at: formatNyClock(m.timestamp || m.creation) || "—",
      atIso: m.timestamp || m.creation || today,
      text: `Text from ${m.client_phone || m.client_name || "client"}`,
      href: `/messages?phone=${encodeURIComponent(m.client_phone || "")}`,
    });
  }
  activity.sort((a, b) => (parseErpDateMs(b.atIso) || 0) - (parseErpDateMs(a.atIso) || 0));

  const pendingBoard = metrics.deliveries.queued + metrics.deliveries.out;

  return {
    generated_at: new Date().toISOString(),
    today,
    syncedAt: Date.now(),
    location: "NYC",
    metrics,
    strip: {
      overdue: floor.overdue,
      dueToday: floor.due_today,
      outForDelivery: metrics.deliveries.out,
      deliveredToday: metrics.deliveries.delivered_today,
    },
    counts: {
      open: metrics.open_alterations,
      ready: floor.ready,
      inProgress: floor.in_progress,
      atHome: floor.at_home,
      readyNotTexted: floor.ready_not_texted,
      pendingBoard,
      openGarments: metrics.open_alterations,
      openInvoices: metrics.invoices.unpaid_count,
      openInvoicesAmount: metrics.invoices.unpaid_total,
      oldestUnpaidDays,
      oldestUnpaidInvoiceId,
      lateTransferCount,
      stalledCount: floor.stalled_48h,
      doubleBookedSlots: 0,
    },
    feeds: {
      lastTicket: newest
        ? {
            name: newest.name,
            customerName: newest.customer_name || newest.name,
            createdAt: newest.creation || newest.modified || null,
          }
        : null,
      lastProgress,
      lastTouchedCustomer: cust0
        ? { name: cust0.customer_name || cust0.name, modified: cust0.modified || null }
        : null,
      lateTransferNames: lateNames,
      stalledReasons,
      conflictDetails: [],
    },
    exceptions: ranked,
    todayRail: {
      openMin,
      closeMin,
      nowMin,
      shopOpen: hours.open && nowMin >= openMin && nowMin < closeMin,
      appointments: apptMarks,
      dueOuts,
      deliveries: delivMarks,
      chips: {
        comingIn: appointments.length,
        mustLeave: floor.due_today,
        readyPickup: floor.ready,
        readyAllTexted: floor.ready_not_texted === 0,
      },
    },
    money: {
      revToday,
      revSpark,
      weekRev,
      lastWeekRev,
      weekDeltaPct: weekDeltaPct(weekRev, lastWeekRev),
      arTotal: metrics.invoices.unpaid_total,
      arAging: aging,
      pipeline,
    },
    glimpses: {
      floor: {
        tailors: [...tailorMap.values()].sort((a, b) => b.inProgress - a.inProgress).slice(0, 6),
        stalled: floor.stalled_48h,
      },
      pickup: { names: pickupNames, ready: floor.ready },
      messages: {
        sender: latestUnread ? shortName(latestUnread.client_name || latestUnread.client_phone) : null,
        preview: latestUnread ? String(latestUnread.content || latestUnread.body || "").slice(0, 48) : null,
        unread: inboundUnread.length,
      },
      invoices: { unpaid: metrics.invoices.unpaid_count, aging },
      deliveries: {
        queued: metrics.deliveries.queued,
        out: metrics.deliveries.out,
        deliveredToday: metrics.deliveries.delivered_today,
      },
      appointments: { next: nextApptGlimpse },
      tasks: {
        open: metrics.tasks.open,
        yesterdayOpen: metrics.tasks.yesterday_open ?? metrics.tasks.open,
        trend: metrics.tasks.trend ?? "flat",
      },
      qc: { waiting: metrics.qc.waiting, passRateWeek },
    },
    activity: activity.slice(0, 20),
  };
}
