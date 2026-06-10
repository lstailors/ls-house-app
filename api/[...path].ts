// Vercel Edge function — Hono's app.fetch IS the Fetch API handler.
export const config = { runtime: "edge" };

import app from "../backend/src/app";

export default app.fetch;
