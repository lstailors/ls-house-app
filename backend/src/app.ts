// Hono app export for Vercel serverless deployment.
// Does NOT import @vibecodeapp/proxy — that is Vibecode-runtime-only (loaded in index.ts).
// All route logic is identical to index.ts.

import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
import { meRouter } from "./routes/me";
import { locationsRouter } from "./routes/locations";
import { customersRouter } from "./routes/customers";
import { portalRouter } from "./routes/portal";
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
import { ownerDashboardRouter } from "./routes/owner-dashboard";
import { maestroRouter } from "./routes/maestro";
import { sofiaRouter } from "./routes/sofia";
import { agentsRouter } from "./routes/agents";
import { espressoRouter } from "./routes/espresso";
import { tasksRouter } from "./routes/tasks";
import { missionControlRouter } from "./routes/mission-control";
import { intakeAlterationsRouter } from "./routes/intake-alterations";
import { altsRouter } from "./routes/alts";
import { commsRouter } from "./routes/comms";
import { searchRouter } from "./routes/search";
import { notificationsRouter } from "./routes/notifications";
import { calendarRouter } from "./routes/calendar";
import { transfersRouter } from "./routes/transfers";
import { printRouter } from "./routes/print";
import { alternationsBoardRouter } from "./routes/alterations-board";
import { paymentsRouter } from "./routes/payments";
import { cartsRouter } from "./routes/carts";
import { ravenRouter } from "./routes/raven";
import { mcpRouter } from "./routes/mcp";
import { webhooksRouter } from "./routes/webhooks";
import { unifiRouter } from "./routes/unifi";
import { authRouter } from "./routes/auth";
import { financialsUnlockRouter } from "./routes/financials-unlock";
import { payInfoRouter } from "./routes/pay-info";
import { yzRouter } from "./routes/yz";
import { helpdeskRouter } from "./routes/helpdesk";
import { appointmentsRouter } from "./routes/appointments";
import { bookingRouter, publicBookingRouter } from "./routes/booking";
import { scannerRouter } from "./routes/scanner";
import { garmentRouter } from "./routes/garment";
import { qrRouter } from "./routes/qr";
import { squareRouter } from "./routes/square-terminal";
import { filesRouter } from "./routes/files";
import { fabricStockRouter } from "./routes/fabric-stock";
import { outreachRouter } from "./routes/outreach";
import { erpnextCustomersRouter } from "./routes/erpnext-customers";
import { sofiaBridgeRouter } from "./routes/sofia-bridge";
import { dispatchRouter } from "./routes/dispatch";
import { deliveryZonesRouter } from "./routes/delivery-zones";
import { placesRouter } from "./routes/places";
import { healthRouter } from "./routes/health";
import { qcRouter } from "./routes/qc";
import { metricsRouter } from "./routes/metrics";
import { offlineRouter } from "./routes/offline";

const app = new Hono();

// ─── CORS ───────────────────────────────────────────────────────────────
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
  /^https:\/\/book\.lstailors\.com$/,
  /^https:\/\/alts\.lstailors\.com$/,
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
app.route("/api/health", healthRouter);

// Serve Apple Pay domain association directly from the edge function so
// Vercel does NOT apply Brotli compression (which breaks Square's crawler).
const APPLE_PAY_ASSOC = `{"pspId":"B86BF7F89377552B43F74A2D40F511A41A3B383BF1F8EBF7AD6DF7303BA68601","version":1,"createdOn":1715203876681,"signature":"308006092a864886f70d010702a0803080020101310d300b0609608648016503040201308006092a864886f70d0107010000a080308203e330820388a003020102020816634c8b0e305717300a06082a8648ce3d040302307a312e302c06035504030c254170706c65204170706c69636174696f6e20496e746567726174696f6e204341202d20473331263024060355040b0c1d4170706c652043657274696669636174696f6e20417574686f7269747931133011060355040a0c0a4170706c6520496e632e310b3009060355040613025553301e170d3234303432393137343732375a170d3239303432383137343732365a305f3125302306035504030c1c6563632d736d702d62726f6b65722d7369676e5f5543342d50524f4431143012060355040b0c0b694f532053797374656d7331133011060355040a0c0a4170706c6520496e632e310b30090603550406130255533059301306072a8648ce3d020106082a8648ce3d03010703420004c21577edebd6c7b2218f68dd7090a1218dc7b0bd6f2c283d846095d94af4a5411b83420ed811f3407e83331f1c54c3f7eb3220d6bad5d4eff49289893e7c0f13a38202113082020d300c0603551d130101ff04023000301f0603551d2304183016801423f249c44f93e4ef27e6c4f6286c3fa2bbfd2e4b304506082b0601050507010104393037303506082b060105050730018629687474703a2f2f6f6373702e6170706c652e636f6d2f6f63737030342d6170706c65616963613330323082011d0603551d2004820114308201103082010c06092a864886f7636405013081fe3081c306082b060105050702023081b60c81b352656c69616e6365206f6e207468697320636572746966696361746520627920616e7920706172747920617373756d657320616363657074616e6365206f6620746865207468656e206170706c696361626c65207374616e64617264207465726d7320616e6420636f6e646974696f6e73206f66207573652c20636572746966696361746520706f6c69637920616e642063657274696669636174696f6e2070726163746963652073746174656d656e74732e303606082b06010505070201162a687474703a2f2f7777772e6170706c652e636f6d2f6365727469666963617465617574686f726974792f30340603551d1f042d302b3029a027a0258623687474703a2f2f63726c2e6170706c652e636f6d2f6170706c6561696361332e63726c301d0603551d0e041604149457db6fd57481868989762f7e578507e79b5824300e0603551d0f0101ff040403020780300f06092a864886f76364061d04020500300a06082a8648ce3d0403020349003046022100c6f023cb2614bb303888a162983e1a93f1056f50fa78cdb9ba4ca241cc14e25e022100be3cd0dfd16247f6494475380e9d44c228a10890a3a1dc724b8b4cb8889818bc308202ee30820275a0030201020208496d2fbf3a98da97300a06082a8648ce3d0403023067311b301906035504030c124170706c6520526f6f74204341202d20473331263024060355040b0c1d4170706c652043657274696669636174696f6e20417574686f7269747931133011060355040a0c0a4170706c6520496e632e310b3009060355040613025553301e170d3134303530363233343633305a170d3239303530363233343633305a307a312e302c06035504030c254170706c65204170706c69636174696f6e20496e746567726174696f6e204341202d20473331263024060355040b0c1d4170706c652043657274696669636174696f6e20417574686f7269747931133011060355040a0c0a4170706c6520496e632e310b30090603550406130255533059301306072a8648ce3d020106082a8648ce3d03010703420004f017118419d76485d51a5e25810776e880a2efde7bae4de08dfc4b93e13356d5665b35ae22d097760d224e7bba08fd7617ce88cb76bb6670bec8e82984ff5445a381f73081f4304606082b06010505070101043a3038303606082b06010505073001862a687474703a2f2f6f6373702e6170706c652e636f6d2f6f63737030342d6170706c65726f6f7463616733301d0603551d0e0416041423f249c44f93e4ef27e6c4f6286c3fa2bbfd2e4b300f0603551d130101ff040530030101ff301f0603551d23041830168014bbb0dea15833889aa48a99debebdebafdacb24ab30370603551d1f0430302e302ca02aa0288626687474703a2f2f63726c2e6170706c652e636f6d2f6170706c65726f6f74636167332e63726c300e0603551d0f0101ff0404030201063010060a2a864886f7636406020e04020500300a06082a8648ce3d040302036700306402303acf7283511699b186fb35c356ca62bff417edd90f754da28ebef19c815e42b789f898f79b599f98d5410d8f9de9c2fe0230322dd54421b0a305776c5df3383b9067fd177c2c216d964fc6726982126f54f87a7d1b99cb9b0989216106990f09921d00003182018930820185020101308186307a312e302c06035504030c254170706c65204170706c69636174696f6e20496e746567726174696f6e204341202d20473331263024060355040b0c1d4170706c652043657274696669636174696f6e20417574686f7269747931133011060355040a0c0a4170706c6520496e632e310b3009060355040613025553020816634c8b0e305717300b0609608648016503040201a08193301806092a864886f70d010903310b06092a864886f70d010701301c06092a864886f70d010905310f170d3234303530383231333131365a302806092a864886f70d010934311b3019300b0609608648016503040201a10a06082a8648ce3d040302302f06092a864886f70d010904312204209dbaa2c4dea464986df093cdbd726cab47580e933c43639c2401d71b0bf64fca300a06082a8648ce3d040302044830460221008f5bd0307b0a7438610c92f55a6481dbe087e4e54db53cba22a4625b26f6942b022100bd16046cbdbf44c9a5c7427c749c1b6bd5fcae549c79a02044ed560664e2513c000000000000"}`;
app.get("/.well-known/apple-developer-merchantid-domain-association", (c) =>
  new Response(APPLE_PAY_ASSOC, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
  })
);

app.route("/api/auth", authRouter);
app.route("/api/financials/unlock", financialsUnlockRouter);
app.route("/api/me", meRouter);
app.route("/api/locations", locationsRouter);
app.route("/api/customers", customersRouter);
app.route("/api/portal", portalRouter);
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
app.route("/api/dashboard", ownerDashboardRouter);
app.route("/api/maestro", maestroRouter);
app.route("/api/sofia", sofiaRouter);
app.route("/api/sofia-bridge", sofiaBridgeRouter);
app.route("/api/agents", agentsRouter);
app.route("/api/mission-control", missionControlRouter);
app.route("/api/espresso", espressoRouter);
app.route("/api/tasks", tasksRouter);
app.route("/api/intake-alterations", intakeAlterationsRouter);
app.route("/api/alts", altsRouter);
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
app.route("/api/scanner", scannerRouter);
app.route("/api/garment", garmentRouter);
app.route("/api/qr", qrRouter);
app.route("/api/square", squareRouter);
app.route("/api/files", filesRouter);
app.route("/api/fabric-stock", fabricStockRouter);
app.route("/api/outreach", outreachRouter);
app.route("/api/erpnext-customers", erpnextCustomersRouter);

app.route("/api/dispatch", dispatchRouter);
app.route("/api/booking", bookingRouter);
app.route("/api/public/booking", publicBookingRouter);
app.route("/api/delivery-zones", deliveryZonesRouter);
app.route("/api/places", placesRouter);
app.route("/api/qc", qcRouter);
app.route("/api/metrics", metricsRouter);
app.route("/api/offline", offlineRouter);

export default app;
