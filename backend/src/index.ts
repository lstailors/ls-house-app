import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
import "./load-env"; // load .env before any module reads process.env
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import "./env";
import { registerRoutes } from "./routes/register";
import { qrRouter } from "./routes/qr";

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
  /^https:\/\/alts\.lstailors\.com$/,
  /^https:\/\/book\.lstailors\.com$/,
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

// Shared with src/app.ts (Vercel Edge) so the two entry points cannot drift.
registerRoutes(app);

// Node/Bun only — see the note in routes/register.ts. QRCode.toBuffer() needs
// zlib/stream, which the Edge runtime does not provide, so this one router is
// mounted here rather than in the shared list.
app.route("/api/qr", qrRouter);

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};
