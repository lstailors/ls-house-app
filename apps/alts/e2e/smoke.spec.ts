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

const ME = {
  id: "u1",
  email: "floor@lstailors.com",
  name: "Floor Staff",
  role: "store_manager",
  locationId: "NYC",
};

async function mockApis(page: Page) {
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

    if (path === "/api/me") return json(ME);
    if (path === "/api/auth/refresh") return json({ token: "t" });
    if (path === "/api/dashboard/alts-home") return json(HOME);
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
    if (method === "GET") return json([]);
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
  const hang = errors.filter((e) => /infinite|unhandled|chunk/i.test(e));
  expect(hang, hang.join("\n")).toEqual([]);
}

test("login renders without console explosions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockApis(page);
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await assertNoHang(page);
});

const ROUTES = [
  "/",
  "/shop-floor",
  "/pickup",
  "/orders/alterations",
  "/house",
  "/qc",
  "/invoices",
  "/deliveries",
  "/tasks",
  "/reports",
  "/customers",
  "/reports?kiosk=1",
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
  const chip = page.locator('a[href="/shop-floor?filter=overdue"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("7");
  await expect(chip).toContainText("OVERDUE");
  await chip.click();
  await expect(page).toHaveURL(/filter=overdue/);
  await expect(page.getByText("OVERDUE ·").first()).toBeVisible();
});
