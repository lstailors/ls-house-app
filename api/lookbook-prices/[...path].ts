// Node serverless function (NOT edge) for /api/lookbook-prices/*.
// Building the price review reads ~62k Fabric Swatch rows from Desk in one
// pass — too long for the edge function's response deadline that serves the
// rest of /api/*. Filesystem routes win over the vercel.json rewrite, so only
// this path lands here; maxDuration lives in vercel.json.
import app from "../../backend/src/app";

export default app.fetch;
