// Server-side session profile (richer than authClient's session).
// Single hook every page can rely on.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import type { Profile } from "@ls/types";

export const ME_KEY = ["me"];

export function useMe() {
  return useQuery<Profile | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const result = await api.get<Profile>("/api/me");
          clearTimeout(timer);
          return result ?? null;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        return null;
      }
    },
    staleTime: 10_000,
    retry: false,
  });
}

export function useInvalidateMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ME_KEY });
}
