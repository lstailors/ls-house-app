// Open YongZheng (YZ) Helpdesk tickets from ERPNext (HD Ticket doctype).
// Reads tickets assigned to the YongZheng agent group, computes days-open and
// escalation server-side, and returns them for the dashboard widget.

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import { YZTicket, YZOrder, YZProductionStatus } from "../types";

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

yzRouter.get("/production", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const rows = await erpList<ErpYZOrder>("YZ Production Tracker", {
    fields: YZ_FIELDS,
    order_by: "ship_date_planned asc",
    limit: 500,
  }).catch(() => []);

  const orders = rows.map((r) =>
    YZOrder.parse({
      name: r.name,
      order_no: str(r.order_no) ?? r.name,
      production_status: normalizeStatus(r.production_status),
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
      date_received: str(r.date_received),
      date_placed: str(r.date_placed),
      ship_date_planned: str(r.ship_date_planned),
      rush_days: num(r.rush_days),
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
    }),
  );

  return c.json({ data: orders });
});
