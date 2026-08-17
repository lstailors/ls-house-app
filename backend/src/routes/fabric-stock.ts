import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpGet, erpList, erpUpdate } from "../lib/erp";
import {
  STOCK_LIST_FIELDS,
  indexFilesByName,
  indexYzstkItems,
  serializeStockPiece,
  type FileHint,
  type ItemHint,
  type StockPieceRow,
} from "../lib/fabric-stock";

export const fabricStockRouter = new Hono();

const DOCTYPE = "LSH Fabric Stock Piece";

async function loadPhotoIndexes() {
  const [lstFiles, sdcFiles, yzFiles, items] = await Promise.all([
    erpList<FileHint>("File", {
      filters: [["file_name", "like", "LST STOCK FABRIC%"]],
      fields: ["name", "file_name", "file_url"],
      limit: 500,
    }),
    erpList<FileHint>("File", {
      filters: [["file_name", "like", "SDC STOCK FABRIC%"]],
      fields: ["name", "file_name", "file_url"],
      limit: 500,
    }),
    erpList<FileHint>("File", {
      filters: [["file_name", "like", "YZSTK-%"]],
      fields: ["name", "file_name", "file_url"],
      limit: 500,
    }),
    erpList<ItemHint>("Item", {
      filters: [["name", "like", "YZSTK-%"]],
      fields: ["name", "image"],
      limit: 500,
    }),
  ]);
  return {
    filesByName: indexFilesByName([...lstFiles, ...sdcFiles, ...yzFiles]),
    yzstkImages: indexYzstkItems(items),
  };
}

function buildFilters(q: {
  status?: string;
  kind?: string;
  source?: string;
}): unknown[] {
  const filters: unknown[] = [];
  if (q.status) filters.push(["status", "=", q.status]);
  if (q.kind) filters.push(["kind", "=", q.kind]);
  if (q.source) filters.push(["source", "=", q.source]);
  return filters;
}

function matchesSearch(row: StockPieceRow, search: string): boolean {
  const hay = [
    row.title,
    row.visual_description,
    row.customer_ref,
    row.pattern_no,
    row.supplier_mill,
    row.label_description,
    row.filename,
    row.sku,
    row.notes,
    row.piece_tag,
    row.order_no,
    row.composition,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(search.toLowerCase());
}

fabricStockRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const status = (c.req.query("status") || "").trim();
  const kind = (c.req.query("kind") || "").trim();
  const source = (c.req.query("source") || "").trim();
  const search = (c.req.query("q") || "").trim();
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") || 300)));

  try {
    const [rows, indexes] = await Promise.all([
      erpList<StockPieceRow>(DOCTYPE, {
        filters: buildFilters({ status, kind, source }),
        fields: [...STOCK_LIST_FIELDS],
        limit,
        order_by: "piece_no asc",
        throwOnError: true,
      }),
      loadPhotoIndexes(),
    ]);

    const filtered = search ? rows.filter((row) => matchesSearch(row, search)) : rows;
    const items = filtered.map((row) =>
      serializeStockPiece(row, indexes.filesByName, indexes.yzstkImages),
    );

    const allForCounts = await erpList<StockPieceRow>(DOCTYPE, {
      fields: ["name", "status", "kind", "source"],
      limit: 500,
    }).catch(() => rows);

    const counts = {
      total: allForCounts.length,
      available: allForCounts.filter((r) => r.status === "Available").length,
      used: allForCounts.filter((r) => r.status === "Used").length,
      fabric: allForCounts.filter((r) => r.status === "Available" && r.kind === "fabric").length,
      lining: allForCounts.filter((r) => r.status === "Available" && r.kind === "lining").length,
      buttons: allForCounts.filter((r) => r.status === "Available" && r.kind === "buttons").length,
      yz: allForCounts.filter((r) => r.status === "Available" && r.source === "YZ").length,
      sdc: allForCounts.filter((r) => r.status === "Available" && r.source === "SDC").length,
      lst: allForCounts.filter((r) => r.status === "Available" && r.source === "LST").length,
      photos: items.filter((i) => i.photoUrl).length,
    };

    return c.json({ data: { items, counts } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Stock load failed";
    return c.json({ error: { message } }, 500);
  }
});

fabricStockRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  try {
    const [row, indexes] = await Promise.all([
      erpGet<StockPieceRow>(DOCTYPE, id),
      loadPhotoIndexes(),
    ]);
    if (!row) return c.json({ error: { message: "Piece not found" } }, 404);
    return c.json({ data: serializeStockPiece(row, indexes.filesByName, indexes.yzstkImages) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Load failed";
    return c.json({ error: { message } }, 500);
  }
});

fabricStockRouter.post("/:id/use", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { usedFor?: string };
  try {
    const existing = await erpGet<StockPieceRow>(DOCTYPE, id);
    if (!existing) return c.json({ error: { message: "Piece not found" } }, 404);

    const updated = await erpUpdate<StockPieceRow>(DOCTYPE, id, {
      status: "Used",
      used_on: new Date().toISOString().slice(0, 19).replace("T", " "),
      used_by: user.email,
      used_for: (body.usedFor || "").trim() || existing.used_for,
    });
    if (!updated) return c.json({ error: { message: "Could not mark used" } }, 500);

    const indexes = await loadPhotoIndexes();
    return c.json({ data: serializeStockPiece(updated, indexes.filesByName, indexes.yzstkImages) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Could not mark used";
    return c.json({ error: { message } }, 500);
  }
});
