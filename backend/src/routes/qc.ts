import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet, erpCreate, erpUpdate, erpPdf } from "../lib/erp";
import { uploadFile, erpFileAbsoluteUrl } from "../lib/erpnext/files";
import { DT } from "../lib/erpnext/doctypes";
import {
  QC_CHECK_CATALOG,
  QC_QUEUE_STATUSES,
  MTM_STATUSES,
  isMtmStatus,
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
import { getAltsMetrics } from "../lib/metrics";
import { sendSms, alertCarl } from "../lib/twilio";

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
  "garment_summary",
  "fail_reason",
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

/** Pending / Pass / Fail — filter in ERPNext, never list-all-then-JS. */
async function listInspectionsByResult(result: "Pending" | "Pass" | "Fail") {
  for (const field of ["qc_result", "result"] as const) {
    try {
      return await erpList<any>(DT_QC, {
        filters: [[field, "=", result]],
        fields: QC_FIELDS,
        limit: 200,
        order_by: "date_received desc",
        throwOnError: true,
      });
    } catch {
      continue;
    }
  }
  return [] as any[];
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

function isMtmStatusKey(value: string): boolean {
  return isMtmStatus(value);
}

const MTM_ORDER_FIELDS = [
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
  "order_type",
  "factory",
];

function serializeMtmOrderRow(doc: any) {
  const status = String(doc.order_status || doc.status || "").trim() || null;
  return {
    id: doc.name,
    name: doc.name,
    inspectionId: null,
    orderName: doc.name,
    salesOrder: doc.erp_sales_order || doc.sales_order || null,
    customOrder: doc.name,
    customer: doc.customer || null,
    customerName: doc.customer_name || "Client",
    orderStatus: status,
    qcResult: null,
    result: null,
    garmentSummary: doc.garment_summary || doc.garment_type || doc.order_type || null,
    factory: doc.factory || null,
    dateReceived: dateReceivedLabel(doc.date_received),
    scanUrl: `https://alts.lstailors.com/qc/${encodeURIComponent(doc.name)}`,
  };
}

async function listMtmPipeline(status?: string) {
  const want = status && isMtmStatusKey(status) ? status : "";
  const doctypes = [DT.MTM_PRO_ORDER, DT_CUSTOM];
  for (const dt of doctypes) {
    for (const field of ["order_status", "status"] as const) {
      const filters = want ? [[field, "=", want]] : [];
      const rows = await erpList<any>(dt, {
        filters,
        fields: MTM_ORDER_FIELDS,
        limit: 200,
        order_by: "modified desc",
      }).catch(() => [] as any[]);
      const usable = rows.filter(isMakeOrderRow);
      if (usable.length) return usable.map(serializeMtmOrderRow);
    }
  }
  return [] as ReturnType<typeof serializeMtmOrderRow>[];
}

async function setMtmOrderStatus(name: string, status: string) {
  const doctypes = [DT.MTM_PRO_ORDER, DT_CUSTOM];
  for (const dt of doctypes) {
    const doc = await erpGet<any>(dt, name).catch(() => null);
    if (!doc?.name) continue;
    for (const field of ["order_status", "status"] as const) {
      try {
        await erpUpdate(dt, name, { [field]: status });
        return { name, status, doctype: dt };
      } catch (e: any) {
        const bad = unknownField(String(e?.message || ""));
        if (bad === field) continue;
        throw e;
      }
    }
  }
  throw new Error("Order not found");
}

async function requireFloor(c: any) {
  const user = await getAuthedUser(c);
  if (!user) return { user: null, res: deny(c, 401) };
  if (user.role === "driver" || user.role === "customer") {
    return { user: null, res: deny(c, 403) };
  }
  return { user, res: null };
}

function serializeInspection(doc: any, extras: Record<string, unknown> = {}) {
  const checks: QcCheck[] = checksFromDoc(doc);
  const qcResult = qcResultOf(doc);
  return {
    id: doc.name,
    name: doc.name,
    salesOrder: doc.sales_order || null,
    customOrder: doc.custom_order || null,
    mtmproOrder: doc.custom_order || doc.mtmpro_order || extras.mtmproOrder || null,
    orderName: extras.orderName || doc.custom_order || doc.mtmpro_order || null,
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
    orderName: extras.orderName || extras.customOrder || doc.custom_order || null,
    customer: doc.customer || extras.customer || null,
    customerName: doc.customer_name || extras.customerName || "Client",
    qcResult,
    result: qcResult,
    orderStatus: extras.orderStatus || null,
    garmentSummary: extras.garmentSummary || doc.garment_summary || null,
    fulfillmentMode: extras.fulfillmentMode || doc.fulfillment_mode || null,
    dateReceived: dateReceivedLabel(doc.date_received),
    createdAt: doc.creation || extras.createdAt || null,
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

function isoWeekKey(raw?: string | null): string {
  const s = String(raw || "").slice(0, 10);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : raw || "");
  if (!Number.isFinite(d.getTime())) return "unknown";
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function garmentKey(doc: any): string {
  const raw = String(doc.garment_summary || doc.garment_type || doc.order_type || "Unspecified").trim();
  return raw || "Unspecified";
}

function sourceKey(doc: any): string {
  const mode = String(doc.fulfillment_mode || "").toLowerCase();
  if (/store|walk.?in|alter/.test(mode)) return "store";
  if (/make|mtm|factory|custom/.test(mode)) return "make";
  if (doc.custom_order) return "make";
  if (/^ALT-/i.test(String(doc.sales_order || ""))) return "store";
  return doc.sales_order ? "make" : "store";
}

function rateBuckets(rows: any[], keyFn: (d: any) => string) {
  const map = new Map<string, { pass: number; fail: number }>();
  for (const r of rows) {
    const k = keyFn(r);
    const cur = map.get(k) || { pass: 0, fail: 0 };
    if (qcResultOf(r) === "Pass") cur.pass += 1;
    else cur.fail += 1;
    map.set(k, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => {
      const decided = v.pass + v.fail;
      return { key, pass: v.pass, fail: v.fail, rate: decided ? Math.round((v.pass / decided) * 100) : 0 };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function notifyQcFail(doc: any, notes: string) {
  const customer = doc.customer_name || "Client";
  const garment = garmentKey(doc);
  const order = doc.custom_order || doc.sales_order || doc.name;
  const body =
    `QC FAIL · ${customer}` +
    (garment && garment !== "Unspecified" ? ` · ${garment}` : "") +
    ` · ${order}` +
    (notes ? ` — ${notes.slice(0, 180)}` : "");

  let tailorName = "";
  let tailorPhone = "";
  let tailorEmail = "";
  let location = "";

  const customName = doc.custom_order;
  if (customName) {
    const co = await erpGet<any>(DT_CUSTOM, customName).catch(() => null);
    tailorName = String(co?.assigned_tailor || co?.tailor || "").trim();
    location = String(co?.origin_location || co?.location || "").trim();
  }
  const so = String(doc.sales_order || "");
  if (!tailorName && /^ALT-/i.test(so)) {
    const t = await erpGet<any>("Alteration Ticket", so).catch(() => null);
    tailorName = String(t?.assigned_tailor || "").trim();
    location = location || String(t?.origin_location || "").trim();
  }

  if (tailorName) {
    const emps = await erpList<any>(DT.EMPLOYEE, {
      filters: [
        ["name", "=", tailorName],
      ],
      fields: ["name", "employee_name", "cell_number", "personal_mobile", "company_email"],
      limit: 1,
    }).catch(() => []);
    let emp = emps[0];
    if (!emp) {
      const byName = await erpList<any>(DT.EMPLOYEE, {
        filters: [["employee_name", "like", `%${tailorName}%`]],
        fields: ["name", "employee_name", "cell_number", "personal_mobile", "company_email"],
        limit: 1,
      }).catch(() => []);
      emp = byName[0];
    }
    if (emp) {
      tailorPhone = String(emp.cell_number || emp.personal_mobile || "").trim();
      tailorEmail = String(emp.company_email || "").trim();
      tailorName = emp.employee_name || tailorName;
    }
  }

  try {
    await erpCreate("ToDo", {
      description: body,
      status: "Open",
      priority: "High",
      date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()),
      allocated_to: tailorEmail || undefined,
      reference_type: DT_QC,
      reference_name: doc.name,
      lsh_context: "qc.fail",
    });
  } catch (e) {
    console.warn("[qc.fail] ToDo", (e as Error)?.message);
  }

  if (tailorPhone) {
    await sendSms(tailorPhone, body).catch(() => null);
  }
  const locBit = location ? ` @ ${location}` : "";
  await alertCarl(`QC fail${locBit}: ${body}`).catch(() => undefined);
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

  // Cards are inspections. Keep every pending inspection — never hide the rack.
  const rows = pending;

  const inspectionRows = dedupeByInspectionName(rows).map((doc) => {
    const order = orderByKey.get(String(doc.custom_order || "")) || orderByKey.get(String(doc.sales_order || ""));
    return serializeListRow(doc, {
      customOrder: order?.name || doc.custom_order,
      salesOrder: order?.erp_sales_order || order?.sales_order || doc.sales_order,
      customerName: doc.customer_name || order?.customer_name,
      orderStatus: order?.order_status || order?.status || "Quality Control",
      garmentSummary: order?.garment_summary || order?.garment_type,
      orderName: order?.name || doc.custom_order,
    });
  });

  const covered = new Set<string>();
  for (const r of inspectionRows) {
    for (const k of [r.customOrder, r.salesOrder, r.id, r.inspectionId]) {
      if (k) covered.add(String(k));
    }
  }
  const extras = makes
    .filter((o) => !covered.has(String(o.name || "")) && !covered.has(String(o.erp_sales_order || o.sales_order || "")))
    .slice(0, 40)
    .map((o) => ({
      id: o.name,
      name: o.name,
      inspectionId: null,
      salesOrder: o.erp_sales_order || o.sales_order || null,
      customOrder: o.name,
      customerName: o.customer_name || "Client",
      qcResult: "Pending",
      result: "Pending",
      orderStatus: o.order_status || o.status || "Quality Control",
      garmentSummary: o.garment_summary || o.garment_type || null,
      dateReceived: dateReceivedLabel(o.date_received),
      scanUrl: `https://alts.lstailors.com/qc/${encodeURIComponent(o.name)}`,
    }));

  return [...inspectionRows, ...extras];
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

// GET /api/qc/count — same Pending COUNT as WAITING tab + home tile
qcRouter.get("/count", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  try {
    const metrics = await getAltsMetrics();
    return c.json({
      data: {
        waiting: metrics.qc.waiting,
        open: metrics.qc.open,
        passed: metrics.qc.passed,
        failed: metrics.qc.failed,
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Could not count QC" } }, 502);
  }
});

// GET /api/qc/rates — pass/fail by week, garment, store vs make
qcRouter.get("/rates", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  try {
    const inspections = (await listInspections()).filter(
      (r) => isQcInspectionName(r.name) && !isSalesOrderName(r.name),
    );
    const decided = inspections.filter((r) => {
      const q = qcResultOf(r);
      return q === "Pass" || q === "Fail";
    });
    const passed = decided.filter((r) => qcResultOf(r) === "Pass");
    const failed = decided.filter((r) => qcResultOf(r) === "Fail");
    const pending = inspections.filter((r) => qcResultOf(r) === "Pending");
    const weekAgo = Date.now() - 7 * 86_400_000;
    const passedThisWeek = passed.filter((r) => {
      const t = Date.parse(r.modified || r.creation || "");
      return Number.isFinite(t) && t >= weekAgo;
    }).length;
    const decidedN = decided.length;
    return c.json({
      data: {
        passed: passed.length,
        failed: failed.length,
        pending: pending.length,
        passRate: decidedN ? Math.round((passed.length / decidedN) * 100) : 0,
        passedThisWeek,
        byWeek: rateBuckets(decided, (d) => isoWeekKey(d.modified || d.creation)),
        byGarment: rateBuckets(decided, garmentKey),
        bySource: rateBuckets(decided, sourceKey),
      },
    });
  } catch (e: any) {
    console.error("GET /api/qc/rates", e);
    return c.json({ error: { message: e?.message || "Could not load QC rates" } }, 502);
  }
});

// GET /api/qc/orders?status=Production — live MTM pipeline (all statuses)
qcRouter.get("/orders", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const status = (c.req.query("status") || "").trim();
  try {
    const rows = await listMtmPipeline(status || undefined);
    return c.json({ data: rows, meta: { statuses: MTM_STATUSES, status: status || null } });
  } catch (e: any) {
    console.error("GET /api/qc/orders", e);
    return c.json({ error: { message: e?.message || "Could not load MTM orders" } }, 502);
  }
});

// PATCH /api/qc/orders/:name/status — set live MTM / make-order status
qcRouter.patch("/orders/:name/status", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const name = decodeURIComponent(c.req.param("name"));
  const body = await c.req.json().catch(() => ({}));
  const status = String(body.status || "").trim();
  if (!isMtmStatusKey(status)) {
    return c.json({ error: { message: "Unknown status" } }, 400);
  }
  try {
    const data = await setMtmOrderStatus(name, status);
    return c.json({ data });
  } catch (e: any) {
    console.error("PATCH /api/qc/orders/:name/status", e);
    return c.json({ error: { message: e?.message || "Could not update status" } }, 502);
  }
});

// GET /api/qc?tab=waiting|open|passed|failed
qcRouter.get("/", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const tab = (c.req.query("tab") || "waiting").toLowerCase();

  try {
    const want = tabToQcResult(tab) ?? "Pending";
    const inspections = await listInspectionsByResult(want);
    const rows = dedupeByInspectionName(inspections).map((r) => serializeListRow(r));
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
    const mtm =
      insp?.mtmpro_order ||
      (/^LST-\d/i.test(id) ? id : null) ||
      (/^LST-\d/i.test(String(custom || "")) ? custom : null);

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
    if (mtm) {
      for (const fmt of ["Standard", "MTMPro Order", "LSH MTM Pro", "MTM Pro Order"]) {
        buf = await tryPdf(DT.MTM_PRO_ORDER, mtm, fmt);
        if (buf) {
          filename = `${mtm}.pdf`;
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
    if (!buf && so) {
      for (const fmt of ["Standard", "Sales Order", "L&S Sales Order"]) {
        buf = await tryPdf("Sales Order", so, fmt);
        if (buf) {
          filename = `${so}.pdf`;
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

// GET /api/qc/:id — floor can open the item to change live status; checks stay tailor-gated on PATCH
qcRouter.get("/:id", async (c) => {
  const gate = await requireFloor(c);
  if (gate.res) return gate.res;
  const id = decodeURIComponent(c.req.param("id"));

  try {
    const insp = await resolveInspection(id);
    if (!insp?.name) {
      const co = await erpGet<any>(DT_CUSTOM, id).catch(() => null);
      const mtm = await erpGet<any>(DT.MTM_PRO_ORDER, id).catch(() => null);
      const so = await erpGet<any>("Sales Order", id).catch(() => null);
      if (!co && !mtm && !so) return c.json({ error: { message: "Not found" } }, 404);
      const order = mtm || co;
      return c.json({
        data: {
          id: null,
          name: null,
          salesOrder: so?.name || order?.erp_sales_order || order?.sales_order || null,
          customOrder: co?.name || null,
          mtmproOrder: mtm?.name || co?.name || null,
          orderName: order?.name || null,
          customer: order?.customer || so?.customer || null,
          customerName: order?.customer_name || so?.customer_name || "Client",
          qcResult: "Pending",
          result: "Pending",
          notes: "",
          checks: blankChecks(),
          summary: checksSummary(blankChecks()),
          photos: [],
          docuseal: false,
          orderStatus: order?.order_status || order?.status || so?.status || null,
          garmentSummary: order?.garment_summary || order?.garment_type || order?.order_type || null,
          links: {
            customer: order?.customer || so?.customer || null,
            salesOrder: so?.name || order?.erp_sales_order || null,
            customOrder: co?.name || mtm?.name || null,
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
    let orderName: string | null = insp.custom_order || insp.mtmpro_order || null;
    if (insp.custom_order) {
      const co = await erpGet<any>(DT_CUSTOM, insp.custom_order).catch(() => null);
      orderStatus = co?.order_status || co?.status || null;
      garmentSummary = co?.garment_summary || co?.garment_type || null;
      if (co?.name) orderName = co.name;
    }
    if (!orderStatus && orderName) {
      const mtm = await erpGet<any>(DT.MTM_PRO_ORDER, orderName).catch(() => null);
      if (mtm) {
        orderStatus = mtm.order_status || mtm.status || orderStatus;
        garmentSummary = garmentSummary || mtm.garment_summary || mtm.order_type || null;
      }
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
        orderName,
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
    if (typeof body.failReason === "string") update.fail_reason = body.failReason;
    if (typeof body.signatureUrl === "string") update.signature_url = body.signatureUrl;

    const want = body.qc_result || body.result;
    if (want === "Pass" || want === "Fail") {
      if (want === "Fail") {
        const notes = String(body.notes ?? body.failReason ?? update.notes ?? existing.notes ?? "").trim();
        if (!notes) return c.json({ error: { message: "Notes are required to fail" } }, 400);
        update.notes = notes;
      }
      update.qc_result = want;
      update.result = want;
    }

    const saved = await updateDroppingFields(existing.name, update);
    const fresh = (await erpGet<any>(DT_QC, existing.name).catch(() => null)) || saved || { ...existing, ...update };
    if (want === "Fail") {
      void notifyQcFail(fresh, String(update.notes || "")).catch((e) =>
        console.warn("[qc.fail] notify", e?.message),
      );
    }
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
