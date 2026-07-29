/**
 * Edge middleware (Vercel).
 * - Bot/crawler User-Agents on /pay/:id get invoice-specific Open Graph HTML.
 * - /admin* on delivered.lstailors.com redirects to app.lstailors.com/deliveries
 *   (Supabase delivery-app admin retired; ERP LSH Delivery lives in house).
 * Humans on other paths continue to the SPA via the default rewrite.
 */
export const config = {
  matcher: ["/pay/:path*", "/admin", "/admin/:path*"],
};

const BOT_RE =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Applebot|iMessagepreview|Googlebot|bingpreview|Embedly|Quora Link Preview|Pinterest|redditbot|SkypeUriPreview|vkShare|W3C_Validator|Google-InspectionTool|preview/i;

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const host = url.hostname;
  const path = url.pathname;

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
