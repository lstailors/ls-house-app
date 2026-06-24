// Vercel Node.js serverless function (maxDuration 60).
//
// Node runtime (not Edge) so background work has a 60s budget: Sofia's SMS
// pipeline (Grok + an 8-20s human-like delay + Twilio/ERP send) can exceed
// Edge's ~25s execution ceiling and get truncated mid-reply.
//
// We wrap app.fetch (NOT hono/vercel's handle, which caused ERRMODULENOTFOUND)
// and pass Vercel's execution context (2nd arg) to Hono as the ExecutionContext,
// so route handlers can call c.executionCtx.waitUntil(...) to keep the invocation
// alive for background work AFTER the response is sent.
export const config = { runtime: "nodejs", maxDuration: 60 };

import app from "../backend/src/app";

export default function handler(
  request: Request,
  context?: { waitUntil?: (promise: Promise<unknown>) => void },
) {
  return app.fetch(request, process.env as unknown as {}, context as unknown as never);
}
