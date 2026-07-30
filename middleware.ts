/**
 * Edge middleware (Vercel).
 * - pay.lstailors.com/:invoiceId → /pay/:invoiceId (short public pay links)
 * - Bot/crawler User-Agents on /pay/:id get invoice-specific Open Graph HTML.
 * - /admin* on delivered.lstailors.com redirects to app.lstailors.com/deliveries
 *   (Supabase delivery-app admin retired; ERP LSH Delivery lives in house).
 * Humans on other paths continue to the SPA via the default rewrite.
 */
export const config = {
  matcher: [
    "/",
    "/pay/:path*",
    "/admin",
    "/admin/:path*",
    // bare invoice ids on pay host: /LSTNY-SINV-… or /ACC-SINV-…
    "/:invoiceId",
  ],
};

const BOT_RE =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Applebot|iMessagepreview|Googlebot|bingpreview|Embedly|Quora Link Preview|Pinterest|redditbot|SkypeUriPreview|vkShare|W3C_Validator|Google-InspectionTool|preview/i;

/** SI names we accept as bare paths on pay.lstailors.com */
const INVOICE_ID_RE = /^(?:[A-Z]{2,10}-)?SINV-\d{4}-\d+/i;

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const host = url.hostname;
  const path = url.pathname;

  // ── pay.lstailors.com short links ──────────────────────────────────────────
  // https://pay.lstailors.com/LSTNY-SINV-2026-01415 → /pay/LSTNY-SINV-2026-01415
  if (host === "pay.lstailors.com" || host.startsWith("pay.")) {
    if (path === "/" || path === "") {
      return Response.redirect("https://app.lstailors.com/", 302);
    }
    // already /pay/...
    if (path.startsWith("/pay/")) {
      // fall through to bot OG handling below
    } else {
      const bare = decodeURIComponent(path.replace(/^\//, "").replace(/\/$/, ""));
      if (bare && !bare.includes("/") && INVOICE_ID_RE.test(bare)) {
        url.pathname = `/pay/${encodeURIComponent(bare)}`;
        return Response.redirect(url.toString(), 302);
      }
      // unknown path on pay host → house home
      return Response.redirect("https://app.lstailors.com/", 302);
    }
  }

  // Supabase mission-control admin → ERP house deliveries
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (host === "delivered.lstailors.com" || host.endsWith(".vercel.app")) {
      return Response.redirect("https://app.lstailors.com/deliveries", 302);
    }
  }

  if (!path.startsWith("/pay/")) return;

  const ua = request.headers.get("user-agent") || "";
  if (!BOT_RE.test(ua)) {
    return; // default routing
  }

  const m = path.match(/^\/pay\/([^/]+)/);
  if (!m) return;

  const id = decodeURIComponent(m[1]);
  const ogUrl = new URL(`/api/pay-info/${encodeURIComponent(id)}/og`, url.origin);
  return fetch(ogUrl.toString(), {
    headers: {
      "User-Agent": ua,
      Accept: "text/html",
    },
  });
}
