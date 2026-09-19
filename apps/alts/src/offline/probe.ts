/** Frozen app.lstailors.com API (pre-Aug 15) has no /api/health. /api/me still does. */
export function isLegacyApiMissingHealth(status: number): boolean {
  return status === 404;
}

export function isShopApiReachable(status: number): boolean {
  return status === 200 || status === 401 || status === 403;
}

export type NormalizedErpHealth = {
  ok: boolean;
  status: "ok" | "degraded";
  erp: {
    configured: boolean;
    reachable: boolean;
    latencyMs: number | null;
    error: string | null;
  };
};

const LEGACY_OK: NormalizedErpHealth = {
  ok: true,
  status: "ok",
  erp: { configured: true, reachable: true, latencyMs: null, error: null },
};

/** Live prod still returns `{status:"ok"}` with no `data`/`erp`. Do not treat that as down. */
export function normalizeApiHealth(json: unknown): NormalizedErpHealth | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const nested = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : null;
  const payload = nested && "erp" in nested ? nested : root;
  const erp = payload.erp;
  if (erp && typeof erp === "object") {
    const e = erp as Record<string, unknown>;
    const reachable = Boolean(e.reachable);
    return {
      ok: Boolean(payload.ok ?? reachable),
      status: payload.status === "degraded" || !reachable ? "degraded" : "ok",
      erp: {
        configured: Boolean(e.configured),
        reachable,
        latencyMs: typeof e.latencyMs === "number" ? e.latencyMs : null,
        error: typeof e.error === "string" ? e.error : null,
      },
    };
  }
  if (payload.status === "ok" || payload.ok === true) return LEGACY_OK;
  return null;
}

export async function probeShopApi(raw: (path: string) => Promise<Response>): Promise<boolean> {
  const health = await raw("/api/health");
  if (health.ok) return true;
  if (!isLegacyApiMissingHealth(health.status)) return false;
  const me = await raw("/api/me");
  return isShopApiReachable(me.status);
}
