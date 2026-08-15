import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";

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

export function useErpHealth() {
  return useQuery({
    queryKey: ["api-health"],
    queryFn: () => api.get<ErpHealth>("/api/health"),
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
