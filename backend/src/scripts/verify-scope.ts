// L&S House — server-side scope verification harness.
//
// Signs into the running API as each demo role, hits every protected endpoint,
// and asserts the exact rules:
//
//   super_admin      → sees everything; ?locationId= override works
//   store_manager    → sees only own location; financials allowed
//   salesperson      → all alterations at own location, ONLY own custom orders,
//                      403 on /sales-orders, /invoices, /dashboard/financials
//   driver           → only own deliveries; everything else blocked or empty
//
// Run with: bun run src/scripts/verify-scope.ts
// Requires backend running and seed already applied.

import "../env.js";
import { prisma } from "../lib/db.js";

const BASE = process.env.BACKEND_URL || "http://localhost:3000";
const PASSWORD = "LStailors2026!";

type Role = "super_admin" | "store_manager" | "salesperson" | "driver";

interface Session {
  email: string;
  role: Role;
  userId: string;
  locationId: string | null;
  cookie: string;
}

interface Check {
  role: Role;
  name: string;
  pass: boolean;
  note: string;
}

const results: Check[] = [];

function record(role: Role, name: string, pass: boolean, note = "") {
  results.push({ role, name, pass, note });
  const tag = pass ? "✅" : "❌";
  console.log(`  ${tag} [${role}] ${name}${note ? " — " + note : ""}`);
}

async function signIn(email: string): Promise<Session> {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`sign-in ${email} failed: ${res.status} ${await res.text()}`);
  }
  const cookie = res.headers.getSetCookie?.().join("; ") || res.headers.get("set-cookie") || "";
  const me = await fetch(`${BASE}/api/me`, { headers: { cookie } });
  const meJson = (await me.json()) as { data: { id: string; role: Role; locationId: string | null } };
  return {
    email,
    role: meJson.data.role,
    userId: meJson.data.id,
    locationId: meJson.data.locationId,
    cookie,
  };
}

async function api<T = any>(
  s: Session,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T | null; raw: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      cookie: s.cookie,
      "content-type": "application/json",
    },
  });
  const raw = await res.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {}
  return { status: res.status, body, raw };
}

async function main() {
  console.log(`\n→ Verifying scope at ${BASE}\n`);

  // Snapshot DB truth so we can compare API output against it
  const [locations, allAlterations, allCustomOrders, allDeliveries, allInvoices, allSO] = await Promise.all([
    prisma.location.findMany(),
    prisma.alteration.findMany(),
    prisma.customOrder.findMany(),
    prisma.delivery.findMany(),
    prisma.invoice.findMany(),
    prisma.salesOrder.findMany(),
  ]);
  const ny = locations.find((l) => l.name === "New York")!;
  const houston = locations.find((l) => l.name === "Houston")!;

  console.log(`  DB: ${locations.length} locations, ${allAlterations.length} alterations,`);
  console.log(`      ${allCustomOrders.length} custom orders, ${allDeliveries.length} deliveries,`);
  console.log(`      ${allInvoices.length} invoices, ${allSO.length} sales orders\n`);

  // ─── Sign everyone in ────────────────────────────────────────────────
  console.log("→ Signing in demo users…");
  const sessions: Record<string, Session> = {};
  for (const email of [
    "superadmin@lstailors.com",
    "nymanager@lstailors.com",
    "houstonmanager@lstailors.com",
    "nysales@lstailors.com",
    "nysales2@lstailors.com",
    "houstonsales@lstailors.com",
    "driver@lstailors.com",
  ]) {
    sessions[email] = await signIn(email);
    console.log(`  ✓ ${email} → ${sessions[email].role} @ ${sessions[email].locationId ?? "all"}`);
  }

  const sa = sessions["superadmin@lstailors.com"];
  const mgrNY = sessions["nymanager@lstailors.com"];
  const mgrHOU = sessions["houstonmanager@lstailors.com"];
  const salesNY = sessions["nysales@lstailors.com"];
  const salesNY2 = sessions["nysales2@lstailors.com"];
  const salesHOU = sessions["houstonsales@lstailors.com"];
  const driver = sessions["driver@lstailors.com"];

  // ─── super_admin ─────────────────────────────────────────────────────
  console.log("\n→ super_admin");
  {
    const locs = await api<{ data: any[] }>(sa, "/api/locations");
    record(sa.role, "GET /locations returns ALL", locs.body!.data.length === locations.length, `${locs.body!.data.length}/${locations.length}`);

    const so = await api<{ data: any[] }>(sa, "/api/sales-orders");
    record(sa.role, "GET /sales-orders returns ALL", so.body!.data.length === allSO.length, `${so.body!.data.length}/${allSO.length}`);

    const inv = await api<{ data: any[] }>(sa, "/api/invoices");
    record(sa.role, "GET /invoices returns ALL", inv.body!.data.length === allInvoices.length, `${inv.body!.data.length}/${allInvoices.length}`);

    const co = await api<{ data: any[] }>(sa, "/api/custom-orders");
    record(sa.role, "GET /custom-orders returns ALL", co.body!.data.length === allCustomOrders.length, `${co.body!.data.length}/${allCustomOrders.length}`);

    const fin = await api<{ data: any }>(sa, "/api/dashboard/financials");
    record(sa.role, "GET /dashboard/financials 200 OK", fin.status === 200);

    // ?locationId= override
    const soNY = await api<{ data: any[] }>(sa, `/api/sales-orders?locationId=${ny.id}`);
    const expectNY = allSO.filter((s) => s.locationId === ny.id).length;
    record(sa.role, "?locationId= override filters to NY", soNY.body!.data.length === expectNY, `${soNY.body!.data.length}/${expectNY}`);
  }

  // ─── store_manager (NY) ──────────────────────────────────────────────
  console.log("\n→ store_manager (NY)");
  {
    const locs = await api<{ data: any[] }>(mgrNY, "/api/locations");
    record(mgrNY.role, "GET /locations scoped to own only", locs.body!.data.length === 1 && locs.body!.data[0].id === ny.id);

    const so = await api<{ data: any[] }>(mgrNY, "/api/sales-orders");
    const expectSO = allSO.filter((s) => s.locationId === ny.id).length;
    record(mgrNY.role, "GET /sales-orders own-location only", so.body!.data.length === expectSO, `${so.body!.data.length}/${expectSO}`);
    const soLeak = so.body!.data.some((r: any) => r.locationId !== ny.id);
    record(mgrNY.role, "no cross-location sales order leaks", !soLeak);

    const inv = await api<{ data: any[] }>(mgrNY, "/api/invoices");
    const expectInv = allInvoices.filter((i) => i.locationId === ny.id).length;
    record(mgrNY.role, "GET /invoices own-location only", inv.body!.data.length === expectInv, `${inv.body!.data.length}/${expectInv}`);

    const co = await api<{ data: any[] }>(mgrNY, "/api/custom-orders");
    const expectCO = allCustomOrders.filter((c) => c.locationId === ny.id).length;
    record(mgrNY.role, "GET /custom-orders all at own location", co.body!.data.length === expectCO, `${co.body!.data.length}/${expectCO}`);

    const alt = await api<{ data: any[] }>(mgrNY, "/api/alterations");
    const expectAlt = allAlterations.filter((a) => a.locationId === ny.id).length;
    record(mgrNY.role, "GET /alterations own-location only", alt.body!.data.length === expectAlt, `${alt.body!.data.length}/${expectAlt}`);

    const fin = await api<{ data: any }>(mgrNY, "/api/dashboard/financials");
    record(mgrNY.role, "GET /dashboard/financials 200 OK", fin.status === 200);

    // override IGNORED for non-super_admin
    const soForce = await api<{ data: any[] }>(mgrNY, `/api/sales-orders?locationId=${houston.id}`);
    const soForceLeak = soForce.body!.data.some((r: any) => r.locationId !== ny.id);
    record(mgrNY.role, "?locationId=houston override IGNORED", !soForceLeak);
  }

  // ─── salesperson (NY) ───────────────────────────────────────────────
  console.log("\n→ salesperson (NY — James Caldwell)");
  {
    const fin = await api(salesNY, "/api/dashboard/financials");
    record(salesNY.role, "GET /dashboard/financials → 403", fin.status === 403);

    const so = await api(salesNY, "/api/sales-orders");
    record(salesNY.role, "GET /sales-orders → 403", so.status === 403);

    const inv = await api(salesNY, "/api/invoices");
    record(salesNY.role, "GET /invoices → 403", inv.status === 403);

    const alt = await api<{ data: any[] }>(salesNY, "/api/alterations");
    const expectAlt = allAlterations.filter((a) => a.locationId === ny.id).length;
    record(salesNY.role, "GET /alterations = ALL NY (shared queue)", alt.body!.data.length === expectAlt, `${alt.body!.data.length}/${expectAlt}`);
    const altLeak = alt.body!.data.some((r: any) => r.locationId !== ny.id);
    record(salesNY.role, "no alterations from Houston leak", !altLeak);

    const co = await api<{ data: any[] }>(salesNY, "/api/custom-orders");
    const expectCO = allCustomOrders.filter((c) => c.locationId === ny.id && c.createdById === salesNY.userId).length;
    record(salesNY.role, "GET /custom-orders = ONLY own at NY", co.body!.data.length === expectCO, `${co.body!.data.length}/${expectCO}`);
    const coLeakLoc = co.body!.data.some((r: any) => r.locationId !== ny.id);
    const coLeakOwner = co.body!.data.some((r: any) => r.createdById !== salesNY.userId);
    record(salesNY.role, "no Houston custom orders leak", !coLeakLoc);
    record(salesNY.role, "no other salesperson's orders leak", !coLeakOwner);

    // Cross-salesperson row read: salesNY2's order — should be 403
    const otherOrder = allCustomOrders.find((c) => c.locationId === ny.id && c.createdById === salesNY2.userId);
    if (otherOrder) {
      const detail = await api(salesNY, `/api/custom-orders/${otherOrder.id}`);
      record(salesNY.role, "GET /custom-orders/:otherSalesId → 403", detail.status === 403);

      // PATCH on someone else's order → 403
      const patch = await api(salesNY, `/api/custom-orders/${otherOrder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "in_production" }),
      });
      record(salesNY.role, "PATCH /custom-orders/:otherSalesId → 403", patch.status === 403);

      // POST deposit on someone else's order → 403 (the critical gap we closed)
      const dep = await api(salesNY, `/api/custom-orders/deposit`, {
        method: "POST",
        body: JSON.stringify({ customOrderId: otherOrder.id, amount: 100 }),
      });
      record(salesNY.role, "POST /custom-orders/deposit on other sales → 403", dep.status === 403);
    }

    const locs = await api<{ data: any[] }>(salesNY, "/api/locations");
    record(salesNY.role, "GET /locations scoped to own only", locs.body!.data.length === 1 && locs.body!.data[0].id === ny.id);
  }

  // ─── salesperson (Houston) cross-location check ─────────────────────
  console.log("\n→ salesperson (Houston) cross-location isolation");
  {
    const co = await api<{ data: any[] }>(salesHOU, "/api/custom-orders");
    const leakedNY = co.body!.data.some((r: any) => r.locationId === ny.id);
    record(salesHOU.role, "Houston sales sees zero NY custom orders", !leakedNY);

    const alt = await api<{ data: any[] }>(salesHOU, "/api/alterations");
    const altLeakedNY = alt.body!.data.some((r: any) => r.locationId === ny.id);
    record(salesHOU.role, "Houston sales sees zero NY alterations", !altLeakedNY);

    // Try to read an NY-only order directly
    const nyCustom = allCustomOrders.find((c) => c.locationId === ny.id);
    if (nyCustom) {
      const detail = await api(salesHOU, `/api/custom-orders/${nyCustom.id}`);
      record(salesHOU.role, "GET /custom-orders/:nyId → 403", detail.status === 403);
    }
  }

  // ─── driver ─────────────────────────────────────────────────────────
  console.log("\n→ driver");
  {
    const fin = await api(driver, "/api/dashboard/financials");
    record(driver.role, "GET /dashboard/financials → 403", fin.status === 403);

    const so = await api(driver, "/api/sales-orders");
    record(driver.role, "GET /sales-orders → 403", so.status === 403);

    const inv = await api(driver, "/api/invoices");
    record(driver.role, "GET /invoices → 403", inv.status === 403);

    const co = await api<{ data: any[] }>(driver, "/api/custom-orders");
    record(driver.role, "GET /custom-orders empty", (co.body?.data ?? []).length === 0);

    const alt = await api<{ data: any[] }>(driver, "/api/alterations");
    record(driver.role, "GET /alterations empty", (alt.body?.data ?? []).length === 0);

    const cust = await api<{ data: any[] }>(driver, "/api/customers");
    record(driver.role, "GET /customers empty", (cust.body?.data ?? []).length === 0);

    const dels = await api<{ data: any[] }>(driver, "/api/deliveries");
    const expectDel = allDeliveries.filter((d) => d.driverId === driver.userId).length;
    record(driver.role, "GET /deliveries = own only", dels.body!.data.length === expectDel, `${dels.body!.data.length}/${expectDel}`);
    const otherDriverLeak = dels.body!.data.some((d: any) => d.driverId !== driver.userId);
    record(driver.role, "no unassigned deliveries leak", !otherDriverLeak);

    // Cannot reassign self off a delivery
    const ownDelivery = allDeliveries.find((d) => d.driverId === driver.userId);
    if (ownDelivery) {
      const reassign = await api(driver, `/api/deliveries/${ownDelivery.id}`, {
        method: "PATCH",
        body: JSON.stringify({ driverId: null }),
      });
      // PATCH allowed (driver may set status/proof) — but driverId field must be ignored.
      record(driver.role, "PATCH succeeds but driverId silently ignored", reassign.status === 200);
      if (reassign.status === 200) {
        const after = await prisma.delivery.findUnique({ where: { id: ownDelivery.id } });
        record(driver.role, "driver_id NOT changed after PATCH", after!.driverId === driver.userId);
      }
    }

    // Cannot PATCH a delivery not assigned to self
    const otherDel = allDeliveries.find((d) => d.driverId !== driver.userId);
    if (otherDel) {
      const patch = await api(driver, `/api/deliveries/${otherDel.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "delivered" }),
      });
      record(driver.role, "PATCH other driver's delivery → 403", patch.status === 403);
    }
  }

  // ─── store_manager (Houston) cross-location isolation ───────────────
  console.log("\n→ store_manager (Houston) cross-location isolation");
  {
    const so = await api<{ data: any[] }>(mgrHOU, "/api/sales-orders");
    const expectSO = allSO.filter((s) => s.locationId === houston.id).length;
    record(mgrHOU.role, "GET /sales-orders Houston only", so.body!.data.length === expectSO, `${so.body!.data.length}/${expectSO}`);
    const soLeak = so.body!.data.some((r: any) => r.locationId !== houston.id);
    record(mgrHOU.role, "no NY sales orders leak", !soLeak);

    // Try to read an NY invoice directly
    const nyInvoice = allInvoices.find((i) => i.locationId === ny.id);
    if (nyInvoice) {
      const detail = await api(mgrHOU, `/api/invoices/${nyInvoice.id}`);
      record(mgrHOU.role, "GET /invoices/:nyId → 403", detail.status === 403);
    }
  }

  // ─── summary ────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log("\n────────────────────────────────────────────────────────");
  console.log(`  ${passed}/${results.length} checks passed`);
  if (failed.length) {
    console.log(`\n  ❌ FAILURES:`);
    for (const f of failed) {
      console.log(`     [${f.role}] ${f.name}${f.note ? " — " + f.note : ""}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`  ✅ All scope rules hold at the API layer.`);
  }
  console.log("────────────────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
