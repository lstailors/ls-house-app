/** DocuSeal credentials for MTM QC. Never shipped in the client bundle. */

import { erpGet, erpUpdate, erpCreate, erpRunMethod, erpList } from "./erp";
import { erpFileAbsoluteUrl, uploadFile } from "./erpnext/files";

const SETTINGS_DT = "LSH QC Settings";
const SETTINGS_NAME = "LSH QC Settings";
const DEFAULT_URL = "https://docuseal.lstailors.com";

const GLOBAL_KEY = "lsh_docuseal_api_key";
const GLOBAL_URL = "lsh_docuseal_url";
const GLOBAL_TEMPLATE = "lsh_docuseal_template_id";

/** Private ERP File — Vercel memory and unknown custom fields cannot keep the key. */
export const DOCUSEAL_SETTINGS_FILE = "lsh-docuseal-settings.json";

export type QcDocusealSettings = {
  url: string;
  apiKey: string;
  templateId: string;
};

let memory: QcDocusealSettings | null = null;

function envFallback(): QcDocusealSettings {
  return {
    url: (process.env.DOCUSEAL_URL || DEFAULT_URL).replace(/\/$/, ""),
    apiKey: (process.env.DOCUSEAL_API_KEY || "").trim(),
    templateId: (process.env.DOCUSEAL_TEMPLATE_ID || "").trim(),
  };
}

function applyEnv(next: QcDocusealSettings) {
  if (next.apiKey) process.env.DOCUSEAL_API_KEY = next.apiKey;
  if (next.url) process.env.DOCUSEAL_URL = next.url;
  if (next.templateId) process.env.DOCUSEAL_TEMPLATE_ID = next.templateId;
}

export function mergeDocusealSettings(
  ...layers: Array<Partial<QcDocusealSettings> | null | undefined>
): QcDocusealSettings {
  const env = envFallback();
  const out: QcDocusealSettings = { url: env.url || DEFAULT_URL, apiKey: env.apiKey, templateId: env.templateId };
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.url) out.url = String(layer.url).replace(/\/$/, "") || out.url;
    if (layer.apiKey) out.apiKey = String(layer.apiKey).trim();
    if (layer.templateId) out.templateId = String(layer.templateId).trim();
  }
  return out;
}

export function parseDocusealSettingsFile(text: string): Partial<QcDocusealSettings> | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      return {
        apiKey: String(j.apiKey || j.docuseal_api_key || "").trim(),
        url: String(j.url || j.docuseal_url || "").trim(),
        templateId: String(j.templateId || j.docuseal_template_id || "").trim(),
      };
    } catch {
      return null;
    }
  }
  return { apiKey: raw };
}

async function fromErpDoc(): Promise<Partial<QcDocusealSettings> | null> {
  const row = await erpGet<any>(SETTINGS_DT, SETTINGS_NAME).catch(() => null);
  if (!row) return null;
  return {
    apiKey: String(row.docuseal_api_key || row.api_key || "").trim(),
    url: String(row.docuseal_url || row.url || "").replace(/\/$/, ""),
    templateId: String(row.docuseal_template_id || row.template_id || "").trim(),
  };
}

async function globalDefault(key: string): Promise<string> {
  const val = await erpRunMethod("frappe.defaults.get_global_default", { key }).catch(() => null);
  return String(val || "").trim();
}

async function fromGlobals(): Promise<Partial<QcDocusealSettings>> {
  const [apiKey, url, templateId] = await Promise.all([
    globalDefault(GLOBAL_KEY),
    globalDefault(GLOBAL_URL),
    globalDefault(GLOBAL_TEMPLATE),
  ]);
  return { apiKey, url, templateId };
}

async function fromErpFile(): Promise<Partial<QcDocusealSettings> | null> {
  const rows = await erpList<{ file_url?: string }>("File", {
    filters: [["file_name", "=", DOCUSEAL_SETTINGS_FILE]],
    fields: ["name", "file_url", "creation"],
    order_by: "creation desc",
    limit: 3,
  }).catch(() => []);
  const fileUrl = rows.find((row) => row.file_url)?.file_url;
  if (!fileUrl) return null;
  const base = (process.env.ERPNEXT_BASE_URL || "").replace(/\/$/, "");
  const key = process.env.ERPNEXT_API_KEY || "";
  const secret = process.env.ERPNEXT_API_SECRET || "";
  if (!base || !key || !secret) return null;
  const abs = erpFileAbsoluteUrl(fileUrl);
  const res = await fetch(abs, {
    headers: {
      Authorization: `token ${key}:${secret}`,
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0; +https://app.lstailors.com)",
    },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return parseDocusealSettingsFile(await res.text());
}

async function persistErpFile(next: QcDocusealSettings): Promise<void> {
  await uploadFile({
    file: Buffer.from(
      JSON.stringify({ apiKey: next.apiKey, url: next.url, templateId: next.templateId }),
      "utf8",
    ),
    filename: DOCUSEAL_SETTINGS_FILE,
    contentType: "application/json",
    folder: "Home",
    isPrivate: true,
  });
}

async function persistGlobals(next: QcDocusealSettings): Promise<void> {
  await Promise.all([
    erpRunMethod("frappe.defaults.set_global_default", { key: GLOBAL_KEY, value: next.apiKey }).catch(() => null),
    erpRunMethod("frappe.defaults.set_global_default", { key: GLOBAL_URL, value: next.url }).catch(() => null),
    erpRunMethod("frappe.defaults.set_global_default", { key: GLOBAL_TEMPLATE, value: next.templateId }).catch(() => null),
  ]);
}

async function persistSetValue(next: QcDocusealSettings): Promise<void> {
  const pairs: Array<[string, string]> = [
    ["docuseal_api_key", next.apiKey],
    ["docuseal_url", next.url],
    ["docuseal_template_id", next.templateId],
  ];
  for (const [fieldname, value] of pairs) {
    if (!value) continue;
    await erpRunMethod("frappe.client.set_value", {
      doctype: SETTINGS_DT,
      name: SETTINGS_NAME,
      fieldname,
      value,
    }).catch(() => null);
  }
}

async function persistErpDoc(next: QcDocusealSettings): Promise<void> {
  const payload = {
    docuseal_api_key: next.apiKey,
    docuseal_url: next.url,
    docuseal_template_id: next.templateId,
  };
  const existing = await erpGet<any>(SETTINGS_DT, SETTINGS_NAME).catch(() => null);
  const write = existing
    ? (doc: Record<string, unknown>) => erpUpdate(SETTINGS_DT, SETTINGS_NAME, doc)
    : (doc: Record<string, unknown>) => erpCreate(SETTINGS_DT, { name: SETTINGS_NAME, ...doc });
  try {
    await write(payload);
  } catch {
    const { docuseal_template_id: _drop, ...withoutTemplate } = payload;
    await write(withoutTemplate).catch(() => null);
  }
}

export async function loadDocusealSettings(): Promise<QcDocusealSettings> {
  if (memory?.apiKey) return memory;
  const [doc, globals, file] = await Promise.all([fromErpDoc(), fromGlobals(), fromErpFile()]);
  memory = mergeDocusealSettings(globals, doc, file);
  return memory;
}

export async function saveDocusealSettings(input: {
  apiKey?: string;
  url?: string;
  templateId?: string;
}): Promise<QcDocusealSettings> {
  const current = await loadDocusealSettings();
  const next: QcDocusealSettings = {
    url: (input.url ?? current.url ?? DEFAULT_URL).replace(/\/$/, "") || DEFAULT_URL,
    apiKey: input.apiKey != null ? String(input.apiKey).trim() : current.apiKey,
    templateId: input.templateId != null ? String(input.templateId).trim() : current.templateId,
  };

  // File first — this is the store that actually survives a new Vercel instance.
  await persistErpFile(next);
  await persistErpDoc(next).catch(() => null);
  await persistSetValue(next);
  await persistGlobals(next);

  memory = next;
  applyEnv(next);
  return next;
}

export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length < 8) return k ? "••••" : "";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}
