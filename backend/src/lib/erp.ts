// Lightweight ERPNext REST client (server-only).
// Bun auto-loads .env in the cwd, but the Vibecode launcher injects a custom
// env that bypasses bun's .env auto-loading. Load the .env file explicitly so
// credentials are always available regardless of how the process was started.

import { readFileSync } from 'fs'
import { join } from 'path'

function loadDotEnv() {
  try {
    const envPath = join(process.cwd(), '.env')
    const content = readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (key && !process.env[key]) process.env[key] = val
    }
  } catch {
    // .env not found — rely on process env
  }
}

loadDotEnv()

function creds() {
  return {
    base:   process.env.ERPNEXT_BASE_URL   ?? '',
    key:    process.env.ERPNEXT_API_KEY    ?? '',
    secret: process.env.ERPNEXT_API_SECRET ?? '',
  }
}

function authHeaders(key: string, secret: string): Record<string, string> {
  return { Authorization: `token ${key}:${secret}`, Accept: 'application/json' }
}

export async function erpList<T = unknown>(
  doctype: string,
  opts: {
    filters?: unknown[]
    fields?: string[]
    limit?: number
    order_by?: string
  } = {}
): Promise<T[]> {
  const { base, key, secret } = creds()
  if (!base || !key || !secret) return []

  const url = new URL(`${base}/api/resource/${encodeURIComponent(doctype)}`)
  if (opts.filters)  url.searchParams.set('filters',           JSON.stringify(opts.filters))
  if (opts.fields)   url.searchParams.set('fields',            JSON.stringify(opts.fields))
  if (opts.limit)    url.searchParams.set('limit_page_length', String(opts.limit))
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
