// Frappe REST client — server only.
// Two credentials:
//  - service: ERP_API_KEY/SECRET, for lookups the Customer role must never do
//    itself (buying price lists, vendor map, customer terms).
//  - session: the logged-in user's `sid`, for their own Fabric Quote records so
//    ERPNext's "own only" permission is enforced by ERPNext itself.
import "server-only";

const UA = "Mozilla/5.0 (compatible; LS-Fabric-Estimator/1.0; +https://lstailors.com)";

export class ErpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function base(): string {
  const b = process.env.ERP_BASE_URL;
  if (!b) throw new ErpError("ERP_BASE_URL is not configured", 500);
  return b.replace(/\/+$/, "");
}

function serviceAuth(): Record<string, string> {
  const key = process.env.ERP_API_KEY;
  const secret = process.env.ERP_API_SECRET;
  if (!key || !secret) throw new ErpError("ERP service credentials are not configured", 500);
  return { Authorization: `token ${key}:${secret}` };
}

export type Auth = { kind: "service" } | { kind: "session"; sid: string };

function authHeaders(auth: Auth): Record<string, string> {
  return auth.kind === "service" ? serviceAuth() : { Cookie: `sid=${auth.sid}` };
}

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { exception?: string; message?: string; _server_messages?: string };
    if (j._server_messages) {
      const msgs = JSON.parse(j._server_messages) as string[];
      const first = msgs[0] ? (JSON.parse(msgs[0]) as { message?: string }).message : undefined;
      if (first) return first.replace(/<[^>]+>/g, "");
    }
    return j.exception ?? j.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function erpFetch<T>(
  path: string,
  auth: Auth,
  init: RequestInit & { query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const url = new URL(base() + path);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      ...authHeaders(auth),
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new ErpError(await readError(res), res.status);
  return (await res.json()) as T;
}

export type Filters = unknown[];

export interface ListOpts {
  filters?: Filters;
  or_filters?: Filters;
  fields?: string[];
  limit?: number;
  start?: number;
  order_by?: string;
  parent?: string;
}

export async function erpList<T>(doctype: string, auth: Auth, opts: ListOpts = {}): Promise<T[]> {
  const j = await erpFetch<{ data: T[] }>(`/api/resource/${encodeURIComponent(doctype)}`, auth, {
    query: {
      filters: opts.filters ? JSON.stringify(opts.filters) : undefined,
      or_filters: opts.or_filters ? JSON.stringify(opts.or_filters) : undefined,
      fields: JSON.stringify(opts.fields ?? ["name"]),
      limit_page_length: String(opts.limit ?? 20),
      limit_start: opts.start ? String(opts.start) : undefined,
      order_by: opts.order_by,
      parent: opts.parent,
    },
  });
  return j.data ?? [];
}

export async function erpGet<T>(doctype: string, name: string, auth: Auth): Promise<T | null> {
  try {
    const j = await erpFetch<{ data: T }>(
      `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
      auth,
    );
    return j.data ?? null;
  } catch (e) {
    if (e instanceof ErpError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}

export async function erpCreate<T>(doctype: string, doc: Record<string, unknown>, auth: Auth): Promise<T> {
  const j = await erpFetch<{ data: T }>(`/api/resource/${encodeURIComponent(doctype)}`, auth, {
    method: "POST",
    body: JSON.stringify(doc),
  });
  return j.data;
}

export async function erpUpdate<T>(
  doctype: string,
  name: string,
  patch: Record<string, unknown>,
  auth: Auth,
): Promise<T> {
  const j = await erpFetch<{ data: T }>(
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    auth,
    { method: "PUT", body: JSON.stringify(patch) },
  );
  return j.data;
}

export const SERVICE: Auth = { kind: "service" };
export const serviceList = <T>(doctype: string, opts: ListOpts = {}) => erpList<T>(doctype, SERVICE, opts);
export const serviceGet = <T>(doctype: string, name: string) => erpGet<T>(doctype, name, SERVICE);

// ── Session (login / whoami) ────────────────────────────────────────────────

/** Frappe /api/method/login. Returns the `sid` cookie value on success. */
export async function erpLogin(usr: string, pwd: string): Promise<string | null> {
  const res = await fetch(base() + "/api/method/login", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ usr, pwd }),
    cache: "no-store",
    redirect: "manual",
  });
  if (!res.ok) return null;
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  for (const c of cookies) {
    const m = /(?:^|\s)sid=([^;]+)/.exec(c);
    if (m && m[1] && m[1] !== "Guest") return m[1];
  }
  return null;
}

export async function erpLogout(sid: string): Promise<void> {
  await erpFetch("/api/method/logout", { kind: "session", sid }, { method: "POST" }).catch(() => undefined);
}

/** Resolve the user behind a sid. Null when the session is expired or Guest. */
export async function erpWhoAmI(sid: string): Promise<string | null> {
  try {
    const j = await erpFetch<{ message?: string }>("/api/method/frappe.auth.get_logged_user", {
      kind: "session",
      sid,
    });
    return j.message && j.message !== "Guest" ? j.message : null;
  } catch {
    return null;
  }
}

/** Upload a file with the user's session and attach it to a document. */
export async function erpUploadFile(
  sid: string,
  file: Blob,
  filename: string,
  attach: { doctype: string; docname: string; fieldname?: string },
): Promise<{ file_url: string; name: string }> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("is_private", "1");
  form.append("doctype", attach.doctype);
  form.append("docname", attach.docname);
  if (attach.fieldname) form.append("fieldname", attach.fieldname);
  const j = await erpFetch<{ message: { file_url: string; name: string } }>(
    "/api/method/upload_file",
    { kind: "session", sid },
    { method: "POST", body: form },
  );
  return j.message;
}
