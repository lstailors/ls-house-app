/**
 * Fabric stock remnant gallery — ERP LSH Fabric Stock Piece SoT.
 * List/filter/detail + mark Used (removes from available stock).
 */
import { Hono } from "hono";
import { z } from "zod";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet, erpUpdate, erpCount } from "../lib/erp";

export const fabricStockRouter = new Hono();

const DOCTYPE = "LSH Fabric Stock Piece";

const LIST_FIELDS = [
  "name",
  "title",
  "piece_no",
  "filename",
  "status",
  "kind",
  "source",
  "photo",
  "photo_url",
  "supplier_mill",
  "pattern_no",
  "piece_tag",
  "location",
  "length_yds",
  "customer_ref",
  "label_description",
  "composition",
  "visual_description",
  "sku",
  "modified",
] as const;

type StockRow = {
  name: string;
  title?: string;
  piece_no?: number;
  filename?: string;
  status?: string;
  kind?: string;
  source?: string;
  photo?: string;
  photo_url?: string;
  supplier_mill?: string;
  pattern_no?: string;
  piece_tag?: string;
  location?: string;
  length_yds?: number;
  customer_ref?: string;
  label_description?: string;
  composition?: string;
  visual_description?: string;
  sku?: string;
  label_type?: string;
  order_no?: string;
  handwritten_qty?: string;
  width?: string;
  notes?: string;
  price_per_yd?: number;
  used_on?: string;
  used_by?: string;
  used_for?: string;
  sales_order?: string;
  modified?: string;
};

function photoProxy(name: string, row: StockRow): string | null {
  if (row.photo_url && /^https?:\/\//i.test(row.photo_url)) return row.photo_url;
  if (row.photo) return `/api/fabric-stock/${encodeURIComponent(name)}/photo`;
  return null;
}

function mapCard(row: StockRow) {
  return {
    id: row.name,
    pieceNo: row.piece_no ?? null,
    title: row.title || row.visual_description || row.name,
    status: row.status || "Available",
    kind: row.kind || "fabric",
    source: row.source || "LST",
    photoUrl: photoProxy(row.name, row),
    supplierMill: row.supplier_mill || "",
    patternNo: row.pattern_no || "",
    pieceTag: row.piece_tag || "",
    location: row.location || "",
    lengthYds: row.length_yds ?? null,
    customerRef: row.customer_ref || "",
    labelDescription: row.label_description || "",
    composition: row.composition || "",
    visualDescription: row.visual_description || "",
    sku: row.sku || "",
    modified: row.modified || null,
  };
}

function mapDetail(row: StockRow) {
  return {
    ...mapCard(row),
    filename: row.filename || "",
    labelType: row.label_type || "",
    orderNo: row.order_no || "",
    handwrittenQty: row.handwritten_qty || "",
    width: row.width || "",
    notes: row.notes || "",
    pricePerYd: row.price_per_yd ?? null,
    usedOn: row.used_on || null,
    usedBy: row.used_by || null,
    usedFor: row.used_for || null,
    salesOrder: row.sales_order || null,
    photoFile: row.photo || null,
  };
}

// GET /api/fabric-stock?status=&kind=&source=&q=&limit=&start=
fabricStockRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const status = (c.req.query("status") || "").trim();
  const kind = (c.req.query("kind") || "").trim();
  const source = (c.req.query("source") || "").trim();
  const q = (c.req.query("q") || "").trim();
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 200) || 200, 1), 500);
  const start = Math.max(Number(c.req.query("start") || 0) || 0, 0);

  const filters: unknown[] = [];
  if (status) filters.push(["status", "=", status]);
  if (kind) filters.push(["kind", "=", kind]);
  if (source) filters.push(["source", "=", source]);

  const or_filters: unknown[] = [];
  if (q.length >= 1) {
    const like = `%${q}%`;
    for (const f of [
      "title",
      "visual_description",
      "customer_ref",
      "pattern_no",
      "piece_tag",
      "supplier_mill",
      "label_description",
      "composition",
      "sku",
      "filename",
      "notes",
    ]) {
      or_filters.push([f, "like", like]);
    }
    // piece_no exact if numeric
    if (/^\d+$/.test(q)) {
      or_filters.push(["piece_no", "=", Number(q)]);
    }
  }

  try {
    const rows = await erpList<StockRow>(DOCTYPE, {
      filters,
      or_filters: or_filters.length ? or_filters : undefined,
      fields: [...LIST_FIELDS],
      limit,
      start,
      order_by: "piece_no asc",
      throwOnError: true,
    });

    const [available, used, fabric, lining, buttons, yz, sdc, lst] = await Promise.all([
      erpCount(DOCTYPE, [["status", "=", "Available"]]),
      erpCount(DOCTYPE, [["status", "=", "Used"]]),
      erpCount(DOCTYPE, [
        ["status", "=", "Available"],
        ["kind", "=", "fabric"],
      ]),
      erpCount(DOCTYPE, [
        ["status", "=", "Available"],
        ["kind", "=", "lining"],
      ]),
      erpCount(DOCTYPE, [
        ["status", "=", "Available"],
        ["kind", "=", "buttons"],
      ]),
      erpCount(DOCTYPE, [
        ["status", "=", "Available"],
        ["source", "=", "YZ"],
      ]),
      erpCount(DOCTYPE, [
        ["status", "=", "Available"],
        ["source", "=", "SDC"],
      ]),
      erpCount(DOCTYPE, [
        ["status", "=", "Available"],
        ["source", "=", "LST"],
      ]),
    ]);

    return c.json({
      data: {
        items: rows.map(mapCard),
        counts: {
          available,
          used,
          fabric,
          lining,
          buttons,
          yz,
          sdc,
          lst,
          total: available + used,
        },
        paging: { start, limit, returned: rows.length },
      },
    });
  } catch (e: any) {
    return c.json(
      { error: { message: e?.message || "Failed to load fabric stock" } },
      502,
    );
  }
});

// GET /api/fabric-stock/:id
fabricStockRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const id = c.req.param("id");
  try {
    const row = await erpGet<StockRow>(DOCTYPE, id);
    if (!row) return c.json({ error: { message: "Not found" } }, 404);
    return c.json({ data: mapDetail(row) });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Failed" } }, 502);
  }
});

// GET /api/fabric-stock/:id/photo — proxy ERP file / redirect CDN
fabricStockRouter.get("/:id/photo", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const id = c.req.param("id");
  const row = await erpGet<StockRow>(DOCTYPE, id);
  if (!row) return c.json({ error: { message: "Not found" } }, 404);

  if (row.photo_url && /^https?:\/\//i.test(row.photo_url)) {
    return c.redirect(row.photo_url, 302);
  }

  const fileUrl = row.photo;
  if (!fileUrl) return c.json({ error: { message: "No photo" } }, 404);

  const base = process.env.ERPNEXT_BASE_URL ?? "";
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const secret = process.env.ERPNEXT_API_SECRET ?? "";
  if (!base || !key || !secret) {
    return c.json({ error: { message: "ERP credentials missing" } }, 500);
  }

  const absolute = fileUrl.startsWith("http")
    ? fileUrl
    : `${base.replace(/\/$/, "")}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;

  const res = await fetch(absolute, {
    headers: {
      Authorization: `token ${key}:${secret}`,
      "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0)",
      Accept: "image/*,*/*",
    },
  });
  if (!res.ok) {
    return c.json({ error: { message: `Photo fetch ${res.status}` } }, 502);
  }
  const buf = await res.arrayBuffer();
  const ct = res.headers.get("content-type") || "image/jpeg";
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Cache-Control": "private, max-age=3600",
    },
  });
});

const useBody = z.object({
  usedFor: z.string().max(500).optional(),
  salesOrder: z.string().max(140).optional(),
  note: z.string().max(1000).optional(),
});

// POST /api/fabric-stock/:id/use — mark Used (only mutating action)
fabricStockRouter.post("/:id/use", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const id = c.req.param("id");

  let body: z.infer<typeof useBody> = {};
  try {
    const raw = await c.req.json().catch(() => ({}));
    body = useBody.parse(raw ?? {});
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Invalid body" } }, 400);
  }

  const row = await erpGet<StockRow>(DOCTYPE, id);
  if (!row) return c.json({ error: { message: "Not found" } }, 404);
  if (row.status === "Used") {
    return c.json({ error: { message: "Already marked used" } }, 409);
  }

  const usedBy = (user as any).name || (user as any).email || "staff";
  const usedForParts = [body.usedFor, body.note].filter(Boolean);
  const now = new Date();
  // America/New_York-ish display not required — ISO fine for Datetime
  const usedOn = now.toISOString().slice(0, 19).replace("T", " ");

  const updated = await erpUpdate<StockRow>(DOCTYPE, id, {
    status: "Used",
    used_on: usedOn,
    used_by: String(usedBy).slice(0, 140),
    used_for: usedForParts.join(" — ").slice(0, 500) || "Marked used in Alts Stock",
    sales_order: body.salesOrder || undefined,
  });

  if (!updated) {
    return c.json({ error: { message: "ERP update failed" } }, 502);
  }

  return c.json({ data: mapDetail(updated) });
});
