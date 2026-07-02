// Open YongZheng (YZ) Helpdesk tickets from ERPNext (HD Ticket doctype).
// Reads tickets assigned to the YongZheng agent group, computes days-open and
// escalation server-side, and returns them for the dashboard widget.

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import { YZTicket, YZOrder, YZProductionStatus, YZProductionBrief } from "../types";
import type { YZAttentionFlag } from "../types";
import { summarizeProduction } from "../lib/ai";

export const yzRouter = new Hono();

const ERP_TICKET_BASE = "https://erp.lstailors.com/app/hd-ticket";
const ERP_YZ_BASE = "https://erp.lstailors.com/app/yz-production-tracker";

interface ErpHdTicket {
  name: string;
  subject: string | null;
  status: string | null;
  priority: string | null;
  lsh_mtm_pro_order: string | null;
  lsh_yz_order_no: string | null;
  creation: string;
  _assign: string | null;
}

// ERPNext stores _assign as a JSON-array string, e.g. '["a@x.com","b@x.com"]'.
function parseAssignees(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

yzRouter.get("/open-tickets", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const rows = await erpList<ErpHdTicket>("HD Ticket", {
    filters: [
      ["agent_group", "=", "YongZheng"],
      ["status", "!=", "Closed"],
    ],
    fields: ["name", "subject", "status", "priority", "lsh_mtm_pro_order", "lsh_yz_order_no", "creation", "_assign"],
    order_by: "creation asc",
    limit: 0,
  }).catch(() => []);

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const tickets = rows.map((r) => {
    const created = new Date(r.creation).getTime();
    const daysOpen = Number.isFinite(created) ? Math.floor((now - created) / DAY_MS) : 0;
    const proOrder = r.lsh_mtm_pro_order || null;
    const yzOrderNo = r.lsh_yz_order_no || null;
    const escalate = daysOpen >= 3 && r.status !== "Resolved";

    return YZTicket.parse({
      name: r.name,
      subject: r.subject ?? null,
      status: r.status ?? null,
      priority: r.priority ?? null,
      orderId: proOrder ?? yzOrderNo ?? null,
      proOrder,
      yzOrderNo,
      creation: r.creation,
      assignees: parseAssignees(r._assign),
      daysOpen,
      escalate,
      url: `${ERP_TICKET_BASE}/${encodeURIComponent(r.name)}`,
    });
  });

  return c.json({ data: tickets });
});

// ─── YZ Production Tracker (Shop Floor) ─────────────────────────────────────
// All production orders pulled live from ERPNext. Booleans normalized from
// 0/1, empty status defaulted, deep link computed. Sorted by planned ship
// date ascending (nulls last) so the shop floor sees what ships next.

interface ErpYZOrder {
  name: string;
  order_no: string | null;
  production_status: string | null;
  customer_name: string | null;
  customer: string | null;
  mtmpro_order: string | null;
  fabric_number: string | null;
  process_category: string | null;
  garment_summary: string | null;
  total_pieces: number | null;
  qty_suit_coat: number | null;
  qty_suit_pant: number | null;
  qty_suit_vest: number | null;
  qty_overcoat: number | null;
  qty_shirt: number | null;
  qty_tux_coat: number | null;
  qty_tux_pant: number | null;
  qty_tux_vest: number | null;
  date_received: string | null;
  date_placed: string | null;
  ship_date_planned: string | null;
  rush_days: number | null;
  embroidery_name: string | null;
  embroidery_qty: number | null;
  tracking_no: string | null;
  customs_flag: string | null;
  delivery_manner: string | null;
  solid_fabric: number | null;
  fully_lined: number | null;
  half_canvas: number | null;
  basted_note: string | null;
  comment: string | null;
  remarks: string | null;
}

const YZ_FIELDS = [
  "name", "order_no", "production_status", "customer_name", "customer",
  "mtmpro_order", "fabric_number", "process_category", "garment_summary",
  "total_pieces", "qty_suit_coat", "qty_suit_pant", "qty_suit_vest",
  "qty_overcoat", "qty_shirt", "qty_tux_coat", "qty_tux_pant", "qty_tux_vest",
  "date_received", "date_placed", "ship_date_planned", "rush_days",
  "embroidery_name", "embroidery_qty", "tracking_no", "customs_flag",
  "delivery_manner", "solid_fabric", "fully_lined", "half_canvas",
  "basted_note", "comment", "remarks",
];

const VALID_STATUS = new Set(YZProductionStatus.options as readonly string[]);

// Blank/unknown status → "In Production" (old records have null status).
function normalizeStatus(raw: string | null): YZProductionStatus {
  const s = (raw ?? "").trim();
  return VALID_STATUS.has(s) ? (s as YZProductionStatus) : "In Production";
}

function num(v: number | null): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// ERPNext returns empty Data fields as "" — collapse to null for a clean UI.
function str(v: string | null): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

// ── Attention flags ─────────────────────────────────────────────────────────
// Rule-based enrichment computed server-side so every consumer (page + brief)
// agrees on what "needs attention". Dates are YYYY-MM-DD; string compare is safe.

const STALE_FABRIC_DAYS = 21;
const SHIPPED_OR_DONE = new Set(["Shipped", "Canceled"]);

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysStr(base: string, days: number): string {
  const p = base.split("-").map(Number);
  const dt = new Date(Date.UTC(p[0] ?? 1970, (p[1] ?? 1) - 1, (p[2] ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

interface OrderCore {
  production_status: YZProductionStatus;
  ship_date_planned: string | null;
  date_received: string | null;
  rush_days: number;
}

function computeAttention(o: OrderCore, today: string): YZAttentionFlag[] {
  const flags: YZAttentionFlag[] = [];
  const active = !SHIPPED_OR_DONE.has(o.production_status);
  const isRush = o.rush_days > 0 || o.production_status === "Rush";

  if (active && o.ship_date_planned && o.ship_date_planned < today) {
    flags.push({ code: "overdue", label: "Overdue", severity: "high" });
  }

  if (o.production_status === "Fabric Not Received" && o.date_received) {
    const days = daysBetween(o.date_received, today);
    if (days >= STALE_FABRIC_DAYS) {
      flags.push({ code: "stale_fabric", label: `Fabric awaited ${days}d`, severity: "high" });
    }
  }

  if (isRush && active) {
    const overdue = !!o.ship_date_planned && o.ship_date_planned < today;
    const soon = !!o.ship_date_planned && o.ship_date_planned <= addDaysStr(today, 3);
    if (overdue || soon || !o.ship_date_planned) {
      flags.push({ code: "rush_at_risk", label: "Rush at risk", severity: "high" });
    }
  }

  if (active && o.production_status !== "Fabric Not Received" && !o.ship_date_planned) {
    flags.push({ code: "no_ship_date", label: "No ship date", severity: "medium" });
  }

  return flags;
}

// Fetch + normalize + enrich all YZ production orders. Shared by both endpoints.
async function fetchYZOrders(): Promise<YZOrder[]> {
  const rows = await erpList<ErpYZOrder>("YZ Production Tracker", {
    fields: YZ_FIELDS,
    order_by: "ship_date_planned asc",
    limit: 500,
  }).catch(() => []);

  const today = todayStr();

  return rows.map((r) => {
    const production_status = normalizeStatus(r.production_status);
    const ship_date_planned = str(r.ship_date_planned);
    const date_received = str(r.date_received);
    const rush_days = num(r.rush_days);
    const attention = computeAttention(
      { production_status, ship_date_planned, date_received, rush_days },
      today,
    );

    return YZOrder.parse({
      name: r.name,
      order_no: str(r.order_no) ?? r.name,
      production_status,
      customer_name: str(r.customer_name),
      customer: str(r.customer),
      mtmpro_order: str(r.mtmpro_order),
      fabric_number: str(r.fabric_number),
      process_category: str(r.process_category),
      garment_summary: str(r.garment_summary),
      total_pieces: num(r.total_pieces),
      qty_suit_coat: num(r.qty_suit_coat),
      qty_suit_pant: num(r.qty_suit_pant),
      qty_suit_vest: num(r.qty_suit_vest),
      qty_overcoat: num(r.qty_overcoat),
      qty_shirt: num(r.qty_shirt),
      qty_tux_coat: num(r.qty_tux_coat),
      qty_tux_pant: num(r.qty_tux_pant),
      qty_tux_vest: num(r.qty_tux_vest),
      date_received,
      date_placed: str(r.date_placed),
      ship_date_planned,
      rush_days,
      embroidery_name: str(r.embroidery_name),
      embroidery_qty: num(r.embroidery_qty),
      tracking_no: str(r.tracking_no),
      customs_flag: str(r.customs_flag),
      delivery_manner: str(r.delivery_manner),
      solid_fabric: num(r.solid_fabric) === 1,
      fully_lined: num(r.fully_lined) === 1,
      half_canvas: num(r.half_canvas) === 1,
      basted_note: str(r.basted_note),
      comment: str(r.comment),
      remarks: str(r.remarks),
      erpUrl: `${ERP_YZ_BASE}/${encodeURIComponent(r.name)}`,
      attention,
    });
  });
}

yzRouter.get("/production", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const orders = await fetchYZOrders();
  return c.json({ data: orders });
});

// ── AI production brief ─────────────────────────────────────────────────────
// Deterministic stats + prioritized attention list, plus an AI-written headline.
// The headline degrades gracefully to "" if the AI gateway is unavailable, so
// the banner still shows the (accurate) structured data.

const ACTIVE_STATUSES = new Set(["In Production", "Rush", "On Pause", "Fabric Not Received"]);
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1 };

yzRouter.get("/production/brief", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const orders = await fetchYZOrders();
  const today = todayStr();
  const weekEnd = addDaysStr(today, 7);

  let active = 0, rush = 0, shippingThisWeek = 0, overdue = 0, attention = 0;
  for (const o of orders) {
    if (ACTIVE_STATUSES.has(o.production_status)) active++;
    if (o.rush_days > 0 || o.production_status === "Rush") rush++;
    if (o.ship_date_planned && o.ship_date_planned >= today && o.ship_date_planned <= weekEnd) shippingThisWeek++;
    if (o.attention.some((f) => f.code === "overdue")) overdue++;
    if (o.attention.length > 0) attention++;
  }

  // Prioritize: highest-severity flag first, then earliest ship date.
  const rank = (s: "high" | "medium") => SEVERITY_RANK[s] ?? 9;

  const flagged = orders
    .filter((o) => o.attention.length > 0)
    .map((o) => {
      const severity: "high" | "medium" = o.attention.some((f) => f.severity === "high")
        ? "high"
        : "medium";
      return {
        order_no: o.order_no,
        customer_name: o.customer_name,
        reason: o.attention.map((f) => f.label).join(", "),
        severity,
        _ship: o.ship_date_planned ?? "9999-99-99",
      };
    })
    .sort((a, b) => rank(a.severity) - rank(b.severity) || a._ship.localeCompare(b._ship));

  const stats = { active, rush, shippingThisWeek, overdue, attention };
  const items = flagged.slice(0, 20).map(({ _ship, ...rest }) => rest);

  let headline = "";
  try {
    headline = await summarizeProduction({ stats, items: items.slice(0, 12) });
  } catch (err) {
    console.warn("[yz:brief] AI headline failed, returning structured only:", err);
  }

  const brief = YZProductionBrief.parse({
    generatedAt: new Date().toISOString(),
    headline,
    stats,
    items,
  });

  return c.json({ data: brief });
});
