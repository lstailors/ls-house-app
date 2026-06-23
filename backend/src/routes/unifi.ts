// UniFi Cloud API routes — calls, recordings, cameras
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { upsertCallLog, listCallLogs } from "../lib/erpnext/agents";
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

// ── POST /api/unifi/sync — pull latest calls into Supabase ───────────────
// Called by Vercel cron (daily) OR Mac Studio crontab (every 1 min).
// Accepts either a user session OR X-Sync-Secret header.
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
    if (!calls.length) return c.json({ data: { synced: 0 } });

    let synced = 0;
    for (const call of calls) {
      const row = {
        external_id: call.id ?? call.callId ?? null,
        time: call.startTime ?? call.start_time ?? call.created ?? new Date().toISOString(),
        from: call.callerNumber ?? call.from ?? call.caller ?? "unknown",
        to: call.calleeNumber ?? call.to ?? call.callee ?? "unknown",
        from_caller_name: call.callerName ?? call.caller_name ?? null,
        direction: call.direction === "outbound" ? "out" : "in",
        duration: call.duration ?? call.durationSeconds ?? 0,
        status: call.status === "answered" ? "accepted" : call.status ?? "unknown",
        transcript_raw: call.transcript ?? null,
        transcript_whisper: call.summary ?? null,
        recording: call.recordingUrl ?? call.recording_url ?? null,
      };

      try {
        await upsertCallLog(row, "external_id");
        synced++;
      } catch { /* skip duplicate */ }
    }

    return c.json({ data: { synced, total: calls.length } });
  } catch (e: any) {
    console.error("[unifi/sync]", e.message);
    return c.json({ error: { message: e.message } }, 502);
  }
});
