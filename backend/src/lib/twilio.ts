const CARL_PHONE = "+16319260917";

export async function sendSms(to: string, body: string, mediaUrl?: string): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const msgSvcSid = process.env.TWILIO_MSG_SERVICE_SID;
  if (!sid || !token) return null;
  const params = new URLSearchParams({ To: to, Body: body });
  if (msgSvcSid) params.set("MessagingServiceSid", msgSvcSid);
  else params.set("From", "+12123084431");
  if (mediaUrl) params.set("MediaUrl0", mediaUrl);
  const auth = btoa(`${sid}:${token}`);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data: any = await res.json();
  return res.ok ? data.sid : null;
}

export async function alertCarl(message: string): Promise<void> {
  const ownerPhone = process.env.OWNER_MOBILE || CARL_PHONE;
  await sendSms(ownerPhone, `[Sofia Alert] ${message}`);
}
