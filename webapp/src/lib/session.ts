// Server-side session profile (richer than authClient's session).
// Single hook every page can rely on.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Profile } from "./types";

export const ME_KEY = ["me"];

export function useMe() {
  return useQuery<Profile | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const result = await api.get<Profile>("/api/me");
        return result ?? null;
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useInvalidateMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ME_KEY });
}
