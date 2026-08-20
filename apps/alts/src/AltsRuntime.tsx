import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { startOfflineQueueWatcher } from "@alts/lib/offlineQueue";
import { startOfflineHeartbeat } from "@alts/offline/status";
import { startOfflineHydrate } from "@alts/offline/hydrate";

/** Offline queue + heartbeat — run once inside the unified app providers. */
export function useAltsRuntime(queryClient: QueryClient) {
  useEffect(() => {
    const stopHeartbeat = startOfflineHeartbeat();
    let stopHydrate: (() => void) | undefined;
    void startOfflineHydrate(queryClient).then((stop) => {
      stopHydrate = stop;
    });
    const stopQueue = startOfflineQueueWatcher((r) => {
      if (r.ok > 0) toast.success(`Sent ${r.ok} offline ticket${r.ok === 1 ? "" : "s"}`);
      if (r.failed > 0) toast.error(`${r.failed} offline ticket${r.failed === 1 ? "" : "s"} still failing`);
    });
    return () => {
      stopHeartbeat();
      stopHydrate?.();
      stopQueue();
    };
  }, [queryClient]);
}
