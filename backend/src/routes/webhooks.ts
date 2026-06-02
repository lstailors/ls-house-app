import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { logErpCommunication, matchCustomerByPhone } from "./comms";

export const webhooksRouter = new Hono();

// POST /api/webhooks/unifi
// UniFi Talk sends call transcripts/recordings to a "Slack webhook" URL.
// We accept the same JSON format and store it.
webhooksRouter.post("/unifi", async (c) => {
  const secret = process.env.UNIFI_WEBHOOK_SECRET;
  if (secret) {
    const token = c.req.header("X-Webhook-Token") ?? c.req.query("token");
    if (token !== secret) return c.json({ ok: false }, 403);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ ok: false, error: "Invalid JSON" }, 400);

  if (!supabaseAdmin) return c.json({ ok: true }); // silently accept

  // Handle both Slack format ({ text, attachments }) and Teams format ({ @type, text, sections })
  // UniFi may send either depending on which icon was selected — payload content is the same
  const attachments = body.attachments ?? [];
  const sections = body.sections ?? [];
  const callData = attachments[0] ?? sections[0] ?? {};

  // Extract fields from any UniFi webhook format
  const callId = body.call_id ?? body.id ?? body.metadata?.call_id ?? callData.activitySubtitle ?? null;
  const transcript = body.transcript
    ?? callData.text ?? callData.pretext
    ?? body.text ?? body.summary
    ?? sections.map((s: any) => s.text ?? s.activityText).filter(Boolean).join("\n")
    ?? null;
  const summary = body.summary ?? callData.title ?? callData.activityTitle ?? body.text?.slice(0, 100) ?? null;
  const recordingUrl = body.recording_url ?? body.metadata?.recording_url
    ?? callData.actions?.find((a: any) => a.name?.toLowerCase().includes("recording"))?.target ?? null;
  const callerPhone = body.from ?? body.caller ?? body.metadata?.from
    ?? callData.activitySubtitle?.match(/\+?[\d\s\-\(\)]{10,}/)?.[0] ?? null;

  if (callId) {
    // Update existing call log if we can match by id
    await supabaseAdmin.from("unifi_call_logs")
      .update({
        transcript_raw: transcript,
        transcript_summary: summary,
        recording_url: recordingUrl,
      })
      .eq("id", callId)
      .then(() => {});
  } else {
    // Log raw webhook for debugging
    await supabaseAdmin.from("unifi_call_logs").insert({
      time: new Date().toISOString(),
      from: callerPhone ?? "unknown",
      to: "unknown",
      direction: "in",
      duration: 0,
      status: "webhook",
      transcript_raw: transcript,
      transcript_summary: summary,
      recording_url: recordingUrl,
    }).then(() => {});
  }

  // Log to ERPNext Customer Communication timeline if we can match the caller
  if (callerPhone && transcript) {
    const customer = await matchCustomerByPhone(callerPhone).catch(() => null);
    if (customer) {
      await logErpCommunication({
        customerId: customer.id,
        medium: "Phone",
        subject: `Phone call — ${summary ?? "transcript available"}`,
        content: transcript,
        direction: "Received",
        date: new Date().toISOString(),
        phoneNo: callerPhone,
      });
    }
  }

  // Respond with Slack-compatible success (UniFi expects this)
  return c.json({ ok: true });
});
