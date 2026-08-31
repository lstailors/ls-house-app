// Standalone Checkout Edge API.
// Keeps checkout.lstailors.com functional even when the main House deployment
// is temporarily missing the checkout router.
export const config = { runtime: "edge" };

import { checkoutRouter } from "../../../backend/src/routes/checkout";

const PREFIX = "/api/checkout";

export async function checkoutEdgeHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`)) {
    url.pathname = url.pathname.slice(PREFIX.length) || "/";
  }

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  return checkoutRouter.fetch(new Request(url, init));
}

export default checkoutEdgeHandler;
