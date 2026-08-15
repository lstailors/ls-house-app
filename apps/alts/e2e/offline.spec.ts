import { expect, test, type Page } from "@playwright/test";

const ME = {
  id: "u1",
  email: "floor@lstailors.com",
  name: "Floor Staff",
  role: "super_admin",
  locationId: "NYC",
};

function nyToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function snapshot() {
  const today = nyToday();
  const now = new Date().toISOString();
  return {
    generated_at: now,
    today,
    since: null,
    collections: {
      tickets: {
        lastSyncedAt: now,
        rows: [
          {
            name: "ALT-NYC-2026-00064",
            customer_name: "Late Client",
            customer_phone: "2125550100",
            workflow_state: "In Progress",
            due_date: today,
            ticket_total: 85,
            modified: now,
          },
        ],
      },
      houseOrders: { lastSyncedAt: now, rows: [] },
      appointments: {
        lastSyncedAt: now,
        rows: [
          {
            name: "APPT-1",
            _kind: "appointment",
            scheduled_time: `${today} 14:30:00`,
            status: "Open",
            customer_name: "Jane Peyser",
            custom_appointment_type: "Fitting",
          },
          {
            name: "EV-1",
            _kind: "event",
            subject: "Peyser fitting",
            starts_on: `${today} 14:30:00`,
            status: "Open",
          },
        ],
      },
      customers: {
        lastSyncedAt: now,
        rows: [
          {
            name: "CUST-PEYSER",
            customer_name: "Jane Peyser",
            mobile_no: "2125550199",
            email_id: "jane@example.com",
            modified: now,
          },
        ],
      },
      invoices: { lastSyncedAt: now, rows: [] },
      catalog: { lastSyncedAt: now, rows: [] },
      qc: { lastSyncedAt: now, rows: [] },
    },
  };
}

const LIVE_HOME = {
  generated_at: new Date().toISOString(),
  today: nyToday(),
  syncedAt: Date.now(),
  location: "NYC",
  metrics: {
    generated_at: new Date().toISOString(),
    today: nyToday(),
    open_alterations: 1,
    tasks: { open: 0, overdue: 0, yesterday_open: 0, trend: "flat" },
    qc: { waiting: 0, open: 0, passed: 0, failed: 0 },
    invoices: { unpaid_count: 0, unpaid_total: 0 },
    deliveries: { queued: 0, out: 0, delivered_today: 0, on_hold: 0 },
    hd_tickets_open: 0,
    messages: { texts: 0, calls: 0, voice: 0, fittings: 0, other: 0, all: 0 },
    floor: {
      overdue: 0,
      due_today: 1,
      ready: 0,
      in_progress: 1,
      at_home: 0,
      stalled_48h: 0,
      ready_not_texted: 0,
      invoices_90: 0,
    },
  },
  strip: { overdue: 0, dueToday: 1, outForDelivery: 0, deliveredToday: 0 },
  counts: {
    open: 1,
    ready: 0,
    inProgress: 1,
    atHome: 0,
    readyNotTexted: 0,
    pendingBoard: 0,
    openGarments: 1,
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
    openMin: 540,
    closeMin: 1080,
    nowMin: 840,
    shopOpen: true,
    appointments: [],
    dueOuts: [],
    deliveries: [],
    chips: { comingIn: 0, mustLeave: 1, readyPickup: 0, readyAllTexted: true },
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

async function mockOnline(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ data }),
      });
    if (path === "/api/me") return json(ME);
    if (path === "/api/auth/refresh") return json({ token: "t" });
    if (path === "/api/health") {
      return json({ ok: true, status: "ok", erp: { configured: true, reachable: true, latencyMs: 12, error: null } });
    }
    if (path === "/api/offline/snapshot") return json(snapshot());
    if (path === "/api/metrics/live-home" || path === "/api/metrics/exceptions" || path === "/api/metrics") {
      return json(path === "/api/metrics" ? LIVE_HOME.metrics : LIVE_HOME);
    }
    if (path === "/api/dashboard/floor-brief") {
      return json({ body: "Quiet floor.", title: "Espresso", createdAt: new Date().toISOString(), fromCache: true });
    }
    if (path.includes("/tickets")) {
      return json(snapshot().collections.tickets.rows);
    }
    if (path.startsWith("/api/customers")) return json(snapshot().collections.customers.rows);
    if (path.startsWith("/api/appointments")) {
      return json({
        appointments: [
          {
            name: "APPT-1",
            scheduledTime: `${nyToday()} 14:30:00`,
            status: "Open",
            customerName: "Jane Peyser",
            appointmentType: "Fitting",
          },
        ],
        blocks: [],
      });
    }
    if (route.request().method() === "GET") return json({});
    return json({ ok: true });
  });
}

test("cold reload after API drop shows the offline banner and shop lists", async ({ page }) => {
  await mockOnline(page);
  await page.goto("/");
  await page.waitForResponse((r) => r.url().includes("/api/offline/snapshot") && r.ok());
  await expect(page.getByTestId("live-chip")).toBeVisible();

  await page.unroute("**/api/**");
  await page.route("**/api/**", (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.reload();

  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toContainText("Offline — showing shop data");
  await expect(page.getByTestId("live-chip")).toContainText("OFFLINE");
  await expect(page.locator(".animate-spin")).toHaveCount(0);

  await page.goto("/shop-floor");
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await expect(page.getByText("Late Client").first()).toBeVisible();
  await expect(page.getByText("ALT-NYC-2026-00064").first()).toBeVisible();
  await expect(page.locator(".animate-spin")).toHaveCount(0);

  await page.goto("/customers");
  await expect(page.getByText("Jane Peyser").first()).toBeVisible();
  await expect(page.locator(".animate-spin")).toHaveCount(0);

  await page.goto("/appointments");
  await page.getByRole("button", { name: /Today/i }).click();
  await expect(page.getByText("Jane Peyser").first()).toBeVisible();
  await expect(page.locator(".animate-spin")).toHaveCount(0);
});
