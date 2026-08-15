import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import type { LiveHome } from "@ls/types";
import {
  LIVE_CACHE_KEY,
  LIVE_EXCEPTIONS_MS,
  LIVE_FRESH_MS,
  LIVE_HOME_KEY,
  LIVE_METRICS_MS,
  liveAgeLabel,
  liveFeedStatus,
  liveFingerprint,
  readLiveCache,
  writeLiveCache,
  type LiveFeedStatus,
} from "@alts/lib/liveDashboard";

type SocketLike = {
  close?: () => void;
  disconnect?: () => void;
};

/**
 * Single live transport for the home command center.
 * Polls /api/metrics/live-home every 30s (counts) and refreshes the
 * exception queue at least every 60s. If VITE_FRAPPE_SOCKET_URL is set,
 * a Frappe socket.io connection triggers an immediate refetch.
 */
export function useLiveMetrics() {
  const cached = useMemo(() => readLiveCache(), []);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [pulsed, setPulsed] = useState<Record<string, boolean>>({});
  const prevFp = useRef<Record<string, string>>(liveFingerprint(cached));

  const query = useQuery({
    queryKey: [LIVE_HOME_KEY],
    queryFn: async (): Promise<LiveHome> => {
      const res = await api.raw("/api/metrics/live-home");
      const j = await res.json().catch(() => ({} as { data?: LiveHome; error?: { message?: string } }));
      if (!res.ok) throw new Error(j?.error?.message || "Live home failed");
      const data = (j?.data ?? j) as LiveHome;
      writeLiveCache(data);
      return data;
    },
    placeholderData: cached,
    staleTime: LIVE_METRICS_MS,
    refetchInterval: LIVE_METRICS_MS,
    refetchIntervalInBackground: true,
    retry: 2,
    retryDelay: (n) => Math.min(8_000, 1_000 * 2 ** n),
  });

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const refetch = query.refetch;

  // Exception queue: extra poll at 60s so a missed 30s tick still lands inside the SLA.
  useEffect(() => {
    const id = window.setInterval(() => {
      void refetch();
    }, LIVE_EXCEPTIONS_MS);
    return () => window.clearInterval(id);
  }, [refetch]);

  useEffect(() => {
    const url = import.meta.env.VITE_FRAPPE_SOCKET_URL as string | undefined;
    if (!url || typeof window === "undefined") return;
    const io = (window as unknown as { io?: (u: string, o?: object) => SocketLike }).io;
    if (typeof io !== "function") return;
    let socket: SocketLike | null = null;
    try {
      socket = io(url, { transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 2_000 });
      const onDoc = () => {
        void refetch();
      };
      (socket as unknown as { on: (ev: string, fn: () => void) => void }).on?.("doc_update", onDoc);
      (socket as unknown as { on: (ev: string, fn: () => void) => void }).on?.("list_update", onDoc);
    } catch {
      /* poll fallback */
    }
    return () => {
      socket?.disconnect?.();
      socket?.close?.();
    };
  }, [refetch]);

  useEffect(() => {
    const next = liveFingerprint(query.data);
    const changed: Record<string, boolean> = {};
    let any = false;
    for (const [k, v] of Object.entries(next)) {
      if (prevFp.current[k] !== undefined && prevFp.current[k] !== v) {
        changed[k] = true;
        any = true;
      }
    }
    prevFp.current = next;
    if (!any) return;
    setPulsed(changed);
    const t = window.setTimeout(() => setPulsed({}), 700);
    return () => window.clearTimeout(t);
  }, [query.data]);

  const updatedAt = query.dataUpdatedAt || (query.data?.syncedAt ?? null);
  const status: LiveFeedStatus = liveFeedStatus(updatedAt || null, query.isError);
  const ageMs = updatedAt ? nowTick - updatedAt : null;

  return {
    data: query.data,
    isLoading: query.isLoading && !query.data,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
    updatedAt: updatedAt || null,
    status,
    ageLabel: liveAgeLabel(updatedAt || null, query.isFetching),
    ageMs,
    pulsed,
    fresh: status === "live" && (ageMs == null || ageMs < LIVE_FRESH_MS),
    cacheKey: LIVE_CACHE_KEY,
  };
}
