import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import {
  isLegacyApiMissingHealth,
  isShopApiReachable,
  normalizeApiHealth,
  type NormalizedErpHealth,
} from "@alts/offline/probe";

export type ErpHealth = NormalizedErpHealth;

const LEGACY_OK: ErpHealth = {
  ok: true,
  status: "ok",
  erp: { configured: true, reachable: true, latencyMs: null, error: null },
};

export function useErpHealth() {
  return useQuery({
    queryKey: ["api-health"],
    queryFn: async (): Promise<ErpHealth> => {
      const res = await api.raw("/api/health");
      if (res.ok) {
        const json = await res.json().catch(() => null);
        const parsed = normalizeApiHealth(json);
        if (parsed) return parsed;
        return LEGACY_OK;
      }
      // Frozen production API has no /api/health. /api/me still answers.
      if (isLegacyApiMissingHealth(res.status)) {
        const me = await api.raw("/api/me");
        if (isShopApiReachable(me.status)) return LEGACY_OK;
      }
      throw new Error(`Health check failed (${res.status})`);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

/** Shown when ERPNext is configured but unreachable — never look like an empty day. */
export default function ErpStatusBanner({ onRetry }: { onRetry?: () => void }) {
  const health = useErpHealth();
  const erp = health.data?.erp;
  if (!erp || erp.reachable) return null;

  return (
    <QueryErrorPanel
      title="Not connected to ERPNext"
      message={
        erp.configured
          ? "The shop app cannot pull tickets from ERPNext right now. Orders and the shop floor will look empty until this comes back."
          : "ERPNext credentials are missing on the API. Tickets cannot load until they are set."
      }
      onRetry={() => {
        void health.refetch();
        onRetry?.();
      }}
    />
  );
}
