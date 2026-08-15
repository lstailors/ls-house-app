// Session profile hook + proactive 8h refresh (HER-15 / Stage 1).
// Single hook every page can rely on.

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@ls/api-client";
import type { Profile } from "@ls/types";
import { refreshSession } from "./authClient";

export const ME_KEY = ["me"];
const ME_CACHE = "ls.me.cache";

function readCachedMe(): Profile | null {
  try {
    const raw = sessionStorage.getItem(ME_CACHE);
    if (!raw) return null;
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

function writeCachedMe(user: Profile | null) {
  try {
    if (!user) sessionStorage.removeItem(ME_CACHE);
    else sessionStorage.setItem(ME_CACHE, JSON.stringify(user));
  } catch {
    /* private mode */
  }
}

export function useMe() {
  const cached = readCachedMe();
  const query = useQuery<Profile | null>({
    queryKey: ME_KEY,
    initialData: cached ?? undefined,
    queryFn: async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const result = await api.get<Profile>("/api/me");
          clearTimeout(timer);
          if (result) writeCachedMe(result);
          return result ?? readCachedMe();
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          writeCachedMe(null);
          return null;
        }
        return readCachedMe();
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
      // /api/me also slides server-side when <2h remain; no need to force refetch always
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
