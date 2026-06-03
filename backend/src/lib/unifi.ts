// UniFi Cloud API client
// Docs: https://developer.ui.com/
// Auth: API Key from UniFi Console → Settings → System → API

const UNIFI_HOST = process.env.UNIFI_HOST ?? "https://api.ui.com";
const UNIFI_API_KEY = process.env.UNIFI_API_KEY ?? "";
const UNIFI_SITE_ID = process.env.UNIFI_SITE_ID ?? "";

function headers() {
  return {
    "X-API-Key": UNIFI_API_KEY,
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
}

// ── Site Manager ──────────────────────────────────────────────────────────

export async function listSites(): Promise<any[]> {
  const res = await fetch(`${UNIFI_HOST}/v1/sites`, { headers: headers() });
  if (!res.ok) throw new Error(`UniFi sites ${res.status}`);
  const data = await res.json() as any;
  return data.data ?? [];
}

// ── UniFi Talk ────────────────────────────────────────────────────────────

// List call logs for the site
export async function getTalkCallLogs(opts: {
  limit?: number;
  offset?: number;
  start?: string; // ISO date
  end?: string;
} = {}): Promise<any[]> {
  if (!UNIFI_API_KEY || !UNIFI_SITE_ID) return [];

  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 100));
  if (opts.offset) params.set("offset", String(opts.offset));
  if (opts.start) params.set("start", opts.start);
  if (opts.end) params.set("end", opts.end);

  const res = await fetch(
    `${UNIFI_HOST}/v1/sites/${UNIFI_SITE_ID}/talk/calls?${params}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`UniFi Talk calls ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return data.data ?? data.calls ?? data ?? [];
}

// Get a specific call
export async function getTalkCall(callId: string): Promise<any | null> {
  if (!UNIFI_API_KEY || !UNIFI_SITE_ID) return null;
  const res = await fetch(
    `${UNIFI_HOST}/v1/sites/${UNIFI_SITE_ID}/talk/calls/${callId}`,
    { headers: headers() }
  );
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data.data ?? data;
}

// Get call recording download URL
export async function getTalkRecordingUrl(callId: string): Promise<string | null> {
  if (!UNIFI_API_KEY || !UNIFI_SITE_ID) return null;
  const res = await fetch(
    `${UNIFI_HOST}/v1/sites/${UNIFI_SITE_ID}/talk/calls/${callId}/recording`,
    { headers: headers() }
  );
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data.url ?? data.data?.url ?? null;
}

// Get voicemails
export async function getTalkVoicemails(limit = 50): Promise<any[]> {
  if (!UNIFI_API_KEY || !UNIFI_SITE_ID) return [];
  const res = await fetch(
    `${UNIFI_HOST}/v1/sites/${UNIFI_SITE_ID}/talk/voicemails?limit=${limit}`,
    { headers: headers() }
  );
  if (!res.ok) return [];
  const data = await res.json() as any;
  return data.data ?? data.voicemails ?? [];
}

// ── UniFi Protect (cameras) ───────────────────────────────────────────────

// List cameras
export async function getProtectCameras(): Promise<any[]> {
  if (!UNIFI_API_KEY || !UNIFI_SITE_ID) return [];
  const res = await fetch(
    `${UNIFI_HOST}/v1/sites/${UNIFI_SITE_ID}/protect/cameras`,
    { headers: headers() }
  );
  if (!res.ok) return [];
  const data = await res.json() as any;
  return data.data ?? data.cameras ?? [];
}

// Get camera snapshot (returns image URL or Buffer)
export async function getCameraSnapshot(cameraId: string): Promise<string | null> {
  if (!UNIFI_API_KEY || !UNIFI_SITE_ID) return null;
  const res = await fetch(
    `${UNIFI_HOST}/v1/sites/${UNIFI_SITE_ID}/protect/cameras/${cameraId}/snapshot`,
    { headers: headers() }
  );
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data.url ?? data.data?.url ?? null;
}

// Get recent motion events
export async function getProtectEvents(opts: {
  cameraId?: string;
  limit?: number;
  start?: string;
  end?: string;
} = {}): Promise<any[]> {
  if (!UNIFI_API_KEY || !UNIFI_SITE_ID) return [];
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 50));
  if (opts.cameraId) params.set("cameraId", opts.cameraId);
  if (opts.start) params.set("start", opts.start);
  if (opts.end) params.set("end", opts.end);

  const res = await fetch(
    `${UNIFI_HOST}/v1/sites/${UNIFI_SITE_ID}/protect/events?${params}`,
    { headers: headers() }
  );
  if (!res.ok) return [];
  const data = await res.json() as any;
  return data.data ?? data.events ?? [];
}

// ── Health check ──────────────────────────────────────────────────────────

export async function checkUnifiConnection(): Promise<{
  connected: boolean;
  siteId: string | null;
  siteName: string | null;
  error?: string;
}> {
  if (!UNIFI_API_KEY) return { connected: false, siteId: null, siteName: null, error: "UNIFI_API_KEY not set" };
  try {
    const sites = await listSites();
    const site = UNIFI_SITE_ID
      ? sites.find(s => s.siteId === UNIFI_SITE_ID || s.id === UNIFI_SITE_ID)
      : sites[0];
    return {
      connected: true,
      siteId: site?.siteId ?? site?.id ?? null,
      siteName: site?.name ?? site?.siteName ?? null,
    };
  } catch (e: any) {
    return { connected: false, siteId: null, siteName: null, error: e.message };
  }
}
