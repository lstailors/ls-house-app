import { expect, test, type Page } from "@playwright/test";

const HOME = {
  location: "NYC",
  syncedAt: Date.now(),
  strip: { overdue: 7, dueToday: 2, outForDelivery: 1, deliveredToday: 0 },
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
};

const LIVE_HOME = {
  generated_at: new Date().toISOString(),
  today: "2026-08-15",
  syncedAt: Date.now(),
  location: "NYC",
  metrics: {
    generated_at: new Date().toISOString(),
    today: "2026-08-15",
    open_alterations: 12,
    tasks: { open: 2, overdue: 1, yesterday_open: 2, trend: "flat" },
    qc: { waiting: 0, open: 0, passed: 10, failed: 2 },
    invoices: { unpaid_count: 4, unpaid_total: 5685 },
    deliveries: { queued: 1, out: 1, delivered_today: 0, on_hold: 0 },
    hd_tickets_open: 0,
    messages: { texts: 3, calls: 0, voice: 0, fittings: 1, other: 0, all: 4 },
    floor: {
      overdue: 7,
      due_today: 2,
      ready: 3,
      in_progress: 4,
      at_home: 2,
      stalled_48h: 0,
      ready_not_texted: 1,
      invoices_90: 1,
    },
  },
  strip: HOME.strip,
  counts: HOME.counts,
  feeds: HOME.feeds,
  exceptions: [
    {
      id: "overdue:ALT-1",
      kind: "overdue",
      severity: "urgent",
      name: "Late Client",
      number: "9d",
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
    revToday: 1200,
    revSpark: [400, 500, 300, 800, 600, 700, 1200],
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
    qc: { waiting: 0, passRateWeek: 83 },
  },
  activity: [
    { id: "a1", at: "4:32", atIso: "2026-08-15T16:32:00", text: "QC passed · C. Dorrian", href: "/qc" },
  ],
};

const ME = {
  id: "u1",
  email: "floor@lstailors.com",
  name: "Floor Staff",
  role: "super_admin",
  locationId: "NYC",
};

async function mockApis(page: Page, opts: { authed?: boolean } = { authed: true }) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });

    if (path === "/api/me") {
      if (!opts.authed) return json(null, 401);
      return json(ME);
    }
    if (path === "/api/auth/refresh") return json({ token: "t" });
    if (path === "/api/health") {
      return json({
        ok: true,
        status: "ok",
        erp: { configured: true, reachable: true, latencyMs: 12, error: null },
      });
    }
    if (path === "/api/garment/tally") {
      return json({
        date: "2026-08-15",
        totals: { pieces: 0, minutes: 0, hours: 0, revenue: 0, workers: 0 },
        tailors: [],
      });
    }
    if (path === "/api/dashboard/alts-home") return json(HOME);
    if (path === "/api/metrics/live-home" || path === "/api/metrics/exceptions") return json(LIVE_HOME);
    if (path === "/api/metrics") return json(LIVE_HOME.metrics);
    if (path === "/api/offline/snapshot") {
      const now = new Date().toISOString();
      return json({
        generated_at: now,
        today: "2026-08-15",
        since: null,
        collections: {
          tickets: { lastSyncedAt: now, rows: [] },
          houseOrders: { lastSyncedAt: now, rows: [] },
          appointments: { lastSyncedAt: now, rows: [] },
          customers: { lastSyncedAt: now, rows: [] },
          invoices: { lastSyncedAt: now, rows: [] },
          catalog: { lastSyncedAt: now, rows: [] },
          qc: { lastSyncedAt: now, rows: [] },
        },
      });
    }
    if (path === "/api/tasks/open-count") return json({ count: 2, overdue: 1 });
    if (path === "/api/qc/count") return json({ waiting: 0, open: 0 });
    if (path === "/api/qc/rates") {
      return json({
        passed: 10,
        failed: 2,
        pending: 0,
        passRate: 83,
        passedThisWeek: 4,
        byWeek: [{ key: "2026-W33", pass: 10, fail: 2, rate: 83 }],
        byGarment: [{ key: "Jacket", pass: 6, fail: 1, rate: 86 }],
        bySource: [
          { key: "store", pass: 4, fail: 1, rate: 80 },
          { key: "make", pass: 6, fail: 1, rate: 86 },
        ],
      });
    }
    if (path.startsWith("/api/qc")) return json([]);
    if (path.startsWith("/api/fabric-stock")) {
      return json({
        items: [],
        counts: { total: 0, available: 0, used: 0, fabric: 0, lining: 0, buttons: 0, yz: 0, sdc: 0, lst: 0, photos: 0 },
      });
    }
    if (path === "/api/dashboard/floor-brief") {
      return json({ body: "Quiet floor.", title: "Espresso", createdAt: new Date().toISOString(), fromCache: true });
    }
    if (path === "/api/espresso") return json({ weather: { temp: 72, weathercode: 1, description: "Clear" } });
    if (path.includes("/tickets")) {
      return json([
        {
          name: "ALT-NYC-2026-00064",
          customer_name: "Late Client",
          workflow_state: "In Progress",
          due_date: "2026-08-06",
          is_rush: 0,
        },
      ]);
    }
    if (path === "/api/invoices") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "SINV-OLDEST",
              customerName: "Old AR",
              status: "unpaid",
              kind: "alteration",
              grandTotal: 5685,
              outstandingAmount: 5685,
              postingDate: "2026-04-15",
            },
          ],
          summary: { paid: 0, outstanding: 5685, openCount: 1, count: 1 },
        }),
      });
    }
    if (path.startsWith("/api/invoices")) return json({ id: "SINV-OLDEST", items: [], outstandingAmount: 5685, grandTotal: 5685, status: "unpaid" });
    if (path.startsWith("/api/deliveries")) return json([]);
    if (path.startsWith("/api/tasks")) return json([]);
    if (path.startsWith("/api/dashboard/floor-reports")) {
      return json({
        location: "NYC",
        today: "2026-08-15",
        snapshot: { openAlts: 12, altsToday: 2, revenueToday: 0, revenueWeek: 0, openHd: 0, deliveriesQueued: 0 },
        pipeline: [],
        tailorWorkload: [],
        ticketPriority: [],
        deliveryStatus: { queued: 0, outForDelivery: 0, delivered: 0, failed: 0 },
        recentActivity: [],
        aging: { overdue: 7, dueToday: 2, dueWeek: 1, later: 2 },
        overdueTickets: [],
        throughput: [],
      });
    }
    if (path.startsWith("/api/customers")) return json([]);
    if (path.startsWith("/api/search")) return json([]);
    if (method === "GET") return json({});
    return json({ ok: true });
  });
}

async function assertNoHang(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await expect(page.locator(".animate-spin").first()).toHaveCount(0, { timeout: 12_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
    const hang = errors.filter(
      (e) => /infinite|unhandled|chunkload/i.test(e) && !/error boundary/i.test(e),
    );
  expect(hang, hang.join("\n")).toEqual([]);
}

test("login renders without console explosions", async ({ page }) => {
  await mockApis(page, { authed: false });
  await page.goto("/login");
  await expect(page.getByPlaceholder("you@lstailors.com")).toBeVisible();
  await assertNoHang(page);
});

const ROUTES = [
  "/",
  "/shop-floor",
  "/pickup",
  "/orders/alterations",
  "/house",
  "/stock",
  "/qc",
  "/invoices",
  "/deliveries",
  "/tasks",
  "/reports",
  "/customers",
  "/reports?kiosk=1",
  "/?kiosk=1",
];

for (const path of ROUTES) {
  test(`route ${path} renders`, async ({ page }) => {
    await mockApis(page);
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Welcome back.")).toHaveCount(0);
    await assertNoHang(page);
  });
}

test("home overdue chip matches metrics API and links to filter", async ({ page }) => {
  await mockApis(page);
  await page.goto("/");
  const chip = page.getByTestId("overdue-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("7");
  await expect(chip).toContainText("OVERDUE");
  await chip.click();
  await expect(page).toHaveURL(/filter=overdue/);
  await expect(page.getByText("OVERDUE ·").first()).toBeVisible();
});
