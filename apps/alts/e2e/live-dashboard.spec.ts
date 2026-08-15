import { expect, test, type Page } from "@playwright/test";

const ME = {
  id: "u1",
  email: "floor@lstailors.com",
  name: "Floor Staff",
  role: "super_admin",
  locationId: "NYC",
};

function liveHome(revToday: number, overdue: number) {
  return {
    generated_at: new Date().toISOString(),
    today: "2026-08-15",
    syncedAt: Date.now(),
    location: "NYC",
    metrics: {
      generated_at: new Date().toISOString(),
      today: "2026-08-15",
      open_alterations: 12,
      tasks: { open: 2, overdue: 1, yesterday_open: 2, trend: "flat" },
      qc: { waiting: 1, open: 1, passed: 10, failed: 2 },
      invoices: { unpaid_count: 4, unpaid_total: 5685 },
      deliveries: { queued: 1, out: 1, delivered_today: 0, on_hold: 0 },
      hd_tickets_open: 0,
      messages: { texts: 3, calls: 0, voice: 0, fittings: 1, other: 0, all: 4 },
      floor: {
        overdue,
        due_today: 2,
        ready: 3,
        in_progress: 4,
        at_home: 2,
        stalled_48h: 0,
        ready_not_texted: 1,
        invoices_90: 1,
      },
    },
    strip: { overdue, dueToday: 2, outForDelivery: 1, deliveredToday: 0 },
    counts: {
      open: 12,
      ready: 3,
      inProgress: 4,
      atHome: 2,
      readyNotTexted: 1,
      pendingBoard: 1,
      openGarments: 12,
      openInvoices: 4,
      openInvoicesAmount: 5685,
      oldestUnpaidDays: 122,
      oldestUnpaidInvoiceId: "SINV-OLDEST",
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
    exceptions: [
      {
        id: `overdue:ALT-${overdue}`,
        kind: "overdue",
        severity: "urgent",
        name: "Late Client",
        number: `${overdue}d`,
        icon: "⏱",
        href: "/shop-floor?filter=overdue",
        action: "open",
        subtitle: "In Progress",
        rank: 0,
      },
    ],
    todayRail: {
      openMin: 540,
      closeMin: 1080,
      nowMin: 840,
      shopOpen: true,
      appointments: [
        { id: "EV-1", minutes: 870, label: "Peyser", href: "/appointments", kind: "appointment" },
      ],
      dueOuts: [],
      deliveries: [],
      chips: { comingIn: 1, mustLeave: 2, readyPickup: 3, readyAllTexted: false },
    },
    money: {
      revToday,
      revSpark: [400, 500, 300, 800, 600, 700, revToday],
      weekRev: 4500,
      lastWeekRev: 4000,
      weekDeltaPct: 13,
      arTotal: 5685,
      arAging: { "0-30": 800, "31-60": 400, "61-90": 200, "90+": 4285 },
      pipeline: { nyc: 12000, hou: 4000, total: 16000 },
    },
    glimpses: {
      floor: { tailors: [{ name: "Carl", inProgress: 3, stalled: 0 }], stalled: 0 },
      pickup: { names: [{ name: "J. Peyser", texted: true, ticket: "ALT-2" }], ready: 3 },
      messages: { sender: "Dorrian", preview: "Is the jacket ready?", unread: 1 },
      invoices: { unpaid: 4, aging: { "0-30": 800, "31-60": 400, "61-90": 200, "90+": 4285 } },
      deliveries: { queued: 1, out: 1, deliveredToday: 0 },
      appointments: { next: { time: "2:30", type: "Fitting", client: "J. Peyser" } },
      tasks: { open: 2, yesterdayOpen: 2, trend: "flat" },
      qc: { waiting: 1, passRateWeek: 83 },
    },
    activity: [
      { id: "a1", at: "4:32", atIso: "2026-08-15T16:32:00", text: "QC passed · C. Dorrian", href: "/qc" },
    ],
  };
}

async function mockApis(page: Page, state: { rev: number; overdue: number }) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    if (path === "/api/me") return json(ME);
    if (path === "/api/auth/refresh") return json({ token: "t" });
    if (path === "/api/health") {
      return json({ ok: true, status: "ok", erp: { configured: true, reachable: true, latencyMs: 12, error: null } });
    }
    if (path === "/api/metrics/live-home" || path === "/api/metrics/exceptions") {
      return json(liveHome(state.rev, state.overdue));
    }
    if (path === "/api/metrics") return json(liveHome(state.rev, state.overdue).metrics);
    if (path === "/api/dashboard/floor-brief") {
      return json({ body: "Quiet floor.", title: "Espresso", createdAt: new Date().toISOString(), fromCache: true });
    }
    if (path === "/api/espresso") return json({ weather: { temp: 72, weathercode: 1, description: "Clear" } });
    if (route.request().method() === "GET") return json({});
    return json({ ok: true });
  });
}

test("live dashboard bands render and a metrics update pulses without layout shift", async ({ page }) => {
  const state = { rev: 1200, overdue: 7 };
  await mockApis(page, state);
  await page.goto("/");

  await expect(page.locator('[data-band="needs-you"]')).toBeVisible();
  await expect(page.locator('[data-band="today"]')).toBeVisible();
  await expect(page.locator('[data-band="money"]')).toBeVisible();
  await expect(page.locator('[data-testid="quick-actions"]')).toBeVisible();
  await expect(page.locator('[data-testid="tile-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="rev-today"]')).toContainText("$1.2k");
  await expect(page.locator('[data-testid="overdue-chip"]')).toContainText("7");
  await expect(page.getByText("2:30 · Fitting · J. Peyser")).toBeVisible();

  const qa = page.locator('[data-testid="quick-actions"]');
  const grid = page.locator('[data-testid="tile-grid"]');
  const before = await qa.boundingBox();
  const gridBefore = await grid.boundingBox();
  expect(before).toBeTruthy();
  expect(gridBefore).toBeTruthy();
  expect(before!.y).toBeLessThan(640);

  state.rev = 1800;
  state.overdue = 8;
  await page.locator('[data-testid="live-chip"]').click();

  await expect(page.locator('[data-testid="rev-today"] [data-tick="1800"]')).toBeVisible();
  await expect(page.locator('[data-testid="overdue-chip"] [data-tick="8"]')).toBeVisible();
  await expect(page.locator(".is-pulse").first()).toBeVisible();

  const after = await qa.boundingBox();
  const gridAfter = await grid.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
  expect(Math.abs((gridAfter?.height ?? 0) - (gridBefore?.height ?? 0))).toBeLessThan(2);
});

test("kiosk mode shows bands and ticker without the tile grid", async ({ page }) => {
  await mockApis(page, { rev: 1200, overdue: 7 });
  await page.goto("/?kiosk=1");
  await expect(page.locator('[data-band="needs-you"]')).toBeVisible();
  await expect(page.locator('[data-band="today"]')).toBeVisible();
  await expect(page.locator('[data-band="money"]')).toBeVisible();
  await expect(page.locator('[data-testid="tile-grid"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="quick-actions"]')).toBeHidden();
  await expect(page.locator(".animate-spin")).toHaveCount(0);
});
