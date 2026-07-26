// Single source of truth for route mounting.
//
// There are two entry points — src/index.ts (Bun, local dev) and src/app.ts
// (Vercel Edge, production) — and they used to each maintain their own copy of
// this list. They drifted twice: commit d04399a ("Fix garment/scanner 404 in
// production: mount routers in app.ts"), and again with /api/files, which meant
// intake garment photos and delivery POD uploads 404'd in production while
// working fine locally. Both entries now call registerRoutes(), so a route
// added here is automatically available in both.
//
// EXCEPTION: routes/qr.ts is NOT registered here. It calls QRCode.toBuffer(),
// which needs zlib/stream via pngjs, and the `qrcode` package resolves to its
// browser build (no toBuffer) under the Edge runtime. A static import would
// break the whole edge bundle, not just that one route — so index.ts mounts it
// separately for dev/Node only.

import type { Hono } from "hono";

import { meRouter } from "./me";
import { authRouter } from "./auth";
import { financialsUnlockRouter } from "./financials-unlock";
import { locationsRouter } from "./locations";
import { customersRouter } from "./customers";
import { alterationsRouter } from "./alterations";
import { customOrdersRouter } from "./custom-orders";
import { salesOrdersRouter } from "./sales-orders";
import { invoicesRouter } from "./invoices";
import { deliveriesRouter } from "./deliveries";
import { trackingRouter } from "./tracking";
import { communicationsRouter } from "./communications";
import { referenceRouter } from "./reference";
import { adminRouter } from "./admin";
import { dashboardRouter } from "./dashboard";
import { maestroRouter } from "./maestro";
import { sofiaRouter } from "./sofia";
import { sofiaBridgeRouter } from "./sofia-bridge";
import { agentsRouter } from "./agents";
import { espressoRouter } from "./espresso";
import { tasksRouter } from "./tasks";
import { intakeAlterationsRouter } from "./intake-alterations";
import { commsRouter } from "./comms";
import { searchRouter } from "./search";
import { notificationsRouter } from "./notifications";
import { calendarRouter } from "./calendar";
import { transfersRouter } from "./transfers";
import { printRouter } from "./print";
import { alternationsBoardRouter } from "./alterations-board";
import { paymentsRouter } from "./payments";
import { cartsRouter } from "./carts";
import { ravenRouter } from "./raven";
import { mcpRouter } from "./mcp";
import { webhooksRouter } from "./webhooks";
import { unifiRouter } from "./unifi";
import { payInfoRouter } from "./pay-info";
import { yzRouter } from "./yz";
import { helpdeskRouter } from "./helpdesk";
import { appointmentsRouter } from "./appointments";
import { bookingRouter, publicBookingRouter } from "./booking";
import { scannerRouter } from "./scanner";
import { garmentRouter } from "./garment";
import { dispatchRouter } from "./dispatch";
import { filesRouter } from "./files";
import { squareRouter } from "./square-terminal";
import { outreachRouter } from "./outreach";
import { erpnextCustomersRouter } from "./erpnext-customers";

export function registerRoutes(app: Hono): void {
  app.route("/api/auth", authRouter);
  app.route("/api/financials/unlock", financialsUnlockRouter);
  app.route("/api/me", meRouter);
  app.route("/api/locations", locationsRouter);
  app.route("/api/customers", customersRouter);
  app.route("/api/alterations", alterationsRouter);
  app.route("/api/custom-orders", customOrdersRouter);
  app.route("/api/sales-orders", salesOrdersRouter);
  app.route("/api/invoices", invoicesRouter);
  app.route("/api/deliveries", deliveriesRouter);
  app.route("/api/scan", trackingRouter);
  app.route("/api/communications", communicationsRouter);
  app.route("/api/reference", referenceRouter);
  app.route("/api/admin", adminRouter);
  app.route("/api/dashboard", dashboardRouter);
  app.route("/api/maestro", maestroRouter);
  app.route("/api/sofia", sofiaRouter);
  app.route("/api/sofia-bridge", sofiaBridgeRouter);
  app.route("/api/agents", agentsRouter);
  app.route("/api/espresso", espressoRouter);
  app.route("/api/tasks", tasksRouter);
  app.route("/api/intake-alterations", intakeAlterationsRouter);
  app.route("/api/comms", commsRouter);
  app.route("/api/search", searchRouter);
  app.route("/api/notifications", notificationsRouter);
  app.route("/api/calendar", calendarRouter);
  app.route("/api/transfers", transfersRouter);
  app.route("/api/print", printRouter);
  app.route("/api/alterations-board", alternationsBoardRouter);
  app.route("/api/alterations/board", alternationsBoardRouter);
  app.route("/api/payments", paymentsRouter);
  app.route("/api/carts", cartsRouter);
  app.route("/api/raven", ravenRouter);
  app.route("/api/mcp", mcpRouter);
  app.route("/api/webhooks", webhooksRouter);
  app.route("/api/unifi", unifiRouter);
  app.route("/api/pay-info", payInfoRouter);
  app.route("/api/yz", yzRouter);
  app.route("/api/helpdesk", helpdeskRouter);
  app.route("/api/appointments", appointmentsRouter);
  app.route("/api/booking", bookingRouter);
  app.route("/api/public/booking", publicBookingRouter);
  app.route("/api/scanner", scannerRouter);
  app.route("/api/garment", garmentRouter);
  app.route("/api/dispatch", dispatchRouter);
  app.route("/api/files", filesRouter);
  app.route("/api/square", squareRouter);
  app.route("/api/outreach", outreachRouter);
  app.route("/api/erpnext-customers", erpnextCustomersRouter);
}
