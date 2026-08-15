/** DocuSeal credentials for MTM QC. Stored in ERPNext — never in the client bundle. */

import { erpGet, erpUpdate, erpCreate, erpRunMethod } from "./erp";

const SETTINGS_DT = "LSH QC Settings";
const SETTINGS_NAME = "LSH QC Settings";
const DEFAULT_URL = "https://docuseal.lstailors.com";

export type QcDocusealSettings = {
  url: string;
  apiKey: string;
};

let memory: QcDocusealSettings | null = null;

function envFallback(): QcDocusealSettings {
  return {
    url: (process.env.DOCUSEAL_URL || DEFAULT_URL).replace(/\/$/, ""),
    apiKey: (process.env.DOCUSEAL_API_KEY || "").trim(),
  };
}

async function fromErpDoc(): Promise<QcDocusealSettings | null> {
  const row = await erpGet<any>(SETTINGS_DT, SETTINGS_NAME).catch(() => null);
  if (!row) return null;
  const apiKey = String(row.docuseal_api_key || row.api_key || "").trim();
  const url = String(row.docuseal_url || row.url || DEFAULT_URL).replace(/\/$/, "");
  return { url: url || DEFAULT_URL, apiKey };
}

async function fromGlobalDefault(): Promise<string> {
  const val = await erpRunMethod("frappe.defaults.get_global_default", {
    key: "lsh_docuseal_api_key",
  }).catch(() => null);
  return String(val || "").trim();
}

export async function loadDocusealSettings(): Promise<QcDocusealSettings> {
  if (memory?.apiKey) return memory;
  const doc = await fromErpDoc();
  const env = envFallback();
  const globalKey = doc?.apiKey ? "" : await fromGlobalDefault();
  memory = {
    url: doc?.url || env.url || DEFAULT_URL,
    apiKey: doc?.apiKey || globalKey || env.apiKey,
  };
  return memory;
}

export async function saveDocusealSettings(input: { apiKey?: string; url?: string }): Promise<QcDocusealSettings> {
  const current = await loadDocusealSettings();
  const next: QcDocusealSettings = {
    url: (input.url ?? current.url ?? DEFAULT_URL).replace(/\/$/, "") || DEFAULT_URL,
    apiKey: input.apiKey != null ? String(input.apiKey).trim() : current.apiKey,
  };

  const payload = {
    docuseal_api_key: next.apiKey,
    docuseal_url: next.url,
  };

  try {
    const existing = await erpGet<any>(SETTINGS_DT, SETTINGS_NAME).catch(() => null);
    if (existing) {
      await erpUpdate(SETTINGS_DT, SETTINGS_NAME, payload);
    } else {
      await erpCreate(SETTINGS_DT, { name: SETTINGS_NAME, ...payload });
    }
  } catch {
    await erpRunMethod("frappe.defaults.set_global_default", {
      key: "lsh_docuseal_api_key",
      value: next.apiKey,
    }).catch(() => {});
    await erpRunMethod("frappe.defaults.set_global_default", {
      key: "lsh_docuseal_url",
      value: next.url,
    }).catch(() => {});
  }

  memory = next;
  if (next.apiKey) process.env.DOCUSEAL_API_KEY = next.apiKey;
  if (next.url) process.env.DOCUSEAL_URL = next.url;
  return next;
}

export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length < 8) return k ? "••••" : "";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}
