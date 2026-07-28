// Session profile hook + proactive 8h refresh (HER-15 / Stage 1).
// Single hook every page can rely on.

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Profile } from "@ls/types";
import { refreshSession } from "./authClient";

export const ME_KEY = ["me"];

export function useMe() {
  const query = useQuery<Profile | null>({
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

  // Sliding refresh: on mount + when tab regains focus, extend the 8h cookie JWT
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (document.visibilityState === "hidden") return;
      const ok = await refreshSession();
      if (!ok || cancelled) return;
    };
    void run();
    const onVis = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return query;
}

export function useInvalidateMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ME_KEY });
}
