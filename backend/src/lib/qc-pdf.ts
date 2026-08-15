import { erpPdf } from "./erp";
import { DT } from "./erpnext/doctypes";

const DT_CUSTOM = DT.CUSTOM_ORDER;

export type QcPdfSource = {
  name?: string | null;
  sales_order?: string | null;
  custom_order?: string | null;
  mtmpro_order?: string | null;
};

async function tryPdf(doctype: string, name: string, format: string): Promise<ArrayBuffer | null> {
  const res = await erpPdf(doctype, name, format);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 80) return null;
  const head = new TextDecoder().decode(buf.slice(0, 8));
  if (!head.startsWith("%PDF")) return null;
  return buf;
}

/** Same PDF the Open PDF button uses — MTMPro, then custom order, then sales order. */
export async function loadQcOrderPdf(
  insp: QcPdfSource,
  fallbackId?: string,
): Promise<{ buf: ArrayBuffer; filename: string } | null> {
  const so = insp.sales_order || null;
  const custom = insp.custom_order || null;
  const id = fallbackId || insp.name || "";
  const mtm =
    insp.mtmpro_order ||
    (/^LST-\d/i.test(id) ? id : null) ||
    (/^LST-\d/i.test(String(custom || "")) ? custom : null);

  if (mtm) {
    for (const fmt of ["Standard", "MTMPro Order", "LSH MTM Pro", "MTM Pro Order"]) {
      const buf = await tryPdf(DT.MTM_PRO_ORDER, mtm, fmt);
      if (buf) return { buf, filename: `${mtm}.pdf` };
    }
  }
  if (custom) {
    for (const fmt of ["Standard", "LSH Custom Order"]) {
      const buf = await tryPdf(DT_CUSTOM, custom, fmt);
      if (buf) return { buf, filename: `${custom}.pdf` };
    }
  }
  if (so) {
    for (const fmt of ["Standard", "Sales Order", "L&S Sales Order"]) {
      const buf = await tryPdf("Sales Order", so, fmt);
      if (buf) return { buf, filename: `${so}.pdf` };
    }
  }
  return null;
}
