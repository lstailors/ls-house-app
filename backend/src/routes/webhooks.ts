import { Hono } from "hono";
import { logErpCommunication, matchCustomerByPhone } from "./comms";
import { insertCallLog, updateCallLog, insertSmsMessage } from "../lib/erpnext/agents";
import { parseDocusealWebhook } from "../lib/docuseal";
import { attachDocusealResultFiles, markQcSignedBySubmission } from "./qc";

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
//   SMS               → https://app.lstailors.com/api/webhooks/unifi?type=sms
//   Emergency Calls   → https://app.lstailors.com/api/webhooks/unifi?type=emergency
// (type param is optional — we auto-detect if not provided)

webhooksRouter.post("/unifi", async (c) => {
  // D9 (HER-22): fail closed if secret unset or mismatch.
  const secret = (process.env.UNIFI_WEBHOOK_SECRET ?? "").trim();
  const token = c.req.header("X-Webhook-Token") ?? c.req.query("token");
  if (!secret || token !== secret) return c.json({ ok: false }, 403);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ ok: false, error: "Invalid JSON" }, 400);

  const type = c.req.query("type") ?? "transcript";
  const { callId, transcript, summary, recordingUrl, callerPhone, callerName, duration, rawText } = parseUnifiPayload(body);
  const customerPhone = callerPhone ?? (type === "sms" ? body.sender ?? null : null);
  const matchedCustomer = customerPhone
    ? await matchCustomerByPhone(customerPhone).catch(() => null)
    : null;
  const matchedCustomerId = matchedCustomer?.id ?? null;
  const matchedCustomerName = matchedCustomer?.name ?? null;

  // ── Determine status from type ──────────────────────────────────────────
  const statusMap: Record<string, string> = {
    transcript: "accepted",
    voicemail:  "voicemail",
    missed:     "missed",
    failed:     "failed",
    emergency:  "emergency",
  };
  const status = statusMap[type] ?? "webhook";

  // ── Save/update in unifi_call_logs ──────────────────────────────────────
  if (callId) {
    await updateCallLog(callId, {
      transcript_raw: transcript,
      transcript_whisper: summary,
      recording: recordingUrl,
      status: type === "transcript" ? "accepted" : status,
    }).catch(() => {});
  } else {
    await insertCallLog({
      time: new Date().toISOString(),
      from: callerPhone ?? "unknown",
      from_caller_name: callerName ?? null,
      to: "unknown",
      direction: "in",
      duration: duration,
      status,
      transcript_raw: transcript,
      transcript_whisper: summary,
      recording: recordingUrl,
    }).catch(() => {});
  }

  // ── Log to ERPNext Customer Communication ───────────────────────────────
  if (callerPhone && matchedCustomerId) {
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
      customerId: matchedCustomerId,
      medium: "Phone",
      subject: erpSubject,
      content: erpContent,
      direction: "Received",
      date: new Date().toISOString(),
      phoneNo: callerPhone,
    });
  }

  // ── SMS handling ──────────────────────────────────────────────────────────
  // UniFi Talk number is separate from Sofia's Twilio number.
  // Store in sms_messages table with source="unifi" so it shows in comms dashboard.
  if (type === "sms") {
    const fromPhone = callerPhone ?? body.from ?? body.sender ?? null;
    const messageBody = body.message ?? body.body ?? body.text ?? transcript ?? rawText ?? null;

    if (fromPhone && messageBody) {
      await insertSmsMessage({
        client_phone: fromPhone,
        direction: "inbound",
        body: messageBody,
        content: messageBody,
        timestamp: new Date().toISOString(),
        metadata: JSON.stringify({ source: "unifi", raw: body }),
      }).catch(() => {});

      // Log to ERPNext customer timeline
      if (matchedCustomerId) {
        await logErpCommunication({
          customerId: matchedCustomerId,
          medium: "SMS",
          subject: `SMS via UniFi — ${callerName ?? fromPhone}`,
          content: messageBody,
          direction: "Received",
          date: new Date().toISOString(),
          phoneNo: fromPhone,
        });
      }
    }
  }

  // ── Forward normalized event to n8n → Hermes (fire-and-forget) ──────────
  const n8nUrl = process.env.N8N_COMMS_WEBHOOK_URL;
  if (n8nUrl) {
    const fwd = {
      source: "unifi_talk",
      type,
      call_id: callId,
      caller_phone: callerPhone,
      caller_name: callerName,
      customer: matchedCustomerId ?? null,
      customer_name: matchedCustomerName ?? null,
      summary,
      transcript,
      recording_url: recordingUrl,
      duration,
      occurred_at: new Date().toISOString(),
    };
    fetch(n8nUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Token": process.env.N8N_COMMS_WEBHOOK_SECRET ?? "",
      },
      body: JSON.stringify(fwd),
    }).catch((e) => console.warn("[unifi→n8n]", e?.message));
  }

  return c.json({ ok: true });
});

// POST /api/webhooks/docuseal — MTM QC signature completed
webhooksRouter.post("/docuseal", async (c) => {
  const secret = (process.env.DOCUSEAL_WEBHOOK_SECRET ?? "").trim();
  if (secret) {
    const token =
      c.req.header("X-Webhook-Secret") ??
      c.req.header("X-Auth-Token") ??
      c.req.query("token");
    if (token !== secret) return c.json({ ok: false }, 403);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ ok: false, error: "Invalid JSON" }, 400);

  const parsed = parseDocusealWebhook(body);
  if (!parsed.completed) return c.json({ ok: true, ignored: true });

  const name = await markQcSignedBySubmission(parsed.ids, parsed.signedUrl, parsed.inspectionName).catch(
    () => null,
  );
  if (name && parsed.ids[0]) {
    await attachDocusealResultFiles(name, parsed.ids[0], parsed.signedUrl).catch((e) =>
      console.warn("[docuseal.webhook] attach", e?.message),
    );
  }
  return c.json({ ok: true, inspection: name });
});
