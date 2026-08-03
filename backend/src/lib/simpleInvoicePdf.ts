/**
 * Minimal single-page PDF writer (Edge-safe, no native deps).
 * Used as public pay-page fallback when ERP wkhtmltopdf fails.
 * Helvetica only — no external fonts/images.
 */

function pdfEscape(s: string): string {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, (ch) => {
      // Drop non-latin1 that break simple PDF text operators
      const code = ch.charCodeAt(0);
      if (code >= 0xa0 && code <= 0xff) return ch;
      return "?";
    });
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

/** Build a simple letter-size PDF (612x792). Returns Uint8Array. */
export function buildSimpleInvoicePdf(inv: SimplePdfInvoice): Uint8Array {
  const W = 612;
  const H = 792;
  const margin = 48;
  const contentWidth = W - margin * 2;

  type Op = string;
  const ops: Op[] = [];
  let y = H - margin;

  const move = (ny: number) => {
    y = ny;
  };
  const line = (x1: number, y1: number, x2: number, y2: number, gray = 0.7) => {
    ops.push(`${gray} g`); // fill not used
    ops.push(`${gray} G`);
    ops.push(`0.5 w`);
    ops.push(`${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`);
  };
  const text = (str: string, x: number, yy: number, size: number, opts?: { bold?: boolean }) => {
    const font = opts?.bold ? "F2" : "F1";
    ops.push("BT");
    ops.push(`/${font} ${size} Tf`);
    ops.push(`${x.toFixed(1)} ${yy.toFixed(1)} Td`);
    ops.push(`(${pdfEscape(str)}) Tj`);
    ops.push("ET");
  };
  const textRight = (str: string, rightX: number, yy: number, size: number, opts?: { bold?: boolean }) => {
    // Approximate width: 0.5 * size * charCount for Helvetica
    const w = str.length * size * 0.5;
    text(str, rightX - w, yy, size, opts);
  };

  // Header band (forest-ish dark via gray)
  ops.push("0.08 0.14 0.10 rg");
  ops.push(`${margin - 12} ${H - 110} ${contentWidth + 24} 78 re f`);

  text("L&S Custom Tailors", margin, H - 58, 18, { bold: true });
  text(inv.title || "Invoice", margin, H - 78, 10);
  text(inv.statusLabel, margin + 280, H - 58, 12, { bold: true });
  textRight(inv.amountLabel, margin + contentWidth, H - 78, 14, { bold: true });

  move(H - 130);
  text(`Invoice  ${inv.invoiceId}`, margin, y, 11, { bold: true });
  move(y - 16);
  text(`Customer  ${inv.customerName}`, margin, y, 10);
  if (inv.postingDate) {
    move(y - 14);
    text(`Date  ${inv.postingDate}`, margin, y, 10);
  }

  move(y - 22);
  line(margin, y, margin + contentWidth, y, 0.55);
  move(y - 18);
  text("ITEMS", margin, y, 8, { bold: true });
  move(y - 14);

  for (const row of inv.lines.slice(0, 24)) {
    if (y < 120) break;
    text(row.name.slice(0, 60), margin, y, 10, { bold: true });
    if (row.amountLabel) textRight(row.amountLabel, margin + contentWidth, y, 10);
    move(y - 12);
    if (row.description) {
      const d = row.description.slice(0, 90);
      text(d, margin, y, 8);
      move(y - 12);
    }
    move(y - 6);
  }

  move(y - 4);
  line(margin, y, margin + contentWidth, y, 0.55);
  move(y - 18);

  if (inv.subtotalLabel) {
    text("Subtotal", margin, y, 9);
    textRight(inv.subtotalLabel, margin + contentWidth, y, 9);
    move(y - 14);
  }
  if (inv.taxLabel) {
    text("Tax", margin, y, 9);
    textRight(inv.taxLabel, margin + contentWidth, y, 9);
    move(y - 14);
  }
  if (inv.discountLabel) {
    text("Discount", margin, y, 9);
    textRight(inv.discountLabel, margin + contentWidth, y, 9);
    move(y - 14);
  }

  text(inv.statusLabel, margin, y, 11, { bold: true });
  textRight(inv.amountLabel, margin + contentWidth, y, 14, { bold: true });
  move(y - 28);

  const note =
    inv.footerNote ||
    "138 E 61st Street, Suite 201 · New York, NY 10065 · (212) 308-4431 · Handcrafted since 1974";
  text(note.slice(0, 95), margin, 56, 8);
  text("Generated for your records · L&S Custom Tailors", margin, 42, 8);

  const stream = ops.join("\n") + "\n";
  const streamBytes = new TextEncoder().encode(stream);

  // Object graph
  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push(
    "3 0 obj\n" +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\n` +
      "endobj\n",
  );
  objects.push(
    `4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${stream}endstream\nendobj\n`,
  );
  objects.push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  objects.push("6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n");

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
