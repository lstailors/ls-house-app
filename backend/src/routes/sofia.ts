import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";

export const sofiaRouter = new Hono();

// ── GET /api/sofia/conversations ──
// sms_messages is org-wide (no location_id column). Scope by role only: driver=blocked.
sofiaRouter.get("/conversations", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });

  if (!supabaseAdmin) return c.json({ data: [] });

  const { data: messages, error } = await supabaseAdmin
    .from("sms_messages")
    .select("id, client_phone, direction, body, status, agent_name, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error || !messages) return c.json({ data: [] });

  // Group by client_phone into thread summaries
  const threadMap = new Map<string, { phone: string; lastMessage: any; messageCount: number }>();
  for (const msg of messages) {
    if (!msg.client_phone) continue;
    const existing = threadMap.get(msg.client_phone);
    if (!existing) {
      threadMap.set(msg.client_phone, { phone: msg.client_phone, lastMessage: msg, messageCount: 1 });
    } else {
      existing.messageCount++;
      if (new Date(msg.created_at) > new Date(existing.lastMessage.created_at)) {
        existing.lastMessage = msg;
      }
    }
  }

  const threads = Array.from(threadMap.values())
    .map((t) => ({ phone: t.phone, lastMessage: t.lastMessage, messageCount: t.messageCount }))
    .sort((a, b) =>
      new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime(),
    );

  return c.json({ data: threads });
});

// ── GET /api/sofia/conversations/:phone ── full thread
sofiaRouter.get("/conversations/:phone", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ data: [] });

  const phone = decodeURIComponent(c.req.param("phone"));

  const { data: messages, error } = await supabaseAdmin
    .from("sms_messages")
    .select("id, client_phone, direction, body, status, agent_name, created_at")
    .eq("client_phone", phone)
    .order("created_at", { ascending: true });

  if (error) return c.json({ data: [] });
  return c.json({ data: messages ?? [] });
});

// ── POST /api/sofia/conversations/:phone/handoff ──
// Destination: lsh.conversation_handoffs (Supabase service role, schema lsh)
// Columns: handoff_type (text), client_phone (text), taken_over_by (uuid),
//          decision (text), note (text), previous_sofia_state (jsonb)
sofiaRouter.post("/conversations/:phone/handoff", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const phone = decodeURIComponent(c.req.param("phone"));
  const body = await c.req.json().catch(() => ({}));
  const notes = typeof body?.notes === "string" ? body.notes : undefined;

  // Best-effort: find which agent was last active on this phone
  let agentName = "sofia";
  const { data: actRow } = await supabaseAdmin
    .from("sofia2_activity_log")
    .select("agent_name")
    .eq("client_phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (actRow?.agent_name) agentName = actRow.agent_name;

  // Write handoff to lsh.conversation_handoffs
  const { error: insertErr } = await (supabaseAdmin as any)
    .schema("lsh")
    .from("conversation_handoffs")
    .insert({
      handoff_type: "human_takeover",
      client_phone: phone,
      taken_over_by: user.id,   // Better Auth UUID
      decision: "human_takeover",
      note: notes ?? null,
      previous_sofia_state: { agent_name: agentName },
    });

  if (insertErr) {
    console.error("[sofia/handoff] insert error:", insertErr.message);
    return c.json({ error: { message: "Failed to log handoff" } }, 500);
  }

  return c.json({ data: { ok: true, agentName } });
});

// ── GET /api/sofia/threads ── deduplicated thread list (uses real column names)
sofiaRouter.get("/threads", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });

  const { data } = await supabaseAdmin
    .from("sms_messages")
    .select("id, client_id, client_phone, direction, content, timestamp")
    .order("timestamp", { ascending: false })
    .limit(500);

  const seen = new Set<string>();
  const threads = (data ?? []).filter((r: any) => {
    if (!r.client_phone || seen.has(r.client_phone)) return false;
    seen.add(r.client_phone);
    return true;
  }).map((r: any) => ({
    id: r.id,
    client_phone: r.client_phone,
    client_id: r.client_id ?? null,
    direction: r.direction,
    body: r.content,
    created_at: r.timestamp,
  }));

  return c.json({ data: threads });
});

// ── GET /api/sofia/thread/:phone ── full conversation
sofiaRouter.get("/thread/:phone", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });

  const phone = decodeURIComponent(c.req.param("phone"));
  const { data } = await supabaseAdmin
    .from("sms_messages")
    .select("id, client_id, client_phone, direction, content, media_urls, timestamp")
    .eq("client_phone", phone)
    .order("timestamp", { ascending: true })
    .limit(300);

  return c.json({ data: (data ?? []).map((r: any) => ({
    id: r.id,
    client_phone: r.client_phone,
    client_id: r.client_id ?? null,
    direction: r.direction,
    body: r.content,
    media_urls: r.media_urls ?? [],
    created_at: r.timestamp,
  })) });
});

// ── POST /api/sofia/send ── send SMS via Twilio
sofiaRouter.post("/send", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json().catch(() => ({}));
  const { to, message, client_id } = body;
  if (!to || !message) return c.json({ error: { message: "to and message required" } }, 400);

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return c.json({ error: { message: "Twilio not configured" } }, 500);

  const params = new URLSearchParams({ To: to, From: "+12123084431", Body: message });
  const auth = btoa(`${accountSid}:${authToken}`);
  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params }
  );
  const twilioData: any = await twilioRes.json();
  if (!twilioRes.ok) return c.json({ error: { message: twilioData.message ?? "Twilio error" } }, 502);

  if (supabaseAdmin) {
    await supabaseAdmin.from("sms_messages").insert({
      client_phone: to,
      client_id: client_id ?? null,
      direction: "outbound",
      content: message,
      status: "sent",
      timestamp: new Date().toISOString(),
      twilio_sid: twilioData.sid,
    });
  }

  return c.json({ data: { ok: true, sid: twilioData.sid } });
});

// ── GET /api/sofia/voice-approvals ──
// Source: public.voice_approval_requests (separate from approval_queue)
sofiaRouter.get("/voice-approvals", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver" || user.role === "salesperson")
    return c.json({ error: { message: "Forbidden" } }, 403);

  if (!supabaseAdmin) return c.json({ data: [] });

  const { data, error } = await supabaseAdmin
    .from("voice_approval_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return c.json({ data: [] });
  return c.json({ data: data ?? [] });
});
