// Lightweight JWT sign/verify using Bun's built-in WebCrypto.
// Token payload: { sub: email, name, iat, exp }

const ALG = "HS256";

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET env var is not set");
  return s;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodePayload(obj: object): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodePayload(s: string): unknown {
  const pad = s.length % 4;
  const padded = pad ? s + "=".repeat(4 - pad) : s;
  return JSON.parse(decodeURIComponent(escape(atob(padded.replace(/-/g, "+").replace(/_/g, "/")))));
}

const HEADER = encodePayload({ alg: ALG, typ: "JWT" });

export async function signToken(payload: { sub: string; name: string; role?: string; locationCode?: string }, expiresInSec = 60 * 60 * 8 /* 8h; was 30d localStorage era */): Promise<string> {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const body = encodePayload({ ...payload, iat: now, exp: now + expiresInSec });
  const signing = `${HEADER}.${body}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signing));
  return `${signing}.${b64url(sig)}`;
}

export async function verifyToken(token: string): Promise<{ sub: string; name: string; role?: string; locationCode?: string; iat: number; exp: number } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    if (!header || !body || !sig) return null;
    const key = await importKey(getSecret());
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = decodePayload(body) as { sub: string; name: string; role?: string; locationCode?: string; iat: number; exp: number };
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
