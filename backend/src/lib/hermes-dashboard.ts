/**
 * Server-side client for Hermes Web Dashboard (maestro.lstailors.com / :9119).
 * Never expose credentials to the browser.
 *
 * Edge-safe: no node:child_process. Vercel uses env vars only
 * (HERMES_DASHBOARD_BASIC_AUTH_USERNAME / _PASSWORD).
 */
const UA = "L&S-MC-HermesMirror/1.0";

function cleanEnv(v: string | undefined): string {
  return (v || "").trim().replace(/\\n/g, "").replace(/\r/g, "");
}

export function hermesDashboardBase(): string {
  return cleanEnv(
    process.env.HERMES_DASHBOARD_URL ||
      process.env.HERMES_MIRROR_URL ||
      "https://maestro.lstailors.com",
  ).replace(/\/$/, "");
}

function creds(): { user: string; pass: string } {
  const user = cleanEnv(
    process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME ||
      process.env.HERMES_DASHBOARD_USERNAME,
  );
  const pass = cleanEnv(
    process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD ||
      process.env.HERMES_DASHBOARD_PASSWORD,
  );
  return { user, pass };
}

export function hermesCredsConfigured(): boolean {
  const { user, pass } = creds();
  return Boolean(user && pass);
}

type CookieJar = { cookie: string; exp: number };
let jar: CookieJar | null = null;

async function login(): Promise<string | null> {
  const { user, pass } = creds();
  if (!user || !pass) return null;
  if (jar && jar.exp > Date.now() + 60_000) return jar.cookie;

  const base = hermesDashboardBase();
  const res = await fetch(`${base}/auth/password-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({ provider: "basic", username: user, password: pass }),
    redirect: "manual",
  });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  // Fallback for runtimes without getSetCookie
  const raw = res.headers.get("set-cookie");
  const parts = setCookie.length
    ? setCookie
    : raw
      ? raw.split(/,(?=\s*[^;]+=)/)
      : [];
  const cookies = parts
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");

  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(`hermes login failed ${res.status}: ${body.slice(0, 200)}`);
  }
  if (!cookies) {
    throw new Error("hermes login ok but no session cookie");
  }
  jar = { cookie: cookies, exp: Date.now() + 10 * 60 * 60 * 1000 };
  return jar.cookie;
}

export async function hermesFetch(
  path: string,
  init: RequestInit = {},
  opts: { auth?: boolean } = {},
): Promise<{ status: number; json: any; error?: string }> {
  const base = hermesDashboardBase();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": UA,
    ...(init.headers as Record<string, string> | undefined),
  };

  if (opts.auth !== false) {
    try {
      const cookie = await login();
      if (cookie) headers.Cookie = cookie;
      else if (opts.auth === true) {
        return {
          status: 401,
          json: null,
          error:
            "Hermes dashboard credentials not configured (set HERMES_DASHBOARD_BASIC_AUTH_USERNAME/PASSWORD or keychain hermes-dashboard-username/password)",
        };
      }
    } catch (e: any) {
      return { status: 502, json: null, error: e?.message || "login failed" };
    }
  }

  try {
    const res = await fetch(url, { ...init, headers });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    if (res.status === 401 && opts.auth !== false) {
      jar = null;
    }
    return { status: res.status, json };
  } catch (e: any) {
    return { status: 502, json: null, error: e?.message || "fetch failed" };
  }
}

export const HERMES_FEATURE_MAP = [
  {
    id: "status",
    desktop: "Status / gateway health",
    mc: "Hermes tab · status card",
    mode: "mirror",
    phase: 1,
  },
  {
    id: "sessions",
    desktop: "Sessions list + search + resume",
    mc: "Hermes tab · sessions",
    mode: "mirror",
    phase: 1,
  },
  {
    id: "chat",
    desktop: "Streaming chat + tool cards",
    mc: "Hermes Chat (one-shot) + Open Console live stream",
    mode: "mirror",
    phase: 2,
  },
  {
    id: "cron",
    desktop: "Cron create/edit/trigger",
    mc: "Hermes cron + Crons health tab",
    mode: "mirror",
    phase: 1,
  },
  {
    id: "skills",
    desktop: "Skills browse/toggle",
    mc: "Hermes tab · skills",
    mode: "mirror",
    phase: 1,
  },
  {
    id: "analytics",
    desktop: "Usage analytics",
    mc: "Costs tab + Hermes analytics",
    mode: "mirror",
    phase: 1,
  },
  {
    id: "mcp",
    desktop: "MCP servers",
    mc: "Hermes Admin · MCP list + Console manage",
    mode: "mirror",
    phase: 2,
  },
  {
    id: "channels",
    desktop: "Messaging channels / pairing",
    mc: "Hermes Admin · gateway channels",
    mode: "mirror",
    phase: 2,
  },
  {
    id: "config",
    desktop: "Config / API keys / models",
    mc: "Open Console → Config",
    mode: "deep-link",
    phase: 2,
  },
  {
    id: "artifacts",
    desktop: "Artifacts gallery",
    mc: "Hermes Artifacts (activity + command outputs)",
    mode: "mirror",
    phase: 2,
  },
  {
    id: "memory",
    desktop: "Memory graph / MEMORY.md",
    mc: "Hermes Memory hub + Console system",
    mode: "mirror",
    phase: 3,
  },
  {
    id: "session-stream",
    desktop: "Live session transcript / tool cards",
    mc: "Hermes Sessions · message transcript + Live Chat",
    mode: "mirror",
    phase: 3,
  },
  {
    id: "costs-depth",
    desktop: "Usage analytics (tokens/models)",
    mc: "Costs tab · Hermes usage feed",
    mode: "mirror",
    phase: 3,
  },
  {
    id: "files-git-term",
    desktop: "File browser · terminal · git review · worktrees",
    mc: "Desktop only",
    mode: "desktop-only",
    phase: 0,
  },
  {
    id: "fleet-board",
    desktop: "—",
    mc: "Fleet · Board · Approvals (L&S native)",
    mode: "mc-native",
    phase: 0,
  },
] as const;

export function hermesDeepLinks(base = hermesDashboardBase()) {
  const b = base.replace(/\/$/, "");
  return {
    home: b,
    chat: `${b}/chat`,
    sessions: `${b}/sessions`,
    cron: `${b}/cron`,
    skills: `${b}/skills`,
    mcp: `${b}/mcp`,
    channels: `${b}/channels`,
    pairing: `${b}/pairing`,
    config: `${b}/config`,
    analytics: `${b}/analytics`,
    logs: `${b}/logs`,
    profiles: `${b}/profiles`,
    memory: `${b}/system`, // memory lives under System admin
    system: `${b}/system`,
  };
}
