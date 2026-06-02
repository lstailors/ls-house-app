import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { logErpCommunication, matchCustomerByPhone } from "./comms";

export const webhooksRouter = new Hono();

// ── Shared payload parser (handles Slack + Teams format) ──────────────────
function parseUnifiPayload(body: any) {
  const attachments = body.attachments ?? [];
  const sections = body.sections ?? [];
  const callData = attachments[0] ?? sections[0] ?? {};

  return {
    callId:      body.call_id ?? body.id ?? body.metadata?.call_id ?? null,
    transcript:  body.transcript ?? callData.text ?? callData.pretext
                 ?? sections.map((s: any) => s.text ?? s.activityText).filter(Boolean).join("\n")
                 ?? body.text ?? null,
    summary:     body.summary ?? callData.title ?? callData.activityTitle ?? null,
    recordingUrl: body.recording_url ?? body.metadata?.recording_url
                 ?? callData.actions?.find((a: any) => a.name?.toLowerCase().includes("recording"))?.target ?? null,
    callerPhone: body.from ?? body.caller ?? body.metadata?.from
                 ?? callData.activitySubtitle?.match(/\+?[\d\s\-\(\)]{10,}/)?.[0] ?? null,
    callerName:  body.from_name ?? body.caller_name ?? body.metadata?.from_name ?? callData.activityTitle ?? null,
    duration:    body.duration ?? body.metadata?.duration ?? 0,
    rawText:     body.text ?? null,
  };
}

// ── POST /api/webhooks/unifi ── handles ALL UniFi Talk webhook types ──────
// Configure in UniFi Talk → Settings → Integrations:
//   AI Transcriptions → https://app.lstailors.com/api/webhooks/unifi?type=transcript
//   Voicemail         → https://app.lstailors.com/api/webhooks/unifi?type=voicemail
//   Missed Calls      → https://app.lstailors.com/api/webhooks/unifi?type=missed
//   Inbound Failure   → https://app.lstailors.com/api/webhooks/unifi?type=failed
// (type param is optional — we auto-detect if not provided)

webhooksRouter.post("/unifi", async (c) => {
  const secret = process.env.UNIFI_WEBHOOK_SECRET;
  if (secret) {
    const token = c.req.header("X-Webhook-Token") ?? c.req.query("token");
    if (token !== secret) return c.json({ ok: false }, 403);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ ok: false, error: "Invalid JSON" }, 400);
  if (!supabaseAdmin) return c.json({ ok: true });

  const type = c.req.query("type") ?? "transcript"; // transcript | voicemail | missed | failed
  const { callId, transcript, summary, recordingUrl, callerPhone, callerName, duration, rawText } = parseUnifiPayload(body);

  // ── Determine status from type ──────────────────────────────────────────
  const statusMap: Record<string, string> = {
    transcript: "accepted",
    voicemail:  "voicemail",
    missed:     "missed",
    failed:     "failed",
  };
  const status = statusMap[type] ?? "webhook";

  // ── Save/update in unifi_call_logs ──────────────────────────────────────
  if (callId) {
    await supabaseAdmin.from("unifi_call_logs").update({
      transcript_raw: transcript,
      transcript_summary: summary,
      recording_url: recordingUrl,
      status: type === "transcript" ? "accepted" : status,
    }).eq("id", callId).then(() => {});
  } else {
    await supabaseAdmin.from("unifi_call_logs").insert({
      time: new Date().toISOString(),
      from: callerPhone ?? "unknown",
      from_caller_name: callerName ?? null,
      to: "unknown",
      direction: "in",
      duration: duration,
      status,
      transcript_raw: transcript,
      transcript_summary: summary,
      recording_url: recordingUrl,
    }).then(() => {});
  }

  // ── Log to ERPNext Customer Communication ───────────────────────────────
  if (callerPhone) {
    const customer = await matchCustomerByPhone(callerPhone).catch(() => null);
    if (customer) {
      const erpSubject = {
        transcript: `Call transcript — ${summary ?? callerName ?? callerPhone}`,
        voicemail:  `Voicemail from ${callerName ?? callerPhone}`,
        missed:     `Missed call from ${callerName ?? callerPhone}`,
        failed:     `Inbound call failed — ${callerPhone}`,
      }[type] ?? `Call — ${callerPhone}`;

      const erpContent = transcript
        ?? (type === "missed" ? `Missed call from ${callerName ?? callerPhone}. No answer.` : null)
        ?? (type === "voicemail" ? `Voicemail received. ${recordingUrl ? "Recording available." : ""}` : null)
        ?? rawText ?? "No transcript available.";

      await logErpCommunication({
        customerId: customer.id,
        medium: "Phone",
        subject: erpSubject,
        content: erpContent,
        direction: "Received",
        date: new Date().toISOString(),
        phoneNo: callerPhone,
      });
    }
  }

  return c.json({ ok: true });
});
