const CARL_PHONE = "+16319260917";
import { dispatchSms } from "./outbound";

export async function sendSms(
  to: string,
  body: string,
  mediaUrl?: string,
  source = "twilio.sendSms",
): Promise<string | null> {
  const result = await dispatchSms({ to, body, mediaUrl, source });
  return result.sid;
}

export async function alertCarl(message: string): Promise<void> {
  const ownerPhone = process.env.OWNER_MOBILE || CARL_PHONE;
  await sendSms(ownerPhone, `[Sofia Alert] ${message}`, undefined, "alertCarl");
}
