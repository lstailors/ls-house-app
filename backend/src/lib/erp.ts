// Lightweight ERPNext REST client (server-only).
// Credentials are read lazily from process.env at call time.
// - Vercel production: env vars injected by platform.
// - Local dev (Bun): loaded by index.ts → load-env.ts before any route runs.
// No fs/path imports here so this module is safe on Vercel Edge runtime.

function creds() {
  return {
    base:   process.env.ERPNEXT_BASE_URL   ?? '',
    key:    process.env.ERPNEXT_API_KEY    ?? '',
    secret: process.env.ERPNEXT_API_SECRET ?? '',
  }
}

function authHeaders(key: string, secret: string): Record<string, string> {
  // Browser UA required when ERPNEXT_BASE_URL is the public CF tunnel (code 1010 otherwise).
  return {
    Authorization: `token ${key}:${secret}`,
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; L&S-House-App/1.0; +https://app.lstailors.com)',
  }
}

export async function erpList<T = unknown>(
  doctype: string,
  opts: {
    filters?: unknown[]
    fields?: string[]
    limit?: number
    start?: number
    order_by?: string
  } = {}
): Promise<T[]> {
  const { base, key, secret } = creds()
  if (!base || !key || !secret) return []

  const url = new URL(`${base}/api/resource/${encodeURIComponent(doctype)}`)
  if (opts.filters)  url.searchParams.set('filters',           JSON.stringify(opts.filters))
  if (opts.fields)   url.searchParams.set('fields',            JSON.stringify(opts.fields))
  if (opts.limit)    url.searchParams.set('limit_page_length', String(opts.limit))
  if (opts.start)    url.searchParams.set('limit_start',       String(opts.start))
  if (opts.order_by) url.searchParams.set('order_by',          opts.order_by)

  const res = await fetch(url.toString(), { headers: authHeaders(key, secret) })
  if (!res.ok) return []
  const json = await res.json() as { data: T[] }
  return json.data ?? []
}

export async function erpGet<T = unknown>(doctype: string, name: string): Promise<T | null> {
  const { base, key, secret } = creds()
  if (!base || !key || !secret) return null
  const res = await fetch(
    `${base}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    { headers: authHeaders(key, secret) }
  )
  if (!res.ok) return null
  const json = await res.json() as { data: T }
  return json.data ?? null
}

export async function erpCreate<T = unknown>(doctype: string, doc: Record<string, unknown>): Promise<T | null> {
  const { base, key, secret } = creds()
  if (!base || !key || !secret) return null
  const res = await fetch(`${base}/api/resource/${encodeURIComponent(doctype)}`, {
    method: 'POST',
    headers: { ...authHeaders(key, secret), 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    throw new Error(err._server_messages || err.exception || `ERP create failed: ${res.status}`)
  }
  const json = await res.json() as { data: T }
  return json.data ?? null
}

export async function erpUpdate<T = unknown>(doctype: string, name: string, doc: Record<string, unknown>): Promise<T | null> {
  const { base, key, secret } = creds()
  if (!base || !key || !secret) return null
  const res = await fetch(`${base}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { ...authHeaders(key, secret), 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    throw new Error(err._server_messages || err.exception || `ERP update failed: ${res.status}`)
  }
  const json = await res.json() as { data: T }
  return json.data ?? null
}

export async function erpSubmit(doctype: string, name: string): Promise<void> {
  const { base, key, secret } = creds()
  if (!base || !key || !secret) return
  const res = await fetch(`${base}/api/method/frappe.client.submit`, {
    method: 'POST',
    headers: { ...authHeaders(key, secret), 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc: JSON.stringify({ doctype, name }) }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    throw new Error(err._server_messages || err.exception || `ERP submit failed: ${res.status}`)
  }
}

export async function erpPdf(doctype: string, name: string, format: string): Promise<Response> {
  const { base, key, secret } = creds()
  const url = `${base}/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(doctype)}&name=${encodeURIComponent(name)}&format=${encodeURIComponent(format)}&no_letterhead=0`
  return fetch(url, { headers: { Authorization: `token ${key}:${secret}` } })
}

export async function erpDelete(doctype: string, name: string): Promise<void> {
  const { base, key, secret } = creds()
  if (!base || !key || !secret) return
  const res = await fetch(
    `${base}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    { method: 'DELETE', headers: authHeaders(key, secret) },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    throw new Error(err._server_messages || err.exception || `ERP delete failed: ${res.status}`)
  }
}

export async function erpRunMethod(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const { base, key, secret } = creds()
  if (!base || !key || !secret) return null
  const res = await fetch(`${base}/api/method/${method}`, {
    method: 'POST',
    headers: { ...authHeaders(key, secret), 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    throw new Error(err._server_messages || err.exception || `ERP method failed: ${res.status}`)
  }
  const json = await res.json() as { message: unknown }
  return json.message ?? null
}
