import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";

export const commsRouter = new Hono();

commsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: null });

  const [callsRes, recordingsRes, smsRes] = await Promise.all([
    supabaseAdmin
      .from("unifi_call_logs")
      .select("id, time, from, to, from_caller_name, direction, duration, status, transcript_raw, sensitivity_flag")
      .order("time", { ascending: false })
      .limit(150),
    supabaseAdmin
      .from("plaud_captures")
      .select("id, recorded_at, duration_seconds, detected_customer_names, summary_raw, transcript_raw, detected_type, status")
      .order("recorded_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("sms_messages")
      .select("id, client_phone, client_id, direction, content, timestamp")
      .order("timestamp", { ascending: false })
      .limit(100),
  ]);

  return c.json({
    data: {
      calls: callsRes.data ?? [],
      recordings: recordingsRes.data ?? [],
      sms: smsRes.data ?? [],
      generatedAt: new Date().toISOString(),
    },
  });
});
