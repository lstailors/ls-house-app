import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet, erpCreate, erpUpdate, erpPdf } from "../lib/erp";
import { uploadFile, erpFileAbsoluteUrl } from "../lib/erpnext/files";
import { DT } from "../lib/erpnext/doctypes";
import {
  QC_CHECK_CATALOG,
  QC_FAIL_STATUS,
  QC_PASS_STATUSES,
  QC_QUEUE_STATUSES,
  MTM_STATUSES,
  blankChecks,
  checksSummary,
  mergeChecks,
  type QcCheck,
} from "../lib/qc";
import { createQcSignatureSubmission, docusealEnabled } from "../lib/docuseal";

export const qcRouter = new Hono();

const DT_QC = DT.QC_INSPECTION;
const DT_MTM = DT.MTM_PRO_ORDER;

const FOH = new Set(["super_admin", "store_manager", "salesperson", "tailor"]);

function deny(c: any, status: 401 | 403 = 401) {
  return c.json({ error: { message: status === 401 ? "Unauthorized" : "Forbidden" } }, status);
}

async function requireFloor(c: any) {
  const user = await getAuthedUser(c);
  if (!user) return { user: null, res: deny(c, 401) };
  if (!FOH.has(user.role)) return { user: null, res: deny(c, 403) };
  return { user, res: null };
}

const QC_FIELDS = [
  "name",
  "sales_order",
  "mtmpro_order",
  "customer",
  "customer_name",
  "inspector",
  "inspector_email",
  "result",
  "status",
  "notes",
  "fail_reason",
  "next_status",
  "checks_json",
  "signed_at",
  "signature_url",
  "docuseal_submission_id",
  "docuseal_embed_src",
  "order_pdf_url",
  "creation",
  "modified",
];

const MTM_FIELDS = [
  "name",
  "customer",
  "customer_name",
  "order_status",
  "status",
  "order_type",
  "order_date",
  "need_by_date",
  "factory",
  "priority",
  "sales_order",
  "garment_summary",
  "production_status",
];

function parseChecks(raw: unknown): QcCheck[] {
  if (typeof raw === "string") {
    try {
      return mergeChecks(JSON.parse(raw));
    } catch {
      return blankChecks();
    }
  }
  return mergeChecks(raw);
}

function serializeInspection(doc: any, extras: Record<string, unknown> = {}) {
  const checks = parseChecks(doc.checks_json ?? doc.checks);
  return {
    id: doc.name,
    name: doc.name,
    salesOrder: doc.sales_order || null,
    mtmproOrder: doc.mtmpro_order || null,
    customer: doc.customer || null,
    customerName: doc.customer_name || extras.customerName || null,
    inspector: doc.inspector || null,
    inspectorEmail: doc.inspector_email || null,
    result: doc.result || "Open",
    status: doc.status || doc.result || "Open",
    notes: doc.notes || "",
    failReason: doc.fail_reason || "",
    nextStatus: doc.next_status || null,
    checks,
    summary: checksSummary(checks),
    signedAt: doc.signed_at || null,
    signatureUrl: doc.signature_url || null,
    docusealSubmissionId: doc.docuseal_submission_id || null,
    docusealEmbedSrc: doc.docuseal_embed_src || null,
    orderPdfUrl: doc.order_pdf_url || null,
    scanUrl: `https://alts.lstailors.com/qc/${encodeURIComponent(doc.name)}`,
    createdAt: doc.creation || null,
    modifiedAt: doc.modified || null,
    ...extras,
  };
}

function mtmStatus(row: any): string {
  return String(row.order_status || row.production_status || row.status || "").trim();
}

function unknownField(msg: string): string | null {
  const m =
    msg.match(/fieldname[:\s]+['"`]?([A-Za-z0-9_]+)/i) ||
    msg.match(/Unknown field[:\s]+['"`]?([A-Za-z0-9_]+)/i) ||
    msg.match(/invalid field[:\s]+['"`]?([A-Za-z0-9_]+)/i) ||
    msg.match(/no field ['"`]?([A-Za-z0-9_]+)/i);
  return m?.[1] || null;
}

async function createDroppingFields(doc: Record<string, unknown>) {
  const payload = { ...doc };
  for (let i = 0; i < 12; i++) {
    try {
      return await erpCreate<any>(DT_QC, payload);
    } catch (e: any) {
      const field = unknownField(String(e?.message || ""));
      if (field && field in payload) {
        delete payload[field];
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not create QC inspection");
}

async function updateDroppingFields(name: string, doc: Record<string, unknown>) {
  const payload = { ...doc };
  for (let i = 0; i < 12; i++) {
    try {
      return await erpUpdate<any>(DT_QC, name, payload);
    } catch (e: any) {
      const field = unknownField(String(e?.message || ""));
      if (field && field in payload) {
        delete payload[field];
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not update QC inspection");
}

async function listMtmInQueue() {
  const attempts: unknown[][][] = [
    [["order_status", "in", [...QC_QUEUE_STATUSES]]],
    [["status", "in", [...QC_QUEUE_STATUSES]]],
    [["production_status", "in", [...QC_QUEUE_STATUSES]]],
  ];
  for (const filters of attempts) {
    const rows = await erpList<any>(DT_MTM, {
      filters,
      fields: MTM_FIELDS,
      limit: 200,
      order_by: "modified desc",
    }).catch(() => null);
    if (rows && rows.length) return rows;
  }
  const recent = await erpList<any>(DT_MTM, {
    fields: MTM_FIELDS,
    limit: 200,
    order_by: "modified desc",
  }).catch(() => [] as any[]);
  const queue = new Set<string>(QC_QUEUE_STATUSES);
  return recent.filter((row) => queue.has(mtmStatus(row)));
}

export async function markQcSignedBySubmission(submissionId: string, signedUrl?: string | null) {
  const id = String(submissionId || "").trim();
  if (!id) return null;
  const rows = await erpList<any>(DT_QC, {
    filters: [["docuseal_submission_id", "=", id]],
    fields: QC_FIELDS,
    limit: 5,
  }).catch(() => []);
  const row = rows[0];
  if (!row?.name) return null;
  const patch: Record<string, unknown> = { signed_at: new Date().toISOString() };
  if (signedUrl) patch.signature_url = signedUrl;
  await updateDroppingFields(row.name, patch);
  return row.name;
}

async function findOpenInspection(mtm: string | null, so: string | null) {
  const filters: unknown[][] = [];
  if (mtm) filters.push(["mtmpro_order", "=", mtm]);
  else if (so) filters.push(["sales_order", "=", so]);
  else return null;
  const rows = await erpList<any>(DT_QC, {
    filters,
    fields: QC_FIELDS,
    limit: 20,
    order_by: "modified desc",
  }).catch(() => []);
  return rows.find((r) => String(r.result || r.status || "Open") === "Open") || rows[0] || null;
}

async function loadMtm(name: string) {
  return erpGet<any>(DT_MTM, name).catch(() => null);
}

async function loadSo(name: string) {
  return erpGet<any>("Sales Order", name).catch(() => null);
}

async function setMtmStatus(name: string, status: string) {
  try {
    await erpUpdate(DT_MTM, name, { order_status: status });
    return;
  } catch {
    try {
      await erpUpdate(DT_MTM, name, { status });
    } catch {
      /* order may use a custom field we cannot write */
    }
  }
}

// GET /api/qc/catalog
qcRouter.get("/catalog", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  return c.json({
    data: {
      statuses: MTM_STATUSES,
      queueStatuses: QC_QUEUE_STATUSES,
      passStatuses: QC_PASS_STATUSES,
      failStatus: QC_FAIL_STATUS,
      checks: QC_CHECK_CATALOG,
      docuseal: docusealEnabled(),
    },
  });
});

// GET /api/qc?tab=waiting|open|passed|failed
qcRouter.get("/", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const tab = (c.req.query("tab") || "waiting").toLowerCase();

  const inspections = await erpList<any>(DT_QC, {
    fields: QC_FIELDS,
    limit: 200,
    order_by: "modified desc",
  }).catch(() => []);

  if (tab === "open") {
    return c.json({
      data: inspections
        .filter((r) => String(r.result || r.status || "Open") === "Open")
        .map((r) => serializeInspection(r)),
    });
  }
  if (tab === "passed") {
    return c.json({
      data: inspections.filter((r) => /pass/i.test(String(r.result || r.status))).map((r) => serializeInspection(r)),
    });
  }
  if (tab === "failed") {
    return c.json({
      data: inspections.filter((r) => /fail/i.test(String(r.result || r.status))).map((r) => serializeInspection(r)),
    });
  }

  const mtm = await listMtmInQueue();

  const waiting = mtm.map((row) => {
    const existing = inspections.find(
      (i) => i.mtmpro_order === row.name || (row.sales_order && i.sales_order === row.sales_order),
    );
    return {
      id: existing?.name || row.name,
      mtmproOrder: row.name,
      salesOrder: row.sales_order || null,
      customer: row.customer || null,
      customerName: row.customer_name || row.customer || "Client",
      orderType: row.order_type || null,
      factory: row.factory || null,
      needBy: row.need_by_date || null,
      garmentSummary: row.garment_summary || null,
      orderStatus: mtmStatus(row) || "Quality Control",
      inspectionId: existing?.name || null,
      result: existing?.result || "Open",
      scanUrl: `https://alts.lstailors.com/qc/${encodeURIComponent(existing?.name || row.name)}`,
    };
  });

  return c.json({ data: waiting });
});

// GET /api/qc/count — home tile badge
qcRouter.get("/count", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const [waiting, inspections] = await Promise.all([
    listMtmInQueue(),
    erpList<any>(DT_QC, {
      fields: ["name", "result", "status"],
      limit: 200,
      order_by: "modified desc",
    }).catch(() => [] as any[]),
  ]);
  const open = inspections.filter((r) => String(r.result || r.status || "Open") === "Open").length;
  return c.json({ data: { waiting: waiting.length, open } });
});

// GET /api/qc/:id/pdf — order PDF (must stay before /:id)
qcRouter.get("/:id/pdf", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));
  const insp = await erpGet<any>(DT_QC, id).catch(() => null);
  const so = insp?.sales_order || (/^SAL-|^SO-|^LSTNY-SO|^LSTX-SO/i.test(id) ? id : null);
  const mtm = insp?.mtmpro_order || (!so ? id : null);

  const tryPdf = async (doctype: string, name: string, format: string) => {
    const res = await erpPdf(doctype, name, format);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 80) return null;
    const head = new TextDecoder().decode(buf.slice(0, 8));
    if (!head.startsWith("%PDF")) return null;
    return buf;
  };

  let buf: ArrayBuffer | null = null;
  let filename = `${id}.pdf`;
  if (so) {
    for (const fmt of ["Standard", "Sales Order", "L&S Sales Order"]) {
      buf = await tryPdf("Sales Order", so, fmt);
      if (buf) {
        filename = `${so}.pdf`;
        break;
      }
    }
  }
  if (!buf && mtm) {
    for (const fmt of ["Standard", "MTMPro Order"]) {
      buf = await tryPdf(DT_MTM, mtm, fmt);
      if (buf) {
        filename = `${mtm}.pdf`;
        break;
      }
    }
  }
  if (!buf) return c.json({ error: { message: "No PDF on this order" } }, 404);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
});

// GET /api/qc/:id
qcRouter.get("/:id", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));

  let insp = await erpGet<any>(DT_QC, id).catch(() => null);
  if (!insp) insp = await findOpenInspection(id, null);
  if (!insp) insp = await findOpenInspection(null, id);

  let mtm: any = null;
  let so: any = null;
  if (insp) {
    if (insp.mtmpro_order) mtm = await loadMtm(insp.mtmpro_order);
    if (insp.sales_order) so = await loadSo(insp.sales_order);
  } else {
    mtm = await loadMtm(id);
    if (!mtm) so = await loadSo(id);
    if (!mtm && !so) return c.json({ error: { message: "Not found" } }, 404);
    return c.json({
      data: {
        id: null,
        mtmproOrder: mtm?.name || null,
        salesOrder: so?.name || mtm?.sales_order || null,
        customer: mtm?.customer || so?.customer || null,
        customerName: mtm?.customer_name || so?.customer_name || "Client",
        orderType: mtm?.order_type || so?.make_type || null,
        factory: mtm?.factory || null,
        needBy: mtm?.need_by_date || so?.delivery_date || null,
        garmentSummary: mtm?.garment_summary || null,
        orderStatus: mtm ? mtmStatus(mtm) : so?.status || null,
        result: "Open",
        checks: blankChecks(),
        summary: checksSummary(blankChecks()),
        notes: "",
        photos: [],
        docuseal: docusealEnabled(),
        scanUrl: `https://alts.lstailors.com/qc/${encodeURIComponent(mtm?.name || so?.name || id)}`,
        links: {
          customer: mtm?.customer || so?.customer || null,
          salesOrder: so?.name || mtm?.sales_order || null,
          mtmproOrder: mtm?.name || null,
        },
      },
    });
  }

  const files = await erpList<any>(DT.FILE, {
    filters: [
      ["attached_to_doctype", "=", DT_QC],
      ["attached_to_name", "=", insp.name],
    ],
    fields: ["name", "file_url", "file_name", "creation"],
    limit: 80,
    order_by: "creation desc",
  }).catch(() => []);

  const photos = files
    .filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(String(f.file_name || f.file_url || "")))
    .map((f) => ({
      id: f.name,
      name: f.file_name,
      url: erpFileAbsoluteUrl(f.file_url),
      createdAt: f.creation,
    }));

  return c.json({
    data: serializeInspection(insp, {
      orderType: mtm?.order_type || so?.make_type || null,
      factory: mtm?.factory || null,
      needBy: mtm?.need_by_date || so?.delivery_date || null,
      garmentSummary: mtm?.garment_summary || null,
      orderStatus: mtm ? mtmStatus(mtm) : so?.status || null,
      photos,
      docuseal: docusealEnabled(),
      links: {
        customer: insp.customer || mtm?.customer || so?.customer || null,
        salesOrder: insp.sales_order || so?.name || mtm?.sales_order || null,
        mtmproOrder: insp.mtmpro_order || mtm?.name || null,
      },
    }),
  });
});

// POST /api/qc — start (or resume) an inspection for an MTM / sales order
qcRouter.post("/", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const body = await c.req.json().catch(() => ({}));
  const mtmName = String(body.mtmproOrder || body.mtmpro_order || "").trim() || null;
  const soName = String(body.salesOrder || body.sales_order || "").trim() || null;
  if (!mtmName && !soName) return c.json({ error: { message: "mtmproOrder or salesOrder required" } }, 400);

  const existing = await findOpenInspection(mtmName, soName);
  if (existing) return c.json({ data: serializeInspection(existing) });

  const mtm = mtmName ? await loadMtm(mtmName) : null;
  const so = soName ? await loadSo(soName) : mtm?.sales_order ? await loadSo(mtm.sales_order) : null;

  const created = await createDroppingFields({
    doctype: DT_QC,
    sales_order: so?.name || soName,
    mtmpro_order: mtm?.name || mtmName,
    customer: mtm?.customer || so?.customer,
    customer_name: mtm?.customer_name || so?.customer_name,
    inspector: gate.user!.name,
    inspector_email: gate.user!.email,
    result: "Open",
    status: "Open",
    notes: "",
    checks_json: JSON.stringify(blankChecks()),
  });
  if (!created) return c.json({ error: { message: "Could not open QC in ERPNext" } }, 502);

  const target = mtm?.name || mtmName;
  if (target && mtmStatus(mtm || {}) !== "Quality Control") {
    await setMtmStatus(target, "Quality Control");
  }

  return c.json({ data: serializeInspection(created) }, 201);
});

// PATCH /api/qc/:id
qcRouter.patch("/:id", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));
  const existing = await erpGet<any>(DT_QC, id);
  if (!existing) return c.json({ error: { message: "Not found" } }, 404);
  const body = await c.req.json().catch(() => ({}));

  const update: Record<string, unknown> = {};
  if (Array.isArray(body.checks)) update.checks_json = JSON.stringify(mergeChecks(body.checks));
  if (typeof body.notes === "string") update.notes = body.notes;
  if (typeof body.failReason === "string") update.fail_reason = body.failReason;
  if (typeof body.nextStatus === "string") update.next_status = body.nextStatus;
  if (typeof body.signatureUrl === "string") update.signature_url = body.signatureUrl;

  if (body.result === "Pass" || body.result === "Fail") {
    update.result = body.result;
    update.status = body.result;
    const next =
      body.result === "Pass"
        ? QC_PASS_STATUSES.includes(body.nextStatus) ? body.nextStatus : "Awaiting Fitting"
        : QC_FAIL_STATUS;
    update.next_status = next;
    const mtm = existing.mtmpro_order;
    if (mtm) await setMtmStatus(mtm, next);
  }

  const saved = await updateDroppingFields(id, update);
  return c.json({ data: serializeInspection(saved || { ...existing, ...update }) });
});

// POST /api/qc/:id/photos
qcRouter.post("/:id/photos", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));
  const existing = await erpGet<any>(DT_QC, id);
  if (!existing) return c.json({ error: { message: "Not found" } }, 404);

  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ error: { message: "Bad form data" } }, 400);
  }
  const raw = form["file"];
  const file = (Array.isArray(raw) ? raw[0] : raw) as File | undefined;
  if (!file || !(file instanceof File) || file.size === 0) {
    return c.json({ error: { message: "file is required" } }, 400);
  }
  const buffer = new Uint8Array(await file.arrayBuffer());
  const { fileUrl, fileId } = await uploadFile({
    file: buffer,
    filename: file.name || `qc-${Date.now()}.jpg`,
    contentType: file.type || "image/jpeg",
    doctype: DT_QC,
    docname: id,
    isPrivate: false,
  });
  return c.json({ data: { url: erpFileAbsoluteUrl(fileUrl), fileId } });
});

// POST /api/qc/:id/sign — DocuSeal embed, or save a drawn signature
qcRouter.post("/:id/sign", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));
  const existing = await erpGet<any>(DT_QC, id);
  if (!existing) return c.json({ error: { message: "Not found" } }, 404);
  const body = await c.req.json().catch(() => ({}));

  if (typeof body.signatureDataUrl === "string" && body.signatureDataUrl.startsWith("data:image")) {
    const b64 = body.signatureDataUrl.split(",")[1] || "";
    const bytes = Buffer.from(b64, "base64");
    const { fileUrl } = await uploadFile({
      file: bytes,
      filename: `qc-sign-${id}.png`,
      contentType: "image/png",
      doctype: DT_QC,
      docname: id,
      isPrivate: false,
    });
    const url = erpFileAbsoluteUrl(fileUrl);
    await updateDroppingFields(id, { signature_url: url, signed_at: new Date().toISOString() });
    return c.json({ data: { signatureUrl: url, signedAt: new Date().toISOString(), embedSrc: null } });
  }

  if (!docusealEnabled()) {
    return c.json({ error: { message: "DocuSeal is not connected — sign on the pad" } }, 400);
  }

  let pdfBytes: ArrayBuffer | null = null;
  const so = existing.sales_order;
  if (so) {
    const pdf = await erpPdf("Sales Order", so, "Standard");
    if (pdf.ok) pdfBytes = await pdf.arrayBuffer();
  }
  const sub = await createQcSignatureSubmission({
    title: `QC ${existing.mtmpro_order || existing.sales_order || id}`,
    inspectorEmail: gate.user!.email,
    inspectorName: gate.user!.name || gate.user!.email,
    pdfBytes,
    pdfName: `${so || id}.pdf`,
  });
  if (!sub) return c.json({ error: { message: "Could not start DocuSeal" } }, 502);
  await updateDroppingFields(id, {
    docuseal_submission_id: String(sub.id),
    docuseal_embed_src: sub.embedSrc,
  });
  return c.json({ data: { embedSrc: sub.embedSrc, submissionId: sub.id } });
});
