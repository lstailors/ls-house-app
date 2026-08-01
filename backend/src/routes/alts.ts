/**
 * SPEC 057 — Walk-in sellable items catalog.
 * GET /api/alts/sellable-items
 *
 * Source: ERP Item (allow-list groups) + Item Price + Bin.
 * When RTW/Stock Garments catalog is empty, returns seeded demo SKUs
 * (source: "seed") so FOH UI matches mock 038 until ops stocks ERP.
 */
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";

export const altsRouter = new Hono();

/** Deny-list: never show service/fabric/ops groups on the Sell grid. */
const DENY_GROUPS = new Set(
  [
    "Alteration Services",
    "Alterations",
    "Alterations - Legacy",
    "Factory Surcharges",
    "Fabric",
    "Suiting",
    "Shirting",
    "Jacketing",
    "Lining",
    "Coating",
    "Specialty",
    "Trouser-Only",
    "Trims",
    "Buttons",
    "Canvas & Interlining",
    "Labels & Monograms",
    "Other Trims",
    "Thread",
    "Zippers",
    "CMT - Factory",
    "Consultations",
    "Business Expenses",
    "Equipment",
    "Services",
    "Repairs",
    "Rush",
    "Pickup & Delivery",
    "Embroidery",
    "Casa L&S",
    "Casa Add-On",
    "Membership - Atelier",
    "Membership - Founder",
    "Membership - Heritage",
    "Membership - Signature",
    "Wholesale - MTM Program",
    "MTM Program - Jacket",
    "MTM Program - Sample Kit",
    "MTM Program - Setup Fee",
    "MTM Program - Shirt",
    "MTM Program - Suit",
    "MTM Program - Trouser",
    "Wholesale - RTW",
    "RTW Wholesale - Accessory",
    "RTW Wholesale - Jacket",
    "RTW Wholesale - Shirt",
    "RTW Wholesale - Suit",
    "RTW Wholesale - Trouser",
    "Bespoke",
    "Bespoke Jacket",
    "Bespoke Other",
    "Bespoke Overcoat",
    "Bespoke Shirt",
    "Bespoke Suit",
    "Bespoke Trouser",
    "Bespoke Vest",
    "MTM",
    "MTM Jacket",
    "MTM Other",
    "MTM Overcoat",
    "MTM Shirt",
    "MTM Suit",
    "MTM Trouser",
    "MTM Vest",
    "Custom Made",
  ].map((s) => s.toLowerCase()),
);

/** Prefer these groups when present (C-curated RTW / stock / Tramarossa). */
const PREFER_GROUPS = new Set(
  [
    "Stock Garments",
    "RTW",
    "RTW Shirt",
    "RTW Trouser",
    "RTW Jacket",
    "RTW Suit",
    "RTW Accessory",
    "Tramarossa",
    "Tramarossa Jeans",
    "Tramarossa Jeans Colored",
    "Tramarossa Pants",
    "Tramarossa Bermuda",
  ].map((s) => s.toLowerCase()),
);

/** Always query these groups from ERP (plus env allow-list). */
const QUERY_GROUPS = [
  "Stock Garments",
  "RTW",
  "RTW Shirt",
  "RTW Trouser",
  "RTW Jacket",
  "RTW Suit",
  "RTW Accessory",
  "Tramarossa",
  "Tramarossa Jeans",
  "Tramarossa Jeans Colored",
  "Tramarossa Pants",
  "Tramarossa Bermuda",
];

const NYC_WAREHOUSES = [
  "NYC Showroom - LSTNY",
  "Finished Goods - LSTNY",
  "Stores - LSTNY",
];

export type SellableAvailability = "in" | "order" | "out";

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
  source: "erp" | "seed";
  eta?: string | null;
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

function uiGroupFrom(itemGroup: string, name: string): SellableItemDto["ui_group"] {
  const g = `${itemGroup} ${name}`.toLowerCase();
  if (/tramarossa/.test(g)) return "bottoms"; // brand line is bottoms-only for now
  if (/trouser|jean|chino|pant|bottom|skirt|bermuda/.test(g)) return "bottoms";
  if (/shirt|polo|tee|top|jacket|coat|overshirt|vest/.test(g)) return "tops";
  if (/accessor|belt|sock|cap|tie|scarf/.test(g)) return "accessories";
  if (/rtw trouser/.test(itemGroup.toLowerCase())) return "bottoms";
  if (/rtw shirt|rtw jacket/.test(itemGroup.toLowerCase())) return "tops";
  if (/rtw accessor/.test(itemGroup.toLowerCase())) return "accessories";
  return "other";
}

function envAllowGroups(): string[] {
  const raw = process.env.ALTS_SELLABLE_ITEM_GROUPS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isDeniedGroup(group: string): boolean {
  return DENY_GROUPS.has((group || "").toLowerCase());
}

function isPreferredGroup(group: string): boolean {
  const g = (group || "").toLowerCase();
  if (PREFER_GROUPS.has(g)) return true;
  if (g.startsWith("rtw") && !g.includes("wholesale")) return true;
  if (g.startsWith("tramarossa")) return true; // any future Tramarossa-* group
  if (g === "stock garments") return true;
  return envAllowGroups().some((a) => a.toLowerCase() === g);
}

function availabilityFrom(isStock: boolean, qty: number | null): SellableAvailability {
  if (!isStock) return "order";
  if (qty == null) return "order";
  if (qty > 0) return "in";
  // Stock item at 0 — special-orderable (not hard out) until ops loads bins.
  return "order";
}

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
  const ug = uiGroupFrom(itemGroup, name);
  if (ug === "bottoms") {
    return { Size: ["28", "30", "32", "34", "36", "38"] };
  }
  if (ug === "tops") {
    return { Size: ["S", "M", "L", "XL"] };
  }
  return { Size: ["One"] };
}

altsRouter.get("/sellable-items", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const q = (c.req.query("q") || "").trim().toLowerCase();
  const filter = (c.req.query("filter") || "all").toLowerCase(); // all|in|order|tops|bottoms
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 60) || 60, 1), 120);
  const origin = "NYC";
  const warehouse =
    c.req.query("warehouse") ||
    process.env.ALTS_SELL_WAREHOUSE ||
    NYC_WAREHOUSES[0];

  try {
    // 1) Prefer allow-listed groups
    let rows = await erpList<{
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
    }>("Item", {
      fields: [
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
      ],
      filters: [
        ["disabled", "=", 0],
        ["is_sales_item", "=", 1],
        [
          "item_group",
          "in",
          [...QUERY_GROUPS, ...envAllowGroups()],
        ],
      ],
      limit: 300,
      order_by: "item_name asc",
    });

    // 2) If empty, fall back to all sales items and filter client-side
    if (!rows.length) {
      const broad = await erpList<typeof rows[0]>("Item", {
        fields: [
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
        ],
        filters: [
          ["disabled", "=", 0],
          ["is_sales_item", "=", 1],
          ["brand", "=", "Tramarossa"],
        ],
        limit: 300,
        order_by: "item_name asc",
      });
      rows = broad.filter((r) => isPreferredGroup(r.item_group) && !isDeniedGroup(r.item_group));
    } else {
      rows = rows.filter((r) => !isDeniedGroup(r.item_group));
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
          color_label: guessColorLabel(name),
          source: "erp" as const,
          eta: avail === "order" ? "Special order" : null,
          attributes: defaultAttributesFor(r.item_group || "", name),
        };
      });
    }

    // Seed until RTW catalog exists
    if (!dto.length) {
      dto = SEED_CATALOG.map((s) => ({ ...s }));
    }

    // Filters
    if (q) {
      dto = dto.filter((d) => {
        const hay = `${d.item_name} ${d.item_code} ${d.color_label || ""} ${d.item_group}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (filter === "in") dto = dto.filter((d) => d.availability === "in");
    else if (filter === "order") dto = dto.filter((d) => d.availability === "order");
    else if (filter === "tops") dto = dto.filter((d) => d.ui_group === "tops");
    else if (filter === "bottoms") dto = dto.filter((d) => d.ui_group === "bottoms");

    dto = dto.slice(0, limit);

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
    let dto = SEED_CATALOG.map((s) => ({ ...s }));
    if (q) {
      dto = dto.filter((d) =>
        `${d.item_name} ${d.color_label || ""}`.toLowerCase().includes(q),
      );
    }
    return c.json({
      data: dto.slice(0, limit),
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
