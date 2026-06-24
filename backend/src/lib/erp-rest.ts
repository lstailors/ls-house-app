// Unified ERPNext REST client (server-only).
//
// Env vars:
// - ERPNEXT_BASE_URL or ERP_URL
// - ERPNEXT_API_KEY or ERP_API_KEY
// - ERPNEXT_API_SECRET or ERP_API_SECRET
// - ERPNEXT_SESSION_TOKEN (optional alternative to API key/secret)

export type ErpFilter =
  | [field: string, operator: string, value: unknown]
  | [doctype: string, field: string, operator: string, value: unknown];

export interface ErpListOptions {
  filters?: ErpFilter[] | unknown[];
  fields?: string[];
  limit?: number;
  limit_page_length?: number;
  limit_start?: number;
  order_by?: string;
  as_dict?: boolean;
}

export interface ErpListResult<T> {
  data: T[];
  total?: number;
}

export interface ErpDoctypeField {
  fieldname: string;
  label?: string;
  fieldtype: string;
  options?: string;
  reqd?: 0 | 1;
  read_only?: 0 | 1;
  hidden?: 0 | 1;
  default?: unknown;
  description?: string;
  depends_on?: string;
  mandatory_depends_on?: string;
}

export interface ErpDoctypeSchema {
  name: string;
  doctype: string;
  module?: string;
  fields: ErpDoctypeField[];
  permissions?: unknown[];
  raw?: unknown;
}

export class ErpRestError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ErpRestError";
  }
}

function normalizeBaseUrl(base: string): string {
  return base.replace(/\/+$/, "");
}

function creds() {
  const base = process.env.ERPNEXT_BASE_URL ?? process.env.ERP_URL ?? "";
  const key = process.env.ERPNEXT_API_KEY ?? process.env.ERP_API_KEY ?? "";
  const secret = process.env.ERPNEXT_API_SECRET ?? process.env.ERP_API_SECRET ?? "";
  const sessionToken = process.env.ERPNEXT_SESSION_TOKEN ?? "";

  return {
    base: base ? normalizeBaseUrl(base) : "",
    key,
    secret,
    sessionToken,
  };
}

function authHeaders(): Record<string, string> {
  const { key, secret, sessionToken } = creds();
  if (sessionToken) {
    return { Cookie: `sid=${sessionToken}`, Accept: "application/json" };
  }
  return { Authorization: `token ${key}:${secret}`, Accept: "application/json" };
}

function ensureConfigured() {
  const { base, key, secret, sessionToken } = creds();
  if (!base) throw new ErpRestError("ERPNEXT_BASE_URL is not configured", 503);
  if (!sessionToken && (!key || !secret)) {
    throw new ErpRestError("ERPNext credentials are not configured", 503);
  }
  return { base };
}

function appendJsonParam(url: URL, key: string, value: unknown | undefined) {
  if (value !== undefined) url.searchParams.set(key, JSON.stringify(value));
}

async function parseJsonBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function erpMessage(body: any, fallback: string): string {
  if (typeof body?.message === "string") return body.message;
  if (typeof body?.exception === "string") return body.exception;

  try {
    const serverMessages = body?._server_messages ? JSON.parse(body._server_messages) : [];
    const first = serverMessages.length ? JSON.parse(serverMessages[0]) : null;
    if (typeof first?.message === "string") return first.message;
  } catch {
    // Keep the fallback if ERPNext's nested server message payload is not JSON.
  }

  return fallback;
}

async function erpFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { base } = ensureConfigured();
  const headers = {
    ...authHeaders(),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };

  const res = await fetch(`${base}${path}`, { ...init, headers });
  const body = await parseJsonBody(res);
  if (!res.ok) {
    throw new ErpRestError(erpMessage(body, `ERPNext request failed with ${res.status}`), res.status, body);
  }
  return body as T;
}

export function getErpRestConfig() {
  const { base, key, secret, sessionToken } = creds();
  return {
    base,
    authMode: sessionToken ? "session" : key && secret ? "token" : "none",
    configured: Boolean(base && (sessionToken || (key && secret))),
  };
}

export async function erpPing(): Promise<{ ok: boolean; baseUrl: string; authMode: string }> {
  const config = getErpRestConfig();
  if (!config.configured) return { ok: false, baseUrl: config.base, authMode: config.authMode };
  await erpFetch<{ message?: unknown }>("/api/method/frappe.auth.get_logged_user");
  return { ok: true, baseUrl: config.base, authMode: config.authMode };
}

export async function erpListResult<T = unknown>(
  doctype: string,
  opts: ErpListOptions = {},
): Promise<ErpListResult<T>> {
  const { base } = ensureConfigured();
  const url = new URL(`${base}/api/resource/${encodeURIComponent(doctype)}`);
  appendJsonParam(url, "filters", opts.filters);
  appendJsonParam(url, "fields", opts.fields);
  if (opts.limit ?? opts.limit_page_length) {
    url.searchParams.set("limit_page_length", String(opts.limit_page_length ?? opts.limit));
  }
  if (opts.limit_start !== undefined) url.searchParams.set("limit_start", String(opts.limit_start));
  if (opts.order_by) url.searchParams.set("order_by", opts.order_by);
  if (opts.as_dict !== undefined) url.searchParams.set("as_dict", opts.as_dict ? "1" : "0");

  const json = await erpFetch<{ data?: T[] }>(`${url.pathname}${url.search}`);
  return { data: json.data ?? [] };
}

export async function erpList<T = unknown>(
  doctype: string,
  opts: ErpListOptions = {},
): Promise<T[]> {
  return (await erpListResult<T>(doctype, opts)).data;
}

export async function erpGet<T = unknown>(doctype: string, name: string): Promise<T | null> {
  try {
    const json = await erpFetch<{ data?: T }>(
      `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    );
    return json.data ?? null;
  } catch (err) {
    if (err instanceof ErpRestError && err.status === 404) return null;
    throw err;
  }
}

export async function erpCreate<T = unknown>(
  doctype: string,
  doc: Record<string, unknown>,
): Promise<T | null> {
  const json = await erpFetch<{ data?: T }>(`/api/resource/${encodeURIComponent(doctype)}`, {
    method: "POST",
    body: JSON.stringify(doc),
  });
  return json.data ?? null;
}

export async function erpUpdate<T = unknown>(
  doctype: string,
  name: string,
  doc: Record<string, unknown>,
): Promise<T | null> {
  const json = await erpFetch<{ data?: T }>(
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    { method: "PUT", body: JSON.stringify(doc) },
  );
  return json.data ?? null;
}

export async function erpDelete(doctype: string, name: string): Promise<void> {
  await erpFetch(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function erpCount(doctype: string, filters?: ErpFilter[] | unknown[]): Promise<number> {
  const message = await erpRunMethod("frappe.client.get_count", { doctype, filters: filters ?? [] });
  return typeof message === "number" ? message : Number(message ?? 0);
}

export async function erpRunMethod(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const json = await erpFetch<{ message?: unknown }>(`/api/method/${method}`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  return json.message ?? null;
}

export async function erpDoctypeFields(doctype: string): Promise<ErpDoctypeSchema> {
  const message = await erpRunMethod("frappe.desk.form.load.getdoctype", {
    doctype,
    with_parent: 1,
  }) as any;

  const docs = Array.isArray(message?.docs) ? message.docs : [];
  const meta = docs.find((doc: any) => doc?.doctype === "DocType" && doc?.name === doctype) ?? docs[0];
  const fields = Array.isArray(meta?.fields) ? meta.fields : [];

  return {
    name: meta?.name ?? doctype,
    doctype,
    module: meta?.module,
    fields: fields.map((field: any) => ({
      fieldname: field.fieldname,
      label: field.label,
      fieldtype: field.fieldtype,
      options: field.options,
      reqd: field.reqd,
      read_only: field.read_only,
      hidden: field.hidden,
      default: field.default,
      description: field.description,
      depends_on: field.depends_on,
      mandatory_depends_on: field.mandatory_depends_on,
    })).filter((field: ErpDoctypeField) => Boolean(field.fieldname)),
    permissions: meta?.permissions,
    raw: meta,
  };
}

export async function erpSubmit(doctype: string, name: string): Promise<void> {
  await erpRunMethod("frappe.client.submit", {
    doc: JSON.stringify({ doctype, name }),
  });
}

export async function erpPdf(doctype: string, name: string, format: string): Promise<Response> {
  const { base } = ensureConfigured();
  const url = `${base}/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(doctype)}&name=${encodeURIComponent(name)}&format=${encodeURIComponent(format)}&no_letterhead=0`;
  return fetch(url, { headers: authHeaders() });
}
