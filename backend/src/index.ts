import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
import "./load-env.js"; // load .env before any module reads process.env
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import "./env.js";
import { meRouter} from "./routes/me.js";
import { locationsRouter } from "./routes/locations.js";
import { customersRouter } from "./routes/customers.js";
import { alterationsRouter } from "./routes/alterations.js";
import { customOrdersRouter } from "./routes/custom-orders.js";
import { salesOrdersRouter } from "./routes/sales-orders.js";
import { invoicesRouter } from "./routes/invoices.js";
import { deliveriesRouter } from "./routes/deliveries.js";
import { scanRouter } from "./routes/scan.js";
import { communicationsRouter } from "./routes/communications.js";
import { referenceRouter } from "./routes/reference.js";
import { adminRouter } from "./routes/admin.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { maestroRouter } from "./routes/maestro.js";
import { intakeAlterationsRouter } from "./routes/intake-alterations.js";
import { sofiaRouter } from "./routes/sofia.js";
import { ravenRouter } from "./routes/raven.js";

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
app.route("/api/me", meRouter);
app.route("/api/locations", locationsRouter);
app.route("/api/customers", customersRouter);
app.route("/api/alterations", alterationsRouter);
app.route("/api/custom-orders", customOrdersRouter);
app.route("/api/sales-orders", salesOrdersRouter);
app.route("/api/invoices", invoicesRouter);
app.route("/api/deliveries", deliveriesRouter);
app.route("/api/scan", scanRouter);
app.route("/api/communications", communicationsRouter);
app.route("/api/reference", referenceRouter);
app.route("/api/admin", adminRouter);
app.route("/api/dashboard", dashboardRouter);
app.route("/api/maestro", maestroRouter);
app.route("/api/sofia", sofiaRouter);
app.route("/api/intake-alterations", intakeAlterationsRouter);
app.route("/api/raven", ravenRouter);
import { searchRouter } from "./routes/search.js";
import { notificationsRouter } from "./routes/notifications.js";
import { erpnextCustomersRouter } from "./routes/erpnext-customers.js";
import { cartsRouter } from "./routes/carts.js";
import { alternationsBoardRouter } from "./routes/alterations-board.js";
import { payInfoRouter } from "./routes/pay-info.js";
app.route("/api/search", searchRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/pay-info", payInfoRouter);
app.route("/api/erpnext-customers", erpnextCustomersRouter);
app.route("/api/carts", cartsRouter);
app.route("/api/alterations/board", alternationsBoardRouter);

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};
