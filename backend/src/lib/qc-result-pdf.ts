import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { QcCheck } from "./qc";

export type QcResultPdfInput = {
  result: "Pass" | "Fail";
  inspection: string;
  customerName?: string | null;
  salesOrder?: string | null;
  customOrder?: string | null;
  inspector?: string | null;
  notes?: string | null;
  checks: QcCheck[];
  signedAt?: string | null;
  signaturePng?: Uint8Array | null;
};

export function formatQcChecksText(checks: QcCheck[]): string {
  const lines: string[] = [];
  let group = "";
  for (const row of checks) {
    if (row.group !== group) {
      group = row.group;
      lines.push("", group.toUpperCase());
    }
    const mark = row.pass === true ? "PASS" : row.pass === false ? "FAIL" : "SKIP";
    lines.push(`  [${mark}] ${row.label}`);
  }
  return lines.join("\n").trim();
}

export function formatQcResultSummary(input: QcResultPdfInput): string {
  const order = [input.customOrder, input.salesOrder].filter(Boolean).join(" · ");
  return [
    `Result: ${input.result}`,
    `Client: ${input.customerName || "Client"}`,
    `Inspection: ${input.inspection}`,
    order ? `Order: ${order}` : "",
    input.inspector ? `Inspector: ${input.inspector}` : "",
    input.notes ? `Notes: ${input.notes}` : "",
    "",
    formatQcChecksText(input.checks),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > width) {
      if (cur) lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export async function buildQcResultPdf(input: QcResultPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [612, 792];
  let page = doc.addPage(pageSize);
  let y = 752;
  const left = 48;
  const forest = rgb(0.08, 0.16, 0.1);
  const brass = rgb(0.72, 0.58, 0.28);
  const ink = rgb(0.12, 0.12, 0.12);
  const dim = rgb(0.35, 0.35, 0.35);

  const ensure = (need: number) => {
    if (y - need < 56) {
      page = doc.addPage(pageSize);
      y = 752;
    }
  };

  const line = (text: string, size: number, face = font, color = ink) => {
    ensure(size + 6);
    page.drawText(text.slice(0, 110), { x: left, y, size, font: face, color });
    y -= size + 6;
  };

  line("L&S  ·  QUALITY CONTROL", 10, bold, brass);
  line(input.result === "Pass" ? "PASS" : "FAIL", 28, bold, forest);
  line(input.customerName || "Client", 16, bold);
  const order = [input.customOrder, input.salesOrder, input.inspection].filter(Boolean).join("  ·  ");
  if (order) line(order, 10, font, dim);
  if (input.inspector) line(`Inspector  ${input.inspector}`, 10, font, dim);
  const when = input.signedAt || new Date().toISOString();
  line(String(when).slice(0, 19).replace("T", " "), 10, font, dim);
  y -= 8;

  let group = "";
  for (const row of input.checks) {
    if (row.group !== group) {
      group = row.group;
      y -= 4;
      line(group.toUpperCase(), 11, bold, brass);
    }
    const mark = row.pass === true ? "PASS" : row.pass === false ? "FAIL" : "SKIP";
    for (const part of wrap(`${mark}   ${row.label}`, 86)) {
      line(part, 10, font, mark === "FAIL" ? rgb(0.55, 0.16, 0.2) : ink);
    }
  }

  if (input.notes?.trim()) {
    y -= 8;
    line("NOTES", 11, bold, brass);
    for (const raw of input.notes.trim().split(/\n/)) {
      for (const part of wrap(raw, 86)) line(part, 10);
    }
  }

  y -= 16;
  line("SIGNATURE", 11, bold, brass);
  if (input.signaturePng && input.signaturePng.byteLength > 20) {
    try {
      const png = await doc.embedPng(input.signaturePng);
      const w = 220;
      const h = (png.height / png.width) * w;
      ensure(h + 8);
      page.drawImage(png, { x: left, y: y - h, width: w, height: h });
      y -= h + 8;
    } catch {
      line("Signed on the floor pad.", 10, font, dim);
    }
  } else {
    line("Signed on the floor pad.", 10, font, dim);
  }

  line("Filed on the QC ticket. DocuSeal webhook attaches the signed copy when complete.", 8, font, dim);
  return doc.save();
}
