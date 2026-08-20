/** YZ Production Sheet mapping — same rules as lsh_house.production_sheet. */

import type { YZOrder } from "@ls/types";

export const PAGE_SIZE = 25;

export const STATUS_KEYS = ["prod", "ship", "rush", "fab", "pause", "cxl"] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

export const STATUS_LABELS: Record<StatusKey, string> = {
  prod: "In Production",
  ship: "Shipped",
  rush: "Rush",
  fab: "Awaiting Fabric",
  pause: "On Pause",
  cxl: "Canceled",
};

const RAW_STATUS_KEY: Record<string, StatusKey> = {
  "in production": "prod",
  shipped: "ship",
  rush: "rush",
  canceled: "cxl",
  cancelled: "cxl",
  "on pause": "pause",
  "fabric not received": "fab",
  "awaiting fabric": "fab",
};

const MAKE_LABELS: Record<string, string> = {
  machine: "Machine",
  "half-hand": "Half-Hand",
  "half hand": "Half-Hand",
  "full-hand": "Hand",
  "full hand": "Hand",
  hand: "Hand",
};

export const GARMENT_FIELDS = [
  ["qty_suit_coat", "Coat"],
  ["qty_suit_pant", "Trouser"],
  ["qty_suit_vest", "Vest"],
  ["qty_overcoat", "Overcoat"],
  ["qty_shirt", "Shirt"],
  ["qty_tux_coat", "Tux Coat"],
  ["qty_tux_pant", "Tux Trouser"],
  ["qty_tux_vest", "Tux Vest"],
] as const;

const SEARCH_FIELDS = [
  "order_no",
  "customer_name",
  "mtmpro_order",
  "fabric_number",
  "tracking_no",
  "garment_summary",
] as const;

export type SheetRow = {
  name: string;
  order_no: string;
  po_no: string;
  customer_name: string;
  customer: string;
  make: string;
  fabric_number: string;
  garments: Array<{ qty: number; label: string }>;
  garment_summary: string;
  total_pieces: number;
  date_received: string | null;
  date_placed: string | null;
  ship_date_planned: string | null;
  date_received_label: string;
  date_placed_label: string;
  ship_date_label: string;
  date_received_long: string;
  date_placed_long: string;
  ship_date_long: string;
  rush_days: number;
  is_rush: boolean;
  status_key: StatusKey;
  status_label: string;
  status_raw: string;
  tracking_no: string;
  tracking_short: string;
  tracking_url: string;
  solid_fabric: string;
  fully_lined: string;
  half_canvas: string;
  embroidery_name: string;
  embroidery_qty: number;
  comment: string;
  remarks: string;
  basted_note: string;
  customs_flag: string;
  erpUrl: string;
  timeline: Array<{ label: string; value: string; state: string }>;
};

function asInt(value: unknown, fallback = 0): number {
  if (value === true) return 1;
  if (value === false || value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asStr(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export function parseDate(value: unknown): Date | null {
  const text = asStr(value);
  if (!text) return null;
  const ymd = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatShortDate(value: unknown): string {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatLongDate(value: unknown): string {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function makeLabel(process: unknown): string {
  const raw = asStr(process);
  if (!raw) return "";
  return MAKE_LABELS[raw.toLowerCase()] ?? raw;
}

export function garmentPills(row: Record<string, unknown>): Array<{ qty: number; label: string }> {
  const pills: Array<{ qty: number; label: string }> = [];
  for (const [field, label] of GARMENT_FIELDS) {
    const qty = asInt(row[field]);
    if (qty) pills.push({ qty, label });
  }
  return pills;
}

export function truncateTracking(trackingNo: unknown): string {
  const raw = asStr(trackingNo).replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 4)}…${raw.slice(-6)}`;
}

export function trackingUrl(trackingNo: unknown, carrier?: unknown): string {
  const raw = asStr(trackingNo).replace(/\s+/g, "");
  if (!raw) return "";
  const kind = asStr(carrier).toUpperCase();
  if (kind === "UPS" || raw.toUpperCase().startsWith("1Z")) {
    return `https://www.ups.com/track?tracknum=${raw}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(raw + " tracking")}`;
}

export function ynFlag(value: unknown): string {
  if (value == null || value === "") return "—";
  return asInt(value) ? "Y" : "N";
}

export function resolveStatusKey(row: Record<string, unknown>): StatusKey {
  const raw = asStr(row.production_status).toLowerCase();
  let key = RAW_STATUS_KEY[raw] ?? "";
  if (!key) key = parseDate(row.date_placed) ? "prod" : "fab";
  if (key === "ship" || key === "pause" || key === "cxl") return key;
  if (asInt(row.rush_days) > 0) return "rush";
  return key as StatusKey;
}

export function matchesFilter(row: Record<string, unknown>, statusFilter: string): boolean {
  const filter = (statusFilter || "all").toLowerCase();
  if (!filter || filter === "all") return true;
  if (filter === "rush" || filter === "s-rush") return asInt(row.rush_days) > 0;
  const key = resolveStatusKey(row);
  const aliases: Record<StatusKey, string[]> = {
    prod: ["prod", "s-prod", "in production", "in_production"],
    ship: ["ship", "s-ship", "shipped"],
    fab: ["fab", "s-fab", "awaiting fabric", "awaiting_fabric", "fabric not received"],
    pause: ["pause", "s-pause", "on pause", "on_pause"],
    cxl: ["cxl", "s-cxl", "canceled", "cancelled"],
    rush: ["rush", "s-rush"],
  };
  for (const [candidate, names] of Object.entries(aliases) as Array<[StatusKey, string[]]>) {
    if (names.includes(filter)) return key === candidate;
  }
  return key === filter;
}

export function matchesSearch(row: Record<string, unknown>, search: string): boolean {
  const needle = asStr(search).toLowerCase();
  if (!needle) return true;
  const hay = SEARCH_FIELDS.map((f) => asStr(row[f]).toLowerCase()).join(" ");
  return hay.includes(needle);
}

export function orderSortKey(row: Record<string, unknown>): [number, number, string] {
  const orderNo = asStr(row.order_no || row.name).toUpperCase();
  const parts = orderNo.replace(/\D+/g, " ").trim().split(/\s+/).filter(Boolean).map(Number);
  const year = parts[0] ?? 0;
  const seq = parts[1] ?? parts[0] ?? 0;
  return [-year, -seq, orderNo];
}

export function paginate<T>(rows: T[], page: number, pageSize = PAGE_SIZE) {
  const total = rows.length;
  const size = Math.max(1, Math.min(pageSize || PAGE_SIZE, 100));
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.max(1, Math.min(page || 1, pages));
  const start = (current - 1) * size;
  return {
    rows: rows.slice(start, start + size),
    paging: {
      page: current,
      page_size: size,
      pages,
      total,
      from: total ? start + 1 : 0,
      to: Math.min(start + size, total),
    },
  };
}

function weekStart(day: Date): Date {
  const d = new Date(day);
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return d;
}

export function kpiCounts(rows: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = { all: rows.length };
  for (const key of STATUS_KEYS) counts[key] = 0;
  let rushByDays = 0;
  for (const row of rows) {
    counts[resolveStatusKey(row)] += 1;
    if (asInt(row.rush_days) > 0) rushByDays += 1;
  }
  counts.rush = rushByDays;
  return counts;
}

export function garmentCounts(rows: Array<Record<string, unknown>>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [, label] of GARMENT_FIELDS) totals[label] = 0;
  for (const row of rows) {
    for (const [field, label] of GARMENT_FIELDS) totals[label] += asInt(row[field]);
  }
  return totals;
}

export function makeBreakdown(rows: Array<Record<string, unknown>>) {
  const out = { machine: 0, half_hand: 0, hand: 0, other: 0 };
  for (const row of rows) {
    const label = makeLabel(row.process_category).toLowerCase();
    if (label === "machine") out.machine += 1;
    else if (label === "half-hand") out.half_hand += 1;
    else if (label === "hand") out.hand += 1;
    else out.other += 1;
  }
  return out;
}

export function weekBuckets(rows: Array<Record<string, unknown>>, today = new Date()) {
  const open = rows.filter((r) => {
    const key = resolveStatusKey(r);
    return key !== "ship" && key !== "cxl";
  });
  const buckets = new Map<string, number>();
  let unscheduled = 0;
  for (const row of open) {
    const planned = parseDate(row.ship_date_planned);
    if (!planned) {
      unscheduled += 1;
      continue;
    }
    const start = weekStart(planned);
    const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    buckets.set(iso, (buckets.get(iso) ?? 0) + 1);
  }
  const currentStart = weekStart(today);
  const currentIso = `${currentStart.getFullYear()}-${String(currentStart.getMonth() + 1).padStart(2, "0")}-${String(currentStart.getDate()).padStart(2, "0")}`;
  const weeks = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start]) => {
      const d = parseDate(start)!;
      const end = new Date(d);
      end.setDate(end.getDate() + 6);
      return {
        start,
        end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`,
        label: `Week of ${formatShortDate(d)}`,
        range: `${formatShortDate(d)} – ${formatShortDate(end)}`,
        count: buckets.get(start) ?? 0,
        current: start === currentIso,
      };
    });
  if (unscheduled) {
    weeks.push({
      start: "",
      end: "",
      label: "Unscheduled",
      range: "Awaiting fabric / placement",
      count: unscheduled,
      current: false,
    });
  }
  return weeks;
}

export function timelineSteps(row: Record<string, unknown>) {
  const key = resolveStatusKey(row);
  const received = parseDate(row.date_received);
  const placed = parseDate(row.date_placed);
  const ships = parseDate(row.ship_date_planned);
  const rushDays = asInt(row.rush_days);
  const receivedState = received ? "done" : key === "fab" && !placed ? "now" : "";
  const placedState = placed ? "done" : "";
  let prodState = "now";
  let prodValue = "In house";
  if (key === "fab") prodValue = "Awaiting mill";
  else if (key === "pause") prodValue = "On Pause";
  else if (key === "cxl") {
    prodState = "";
    prodValue = "Canceled";
  } else if (key === "ship") {
    prodState = "done";
    prodValue = "Complete";
  } else if (key === "rush") prodValue = rushDays ? `Rush · −${rushDays} days` : "Rush";
  const shipState = key === "ship" ? "done" : "";
  const shipValue = key === "ship" ? formatShortDate(ships) || "Shipped" : formatShortDate(ships);
  return [
    { label: "Received", value: formatShortDate(received) || "—", state: receivedState },
    { label: "Placed with YZ", value: formatShortDate(placed) || "—", state: placedState },
    { label: "In Production", value: prodValue, state: prodState },
    { label: "Ships (plan)", value: shipValue || "—", state: shipState },
    { label: "Arrival QC", value: "—", state: "" },
  ];
}

export function serializeRow(row: Record<string, unknown>): SheetRow {
  const key = resolveStatusKey(row);
  const pills = garmentPills(row);
  const tracking = asStr(row.tracking_no);
  const rushDays = asInt(row.rush_days);
  const received = parseDate(row.date_received);
  const placed = parseDate(row.date_placed);
  const ships = parseDate(row.ship_date_planned);
  return {
    name: asStr(row.name || row.order_no),
    order_no: asStr(row.order_no || row.name),
    po_no: asStr(row.mtmpro_order),
    customer_name: asStr(row.customer_name),
    customer: asStr(row.customer),
    make: makeLabel(row.process_category),
    fabric_number: asStr(row.fabric_number),
    garments: pills,
    garment_summary: asStr(row.garment_summary),
    total_pieces: asInt(row.total_pieces) || pills.reduce((s, p) => s + p.qty, 0),
    date_received: received ? received.toISOString().slice(0, 10) : null,
    date_placed: placed ? placed.toISOString().slice(0, 10) : null,
    ship_date_planned: ships ? ships.toISOString().slice(0, 10) : null,
    date_received_label: formatShortDate(received),
    date_placed_label: formatShortDate(placed),
    ship_date_label: formatShortDate(ships),
    date_received_long: formatLongDate(received),
    date_placed_long: formatLongDate(placed),
    ship_date_long: formatLongDate(ships),
    rush_days: rushDays,
    is_rush: rushDays > 0,
    status_key: key,
    status_label: STATUS_LABELS[key],
    status_raw: asStr(row.production_status),
    tracking_no: tracking,
    tracking_short: truncateTracking(tracking),
    tracking_url: trackingUrl(tracking),
    solid_fabric: ynFlag(row.solid_fabric),
    fully_lined: ynFlag(row.fully_lined),
    half_canvas: ynFlag(row.half_canvas),
    embroidery_name: asStr(row.embroidery_name),
    embroidery_qty: asInt(row.embroidery_qty),
    comment: asStr(row.comment),
    remarks: asStr(row.remarks),
    basted_note: asStr(row.basted_note),
    customs_flag: asStr(row.customs_flag),
    erpUrl: asStr(row.erpUrl),
    timeline: timelineSteps(row),
  };
}

export function filterRows(rows: Array<Record<string, unknown>>, statusFilter = "all", search = "") {
  return rows
    .filter((r) => matchesFilter(r, statusFilter) && matchesSearch(r, search))
    .sort((a, b) => {
      const ka = orderSortKey(a);
      const kb = orderSortKey(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return ka[2].localeCompare(kb[2]);
    });
}

export function overviewPayload(rows: Array<Record<string, unknown>>, today = new Date()) {
  const kpis = kpiCounts(rows);
  const garments = garmentCounts(rows);
  const rushRows = rows
    .filter((r) => asInt(r.rush_days) > 0)
    .sort((a, b) => asInt(b.rush_days) - asInt(a.rush_days) || orderSortKey(a)[1] - orderSortKey(b)[1]);
  return {
    kpis,
    status_bars: (["ship", "prod", "fab", "cxl", "pause"] as StatusKey[]).map((key) => ({
      key,
      label: STATUS_LABELS[key],
      count: kpis[key] ?? 0,
    })),
    rush_queue: rushRows.slice(0, 8).map(serializeRow),
    rush_total: rushRows.length,
    ship_weeks: weekBuckets(rows, today),
    garments,
    garment_total: Object.values(garments).reduce((s, n) => s + n, 0),
    make: makeBreakdown(rows),
    order_count: rows.length,
  };
}

export function yzAsRecord(order: YZOrder): Record<string, unknown> {
  return order as unknown as Record<string, unknown>;
}
