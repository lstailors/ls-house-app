import { describe, expect, test } from "bun:test";
import {
  EMPTY_LIVE_HOME,
  hydrateFromAltsHome,
  liveAgeLabel,
  liveFeedStatus,
  liveFingerprint,
  parseLiveHomeResponse,
} from "./liveDashboard";

describe("live dashboard clock", () => {
  test("fresh under 90s, gold when stale, red when down", () => {
    const now = Date.now();
    expect(liveFeedStatus(now - 12_000, false)).toBe("live");
    expect(liveFeedStatus(now - 120_000, false)).toBe("stale");
    expect(liveFeedStatus(null, true)).toBe("down");
    expect(liveFeedStatus(now, false, true)).toBe("offline");
  });

  test("age label is seconds then minutes", () => {
    expect(liveAgeLabel(Date.now() - 12_000)).toBe("12s ago");
    expect(liveAgeLabel(Date.now() - 120_000)).toBe("2m ago");
  });

  test("404 live-home hydrates the older alts-home feed", () => {
    const live = parseLiveHomeResponse(200, {
      data: { ...EMPTY_LIVE_HOME, strip: { ...EMPTY_LIVE_HOME.strip, overdue: 4 } },
    });
    expect(live.strip.overdue).toBe(4);

    const fallback = parseLiveHomeResponse(
      404,
      { error: { message: "Not Found" } },
      {
        data: {
          syncedAt: 1_700_000_000_000,
          location: "NYC",
          strip: { overdue: 7, dueToday: 2, outForDelivery: 3, deliveredToday: 1 },
          counts: { ready: 5, readyNotTexted: 0, openInvoices: 4, stalledCount: 1 },
        },
      },
    );
    expect(fallback.strip.overdue).toBe(7);
    expect(fallback.strip.outForDelivery).toBe(3);
    expect(fallback.todayRail.chips.readyPickup).toBe(5);
    expect(fallback.glimpses.deliveries.out).toBe(3);

    const hydrated = hydrateFromAltsHome({ strip: { overdue: 9 } }, 1_700_000_000_000);
    expect(hydrated.strip.overdue).toBe(9);
  });

  test("fingerprint changes when revenue or overdue moves", () => {
    const a = liveFingerprint(EMPTY_LIVE_HOME);
    const b = liveFingerprint({
      ...EMPTY_LIVE_HOME,
      strip: { ...EMPTY_LIVE_HOME.strip, overdue: 8 },
      money: { ...EMPTY_LIVE_HOME.money, revToday: 400 },
    });
    expect(a.overdue).not.toBe(b.overdue);
    expect(a.revToday).not.toBe(b.revToday);
  });
});
