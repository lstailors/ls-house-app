// Vercel Node.js serverless function.
// Using Node runtime (not Edge) so async tasks like processMessage complete
// before the function exits — Edge kills pending work after response is sent.
export const config = { runtime: "nodejs", maxDuration: 60 };

import app from "../backend/src/app";
import { handle } from "hono/vercel";

export default handle(app);
