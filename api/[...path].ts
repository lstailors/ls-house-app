// Vercel Node.js serverless function — supports full Node.js APIs (required for ai/gateway packages).
export const config = { runtime: "nodejs" };

import app from "../backend/src/app";

export default app.fetch;
