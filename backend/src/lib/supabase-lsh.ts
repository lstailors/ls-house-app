// Supabase REST helper for lsh.* schema (Edge-safe: fetch only).

function trimEnv(v: string | undefined): string {
  return (v ?? "").trim().replace(/\\n/g, "").replace(/\r/g, "");
}

export function supabaseConfig(): { url: string; key: string } | null {
  const url = trimEnv(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const key = trimEnv(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_KEY
  );
  if (!url || !key || key.length < 80) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function lshFetch(
  path: string,
  init: RequestInit & { profile?: string } = {}
): Promise<Response> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
  const headers = new Headers(init.headers || {});
  headers.set("apikey", cfg.key);
  headers.set("Authorization", `Bearer ${cfg.key}`);
  headers.set("Accept", "application/json");
  headers.set("Accept-Profile", init.profile || "lsh");
  headers.set("Content-Profile", init.profile || "lsh");
  return fetch(`${cfg.url}/rest/v1/${path}`, { ...init, headers });
}

export async function lshSelect<T = Record<string, unknown>>(
  table: string,
  opts: {
    select?: string;
    filters?: string[];
    order?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<T[]> {
  const params = new URLSearchParams();
  params.set("select", opts.select ?? "*");
  if (opts.order) params.set("order", opts.order);
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  for (const f of opts.filters ?? []) {
    const i = f.indexOf("=");
    if (i > 0) params.append(f.slice(0, i), f.slice(i + 1));
  }
  const res = await lshFetch(`${table}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`lsh.${table} ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T[];
}

export async function lshInsert<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown> | Record<string, unknown>[],
  opts: { upsert?: boolean; onConflict?: string } = {}
): Promise<T | T[] | null> {
  const params = new URLSearchParams();
  if (opts.upsert && opts.onConflict) params.set("on_conflict", opts.onConflict);
  const prefer = opts.upsert
    ? "resolution=merge-duplicates,return=representation"
    : "return=representation";
  const res = await lshFetch(`${table}?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`lsh.${table} insert ${res.status}: ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as T | T[];
}

export async function lshUpdate(
  table: string,
  filters: string[],
  values: Record<string, unknown>
): Promise<void> {
  const params = new URLSearchParams();
  for (const f of filters) {
    const i = f.indexOf("=");
    if (i > 0) params.append(f.slice(0, i), f.slice(i + 1));
  }
  const res = await lshFetch(`${table}?${params.toString()}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(values),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`lsh.${table} update ${res.status}: ${body.slice(0, 300)}`);
  }
}
