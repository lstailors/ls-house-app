import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "@ls/api-client";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { isShopApiReachable } from "@alts/offline/probe";

export type ErpHealth = {
  ok: boolean;
  status: "ok" | "degraded";
  erp: {
    configured: boolean;
    reachable: boolean;
    latencyMs: number | null;
    error: string | null;
  };
};

const LEGACY_OK: ErpHealth = {
  ok: true,
  status: "ok",
  erp: { configured: true, reachable: true, latencyMs: null, error: null },
};

export function useErpHealth() {
  return useQuery({
    queryKey: ["api-health"],
    queryFn: async (): Promise<ErpHealth> => {
      try {
        return await api.get<ErpHealth>("/api/health");
      } catch (err) {
        // Frozen production API has no /api/health. /api/me still answers.
        if (err instanceof ApiError && err.status === 404) {
          const me = await api.raw("/api/me");
          if (isShopApiReachable(me.status)) return LEGACY_OK;
        }
        throw err;
      }
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
