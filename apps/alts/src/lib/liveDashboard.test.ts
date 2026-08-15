import { describe, expect, test } from "bun:test";
import {
  EMPTY_LIVE_HOME,
  liveAgeLabel,
  liveFeedStatus,
  liveFingerprint,
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
