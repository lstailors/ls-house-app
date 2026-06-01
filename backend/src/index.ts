import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import "./env";
import { meRouter} from "./routes/me";
import { locationsRouter } from "./routes/locations";
import { customersRouter } from "./routes/customers";
import { alterationsRouter } from "./routes/alterations";
import { customOrdersRouter } from "./routes/custom-orders";
import { salesOrdersRouter } from "./routes/sales-orders";
import { invoicesRouter } from "./routes/invoices";
import { deliveriesRouter } from "./routes/deliveries";
import { scanRouter } from "./routes/scan";
import { communicationsRouter } from "./routes/communications";
import { referenceRouter } from "./routes/reference";
import { adminRouter } from "./routes/admin";
import { dashboardRouter } from "./routes/dashboard";
import { maestroRouter } from "./routes/maestro";
import { sofiaRouter } from "./routes/sofia";

const app = new Hono();

const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.dev$/,
  /^https:\/\/vibecode\.dev$/,
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
import { searchRouter } from "./routes/search";
import { notificationsRouter } from "./routes/notifications";
app.route("/api/search", searchRouter);
app.route("/api/notifications", notificationsRouter);

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};
