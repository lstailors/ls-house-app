// Supabase REST helper for lsh.* schema (Edge-safe: fetch only, no fs).
// Service role required for writers; readers can use service role server-side
// since Mission Control routes already gate super_admin|store_manager.

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

export async function lshSelect<T = Record<string, unknown>>(
  table: string,
  opts: {
    select?: string;
    filters?: string[]; // raw postgrest filter segments e.g. "status=eq.blocked"
    order?: string; // e.g. "priority.desc.nullslast"
    limit?: number;
    offset?: number;
  } = {}
): Promise<T[]> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");

  const params = new URLSearchParams();
  params.set("select", opts.select ?? "*");
  if (opts.order) params.set("order", opts.order);
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  for (const f of opts.filters ?? []) {
    const i = f.indexOf("=");
    if (i > 0) params.append(f.slice(0, i), f.slice(i + 1));
    else params.append(f, "");
  }

  const res = await fetch(`${cfg.url}/rest/v1/${table}?${params.toString()}`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Accept: "application/json",
      "Accept-Profile": "lsh",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`lsh.${table} ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T[];
}
