// Hono app export for Vercel serverless deployment.
// Does NOT import @vibecodeapp/proxy — that is Vibecode-runtime-only (loaded in index.ts).
// All route logic is identical to index.ts.

import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env.js";
import { meRouter } from "./routes/me.js";
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
import { sofiaRouter } from "./routes/sofia.js";
import { agentsRouter } from "./routes/agents.js";
import { espressoRouter } from "./routes/espresso.js";
import { tasksRouter } from "./routes/tasks.js";
import { intakeAlterationsRouter } from "./routes/intake-alterations.js";
import { commsRouter } from "./routes/comms.js";
import { searchRouter } from "./routes/search.js";
import { notificationsRouter } from "./routes/notifications.js";
import { calendarRouter } from "./routes/calendar.js";
import { transfersRouter } from "./routes/transfers.js";
import { printRouter } from "./routes/print.js";
import { alternationsBoardRouter } from "./routes/alterations-board.js";
import { cartsRouter } from "./routes/carts.js";
import { ravenRouter } from "./routes/raven.js";
import { mcpRouter } from "./routes/mcp.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { unifiRouter } from "./routes/unifi.js";

const app = new Hono();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Hard-coded allowed origins + optional ALLOWED_ORIGINS env var (comma-separated
// literal origins, e.g. "https://app.lstailors.com,https://staging.lstailors.com").
// On Vercel, frontend + backend share the same origin so CORS is moot for prod,
// but kept for direct API calls, dev, and preview environments.

const BASE_ALLOWED = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.dev$/,
  /^https:\/\/vibecode\.dev$/,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/app\.lstailors\.com$/,
];

const extraOrigins: RegExp[] = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, "\\$&")}$`));

const allowed = [...BASE_ALLOWED, ...extraOrigins];

app.use(
  "*",
  cors({
    origin: (origin) => (origin && allowed.some((re) => re.test(origin)) ? origin : null),
    credentials: true,
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));

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
app.route("/api/carts", cartsRouter);
app.route("/api/raven", ravenRouter);
app.route("/api/mcp", mcpRouter);
app.route("/api/webhooks", webhooksRouter);
app.route("/api/unifi", unifiRouter);

export default app;
