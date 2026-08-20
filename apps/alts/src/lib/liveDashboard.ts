import type { LiveHome } from "@ls/types";

export const LIVE_HOME_KEY = "alts-live-home";
export const LIVE_CACHE_KEY = "alts.live-home.v1";
export const LIVE_FRESH_MS = 90_000;
export const LIVE_METRICS_MS = 30_000;
export const LIVE_EXCEPTIONS_MS = 60_000;

export type LiveFeedStatus = "live" | "stale" | "down" | "offline";

export function liveFeedStatus(
  updatedAt: number | null,
  isError: boolean,
  shopOffline = false,
): LiveFeedStatus {
  if (shopOffline) return "offline";
  if (isError && !updatedAt) return "down";
  if (!updatedAt) return "stale";
  const age = Date.now() - updatedAt;
  if (isError && age > LIVE_FRESH_MS) return "down";
  if (age < LIVE_FRESH_MS) return "live";
  return "stale";
}

export function liveAgeLabel(updatedAt: number | null, fetching?: boolean): string {
  if (fetching && !updatedAt) return "connecting";
  if (!updatedAt) return "waiting";
  const sec = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

export function readLiveCache(): LiveHome | undefined {
  try {
    const raw = sessionStorage.getItem(LIVE_CACHE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as LiveHome;
  } catch {
    return undefined;
  }
}

export function writeLiveCache(data: LiveHome) {
  try {
    sessionStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* private mode */
  }
}

/** Stable keys so a payment / overdue / QC pass can pulse the right tile. */
export function liveFingerprint(data: LiveHome | undefined | null): Record<string, string> {
  if (!data) return {};
  return {
    overdue: String(data.strip.overdue),
    revToday: String(data.money.revToday),
    ar: String(data.money.arTotal),
    exceptions: data.exceptions.map((e) => e.id).join("|"),
    comingIn: String(data.todayRail.chips.comingIn),
    mustLeave: String(data.todayRail.chips.mustLeave),
    ready: String(data.todayRail.chips.readyPickup),
    floor: String(data.glimpses.floor.stalled) + data.glimpses.floor.tailors.map((t) => t.inProgress).join(","),
    pickup: data.glimpses.pickup.names.map((n) => n.ticket).join(","),
    messages: `${data.glimpses.messages.unread}:${data.glimpses.messages.preview ?? ""}`,
    invoices: String(data.glimpses.invoices.unpaid),
    deliveries: `${data.glimpses.deliveries.queued}/${data.glimpses.deliveries.out}/${data.glimpses.deliveries.deliveredToday}`,
    appointments: data.glimpses.appointments.next
      ? `${data.glimpses.appointments.next.time}:${data.glimpses.appointments.next.client}`
      : "",
    tasks: String(data.glimpses.tasks.open),
    qc: `${data.glimpses.qc.waiting}:${data.glimpses.qc.passRateWeek}`,
    activity: data.activity[0]?.id ?? "",
  };
}

/** Older deployed house API — `/api/dashboard/alts-home` — before live-home shipped. */
export type AltsHomePayload = {
  location?: string;
  syncedAt?: number;
  strip?: Partial<LiveHome["strip"]>;
  counts?: Partial<LiveHome["counts"]>;
  feeds?: Partial<LiveHome["feeds"]>;
};

export function hydrateFromAltsHome(raw: AltsHomePayload, now = Date.now()): LiveHome {
  const strip = { ...EMPTY_LIVE_HOME.strip, ...raw.strip };
  const counts = { ...EMPTY_LIVE_HOME.counts, ...raw.counts };
  const feeds = { ...EMPTY_LIVE_HOME.feeds, ...raw.feeds };
  return {
    ...EMPTY_LIVE_HOME,
    generated_at: new Date(raw.syncedAt || now).toISOString(),
    today: new Date(now).toISOString().slice(0, 10),
    syncedAt: raw.syncedAt || now,
    location: raw.location || "NYC",
    strip,
    counts,
    feeds,
    todayRail: {
      ...EMPTY_LIVE_HOME.todayRail,
      chips: {
        comingIn: 0,
        mustLeave: strip.dueToday ?? 0,
        readyPickup: counts.ready ?? 0,
        readyAllTexted: (counts.readyNotTexted ?? 0) === 0,
      },
    },
    glimpses: {
      ...EMPTY_LIVE_HOME.glimpses,
      floor: { tailors: [], stalled: counts.stalledCount ?? 0 },
      pickup: { names: [], ready: counts.ready ?? 0 },
      invoices: {
        unpaid: counts.openInvoices ?? 0,
        aging: EMPTY_LIVE_HOME.glimpses.invoices.aging,
      },
      deliveries: {
        queued: 0,
        out: strip.outForDelivery ?? 0,
        deliveredToday: strip.deliveredToday ?? 0,
      },
    },
  };
}

export function parseLiveHomeResponse(
  liveStatus: number,
  liveJson: unknown,
  altsHomeJson?: unknown,
): LiveHome {
  if (liveStatus >= 200 && liveStatus < 300) {
    const j = liveJson as { data?: LiveHome };
    return ((j && typeof j === "object" && "data" in j ? j.data : j) ?? liveJson) as LiveHome;
  }
  if (liveStatus === 404 && altsHomeJson) {
    const j = altsHomeJson as { data?: AltsHomePayload };
    const payload = ((j && typeof j === "object" && "data" in j ? j.data : j) ??
      altsHomeJson) as AltsHomePayload;
    return hydrateFromAltsHome(payload);
  }
  const err = liveJson as { error?: { message?: string } };
  throw new Error(err?.error?.message || "Live home failed");
}

export const EMPTY_LIVE_HOME: LiveHome = {
  generated_at: new Date(0).toISOString(),
  today: "2026-08-15",
  syncedAt: 0,
  location: "NYC",
  metrics: {
    generated_at: new Date(0).toISOString(),
    today: "2026-08-15",
    open_alterations: 0,
    tasks: { open: 0, overdue: 0, yesterday_open: 0, trend: "flat" },
    qc: { waiting: 0, open: 0, passed: 0, failed: 0 },
    invoices: { unpaid_count: 0, unpaid_total: 0 },
    deliveries: { queued: 0, out: 0, delivered_today: 0, on_hold: 0 },
    hd_tickets_open: 0,
    messages: { texts: 0, calls: 0, voice: 0, fittings: 0, other: 0, all: 0 },
    floor: {
      overdue: 0,
      due_today: 0,
      ready: 0,
      in_progress: 0,
      at_home: 0,
      stalled_48h: 0,
      ready_not_texted: 0,
      invoices_90: 0,
    },
  },
  strip: { overdue: 0, dueToday: 0, outForDelivery: 0, deliveredToday: 0 },
  counts: {
    open: 0,
    ready: 0,
    inProgress: 0,
    atHome: 0,
    readyNotTexted: 0,
    pendingBoard: 0,
    openGarments: 0,
    openInvoices: 0,
    openInvoicesAmount: 0,
    oldestUnpaidDays: null,
    oldestUnpaidInvoiceId: null,
    lateTransferCount: 0,
    stalledCount: 0,
    doubleBookedSlots: 0,
  },
  feeds: {
    lastTicket: null,
    lastProgress: null,
    lastTouchedCustomer: null,
    lateTransferNames: [],
    stalledReasons: {},
    conflictDetails: [],
  },
  exceptions: [],
  todayRail: {
    openMin: 9 * 60,
    closeMin: 18 * 60,
    nowMin: 12 * 60,
    shopOpen: true,
    appointments: [],
    dueOuts: [],
    deliveries: [],
    chips: { comingIn: 0, mustLeave: 0, readyPickup: 0, readyAllTexted: true },
  },
  money: {
    revToday: 0,
    revSpark: [0, 0, 0, 0, 0, 0, 0],
    weekRev: 0,
    lastWeekRev: 0,
    weekDeltaPct: 0,
    arTotal: 0,
    arAging: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 },
    pipeline: { nyc: 0, hou: 0, total: 0 },
  },
  glimpses: {
    floor: { tailors: [], stalled: 0 },
    pickup: { names: [], ready: 0 },
    messages: { sender: null, preview: null, unread: 0 },
    invoices: { unpaid: 0, aging: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } },
    deliveries: { queued: 0, out: 0, deliveredToday: 0 },
    appointments: { next: null },
    tasks: { open: 0, yesterdayOpen: 0, trend: "flat" },
    qc: { waiting: 0, passRateWeek: 100 },
  },
  activity: [],
};
