// UniFi Cloud API routes — calls, recordings, cameras
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { upsertCallLog, listCallLogs } from "../lib/erpnext/agents";
import { resolveIdentity } from "../lib/identity-resolve";
import {
  checkUnifiConnection,
  getTalkCallLogs,
  getTalkCall,
  getTalkRecordingUrl,
  getTalkVoicemails,
  getProtectCameras,
  getCameraSnapshot,
  getProtectEvents,
} from "../lib/unifi";

export const unifiRouter = new Hono();

// ── GET /api/unifi/status — connection health check ───────────────────────
unifiRouter.get("/status", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const result = await checkUnifiConnection();
  return c.json({ data: result });
});

// ── GET /api/unifi/calls — fetch call logs from UniFi Cloud ───────────────
unifiRouter.get("/calls", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  try {
    const limit = Number(c.req.query("limit") ?? "100");
    const start = c.req.query("start");
    const calls = await getTalkCallLogs({ limit, start });
    return c.json({ data: calls });
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502);
  }
});

// ── GET /api/unifi/calls/:id/recording — get recording URL ───────────────
unifiRouter.get("/calls/:id/recording", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const url = await getTalkRecordingUrl(c.req.param("id"));
  return c.json({ data: { url } });
});

// ── GET /api/unifi/voicemails ─────────────────────────────────────────────
unifiRouter.get("/voicemails", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const vms = await getTalkVoicemails();
  return c.json({ data: vms });
});

// ── GET /api/unifi/cameras ────────────────────────────────────────────────
unifiRouter.get("/cameras", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const cameras = await getProtectCameras();
  return c.json({ data: cameras });
});

// ── GET /api/unifi/cameras/:id/snapshot ──────────────────────────────────
unifiRouter.get("/cameras/:id/snapshot", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const url = await getCameraSnapshot(c.req.param("id"));
  return c.json({ data: { url } });
});

// ── GET /api/unifi/events — motion events ────────────────────────────────
unifiRouter.get("/events", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const events = await getProtectEvents({ limit: 50 });
  return c.json({ data: events });
});

// ── POST /api/unifi/sync — optional cloud Talk pull into ERP Call Log ────
// Prefer maestro/unifi-runtime ERP mirror (SoT). This path is best-effort.
// Accepts either a user session OR X-Sync-Secret header.
// Never 5xx on upstream Talk outage — that was spamming Vercel anomaly alerts.
unifiRouter.post("/sync", async (c) => {
  const syncSecret = process.env.UNIFI_SYNC_SECRET;
  const providedSecret = c.req.header("X-Sync-Secret");
  if (syncSecret && providedSecret === syncSecret) {
    // Authorized via sync secret — skip user session check
  } else {
    const user = await getAuthedUser(c);
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  }
  try {
    const lastRows = await listCallLogs({ limit: 1, orderBy: "time desc" });
    const lastRow = lastRows[0];

    const since = lastRow?.time
      ? new Date(new Date(lastRow.time).getTime() - 60_000).toISOString()
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const calls = await getTalkCallLogs({ limit: 200, start: since });
    if (!calls.length) {
      return c.json({ data: { synced: 0, degraded: false, source: "unifi-cloud" } });
    }

    let synced = 0;
    let matched = 0;
    for (const call of calls) {
      const from = call.callerNumber ?? call.from ?? call.caller ?? "unknown";
      const to = call.calleeNumber ?? call.to ?? call.callee ?? "unknown";
      const fromName = call.callerName ?? call.caller_name ?? null;
      const direction = call.direction === "outbound" ? "out" : "in";
      // Client phone = inbound from, outbound to
      const clientPhone = direction === "out" ? to : from;
      const idHit = await resolveIdentity({ phone: clientPhone, name: fromName }).catch(() => null);
      if (idHit) matched++;

      const row: Record<string, unknown> = {
        external_id: call.id ?? call.callId ?? call.uuid ?? null,
        time: call.startTime ?? call.start_time ?? call.created ?? new Date().toISOString(),
        from,
        to,
        from_caller_name: fromName,
        direction,
        duration: call.duration ?? call.durationSeconds ?? 0,
        status: call.status === "answered" ? "accepted" : call.status ?? "unknown",
        transcript_raw: call.transcript ?? null,
        transcript_whisper: call.summary ?? null,
        recording: call.recordingUrl ?? call.recording_url ?? null,
      };
      if (idHit) {
        row.customer = idHit.erpnext_customer_id;
        row.match_method = idHit.match;
        row.match_confidence = idHit.confidence;
      }

      try {
        await upsertCallLog(row, "external_id");
        synced++;
      } catch { /* skip duplicate */ }
    }

    return c.json({ data: { synced, matched, total: calls.length, source: "unifi-cloud" } });
  } catch (e: any) {
    // Soft-fail: background poller must not trip 5xx anomaly alerts.
    console.warn("[unifi/sync] degraded:", e?.message ?? e);
    return c.json({
      data: {
        synced: 0,
        degraded: true,
        reason: e?.message ?? "unifi sync failed",
        source: "unifi-cloud",
      },
    });
  }
});
