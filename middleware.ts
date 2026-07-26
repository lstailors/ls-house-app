/**
 * Edge middleware (Vercel). Bot/crawler User-Agents on /pay/:id get
 * invoice-specific Open Graph HTML so iMessage shows an invoice card.
 * Humans continue to the SPA via the default rewrite.
 */
export const config = {
  matcher: '/pay/:path*',
};

const BOT_RE =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Applebot|iMessagepreview|Googlebot|bingpreview|Embedly|Quora Link Preview|Pinterest|redditbot|SkypeUriPreview|vkShare|W3C_Validator|Google-InspectionTool|preview/i;

export default async function middleware(request: Request) {
  const ua = request.headers.get('user-agent') || '';
  if (!BOT_RE.test(ua)) {
    return; // default routing
  }

  const url = new URL(request.url);
  const m = url.pathname.match(/^\/pay\/([^/]+)/);
  if (!m) return;

  const id = decodeURIComponent(m[1]);
  const ogUrl = new URL(`/api/pay-info/${encodeURIComponent(id)}/og`, url.origin);
  return fetch(ogUrl.toString(), {
    headers: {
      'User-Agent': ua,
      Accept: 'text/html',
    },
  });
}
