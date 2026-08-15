import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import type { AltsMetrics } from "@ls/types";

export function useAltsMetrics() {
  return useQuery({
    queryKey: ["alts-metrics"],
    queryFn: () => api.get<AltsMetrics>("/api/metrics"),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
