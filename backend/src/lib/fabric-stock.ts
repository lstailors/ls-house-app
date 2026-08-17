/** Resolve factory-stock photos from every ERP source we actually have. */

export type StockPieceRow = {
  name: string;
  title?: string | null;
  piece_no?: number | null;
  filename?: string | null;
  status?: string | null;
  kind?: string | null;
  source?: string | null;
  photo?: string | null;
  photo_url?: string | null;
  label_type?: string | null;
  supplier_mill?: string | null;
  order_no?: string | null;
  pattern_no?: string | null;
  piece_tag?: string | null;
  location?: string | null;
  length_yds?: number | null;
  handwritten_qty?: string | null;
  customer_ref?: string | null;
  label_description?: string | null;
  sku?: string | null;
  price_per_yd?: number | null;
  width?: string | null;
  composition?: string | null;
  visual_description?: string | null;
  notes?: string | null;
  used_on?: string | null;
  used_by?: string | null;
  used_for?: string | null;
  sales_order?: string | null;
};

export type FileHint = {
  file_name?: string | null;
  file_url?: string | null;
};

export type ItemHint = {
  name?: string | null;
  image?: string | null;
};

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|gif)$/i;

export function yzstkCode(pieceNo: number | null | undefined): string | null {
  if (pieceNo == null || !Number.isFinite(Number(pieceNo))) return null;
  const n = Math.trunc(Number(pieceNo));
  if (n <= 0) return null;
  return `YZSTK-${String(n).padStart(3, "0")}`;
}

export function isErpFilePath(value: string | null | undefined): value is string {
  if (!value) return false;
  const path = stripOrigin(value);
  return path.startsWith("/files/") || path.startsWith("/private/files/");
}

export function stripOrigin(value: string): string {
  return value.replace(/^https?:\/\/[^/]+/i, "");
}

export function safeErpFilePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let path = stripOrigin(raw.trim());
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.includes("..")) return null;
  if (!path.startsWith("/files/") && !path.startsWith("/private/files/")) return null;
  return path;
}

export function photoProxyUrl(fileUrl: string): string {
  const path = safeErpFilePath(fileUrl);
  if (!path) return "";
  return `/api/files/erp?path=${encodeURIComponent(path)}`;
}

/** Public ERP /files URLs the browser can load as a normal <img>. Private files stay proxied. */
export function browserPhotoUrl(fileUrl: string): string {
  const path = safeErpFilePath(fileUrl);
  if (!path) return "";
  if (path.startsWith("/private/")) return photoProxyUrl(path);
  const base = (process.env.ERPNEXT_PUBLIC_FILE_BASE || process.env.ERPNEXT_BASE_URL || "https://erp.lstailors.com").replace(
    /\/$/,
    "",
  );
  return `${base}${path}`;
}

function pickBestFileUrl(candidates: FileHint[]): string | null {
  const urls = candidates
    .map((f) => (f.file_url || "").trim())
    .filter((url) => isErpFilePath(url) && IMAGE_EXT.test(url));
  if (!urls.length) return null;
  const publicExact = urls.find((u) => u.startsWith("/files/") && !/[a-f0-9]{5,}\.(jpe?g|png|webp)$/i.test(u));
  if (publicExact) return publicExact;
  const publicAny = urls.find((u) => u.startsWith("/files/"));
  if (publicAny) return publicAny;
  return urls[0] ?? null;
}

export function indexFilesByName(files: FileHint[]): Map<string, string> {
  const grouped = new Map<string, FileHint[]>();
  for (const file of files) {
    const name = (file.file_name || "").trim();
    if (!name) continue;
    const list = grouped.get(name) ?? [];
    list.push(file);
    grouped.set(name, list);
  }
  const out = new Map<string, string>();
  for (const [name, list] of grouped) {
    const url = pickBestFileUrl(list);
    if (url) out.set(name, url);
  }
  return out;
}

export function indexYzstkItems(items: ItemHint[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of items) {
    const name = (item.name || "").trim().toUpperCase();
    if (!name.startsWith("YZSTK-")) continue;
    if (item.image && isErpFilePath(item.image)) out.set(name, stripOrigin(item.image));
  }
  return out;
}

export function resolvePiecePhoto(
  piece: Pick<StockPieceRow, "photo" | "photo_url" | "filename" | "piece_no">,
  filesByName: Map<string, string>,
  yzstkImages: Map<string, string>,
): string | null {
  if (isErpFilePath(piece.photo)) return stripOrigin(piece.photo);
  if (isErpFilePath(piece.photo_url)) return stripOrigin(piece.photo_url);

  const filename = (piece.filename || "").trim();
  if (filename && filesByName.has(filename)) return filesByName.get(filename) ?? null;

  const code = yzstkCode(piece.piece_no);
  if (code) {
    const exact = filesByName.get(`${code}.jpg`) || filesByName.get(`${code}.JPG`);
    if (exact) return exact;
    const itemImage = yzstkImages.get(code);
    if (itemImage) return itemImage;
    for (const [name, url] of filesByName) {
      if (name.toUpperCase().startsWith(`${code}-`) && IMAGE_EXT.test(name)) return url;
    }
  }
  return null;
}

export function serializeStockPiece(
  row: StockPieceRow,
  filesByName: Map<string, string>,
  yzstkImages: Map<string, string>,
) {
  const fileUrl = resolvePiecePhoto(row, filesByName, yzstkImages);
  return {
    id: row.name,
    title: row.title || row.visual_description || row.name,
    pieceNo: row.piece_no ?? null,
    filename: row.filename || null,
    status: row.status || "Available",
    kind: row.kind || null,
    source: row.source || null,
    photoUrl: fileUrl ? browserPhotoUrl(fileUrl) : null,
    photoPath: fileUrl,
    labelType: row.label_type || null,
    supplierMill: row.supplier_mill || null,
    orderNo: row.order_no || null,
    patternNo: row.pattern_no || null,
    pieceTag: row.piece_tag || null,
    location: row.location || null,
    lengthYds: row.length_yds ?? null,
    handwrittenQty: row.handwritten_qty || null,
    customerRef: row.customer_ref || null,
    labelDescription: row.label_description || null,
    sku: row.sku || null,
    pricePerYd: row.price_per_yd ?? null,
    width: row.width || null,
    composition: row.composition || null,
    visualDescription: row.visual_description || null,
    notes: row.notes || null,
    usedOn: row.used_on || null,
    usedBy: row.used_by || null,
    usedFor: row.used_for || null,
    salesOrder: row.sales_order || null,
  };
}

export const STOCK_LIST_FIELDS = [
  "name",
  "title",
  "piece_no",
  "filename",
  "status",
  "kind",
  "source",
  "photo",
  "photo_url",
  "label_type",
  "supplier_mill",
  "order_no",
  "pattern_no",
  "piece_tag",
  "location",
  "length_yds",
  "handwritten_qty",
  "customer_ref",
  "label_description",
  "sku",
  "price_per_yd",
  "width",
  "composition",
  "visual_description",
  "notes",
  "used_on",
  "used_by",
  "used_for",
  "sales_order",
] as const;
