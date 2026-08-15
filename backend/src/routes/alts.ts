/**
 * SPEC 057 — Walk-in sellable items catalog.
 * GET /api/alts/sellable-items
 *
 * Source: ERP Item (MTM garment groups + RTW/stock/Tramarossa) + Item Price + Bin.
 * MTM SKUs sort first so FOH can invoice made-to-measure on the fly.
 * When RTW/Stock Garments catalog is empty, returns seeded demo SKUs
 * (source: "seed") so FOH UI matches mock 038 until ops stocks ERP.
 */
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import { grokChat } from "../lib/grok";
import {
  availabilityFrom,
  dedupeByItemCode,
  envAllowGroups,
  HOUSE_MTM_CODES,
  isDeniedGroup,
  isMtmSellGroup,
  isPreferredGroup,
  finalizeSellableCatalog,
  MTM_SELL_GROUPS,
  RTW_SELL_GROUPS,
  sellableKind,
  uiGroupFrom,
  type SellableAvailability,
  type SellableKind,
} from "../lib/sellable-catalog";

export const altsRouter = new Hono();

const NYC_WAREHOUSES = [
  "NYC Showroom - LSTNY",
  "Finished Goods - LSTNY",
  "Stores - LSTNY",
];

export type SellableItemDto = {
  item_code: string;
  item_name: string;
  item_group: string;
  rate: number;
  is_stock_item: boolean;
  stock_qty: number | null;
  availability: SellableAvailability;
  has_variants: boolean;
  attributes?: { Size?: string[]; Color?: string[] };
  image?: string | null;
  ui_group?: "tops" | "bottoms" | "accessories" | "other";
  color_label?: string | null;
  source: "erp" | "seed" | "house";
  eta?: string | null;
  kind?: SellableKind;
};

/** Demo catalog when ERP has no Stock Garments / RTW rows yet (SPEC 057). */
const SEED_CATALOG: SellableItemDto[] = [
  {
    item_code: "SEED-POLO-NAVY",
    item_name: "Pique Polo",
    item_group: "RTW Shirt",
    rate: 145,
    is_stock_item: true,
    stock_qty: 8,
    availability: "in",
    has_variants: false,
    attributes: {
      Size: ["S", "M", "L", "XL"],
      Color: ["Navy", "White", "Forest"],
    },
    color_label: "Navy",
    ui_group: "tops",
    source: "seed",
    image: null,
  },
  {
    item_code: "SEED-POLO-WHITE",
    item_name: "Pique Polo",
    item_group: "RTW Shirt",
    rate: 145,
    is_stock_item: true,
    stock_qty: 5,
    availability: "in",
    has_variants: false,
    attributes: { Size: ["S", "M", "L", "XL"], Color: ["White", "Navy"] },
    color_label: "White",
    ui_group: "tops",
    source: "seed",
    image: null,
  },
  {
    item_code: "SEED-JEAN-WHITE",
    item_name: "Selvedge Jean",
    item_group: "RTW Trouser",
    rate: 220,
    is_stock_item: true,
    stock_qty: 3,
    availability: "in",
    has_variants: false,
    attributes: { Size: ["30", "32", "34", "36"], Color: ["White", "Indigo"] },
    color_label: "White",
    ui_group: "bottoms",
    source: "seed",
    image: null,
  },
  {
    item_code: "SEED-JEAN-INDIGO",
    item_name: "Selvedge Jean",
    item_group: "RTW Trouser",
    rate: 220,
    is_stock_item: true,
    stock_qty: 6,
    availability: "in",
    has_variants: false,
    attributes: { Size: ["30", "32", "34", "36"], Color: ["Indigo", "White"] },
    color_label: "Indigo",
    ui_group: "bottoms",
    source: "seed",
    image: null,
  },
  {
    item_code: "SEED-TEE-CREAM",
    item_name: "Cotton Tee",
    item_group: "RTW Shirt",
    rate: 65,
    is_stock_item: true,
    stock_qty: 12,
    availability: "in",
    has_variants: false,
    attributes: { Size: ["S", "M", "L", "XL"], Color: ["Cream", "Black"] },
    color_label: "Cream",
    ui_group: "tops",
    source: "seed",
    image: null,
  },
  {
    item_code: "SEED-CHINO-SAND",
    item_name: "Summer Chino",
    item_group: "RTW Trouser",
    rate: 175,
    is_stock_item: true,
    stock_qty: 0,
    availability: "order",
    has_variants: false,
    attributes: { Size: ["30", "32", "34", "36"], Color: ["Sand"] },
    color_label: "Sand",
    ui_group: "bottoms",
    source: "seed",
    eta: "10–14 days",
    image: null,
  },
  {
    item_code: "SEED-OVERSHIRT-OLIVE",
    item_name: "Work Overshirt",
    item_group: "RTW Jacket",
    rate: 295,
    is_stock_item: true,
    stock_qty: 0,
    availability: "order",
    has_variants: false,
    attributes: { Size: ["S", "M", "L"], Color: ["Olive"] },
    color_label: "Olive",
    ui_group: "tops",
    source: "seed",
    eta: "2–3 weeks",
    image: null,
  },
  {
    item_code: "SEED-BELT-COGNAC",
    item_name: "Suede Belt",
    item_group: "RTW Accessory",
    rate: 120,
    is_stock_item: true,
    stock_qty: 4,
    availability: "in",
    has_variants: false,
    attributes: { Size: ["32", "34", "36"], Color: ["Cognac"] },
    color_label: "Cognac",
    ui_group: "accessories",
    source: "seed",
    image: null,
  },
  {
    item_code: "SEED-SOCK-CHARCOAL",
    item_name: "Merino Sock",
    item_group: "RTW Accessory",
    rate: 28,
    is_stock_item: true,
    stock_qty: 20,
    availability: "in",
    has_variants: false,
    attributes: { Size: ["One"], Color: ["Charcoal"] },
    color_label: "Charcoal",
    ui_group: "accessories",
    source: "seed",
    image: null,
  },
  {
    item_code: "SEED-CAP-FOREST",
    item_name: "Wool Cap",
    item_group: "RTW Accessory",
    rate: 85,
    is_stock_item: true,
    stock_qty: 0,
    availability: "out",
    has_variants: false,
    attributes: { Size: ["One"], Color: ["Forest"] },
    color_label: "Forest",
    ui_group: "accessories",
    source: "seed",
    image: null,
  },
];

/** Pull a color token from Italian/English product names for tile subline. */
function guessColorLabel(name: string): string | null {
  const n = (name || "").toUpperCase();
  const colors: [RegExp, string][] = [
    [/\bWHITE\b|BIANCO/, "White"],
    [/\bBLACK\b|NERO/, "Black"],
    [/\bDARK BLUE\b|BLU SCURO|NAVY/, "Dark Blue"],
    [/\bMEDIUM BLUE\b|BLU MEDIO|INDIGO/, "Medium Blue"],
    [/\bLIGHT BLUE\b|BLU CHIARO|AZURE|AZZURRO/, "Light Blue"],
    [/\bGREY\b|GRAY\b|GRIGIO/, "Grey"],
    [/\bBEIGE\b|SAND\b|CHAMPAGNE/, "Beige"],
    [/\bGREEN\b|VERDE|OLIVE|ALOE/, "Green"],
    [/\bBROWN\b|MARRONE/, "Brown"],
    [/\bCREAM\b|CREMA/, "Cream"],
  ];
  for (const [re, label] of colors) {
    if (re.test(n)) return label;
  }
  return null;
}

/** Default size chips when ERP has no variant attributes yet. */
function defaultAttributesFor(itemGroup: string, name: string): { Size?: string[]; Color?: string[] } | undefined {
  if (isMtmSellGroup(itemGroup)) {
    const blob = `${itemGroup} ${name}`.toLowerCase();
    if (/trouser|pant/.test(blob)) return { Size: ["28", "30", "32", "34", "36", "38"] };
    if (/shirt/.test(blob)) return { Size: ["14.5", "15", "15.5", "16", "16.5", "17"] };
    return { Size: ["36", "38", "40", "42", "44", "46"] };
  }
  const ug = uiGroupFrom(itemGroup, name);
  if (ug === "bottoms") {
    return { Size: ["28", "30", "32", "34", "36", "38"] };
  }
  if (ug === "tops") {
    return { Size: ["S", "M", "L", "XL"] };
  }
  return { Size: ["One"] };
}

const SELLABLE_ITEM_FIELDS = [
  "name",
  "item_code",
  "item_name",
  "item_group",
  "is_stock_item",
  "has_variants",
  "standard_rate",
  "image",
  "disabled",
  "is_sales_item",
] as const;

type ErpSellableRow = {
  name: string;
  item_code: string;
  item_name: string;
  item_group: string;
  is_stock_item: number;
  has_variants: number;
  standard_rate: number;
  image: string | null;
  disabled: number;
  is_sales_item: number;
};

async function listSalesItemsByGroups(groups: string[], limit: number): Promise<ErpSellableRow[]> {
  const cleaned = [...new Set(groups.map((g) => g.trim()).filter(Boolean))];
  if (!cleaned.length) return [];
  return erpList<ErpSellableRow>("Item", {
    fields: [...SELLABLE_ITEM_FIELDS],
    filters: [
      ["disabled", "=", 0],
      ["is_sales_item", "=", 1],
      ["item_group", "in", cleaned],
    ],
    limit,
    order_by: "item_name asc",
  });
}

altsRouter.get("/sellable-items", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const q = (c.req.query("q") || "").trim().toLowerCase();
  const filter = (c.req.query("filter") || "all").toLowerCase(); // all|mtm|in|order|tops|bottoms
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 80) || 80, 1), 150);
  const origin = "NYC";
  const warehouse =
    c.req.query("warehouse") ||
    process.env.ALTS_SELL_WAREHOUSE ||
    NYC_WAREHOUSES[0];
  const extraGroups = envAllowGroups();
  const extraMtm = extraGroups.filter((g) => isMtmSellGroup(g));
  const extraRtw = extraGroups.filter((g) => !isMtmSellGroup(g));

  try {
    // Fetch MTM separately so the RTW/Tramarossa 300-row cap cannot hide them.
    const [mtmRows, mtmLike, mtmByCode, rtwRows] = await Promise.all([
      listSalesItemsByGroups([...MTM_SELL_GROUPS, ...extraMtm], 200),
      erpList<ErpSellableRow>("Item", {
        fields: [...SELLABLE_ITEM_FIELDS],
        filters: [
          ["disabled", "=", 0],
          ["is_sales_item", "=", 1],
          ["item_group", "like", "MTM%"],
        ],
        limit: 200,
        order_by: "item_name asc",
      }),
      erpList<ErpSellableRow>("Item", {
        fields: [...SELLABLE_ITEM_FIELDS],
        filters: [
          ["disabled", "=", 0],
          ["item_code", "in", [...HOUSE_MTM_CODES]],
        ],
        limit: 20,
        order_by: "item_name asc",
      }),
      listSalesItemsByGroups([...RTW_SELL_GROUPS, ...extraRtw], 300),
    ]);
    let rows = dedupeByItemCode([...mtmRows, ...mtmLike, ...mtmByCode, ...rtwRows]).filter(
      (r) => !isDeniedGroup(r.item_group),
    );

    // If empty, fall back to Tramarossa brand sales items
    if (!rows.length) {
      const broad = await erpList<ErpSellableRow>("Item", {
        fields: [...SELLABLE_ITEM_FIELDS],
        filters: [
          ["disabled", "=", 0],
          ["is_sales_item", "=", 1],
          ["brand", "=", "Tramarossa"],
        ],
        limit: 300,
        order_by: "item_name asc",
      });
      rows = broad.filter(
        (r) => isPreferredGroup(r.item_group, extraGroups) && !isDeniedGroup(r.item_group),
      );
    }

    let dto: SellableItemDto[] = [];

    if (rows.length) {
      // Stock bins for preferred warehouse (best-effort)
      const codes = rows.map((r) => r.item_code);
      const bins = codes.length
        ? await erpList<{ item_code: string; actual_qty: number; warehouse: string }>("Bin", {
            fields: ["item_code", "actual_qty", "warehouse"],
            filters: [
              ["item_code", "in", codes],
              ["warehouse", "in", NYC_WAREHOUSES],
            ],
            limit: 500,
          }).catch(() => [])
        : [];

      const qtyByCode = new Map<string, number>();
      for (const b of bins) {
        const prev = qtyByCode.get(b.item_code) || 0;
        qtyByCode.set(b.item_code, prev + (Number(b.actual_qty) || 0));
      }

      // Selling rates from Item Price (Selling)
      const prices = codes.length
        ? await erpList<{ item_code: string; price_list_rate: number }>("Item Price", {
            fields: ["item_code", "price_list_rate"],
            filters: [
              ["item_code", "in", codes],
              ["selling", "=", 1],
            ],
            limit: 500,
            order_by: "modified desc",
          }).catch(() => [])
        : [];
      const rateByCode = new Map<string, number>();
      for (const p of prices) {
        if (!rateByCode.has(p.item_code)) {
          rateByCode.set(p.item_code, Number(p.price_list_rate) || 0);
        }
      }

      dto = rows.map((r) => {
        const isStock = !!r.is_stock_item;
        const stockQty = isStock ? qtyByCode.get(r.item_code) ?? 0 : null;
        const rate = rateByCode.get(r.item_code) || Number(r.standard_rate) || 0;
        const avail = availabilityFrom(isStock, stockQty);
        const kind = sellableKind(r.item_group || "", r.item_code);
        const name = r.item_name || r.item_code;
        return {
          item_code: r.item_code,
          item_name: name,
          item_group: r.item_group || "",
          rate,
          is_stock_item: isStock,
          stock_qty: stockQty,
          availability: avail,
          has_variants: !!r.has_variants,
          image: r.image || null,
          ui_group: uiGroupFrom(r.item_group || "", name),
          color_label: kind === "mtm" ? null : guessColorLabel(name),
          source: "erp" as const,
          eta: kind === "mtm" ? "Made to measure" : avail === "order" ? "Special order" : null,
          kind,
          attributes: defaultAttributesFor(r.item_group || "", name),
        };
      });
    }

    // Seed until RTW catalog exists
    if (!dto.length) {
      dto = SEED_CATALOG.map((s) => ({ ...s, kind: sellableKind(s.item_group, s.item_code) }));
    }

    // Always pin house MTM tiles so jeans cannot hide them.
    dto = finalizeSellableCatalog(dto, { q, filter, limit }) as SellableItemDto[];

    return c.json({
      data: dto,
      meta: {
        warehouse,
        origin,
        seeded: dto.length > 0 && dto.every((d) => d.source === "seed"),
        count: dto.length,
      },
    });
  } catch (e: any) {
    console.error("[alts/sellable-items]", e?.message || e);
    // Soft-fail to seed so FOH still works
    let dto = SEED_CATALOG.map((s) => ({ ...s, kind: sellableKind(s.item_group, s.item_code) }));
    dto = finalizeSellableCatalog(dto, { q, filter, limit }) as SellableItemDto[];
    return c.json({
      data: dto,
      meta: { warehouse, origin, seeded: true, error: String(e?.message || e) },
    });
  }
});

/**
 * GET /api/alts/schedule-load?origin=NYC&from=YYYY-MM-DD&days=14
 * Day-bucket capacity for promised due dates (airline load chart).
 * Stage 1 = ticket counts. Later = estimated_minutes × tailor hours.
 */
altsRouter.get("/schedule-load", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const origin = "NYC";
  const from =
    c.req.query("from") ||
    new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const nDays = Math.min(28, Math.max(7, Number(c.req.query("days") || 14) || 14));

  const start = new Date(`${from}T12:00:00`);
  const dates: string[] = [];
  for (let i = 0; i < nDays; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    // Skip Sundays for shop strip (still allow if selected later via expand)
    const iso = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay(); // careful with TZ — rebuild with local
    dates.push(iso);
  }

  // Rebuild dates in America/New_York day boundaries
  const nyDates: string[] = [];
  {
    const base = new Date(`${from}T12:00:00-04:00`);
    for (let i = 0; i < nDays + 4; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      const iso = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const wd = new Date(`${iso}T12:00:00`).getDay();
      if (wd === 0) continue; // skip Sunday
      if (!nyDates.includes(iso)) nyDates.push(iso);
      if (nyDates.length >= nDays) break;
    }
  }

  const rangeStart = nyDates[0];
  const rangeEnd = nyDates[nyDates.length - 1];

  const tickets = await erpList<any>("Alteration Ticket", {
    filters: [
      ["due_date", ">=", rangeStart],
      ["due_date", "<=", rangeEnd],
      ["origin_location", "=", origin],
      ["workflow_state", "not in", ["Picked Up", "Cancelled"]],
    ],
    fields: [
      "name",
      "customer_name",
      "due_date",
      "due_time",
      "is_rush",
      "workflow_state",
      "ticket_total",
    ],
    limit: 500,
    order_by: "due_date asc",
  }).catch(() => [] as any[]);

  // Appointments (optional — store DT may fail)
  let appts: any[] = [];
  try {
    const { storeList } = await import("../lib/erpnext/store");
    const { DT } = await import("../lib/erpnext/doctypes");
    appts = await storeList<any>(DT.APPOINTMENT, {
      filters: [
        ["start_time", ">=", `${rangeStart}T00:00:00`],
        ["start_time", "<=", `${rangeEnd}T23:59:59`],
        ["status", "!=", "cancelled"],
      ],
      fields: ["name", "customer", "event_type", "start_time", "end_time", "location", "status"],
      orderBy: "start_time asc",
      limit: 200,
    });
    // NYC appointments only (alts FOH)
    appts = appts.filter((a) => {
      const loc = String(a.location || "").toLowerCase();
      return !loc.includes("hou") && !loc.includes("houston");
    });
  } catch {
    appts = [];
  }

  const byDate: Record<
    string,
    {
      date: string;
      count: number;
      rush: number;
      tickets: any[];
      appointments: any[];
    }
  > = {};
  for (const iso of nyDates) {
    byDate[iso] = { date: iso, count: 0, rush: 0, tickets: [], appointments: [] };
  }

  for (const t of tickets) {
    const d = String(t.due_date || "").slice(0, 10);
    if (!byDate[d]) continue;
    byDate[d].count += 1;
    if (t.is_rush) byDate[d].rush += 1;
    byDate[d].tickets.push({
      name: t.name,
      customer_name: t.customer_name,
      due_time: t.due_time || null,
      is_rush: t.is_rush,
      workflow_state: t.workflow_state,
    });
  }

  for (const a of appts) {
    const d = String(a.start_time || "").slice(0, 10);
    if (!byDate[d]) continue;
    byDate[d].appointments.push({
      id: a.name,
      title: a.event_type || "Appointment",
      start: a.start_time,
      end: a.end_time,
    });
    // appointments count toward visual load lightly
    byDate[d].count += 1;
  }

  // Sort tickets in day by time
  for (const d of Object.values(byDate)) {
    d.tickets.sort((a, b) => String(a.due_time || "99").localeCompare(String(b.due_time || "99")));
  }

  return c.json({
    data: {
      origin,
      from: rangeStart,
      to: rangeEnd,
      days: nyDates.map((iso) => byDate[iso]),
    },
  });
});

/**
 * GET /api/alts/capacity-alert?origin=NYC&days=14&lookback=90
 *
 * TileOS capacity-AI overbooking alert.
 * Compares upcoming booked minutes (sum of line est_minutes by due_date) vs
 * historical daily throughput (completed tickets last `lookback` days).
 * Returns per-day load status + Grok-generated alert summary.
 *
 * Heat states match SPEC 065a §2.2:
 *   empty  pct == 0
 *   low    0 < pct <= 0.33
 *   med    0.33 < pct <= 0.66
 *   high   0.66 < pct < 1.0
 *   over   pct >= 1.0  ← overbooking alert triggers here
 */
altsRouter.get("/capacity-alert", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const origin = (c.req.query("origin") ?? "NYC").toUpperCase();
  const nDays = Math.min(28, Math.max(7, Number(c.req.query("days") || 14) || 14));
  const lookbackDays = Math.min(180, Math.max(30, Number(c.req.query("lookback") || 90) || 90));

  // ------------------------------------------------------------------
  // 1. Build forward date range (NYC timezone, skip Sundays)
  // ------------------------------------------------------------------
  const todayNy = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const nyDates: string[] = [];
  {
    const base = new Date(`${todayNy}T12:00:00-04:00`);
    for (let i = 0; i < nDays + 4; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      const iso = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const wd = new Date(`${iso}T12:00:00`).getDay();
      if (wd === 0) continue; // skip Sunday
      if (!nyDates.includes(iso)) nyDates.push(iso);
      if (nyDates.length >= nDays) break;
    }
  }
  const fwdStart = nyDates[0];
  const fwdEnd = nyDates[nyDates.length - 1];

  // ------------------------------------------------------------------
  // 2. Historical lookback: tickets picked up in the last `lookbackDays` days
  // ------------------------------------------------------------------
  const histEndDt = new Date(`${todayNy}T23:59:59-04:00`);
  const histStartDt = new Date(histEndDt.getTime() - lookbackDays * 86400000);
  const histStart = histStartDt.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const histEnd = todayNy;

  const histTickets = await erpList<any>("Alteration Ticket", {
    filters: [
      ["workflow_state", "=", "Picked Up"],
      ["origin_location", "=", origin],
      ["picked_up_at", ">=", `${histStart} 00:00:00`],
      ["picked_up_at", "<=", `${histEnd} 23:59:59`],
    ],
    fields: ["name", "picked_up_at", "ticket_total"],
    limit: 2000,
    order_by: "picked_up_at asc",
  }).catch(() => [] as any[]);

  // Fetch lines for historical tickets to get est_minutes
  const histNames = histTickets.map((t: any) => t.name);
  let histLines: any[] = [];
  if (histNames.length > 0) {
    // Batch in chunks of 100 to avoid huge IN clauses
    for (let i = 0; i < histNames.length; i += 100) {
      const chunk = histNames.slice(i, i + 100);
      const rows = await erpList<any>("Alteration Ticket Line", {
        parent: "Alteration Ticket",
        filters: [["parent", "in", chunk]],
        fields: ["parent", "est_minutes", "estimated_minutes"],
        limit: 5000,
      }).catch(() => [] as any[]);
      histLines = histLines.concat(rows);
    }
  }

  // Build map: ticket → total est_minutes
  const histLinesByTicket = new Map<string, number>();
  for (const l of histLines) {
    const mins = Number(l.est_minutes ?? l.estimated_minutes ?? 15) || 15;
    histLinesByTicket.set(l.parent, (histLinesByTicket.get(l.parent) ?? 0) + mins);
  }

  // Bucket by pickup date → daily total minutes completed
  const histByDate = new Map<string, number>();
  for (const t of histTickets) {
    const d = String(t.picked_up_at ?? "").slice(0, 10);
    if (!d) continue;
    const mins = histLinesByTicket.get(t.name) ?? 30; // fallback 30m if no lines
    histByDate.set(d, (histByDate.get(d) ?? 0) + mins);
  }

  // Daily throughput array (only days with at least one completed ticket = shop was open)
  const dailyThroughputVals = Array.from(histByDate.values()).filter((v) => v > 0);
  dailyThroughputVals.sort((a, b) => a - b);

  const avgThroughput =
    dailyThroughputVals.length > 0
      ? dailyThroughputVals.reduce((s, v) => s + v, 0) / dailyThroughputVals.length
      : 240; // default 4h if no history

  // p75 = capacity ceiling before "over" alert
  const p75Idx = Math.floor(dailyThroughputVals.length * 0.75);
  const p75Throughput =
    dailyThroughputVals.length > 0 ? dailyThroughputVals[p75Idx] ?? avgThroughput : avgThroughput;

  // ------------------------------------------------------------------
  // 3. Forward load: open tickets in the date range, by due_date
  // ------------------------------------------------------------------
  const fwdTickets = await erpList<any>("Alteration Ticket", {
    filters: [
      ["due_date", ">=", fwdStart],
      ["due_date", "<=", fwdEnd],
      ["origin_location", "=", origin],
      ["workflow_state", "not in", ["Picked Up", "Cancelled"]],
    ],
    fields: ["name", "due_date", "is_rush", "workflow_state"],
    limit: 1000,
    order_by: "due_date asc",
  }).catch(() => [] as any[]);

  const fwdNames = fwdTickets.map((t: any) => t.name);
  let fwdLines: any[] = [];
  if (fwdNames.length > 0) {
    for (let i = 0; i < fwdNames.length; i += 100) {
      const chunk = fwdNames.slice(i, i + 100);
      const rows = await erpList<any>("Alteration Ticket Line", {
        parent: "Alteration Ticket",
        filters: [["parent", "in", chunk]],
        fields: ["parent", "est_minutes", "estimated_minutes"],
        limit: 5000,
      }).catch(() => [] as any[]);
      fwdLines = fwdLines.concat(rows);
    }
  }

  const fwdLinesByTicket = new Map<string, number>();
  for (const l of fwdLines) {
    const mins = Number(l.est_minutes ?? l.estimated_minutes ?? 15) || 15;
    fwdLinesByTicket.set(l.parent, (fwdLinesByTicket.get(l.parent) ?? 0) + mins);
  }

  // Per-day forward load
  function heatState(pct: number): string {
    if (pct === 0) return "empty";
    if (pct <= 0.33) return "low";
    if (pct <= 0.66) return "med";
    if (pct < 1.0) return "high";
    return "over";
  }

  type DayLoad = {
    date: string;
    booked_minutes: number;
    capacity_minutes: number;
    pct: number;
    heat: string;
    ticket_count: number;
    rush_count: number;
    overbooking_delta_minutes: number; // > 0 = over by this many minutes
  };

  const dayLoads: DayLoad[] = nyDates.map((iso) => {
    const dayTickets = fwdTickets.filter((t: any) => String(t.due_date || "").slice(0, 10) === iso);
    let bookedMin = 0;
    let rushCount = 0;
    for (const t of dayTickets) {
      bookedMin += fwdLinesByTicket.get(t.name) ?? 15;
      if (t.is_rush) rushCount++;
    }
    const pct = p75Throughput > 0 ? bookedMin / p75Throughput : 0;
    return {
      date: iso,
      booked_minutes: bookedMin,
      capacity_minutes: Math.round(p75Throughput),
      pct: Math.round(pct * 100) / 100,
      heat: heatState(pct),
      ticket_count: dayTickets.length,
      rush_count: rushCount,
      overbooking_delta_minutes: Math.max(0, Math.round(bookedMin - p75Throughput)),
    };
  });

  const overDays = dayLoads.filter((d) => d.heat === "over");
  const hasAlert = overDays.length > 0;

  // ------------------------------------------------------------------
  // 4. Grok AI summary
  // ------------------------------------------------------------------
  const aiSummary = await grokChat(
    [
      {
        role: "system",
        content:
          "You are Rocco, the production manager at L&S Custom Tailors NYC. " +
          "Give a concise, direct overbooking alert (3-5 sentences max). " +
          "Flag specific dates that are over capacity. Suggest one concrete action per overbooked day " +
          "(e.g. spread tickets, call ahead, add tailor time). Tone: direct, no fluff.",
      },
      {
        role: "user",
        content:
          `Historical daily throughput baseline: avg ${Math.round(avgThroughput)}m, p75 capacity ceiling ${Math.round(p75Throughput)}m (lookback ${lookbackDays} days, ${histTickets.length} completed tickets). ` +
          `Forward load next ${nDays} working days: ` +
          dayLoads
            .filter((d) => d.heat !== "empty")
            .map(
              (d) =>
                `${d.date}: ${d.booked_minutes}m booked (${d.ticket_count} tickets, ${d.rush_count} rush) — ${d.heat}${d.overbooking_delta_minutes > 0 ? ` over by ${d.overbooking_delta_minutes}m` : ""}`,
            )
            .join("; ") +
          `. ${overDays.length} day(s) over capacity. Provide your alert now.`,
      },
    ],
    { maxTokens: 250, temperature: 0.3 },
  );

  // ------------------------------------------------------------------
  // 5. Response
  // ------------------------------------------------------------------
  return c.json({
    data: {
      origin,
      generated_at: new Date().toISOString(),
      lookback_days: lookbackDays,
      historical: {
        tickets_completed: histTickets.length,
        days_with_data: dailyThroughputVals.length,
        avg_daily_minutes: Math.round(avgThroughput),
        p75_daily_minutes: Math.round(p75Throughput),
        capacity_ceiling_minutes: Math.round(p75Throughput),
      },
      forward_days: nDays,
      alert: hasAlert,
      over_days: overDays.map((d) => ({
        date: d.date,
        booked_minutes: d.booked_minutes,
        over_by_minutes: d.overbooking_delta_minutes,
        ticket_count: d.ticket_count,
        rush_count: d.rush_count,
      })),
      days: dayLoads,
      ai_summary: aiSummary || null,
    },
  });
});
