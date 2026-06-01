// Vercel Edge function — Hono's app.fetch IS the Fetch API handler.
// No adapter needed: Vercel Edge and Hono both use Request/Response natively.
export const config = { runtime: "edge" };

import app from "../backend/src/app";

export default app.fetch;
