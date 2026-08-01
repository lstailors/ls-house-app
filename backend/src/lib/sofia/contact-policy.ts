// Sofia's contact rules. One place that decides which number a client may be
// pointed at, and which number is Carl's alone.
//
// The rule Carl set, in his words: "She should never direct connect me but if
// emergency Sofia calls me."
//
//   - Clients are only ever given / transferred to the SHOP line.
//   - Carl's mobile is never spoken, texted, or transferred to by a client.
//   - On an emergency, the system calls Carl. The client is never bridged in.
//
// Numbers live in env so they change without a deploy; the defaults are the
// real live numbers so a missing env var degrades to correct behaviour rather
// than to an empty string.

const SHOP_PHONE_DEFAULT = "+12127521638";
const OWNER_MOBILE_DEFAULT = "+16319260917";

export const SHOP_PHONE = process.env.SHOP_PHONE || SHOP_PHONE_DEFAULT;
export const OWNER_MOBILE = process.env.OWNER_MOBILE || OWNER_MOBILE_DEFAULT;

/** Digits only, last 10 — the comparison the rest of the codebase uses. */
function last10(phone: unknown): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-10);
}

export function isOwnerNumber(phone: unknown): boolean {
  const digits = last10(phone);
  return digits.length === 10 && digits === last10(OWNER_MOBILE);
}

/**
 * The only number a client may be transferred to or handed. Always the shop —
 * there is deliberately no branch that returns the owner's mobile.
 */
export function transferTarget(): string {
  return SHOP_PHONE;
}

/**
 * Strip Carl's mobile out of anything about to be sent to a client.
 *
 * The model is instructed never to disclose it, but instructions are not a
 * control: this runs on the wire so a hallucinated or quoted number cannot
 * reach a client. Matches the number in any punctuation style — 631-926-0917,
 * (631) 926 0917, +1 631.926.0917 — by comparing digit runs rather than
 * trying to enumerate formats.
 */
export function scrubOwnerContact(text: string): string {
  const ownerDigits = last10(OWNER_MOBILE);
  if (!ownerDigits) return text;

  // Any run of 10+ digits once separators are ignored.
  return String(text ?? "").replace(
    /(?:\+?1[\s.\-]*)?(?:\(\d{3}\)|\d{3})[\s.\-]*\d{3}[\s.\-]*\d{4}/g,
    (match) => (last10(match) === ownerDigits ? SHOP_PHONE : match),
  );
}

/**
 * Place a real voice call to Carl. Used only for severity=emergency
 * escalations — this is Sofia calling Carl, never a client-to-Carl bridge.
 *
 * Voice needs a real From number (a Messaging Service SID does not apply), so
 * TWILIO_VOICE_FROM is preferred and the shop line is the fallback.
 */
export async function placeEmergencyCall(args: {
  summary: string;
  clientName?: string | null;
}): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const from = process.env.TWILIO_VOICE_FROM || SHOP_PHONE;

  if (!accountSid || !authToken) {
    return { ok: false, error: "Twilio voice credentials not configured" };
  }

  const who = args.clientName ? `from ${args.clientName}` : "from a client";
  // Twilio reads this aloud; keep it short and repeat it, since Carl may catch
  // the call mid-sentence.
  const spoken = `Emergency escalation ${who}. ${args.summary}. Again: ${args.summary}.`;
  const twiml =
    `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say voice="Polly.Joanna">` +
    escapeXml(spoken) +
    `</Say></Response>`;

  const params = new URLSearchParams({ To: OWNER_MOBILE, From: from, Twiml: twiml });

  try {
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );
    const data: any = await r.json().catch(() => null);
    if (r.ok && data?.sid) return { ok: true, sid: data.sid };
    return { ok: false, error: data?.message ?? `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
