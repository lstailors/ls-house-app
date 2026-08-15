import { useEffect, useState } from "react";

export type ShopLink = "online" | "offline";

let link: ShopLink = typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online";
const listeners = new Set<(s: ShopLink) => void>();
let fails = 0;
let timer: number | null = null;

function setLink(next: ShopLink) {
  if (link === next) return;
  link = next;
  listeners.forEach((fn) => fn(next));
}

async function ping() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    fails = 2;
    setLink("offline");
    return;
  }
  try {
    const { api } = await import("@ls/api-client");
    const res = await api.raw("/api/health");
    if (!res.ok) {
      fails += 1;
      if (fails >= 2) setLink("offline");
      return;
    }
    fails = 0;
    setLink("online");
  } catch {
    // Fetch throw = real drop (Playwright abort, wifi gone). Don't wait for a second ping.
    fails = 2;
    setLink("offline");
  }
}

export function startOfflineHeartbeat() {
  if (timer != null) return () => undefined;
  void ping();
  const onOnline = () => {
    fails = 0;
    void ping();
  };
  const onOffline = () => {
    fails = 2;
    setLink("offline");
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  timer = window.setInterval(() => void ping(), 20_000);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    if (timer != null) window.clearInterval(timer);
    timer = null;
  };
}

export function getShopLink(): ShopLink {
  return link;
}

export function isShopOffline() {
  return link === "offline";
}

export function useShopLink(): ShopLink {
  const [s, set] = useState(link);
  useEffect(() => {
    listeners.add(set);
    return () => {
      listeners.delete(set);
    };
  }, []);
  return s;
}

export function formatShopClock(iso?: string | null) {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}
