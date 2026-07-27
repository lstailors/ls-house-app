import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
import "./load-env"; // load .env before any module reads process.env
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import "./env";
import { meRouter} from "./routes/me";
import { authRouter } from "./routes/auth";
import { locationsRouter } from "./routes/locations";
import { customersRouter } from "./routes/customers";
import { alterationsRouter } from "./routes/alterations";
import { customOrdersRouter } from "./routes/custom-orders";
import { salesOrdersRouter } from "./routes/sales-orders";
import { invoicesRouter } from "./routes/invoices";
import { deliveriesRouter } from "./routes/deliveries";
import { trackingRouter } from "./routes/tracking";
import { communicationsRouter } from "./routes/communications";
import { referenceRouter } from "./routes/reference";
import { adminRouter } from "./routes/admin";
import { dashboardRouter } from "./routes/dashboard";
import { maestroRouter } from "./routes/maestro";
import { intakeAlterationsRouter } from "./routes/intake-alterations";
import { sofiaRouter } from "./routes/sofia";
import { ravenRouter } from "./routes/raven";
import { agentsRouter } from "./routes/agents";
import { filesRouter } from "./routes/files";
import { squareRouter } from "./routes/square-terminal";
import { printRouter } from "./routes/print";
import { paymentsRouter } from "./routes/payments";
import { commsRouter } from "./routes/comms";
import { webhooksRouter } from "./routes/webhooks";
import { unifiRouter } from "./routes/unifi";
import { calendarRouter } from "./routes/calendar";
import { espressoRouter } from "./routes/espresso";
import { mcpRouter } from "./routes/mcp";
import { tasksRouter } from "./routes/tasks";
import { scannerRouter } from "./routes/scanner";
import { garmentRouter } from "./routes/garment";
import { qrRouter } from "./routes/qr";
import { outreachRouter } from "./routes/outreach";
import { searchRouter } from "./routes/search";
import { notificationsRouter } from "./routes/notifications";
import { erpnextCustomersRouter } from "./routes/erpnext-customers";
import { cartsRouter } from "./routes/carts";
import { alternationsBoardRouter } from "./routes/alterations-board";
import { payInfoRouter } from "./routes/pay-info";
import { transfersRouter } from "./routes/transfers";
import { yzRouter } from "./routes/yz";
import { helpdeskRouter } from "./routes/helpdesk";
import { sofiaBridgeRouter } from "./routes/sofia-bridge";
import { dispatchRouter } from "./routes/dispatch";
import { bookingRouter, publicBookingRouter } from "./routes/booking";

const app = new Hono();

const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.dev$/,
  /^https:\/\/vibecode\.dev$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/app\.lstailors\.com$/,
  /^https:\/\/book\.lstailors\.com$/,
  /^https:\/\/alts\.lstailors\.com$/,
];

app.use(
  "*",
  cors({
    origin: (origin) => (origin && allowed.some((re) => re.test(origin)) ? origin : null),
    credentials: true,
  }),
);

app.use("*", logger());

app.get("/health", (c) => c.json({ status: "ok" }));

// App routes
app.route("/api/auth", authRouter);
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
app.route("/api/intake-alterations", intakeAlterationsRouter);
app.route("/api/raven", ravenRouter);
app.route("/api/agents", agentsRouter);
app.route("/api/comms", commsRouter);
app.route("/api/webhooks", webhooksRouter);
app.route("/api/unifi", unifiRouter);
app.route("/api/calendar", calendarRouter);
app.route("/api/espresso", espressoRouter);
app.route("/api/mcp", mcpRouter);
app.route("/api/tasks", tasksRouter);
app.route("/api/scanner", scannerRouter);
app.route("/api/garment", garmentRouter);
app.route("/api/qr", qrRouter);
app.route("/api/files", filesRouter);
app.route("/api/square", squareRouter);
app.route("/api/payments", paymentsRouter);
app.route("/api/print", printRouter);
app.route("/api/outreach", outreachRouter);
app.route("/api/search", searchRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/pay-info", payInfoRouter);
app.route("/api/erpnext-customers", erpnextCustomersRouter);
app.route("/api/carts", cartsRouter);
app.route("/api/alterations/board", alternationsBoardRouter);
app.route("/api/alterations-board", alternationsBoardRouter);
app.route("/api/transfers", transfersRouter);
app.route("/api/yz", yzRouter);
app.route("/api/helpdesk", helpdeskRouter);
app.route("/api/sofia-bridge", sofiaBridgeRouter);

app.route("/api/dispatch", dispatchRouter);
app.route("/api/booking", bookingRouter);
app.route("/api/public/booking", publicBookingRouter);

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};
