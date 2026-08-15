import { insertSmsMessage } from "./erpnext/agents";
import { isLive, isSmsAllowlisted, opsMode } from "./ops-mode";
import { maskTrack } from "./pci-guard";

export type OutboundSmsResult = {
  sid: string | null;
  held: boolean;
  reason?: string;
};

function safePreview(body: string): string {
  const masked = maskTrack(body);
  return masked.length > 180 ? `${masked.slice(0, 180)}…` : masked;
}

async function logOutbound(opts: {
  to: string;
  body: string;
  source: string;
  sid: string | null;
  held: boolean;
  reason?: string;
}) {
  const status = opts.held ? "failed" : opts.sid ? "sent" : "failed";
  console.info(
    JSON.stringify({
      kind: "outbound_sms",
      mode: opsMode(),
      source: opts.source,
      toLast4: String(opts.to).replace(/\D/g, "").slice(-4),
      held: opts.held,
      reason: opts.reason ?? null,
      sid: opts.sid,
      preview: safePreview(opts.body),
    }),
  );
  try {
    await insertSmsMessage({
      client_phone: opts.to,
      direction: "outbound",
      content: opts.body,
      timestamp: new Date().toISOString(),
      twilio_sid: opts.sid,
      status,
      context_tag: opts.held ? `held:${opts.source}` : opts.source,
    });
  } catch (e) {
    console.warn("[outbound] log write failed", (e as Error).message);
  }
}

/**
 * Single choke point for Node Twilio sends.
 * TEST mode: allowlisted numbers only; everyone else is logged, not sent.
 */
export async function dispatchSms(opts: {
  to: string;
  body: string;
  mediaUrl?: string;
  source: string;
}): Promise<OutboundSmsResult> {
  const to = String(opts.to || "").trim();
  const body = String(opts.body || "");
  if (!to || !body) {
    return { sid: null, held: true, reason: "missing_to_or_body" };
  }

  if (!isLive() && !isSmsAllowlisted(to)) {
    const sid = `held_${Date.now()}`;
    await logOutbound({
      to,
      body,
      source: opts.source,
      sid,
      held: true,
      reason: "test_mode_not_allowlisted",
    });
    return { sid, held: true, reason: "test_mode_not_allowlisted" };
  }

  const sid = await twilioPost(to, body, opts.mediaUrl);
  await logOutbound({
    to,
    body,
    source: opts.source,
    sid,
    held: false,
    reason: sid ? undefined : "twilio_failed",
  });
  return { sid, held: false, reason: sid ? undefined : "twilio_failed" };
}

async function twilioPost(to: string, body: string, mediaUrl?: string): Promise<string | null> {
  const account = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const msgSvcSid = process.env.TWILIO_MSG_SERVICE_SID;
  if (!account || !token) return null;
  const params = new URLSearchParams({ To: to, Body: body });
  if (msgSvcSid) params.set("MessagingServiceSid", msgSvcSid);
  else params.set("From", "+12123084431");
  if (mediaUrl) params.set("MediaUrl0", mediaUrl);
  const auth = btoa(`${account}:${token}`);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data: any = await res.json().catch(() => ({}));
  return res.ok ? data.sid ?? null : null;
}

export async function dispatchEmail(opts: {
  to: string;
  subject: string;
  source: string;
  send: () => Promise<unknown>;
}): Promise<{ held: boolean }> {
  if (!isLive() && !String(opts.to).toLowerCase().endsWith("@lstailors.com")) {
    console.info(
      JSON.stringify({
        kind: "outbound_email",
        mode: opsMode(),
        source: opts.source,
        toDomain: String(opts.to).split("@")[1] ?? "",
        subject: String(opts.subject || "").slice(0, 80),
        held: true,
        reason: "test_mode_external_email",
      }),
    );
    return { held: true };
  }
  await opts.send();
  console.info(
    JSON.stringify({
      kind: "outbound_email",
      mode: opsMode(),
      source: opts.source,
      toDomain: String(opts.to).split("@")[1] ?? "",
      subject: String(opts.subject || "").slice(0, 80),
      held: false,
    }),
  );
  return { held: false };
}
