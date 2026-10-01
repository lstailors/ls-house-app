/**
 * Twilio MessageStatus → LSH SMS Message.
 *
 * Accepting a message (queued/accepted/sent) is not delivery.
 * Callbacks move delivery_status forward only. A later queued receipt
 * must not wipe delivered or failed.
 */

export type SmsStatusSnapshot = {
  status?: string | null;
  delivery_status?: string | null;
};

export type TwilioStatusEvent = {
  messageStatus: string;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type SmsStatusPatch = {
  status: "sent" | "failed";
  delivery_status: string;
  error_message: string;
};

const RANK: Record<string, number> = {
  accepted: 1,
  queued: 1,
  scheduled: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  undelivered: 5,
  failed: 5,
};

export function isDeliverableSid(sid: string | null | undefined): sid is string {
  const value = String(sid ?? "").trim();
  return Boolean(value) && !value.startsWith("held_");
}

export function smsStatusCallbackUrl(): string {
  const explicit = String(process.env.TWILIO_STATUS_CALLBACK_URL ?? "").trim();
  if (explicit) return explicit;
  const house = String(process.env.HOUSE_APP_URL || process.env.PUBLIC_APP_URL || "https://app.lstailors.com")
    .trim()
    .replace(/\/$/, "");
  return `${house}/api/sofia/sms/status`;
}

function previousRank(current: SmsStatusSnapshot): number {
  const delivery = String(current.delivery_status ?? "").trim().toLowerCase();
  if (delivery && RANK[delivery] != null) return RANK[delivery]!;
  const status = String(current.status ?? "").trim().toLowerCase();
  if (status === "failed") return RANK.failed!;
  if (status === "sent") return RANK.sent!;
  return 0;
}

/** Null means ignore (unknown status, or a stale callback). */
export function applyTwilioMessageStatus(
  current: SmsStatusSnapshot,
  event: TwilioStatusEvent,
): SmsStatusPatch | null {
  const incoming = String(event.messageStatus ?? "").trim().toLowerCase();
  const incomingRank = RANK[incoming];
  if (incomingRank == null) return null;
  if (incomingRank < previousRank(current)) return null;

  const failed = incoming === "failed" || incoming === "undelivered";
  const errorBits = [event.errorCode, event.errorMessage]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);
  return {
    status: failed ? "failed" : "sent",
    delivery_status: incoming,
    error_message: failed ? errorBits.join(": ") || `Twilio ${incoming}` : "",
  };
}
