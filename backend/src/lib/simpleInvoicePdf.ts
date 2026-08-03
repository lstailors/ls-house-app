/**
 * Edge-safe single-page invoice PDF (no native deps).
 * Public pay-page fallback when ERP/Gotenberg print is down.
 *
 * Liquid Glass tokens (Lucia brief 2026-08 — simpleInvoicePdf-reskin):
 *   Forest #1F3A2E · Cream #F1E9D6 · Brass #B08D57 · Deep #0D1A10
 * Type1 only: Helvetica family (Oblique ≈ display italic; no external fonts).
 */

// --- brand tokens (exact hex) ---
const FOREST = { r: 0x1f / 255, g: 0x3a / 255, b: 0x2e / 255 };
const DEEP = { r: 0x0d / 255, g: 0x1a / 255, b: 0x10 / 255 };
const CREAM = { r: 0xf1 / 255, g: 0xe9 / 255, b: 0xd6 / 255 };
const BRASS = { r: 0xb0 / 255, g: 0x8d / 255, b: 0x57 / 255 };
const MUTED = { r: 0xc9 / 255, g: 0xc0 / 255, b: 0xab / 255 };

/** Normalize client-visible text before PDF draw. */
function cleanText(s: string): string {
  return String(s)
    .replace(/\u00b4\u2022/g, "•") // mangled ´•
    .replace(/\u00b4/g, "") // stray acute
    .replace(/[·•∙⋅・]/g, " • ") // unify separators to bullet
    .replace(/\s+•\s+/g, " • ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Escape for PDF literal string with WinAnsi high-byte octals.
 * Avoids UTF-8 multi-byte bleed (was producing Â· / ´• in viewers).
 */
function pdfEscape(s: string): string {
  let out = "";
  const cleaned = cleanText(s);
  for (let i = 0; i < cleaned.length; i++) {
    const code = cleaned.charCodeAt(i);
    if (code === 0x5c) out += "\\\\";
    else if (code === 0x28) out += "\\(";
    else if (code === 0x29) out += "\\)";
    else if (code === 0x0a) out += "\\n";
    else if (code === 0x0d) out += "\\r";
    else if (code === 0x09) out += "\\t";
    else if (code === 0x2022) out += "\\267"; // • → middot in WinAnsi (·) as safe bullet
    else if (code >= 0x20 && code <= 0x7e) out += cleaned[i];
    else if (code >= 0xa0 && code <= 0xff) out += `\\${code.toString(8).padStart(3, "0")}`;
    else if (code === 0x2013 || code === 0x2014) out += "-"; // en/em dash
    else if (code === 0x2018 || code === 0x2019) out += "'";
    else if (code === 0x201c || code === 0x201d) out += '"';
    else if (code === 0x00a0) out += " ";
    else out += "?";
  }
  return out;
}

function rgb(c: { r: number; g: number; b: number }, mode: "f" | "s" = "f"): string {
  const t = `${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}`;
  return mode === "f" ? `${t} rg` : `${t} RG`;
}

export type SimplePdfLine = {
  name: string;
  description?: string;
  amountLabel?: string;
};

export type SimplePdfInvoice = {
  title?: string;
  invoiceId: string;
  customerName: string;
  postingDate?: string | null;
  statusLabel: string; // "Paid in Full" | "Balance Due"
  amountLabel: string;
  lines: SimplePdfLine[];
  subtotalLabel?: string | null;
  taxLabel?: string | null;
  discountLabel?: string | null;
  footerNote?: string;
};

/** Approx Helvetica advance width (non-condensed). */
function approxWidth(str: string, size: number): number {
  return cleanText(str).length * size * 0.5;
}

/** Build a letter-size Liquid Glass PDF (612×792). Returns Uint8Array. */
export function buildSimpleInvoicePdf(inv: SimplePdfInvoice): Uint8Array {
  const W = 612;
  const H = 792;
  const margin = 48; // 24pt edge breathing room beyond content inset feel
  const contentW = W - margin * 2;
  const right = margin + contentW;

  type Op = string;
  const ops: Op[] = [];
  let y = H - margin;

  const fillRect = (x: number, yy: number, w: number, h: number, c: typeof FOREST) => {
    ops.push(rgb(c, "f"));
    ops.push(`${x.toFixed(1)} ${yy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
  };
  const strokeRect = (
    x: number,
    yy: number,
    w: number,
    h: number,
    c: typeof BRASS,
    lw = 1,
  ) => {
    ops.push(rgb(c, "s"));
    ops.push(`${lw} w`);
    ops.push(`${x.toFixed(1)} ${yy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re S`);
  };
  const hRule = (x1: number, yy: number, x2: number, c: typeof BRASS, lw = 1) => {
    ops.push(rgb(c, "s"));
    ops.push(`${lw} w`);
    ops.push(`${x1.toFixed(1)} ${yy.toFixed(1)} m ${x2.toFixed(1)} ${yy.toFixed(1)} l S`);
  };

  type FontId = "F1" | "F2" | "F3" | "F4";
  const text = (
    str: string,
    x: number,
    yy: number,
    size: number,
    opts?: { font?: FontId; color?: typeof DEEP; charSpace?: number },
  ) => {
    const font = opts?.font ?? "F1";
    const color = opts?.color ?? DEEP;
    ops.push(rgb(color, "f"));
    ops.push("BT");
    ops.push(`/${font} ${size} Tf`);
    if (opts?.charSpace != null) ops.push(`${opts.charSpace.toFixed(2)} Tc`);
    ops.push(`${x.toFixed(1)} ${yy.toFixed(1)} Td`);
    ops.push(`(${pdfEscape(str)}) Tj`);
    if (opts?.charSpace != null) ops.push(`0 Tc`);
    ops.push("ET");
  };

  const textRight = (
    str: string,
    rightX: number,
    yy: number,
    size: number,
    opts?: { font?: FontId; color?: typeof DEEP; charSpace?: number },
  ) => {
    const w = approxWidth(str, size);
    text(str, rightX - w, yy, size, opts);
  };

  const label = (str: string, x: number, yy: number) =>
    text(str.toUpperCase(), x, yy, 7, {
      font: "F2",
      color: BRASS,
      charSpace: 1.2,
    });

  // --- full cream page ---
  fillRect(0, 0, W, H, CREAM);

  // --- forest header band ---
  const headerH = 118;
  fillRect(0, H - headerH, W, headerH, FOREST);

  // left brass spine accent
  fillRect(0, 0, 6, H, BRASS);

  // wordmark + brass rule under it
  text("L&S Custom Tailors", margin, H - 42, 16, {
    font: "F3",
    color: CREAM,
  });
  hRule(margin, H - 50, margin + 200, BRASS, 1);

  text("Custom Tailors  ·  Est. 1974", margin, H - 66, 8, {
    font: "F1",
    color: MUTED,
    charSpace: 0.6,
  });

  // display title (italic) + amount
  const title = inv.title || "Invoice";
  text(title, margin, H - 96, 22, { font: "F3", color: CREAM });

  // Paid / status pill — brass border, cream text on forest
  const pillLabel = cleanText(inv.statusLabel || "Invoice").toUpperCase();
  const pillW = Math.max(88, approxWidth(pillLabel, 8) + 28);
  const pillH = 22;
  const pillX = right - pillW;
  const pillY = H - 48;
  // fill slightly deeper forest so border reads
  fillRect(pillX, pillY, pillW, pillH, DEEP);
  strokeRect(pillX, pillY, pillW, pillH, BRASS, 1.25);
  const pillTextW = approxWidth(pillLabel, 8);
  text(pillLabel, pillX + (pillW - pillTextW) / 2, pillY + 7, 8, {
    font: "F2",
    color: CREAM,
    charSpace: 1.0,
  });

  // large amount (display italic)
  textRight(inv.amountLabel, right, H - 96, 20, {
    font: "F3",
    color: BRASS,
  });

  // --- meta block ---
  y = H - headerH - 36;
  label("Invoice", margin, y);
  text(inv.invoiceId, margin + 72, y - 1, 10, { font: "F2", color: DEEP });
  y -= 22;
  label("Customer", margin, y);
  text(cleanText(inv.customerName).slice(0, 48), margin + 72, y - 1, 10, {
    font: "F1",
    color: DEEP,
  });
  if (inv.postingDate) {
    y -= 22;
    label("Date", margin, y);
    text(String(inv.postingDate), margin + 72, y - 1, 10, {
      font: "F1",
      color: DEEP,
    });
  }

  // brass rule before items
  y -= 28;
  hRule(margin, y, right, BRASS, 1);
  y -= 22;
  label("Items", margin, y);
  y -= 18;

  for (const row of inv.lines.slice(0, 20)) {
    if (y < 150) break;
    text(cleanText(row.name).slice(0, 52), margin, y, 10, {
      font: "F2",
      color: DEEP,
    });
    if (row.amountLabel) {
      textRight(row.amountLabel, right, y, 10, { font: "F2", color: DEEP });
    }
    y -= 13;
    if (row.description) {
      const d = cleanText(row.description).slice(0, 86);
      text(d, margin, y, 8, { font: "F1", color: { r: 0.35, g: 0.38, b: 0.32 } });
      y -= 12;
    }
    y -= 8; // generous rhythm between line items
  }

  // brass rule above totals
  y -= 6;
  hRule(margin, y, right, BRASS, 1);
  y -= 22;

  if (inv.subtotalLabel) {
    label("Subtotal", margin, y);
    textRight(inv.subtotalLabel, right, y, 9, { font: "F1", color: DEEP });
    y -= 18;
  }
  if (inv.taxLabel) {
    label("Tax", margin, y);
    textRight(inv.taxLabel, right, y, 9, { font: "F1", color: DEEP });
    y -= 18;
  }
  if (inv.discountLabel) {
    label("Discount", margin, y);
    textRight(inv.discountLabel, right, y, 9, { font: "F1", color: DEEP });
    y -= 18;
  }

  // status + amount row
  y -= 4;
  text(cleanText(inv.statusLabel), margin, y, 12, {
    font: "F3",
    color: FOREST,
  });
  textRight(inv.amountLabel, right, y, 14, {
    font: "F3",
    color: FOREST,
  });

  // --- footer band ---
  const footH = 64;
  fillRect(0, 0, W, footH, FOREST);
  fillRect(0, 0, 6, footH, BRASS);

  const note =
    inv.footerNote ||
    "138 E 61st Street, Suite 201  ·  New York, NY 10065  ·  (212) 308-4431  ·  Handcrafted since 1974";
  text(cleanText(note).slice(0, 100), margin, 34, 7, {
    font: "F1",
    color: MUTED,
    charSpace: 0.3,
  });
  text("Generated for your records  ·  L&S Custom Tailors", margin, 18, 7, {
    font: "F1",
    color: MUTED,
    charSpace: 0.4,
  });

  const stream = ops.join("\n") + "\n";
  const streamBytes = new TextEncoder().encode(stream);

  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push(
    "3 0 obj\n" +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R /F4 8 0 R >> >> >>\n` +
      "endobj\n",
  );
  objects.push(
    `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${stream}endstream\nendobj\n`,
  );
  // WinAnsiEncoding so high-byte octals (middot etc.) paint correctly
  const type1 = (name: string) =>
    `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  objects.push(`5 0 obj\n${type1("Helvetica")}\nendobj\n`);
  objects.push(`6 0 obj\n${type1("Helvetica-Bold")}\nendobj\n`);
  objects.push(`7 0 obj\n${type1("Helvetica-Oblique")}\nendobj\n`);
  objects.push(`8 0 obj\n${type1("Helvetica-BoldOblique")}\nendobj\n`);

  const enc = new TextEncoder();
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  let pos = enc.encode(pdf).length;
  for (const obj of objects) {
    offsets.push(pos);
    pdf += obj;
    pos += enc.encode(obj).length;
  }
  const xrefPos = pos;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefPos}\n%%EOF\n`;

  return enc.encode(pdf);
}

export function formatMoneyUsd(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  const neg = v < 0;
  const abs = Math.abs(v);
  const fixed = abs.toFixed(2);
  return `${neg ? "-" : ""}$${fixed}`;
}
