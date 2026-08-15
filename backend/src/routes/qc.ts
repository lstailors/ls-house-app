import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet, erpCreate, erpUpdate, erpPdf } from "../lib/erp";
import { uploadFile, erpFileAbsoluteUrl } from "../lib/erpnext/files";
import { DT } from "../lib/erpnext/doctypes";
import {
  QC_CHECK_CATALOG,
  QC_QUEUE_STATUSES,
  MTM_STATUSES,
  blankChecks,
  checksFromDoc,
  checksSummary,
  checksToDocFields,
  dateReceivedLabel,
  dedupeByInspectionName,
  isQcInspectionName,
  isSalesOrderName,
  qcResultOf,
  tabToQcResult,
  type QcCheck,
} from "../lib/qc";
import { createQcSignatureSubmission, docusealEnabled } from "../lib/docuseal";
import { loadDocusealSettings, maskKey, saveDocusealSettings } from "../lib/qc-settings";

export const qcRouter = new Hono();

const DT_QC = DT.QC_INSPECTION;
const DT_CUSTOM = DT.CUSTOM_ORDER;

/** Tailor + Admin only. */
const QC_ROLES = new Set(["super_admin", "tailor"]);
const ADMIN = new Set(["super_admin"]);

function deny(c: any, status: 401 | 403 = 401) {
  return c.json({ error: { message: status === 401 ? "Unauthorized" : "Forbidden" } }, status);
}

async function requireQc(c: any) {
  const user = await getAuthedUser(c);
  if (!user) return { user: null, res: deny(c, 401) };
  if (!QC_ROLES.has(user.role)) return { user: null, res: deny(c, 403) };
  return { user, res: null };
}

async function requireAdmin(c: any) {
  const user = await getAuthedUser(c);
  if (!user) return { user: null, res: deny(c, 401) };
  if (!ADMIN.has(user.role)) return { user: null, res: deny(c, 403) };
  return { user, res: null };
}

/** Known LSH QC Inspection fields. erpList drops any that do not exist. */
const QC_FIELDS = [
  "name",
  "sales_order",
  "custom_order",
  "customer",
  "customer_name",
  "inspector",
  "qc_result",
  "result",
  "status",
  "notes",
  "date_received",
  "fulfillment_mode",
  "identity",
  "measurements",
  "construction",
  "finish",
  "condition",
  "fit_ready",
  "checks_json",
  "signed_at",
  "signature_url",
  "docuseal_submission_id",
  "docuseal_embed_src",
  "creation",
  "modified",
];

function unknownField(msg: string): string | null {
  const m =
    msg.match(/Unknown column ['"`]?([A-Za-z0-9_]+)/i) ||
    msg.match(/fieldname[:\s]+['"`]?([A-Za-z0-9_]+)/i) ||
    msg.match(/Unknown field[:\s]+['"`]?([A-Za-z0-9_]+)/i) ||
    msg.match(/invalid field[:\s]+['"`]?([A-Za-z0-9_]+)/i) ||
    msg.match(/no field ['"`]?([A-Za-z0-9_]+)/i) ||
    msg.match(/Field ['"`]([A-Za-z0-9_]+)['"`] cannot be updated/i);
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

async function listInspections() {
  return erpList<any>(DT_QC, {
    fields: QC_FIELDS,
    limit: 200,
    order_by: "modified desc",
  }).catch(() => [] as any[]);
}

/** MTM make orders in the QC queue — never walk-in alteration tickets, never an unfiltered dump. */
async function listMakeOrdersInQcQueue() {
  const statuses = ["Quality Control", "Received at Store"];
  const fields = [
    "name",
    "customer",
    "customer_name",
    "status",
    "order_status",
    "erp_sales_order",
    "sales_order",
    "date_received",
    "garment_type",
    "garment_summary",
  ];
  for (const field of ["status", "order_status"] as const) {
    const rows = await erpList<any>(DT_CUSTOM, {
      filters: [[field, "in", statuses]],
      fields,
      limit: 50,
      order_by: "modified desc",
    }).catch(() => [] as any[]);
    if (rows.length) return rows;
  }
  return [] as any[];
}

function serializeInspection(doc: any, extras: Record<string, unknown> = {}) {
  const checks: QcCheck[] = checksFromDoc(doc);
  const qcResult = qcResultOf(doc);
  return {
    id: doc.name,
    name: doc.name,
    salesOrder: doc.sales_order || null,
    customOrder: doc.custom_order || null,
    mtmproOrder: doc.custom_order || doc.mtmpro_order || null,
    customer: doc.customer || null,
    customerName: doc.customer_name || extras.customerName || null,
    inspector: doc.inspector || null,
    result: qcResult,
    qcResult,
    status: qcResult,
    notes: doc.notes || "",
    failReason: doc.fail_reason || doc.notes || "",
    fulfillmentMode: doc.fulfillment_mode || null,
    checks,
    summary: checksSummary(checks),
    signedAt: doc.signed_at || null,
    signatureUrl: doc.signature_url || null,
    docusealSubmissionId: doc.docuseal_submission_id || null,
    docusealEmbedSrc: doc.docuseal_embed_src || null,
    dateReceived: dateReceivedLabel(doc.date_received),
    scanUrl: `https://alts.lstailors.com/qc/${encodeURIComponent(doc.name)}`,
    createdAt: doc.creation || null,
    modifiedAt: doc.modified || null,
    ...extras,
  };
}

function serializeListRow(doc: any, extras: Record<string, unknown> = {}) {
  const qcResult = qcResultOf(doc);
  return {
    id: doc.name,
    name: doc.name,
    inspectionId: doc.name,
    salesOrder: doc.sales_order || extras.salesOrder || null,
    customOrder: doc.custom_order || extras.customOrder || null,
    customer: doc.customer || extras.customer || null,
    customerName: doc.customer_name || extras.customerName || "Client",
    qcResult,
    result: qcResult,
    orderStatus: extras.orderStatus || null,
    garmentSummary: extras.garmentSummary || doc.garment_summary || null,
    dateReceived: dateReceivedLabel(doc.date_received),
    scanUrl: `https://alts.lstailors.com/qc/${encodeURIComponent(doc.name)}`,
  };
}

function isMakeOrderRow(row: any): boolean {
  const name = String(row?.name || "");
  if (/^ALT-/i.test(name)) return false;
  const kind = String(row?.order_type || row?.kind || row?.ticket_type || "").toLowerCase();
  if (kind && /alter/.test(kind)) return false;
  return true;
}

async function waitingRows() {
  const [inspections, orders] = await Promise.all([listInspections(), listMakeOrdersInQcQueue()]);
  const pending = inspections.filter(
    (r) => isQcInspectionName(r.name) && !isSalesOrderName(r.name) && qcResultOf(r) === "Pending",
  );

  const makes = orders.filter(isMakeOrderRow);
  const orderKeys = new Set<string>();
  const orderByKey = new Map<string, any>();
  for (const o of makes) {
    for (const key of [o.name, o.erp_sales_order, o.sales_order]) {
      if (key) {
        orderKeys.add(String(key));
        orderByKey.set(String(key), o);
      }
    }
  }

  // Cards are inspections, never an unfiltered MTM / sales-order dump.
  let rows = pending;
  if (orderKeys.size) {
    const matched = pending.filter(
      (i) => orderKeys.has(String(i.custom_order || "")) || orderKeys.has(String(i.sales_order || "")),
    );
    if (matched.length) rows = matched;
  }

  return dedupeByInspectionName(rows).map((doc) => {
    const order = orderByKey.get(String(doc.custom_order || "")) || orderByKey.get(String(doc.sales_order || ""));
    return serializeListRow(doc, {
      customOrder: order?.name || doc.custom_order,
      salesOrder: order?.erp_sales_order || order?.sales_order || doc.sales_order,
      customerName: doc.customer_name || order?.customer_name,
      orderStatus: order?.order_status || order?.status || "Quality Control",
      garmentSummary: order?.garment_summary || order?.garment_type,
    });
  });
}

async function resolveInspection(id: string) {
  const direct = await erpGet<any>(DT_QC, id).catch(() => null);
  if (direct?.name) return direct;

  for (const field of ["sales_order", "custom_order", "mtmpro_order"]) {
    const rows = await erpList<any>(DT_QC, {
      filters: [[field, "=", id]],
      fields: ["name"],
      limit: 5,
      order_by: "modified desc",
    }).catch(() => [] as any[]);
    if (rows[0]?.name) {
      return (await erpGet<any>(DT_QC, rows[0].name).catch(() => null)) || rows[0];
    }
  }

  return null;
}

export async function markQcSignedBySubmission(submissionId: string, signedUrl?: string | null) {
  const id = String(submissionId || "").trim();
  if (!id) return null;
  const rows = await erpList<any>(DT_QC, {
    filters: [["docuseal_submission_id", "=", id]],
    fields: ["name"],
    limit: 5,
  }).catch(() => []);
  const row = rows[0];
  if (!row?.name) return null;
  const patch: Record<string, unknown> = { signed_at: new Date().toISOString() };
  if (signedUrl) patch.signature_url = signedUrl;
  await updateDroppingFields(row.name, patch);
  return row.name;
}

// GET /api/qc/catalog
qcRouter.get("/catalog", async (c) => {
  const gate = await requireQc(c);
  if (gate.res) return gate.res;
  let docuseal = false;
  try {
    docuseal = await docusealEnabled();
  } catch {
    /* optional */
  }
  return c.json({
    data: {
      statuses: MTM_STATUSES,
      queueStatuses: QC_QUEUE_STATUSES,
      checks: QC_CHECK_CATALOG,
      docuseal,
    },
  });
});

// GET /api/qc/settings — Admin. Never returns the raw key.
qcRouter.get("/settings", async (c) => {
  const gate = await requireAdmin(c);
  if (gate.res) return gate.res;
  try {
    const s = await loadDocusealSettings();
    return c.json({
      data: {
        url: s.url,
        apiKeySet: Boolean(s.apiKey),
        apiKeyMasked: maskKey(s.apiKey),
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Could not load settings" } }, 502);
  }
});

qcRouter.patch("/settings", async (c) => {
  const gate = await requireAdmin(c);
  if (gate.res) return gate.res;
  const body = await c.req.json().catch(() => ({}));
  try {
    const saved = await saveDocusealSettings({
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      url: typeof body.url === "string" ? body.url : undefined,
    });
    return c.json({
      data: {
        url: saved.url,
        apiKeySet: Boolean(saved.apiKey),
        apiKeyMasked: maskKey(saved.apiKey),
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Could not save settings" } }, 502);
  }
});

// GET /api/qc/count
qcRouter.get("/count", async (c) => {
  const gate = await requireQc(c);
  if (gate.res) return gate.res;
  try {
    const waiting = await waitingRows();
    return c.json({ data: { waiting: waiting.length, open: waiting.length } });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Could not count QC" } }, 502);
  }
});

// GET /api/qc?tab=waiting|open|passed|failed
qcRouter.get("/", async (c) => {
  const gate = await requireQc(c);
  if (gate.res) return gate.res;
  const tab = (c.req.query("tab") || "waiting").toLowerCase();

  try {
    if (tab === "waiting") {
      return c.json({ data: await waitingRows() });
    }

    const want = tabToQcResult(tab);
    const inspections = await listInspections();
    const rows = dedupeByInspectionName(
      inspections.filter(
        (r) =>
          isQcInspectionName(r.name) &&
          !isSalesOrderName(r.name) &&
          (want ? qcResultOf(r) === want : true),
      ),
    ).map((r) => serializeListRow(r));
    return c.json({ data: rows });
  } catch (e: any) {
    console.error("GET /api/qc", e);
    return c.json({ error: { message: e?.message || "Could not load QC" } }, 502);
  }
});

// GET /api/qc/:id/pdf
qcRouter.get("/:id/pdf", async (c) => {
  const gate = await requireQc(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));
  try {
    const insp = await resolveInspection(id);
    const so = insp?.sales_order || (/^LSTNY-SO|^LSTX-SO|^SAL-|^SO-/i.test(id) ? id : null);
    const custom = insp?.custom_order || null;

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
    if (!buf && custom) {
      for (const fmt of ["Standard", "LSH Custom Order"]) {
        buf = await tryPdf(DT_CUSTOM, custom, fmt);
        if (buf) {
          filename = `${custom}.pdf`;
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
  } catch (e: any) {
    console.error("GET /api/qc/:id/pdf", e);
    return c.json({ error: { message: e?.message || "PDF failed" } }, 502);
  }
});

// GET /api/qc/:id — always by inspection name LSH-QC-…, or resolve from SO / custom order
qcRouter.get("/:id", async (c) => {
  const gate = await requireQc(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));

  try {
    const insp = await resolveInspection(id);
    if (!insp?.name) {
      const co = await erpGet<any>(DT_CUSTOM, id).catch(() => null);
      const so = await erpGet<any>("Sales Order", id).catch(() => null);
      if (!co && !so) return c.json({ error: { message: "Not found" } }, 404);
      return c.json({
        data: {
          id: null,
          name: null,
          salesOrder: so?.name || co?.erp_sales_order || co?.sales_order || null,
          customOrder: co?.name || null,
          mtmproOrder: co?.name || null,
          customer: co?.customer || so?.customer || null,
          customerName: co?.customer_name || so?.customer_name || "Client",
          qcResult: "Pending",
          result: "Pending",
          notes: "",
          checks: blankChecks(),
          summary: checksSummary(blankChecks()),
          photos: [],
          docuseal: false,
          orderStatus: co?.order_status || co?.status || so?.status || null,
          garmentSummary: co?.garment_summary || co?.garment_type || null,
          links: {
            customer: co?.customer || so?.customer || null,
            salesOrder: so?.name || co?.erp_sales_order || null,
            customOrder: co?.name || null,
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

    let orderStatus: string | null = null;
    let garmentSummary: string | null = null;
    if (insp.custom_order) {
      const co = await erpGet<any>(DT_CUSTOM, insp.custom_order).catch(() => null);
      orderStatus = co?.order_status || co?.status || null;
      garmentSummary = co?.garment_summary || co?.garment_type || null;
    }

    let docuseal = false;
    try {
      docuseal = await docusealEnabled();
    } catch {
      /* DocuSeal is optional — never block the inspection page */
    }

    return c.json({
      data: serializeInspection(insp, {
        photos,
        docuseal,
        orderStatus,
        garmentSummary,
        links: {
          customer: insp.customer || null,
          salesOrder: insp.sales_order || null,
          customOrder: insp.custom_order || null,
        },
      }),
    });
  } catch (e: any) {
    console.error("GET /api/qc/:id", e);
    return c.json({ error: { message: e?.message || "Could not load inspection" } }, 502);
  }
});

// POST /api/qc — start only when no inspection exists yet
qcRouter.post("/", async (c) => {
  const gate = await requireQc(c);
  if (gate.res) return gate.res;
  const body = await c.req.json().catch(() => ({}));
  const customName = String(body.customOrder || body.custom_order || "").trim() || null;
  const soName = String(body.salesOrder || body.sales_order || "").trim() || null;
  if (!customName && !soName) return c.json({ error: { message: "customOrder or salesOrder required" } }, 400);

  try {
    const existing =
      (customName ? await resolveInspection(customName) : null) ||
      (soName ? await resolveInspection(soName) : null);
    if (existing?.name) return c.json({ data: serializeInspection(existing) });

    const co = customName ? await erpGet<any>(DT_CUSTOM, customName).catch(() => null) : null;
    const so = soName ? await erpGet<any>("Sales Order", soName).catch(() => null) : null;

    const created = await createDroppingFields({
      doctype: DT_QC,
      sales_order: so?.name || soName || co?.erp_sales_order,
      custom_order: co?.name || customName,
      customer: co?.customer || so?.customer,
      customer_name: co?.customer_name || so?.customer_name,
      inspector: gate.user!.name,
      qc_result: "Pending",
      result: "Pending",
      notes: "",
      date_received: new Date().toISOString().slice(0, 10),
    });
    if (!created) return c.json({ error: { message: "Could not open QC in ERPNext" } }, 502);
    return c.json({ data: serializeInspection(created) }, 201);
  } catch (e: any) {
    console.error("POST /api/qc", e);
    return c.json({ error: { message: e?.message || "Could not start QC" } }, 502);
  }
});

// PATCH /api/qc/:id — checks/notes. Pass/Fail routing stays in Frappe.
qcRouter.patch("/:id", async (c) => {
  const gate = await requireQc(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));
  try {
    const existing = await resolveInspection(id);
    if (!existing?.name) return c.json({ error: { message: "Not found" } }, 404);
    const body = await c.req.json().catch(() => ({}));

    const update: Record<string, unknown> = {};
    if (Array.isArray(body.checks)) Object.assign(update, checksToDocFields(body.checks));
    if (typeof body.notes === "string") update.notes = body.notes;
    if (typeof body.signatureUrl === "string") update.signature_url = body.signatureUrl;

    const want = body.qc_result || body.result;
    if (want === "Pass" || want === "Fail") {
      if (want === "Fail") {
        const notes = String(body.notes ?? body.failReason ?? update.notes ?? existing.notes ?? "").trim();
        if (!notes) return c.json({ error: { message: "Notes are required to fail" } }, 400);
        update.notes = notes;
      }
      update.qc_result = want;
    }

    const saved = await updateDroppingFields(existing.name, update);
    const fresh = (await erpGet<any>(DT_QC, existing.name).catch(() => null)) || saved || { ...existing, ...update };
    return c.json({ data: serializeInspection(fresh) });
  } catch (e: any) {
    console.error("PATCH /api/qc/:id", e);
    return c.json({ error: { message: e?.message || "Could not save QC" } }, 502);
  }
});

qcRouter.post("/:id/photos", async (c) => {
  const gate = await requireQc(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));
  try {
    const existing = await resolveInspection(id);
    if (!existing?.name) return c.json({ error: { message: "Not found" } }, 404);

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
      docname: existing.name,
      isPrivate: false,
    });
    return c.json({ data: { url: erpFileAbsoluteUrl(fileUrl), fileId } });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Upload failed" } }, 502);
  }
});

qcRouter.post("/:id/sign", async (c) => {
  const gate = await requireQc(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));
  try {
    const existing = await resolveInspection(id);
    if (!existing?.name) return c.json({ error: { message: "Not found" } }, 404);
    const body = await c.req.json().catch(() => ({}));

    if (typeof body.signatureDataUrl === "string" && body.signatureDataUrl.startsWith("data:image")) {
      const b64 = body.signatureDataUrl.split(",")[1] || "";
      const bytes = Buffer.from(b64, "base64");
      const { fileUrl } = await uploadFile({
        file: bytes,
        filename: `qc-sign-${existing.name}.png`,
        contentType: "image/png",
        doctype: DT_QC,
        docname: existing.name,
        isPrivate: false,
      });
      const url = erpFileAbsoluteUrl(fileUrl);
      await updateDroppingFields(existing.name, { signature_url: url, signed_at: new Date().toISOString() });
      return c.json({ data: { signatureUrl: url, signedAt: new Date().toISOString(), embedSrc: null } });
    }

    if (!(await docusealEnabled())) {
      return c.json({ error: { message: "DocuSeal is not connected — sign on the pad" } }, 400);
    }

    let pdfBytes: ArrayBuffer | null = null;
    const so = existing.sales_order;
    if (so) {
      const pdf = await erpPdf("Sales Order", so, "Standard");
      if (pdf.ok) pdfBytes = await pdf.arrayBuffer();
    }
    const sub = await createQcSignatureSubmission({
      title: `QC ${existing.custom_order || existing.sales_order || existing.name}`,
      inspectorEmail: gate.user!.email,
      inspectorName: gate.user!.name || gate.user!.email,
      pdfBytes,
      pdfName: `${so || existing.name}.pdf`,
    });
    if (!sub) return c.json({ error: { message: "Could not start DocuSeal" } }, 502);
    await updateDroppingFields(existing.name, {
      docuseal_submission_id: String(sub.id),
      docuseal_embed_src: sub.embedSrc,
    });
    return c.json({ data: { embedSrc: sub.embedSrc, submissionId: sub.id } });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Could not sign" } }, 502);
  }
});
