import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";

// ── Constants ──
const STAFF_PHONES = new Set(["+16319260917", "+16462087809", "+16463637906"]);
const CARL_PHONE = "+16319260917";
const GREETING_WORDS = ["hi", "hello", "hey", "ciao", "good morning", "good afternoon", "good evening"];
const SCHEDULING_WORDS = ["book", "schedule", "appointment", "fitting", "consultation", "visit", "come in", "available", "availability", "slot", "time"];
const ORDER_STATUS_WORDS = ["order", "status", "ready", "when", "alteration", "suit", "shirt", "pants", "jacket", "garment", "pickup", "done"];

// ── xAI Grok helper ──
async function callGrok(messages: { role: string; content: string }[], temperature = 0.7): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return "";
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "grok-3-mini", messages, temperature }),
  });
  if (!res.ok) return "";
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Twilio SMS send helper ──
async function sendSms(to: string, body: string): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const msgSvcSid = process.env.TWILIO_MSG_SERVICE_SID;
  if (!sid || !token) return null;
  const params = new URLSearchParams({ To: to, Body: body });
  if (msgSvcSid) params.set("MessagingServiceSid", msgSvcSid);
  else params.set("From", "+12123084431");
  const auth = btoa(`${sid}:${token}`);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data: any = await res.json();
  return res.ok ? data.sid : null;
}

// ── Slack post helper ──
async function postToSlack(text: string, channel = "C0AV292BK5L"): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel, text }),
  }).catch(() => {});
}

// ── Alert Carl helper ──
async function alertCarl(message: string): Promise<void> {
  const ownerPhone = process.env.OWNER_MOBILE || CARL_PHONE;
  await sendSms(ownerPhone, `[Sofia Alert] ${message}`);
}

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

// ────────────────────────────────────────────────────────────────────────────
// POST /api/sofia/sms  — Twilio webhook (NO auth required)
// ────────────────────────────────────────────────────────────────────────────
sofiaRouter.post("/sms", async (c) => {
  const twimlEmpty = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  try {
    // 1. Parse Twilio form-encoded body
    const formText = await c.req.text();
    const params = new URLSearchParams(formText);
    const fromRaw = params.get("From") ?? "";
    const body = (params.get("Body") ?? "").trim();
    const numMedia = parseInt(params.get("NumMedia") ?? "0", 10);

    // 2. Staff sender → log and return empty TwiML
    if (STAFF_PHONES.has(fromRaw)) {
      console.log(`[sofia/sms] Staff message from ${fromRaw}: ${body}`);
      c.header("Content-Type", "text/xml");
      return c.body(twimlEmpty);
    }

    if (!supabaseAdmin) {
      c.header("Content-Type", "text/xml");
      return c.body(twimlEmpty);
    }

    // 3. Get or create client
    let clientId: string | null = null;
    let isNewClient = false;
    const { data: existingClient } = await supabaseAdmin
      .from("clients")
      .select("id, first_name, last_name")
      .eq("phone", fromRaw)
      .maybeSingle();

    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await supabaseAdmin
        .from("clients")
        .insert({ phone: fromRaw, source: "sms_inbound" })
        .select("id")
        .single();
      if (newClient) {
        clientId = newClient.id;
        isNewClient = true;
        await alertCarl(`New client texted: ${fromRaw}`);
      }
    }

    // 4. Log inbound message
    await supabaseAdmin.from("sms_messages").insert({
      client_phone: fromRaw,
      client_id: clientId,
      direction: "inbound",
      content: body,
      status: "received",
      timestamp: new Date().toISOString(),
      num_media: numMedia > 0 ? numMedia : null,
    });

    // 5. Fetch last 10 messages for history
    const { data: history } = await supabaseAdmin
      .from("sms_messages")
      .select("direction, content, timestamp")
      .eq("client_phone", fromRaw)
      .order("timestamp", { ascending: false })
      .limit(10);

    const conversationHistory = (history ?? [])
      .reverse()
      .map((m: any) => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.content ?? "",
      }));

    // 6. Check for pending_booking_confirmation state
    const { data: activityLog } = await supabaseAdmin
      .from("sofia2_activity_log")
      .select("state, metadata")
      .eq("client_phone", fromRaw)
      .eq("state", "pending_booking_confirmation")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const bodyLower = body.toLowerCase();
    let replyText = "";

    // 7. Handle greetings
    const isGreeting = GREETING_WORDS.some((w) => bodyLower.includes(w));
    if (isGreeting && !replyText) {
      const clientName = existingClient?.first_name ?? null;
      const greeting = clientName ? `Hello ${clientName}` : "Hello";
      replyText = await callGrok([
        {
          role: "system",
          content: `You are Sofia, the concierge assistant for L&S Custom Tailors in New York City. You are warm, professional, and personalized. Keep responses brief (1-2 sentences). Always sign off as Sofia.`,
        },
        ...conversationHistory,
        {
          role: "user",
          content: body,
        },
      ]);
      if (!replyText) {
        replyText = `${greeting}! Welcome to L&S Custom Tailors. How can I assist you today? — Sofia`;
      }
    }

    // 8. Detect scheduling intent
    if (!replyText) {
      const hasSchedulingIntent = SCHEDULING_WORDS.some((w) => bodyLower.includes(w));
      if (hasSchedulingIntent) {
        // Extract intent via Grok
        const intentJson = await callGrok([
          {
            role: "system",
            content: `Extract scheduling intent from the message. Return JSON only: {"wants_appointment": boolean, "preferred_time": string|null, "garment_type": string|null}`,
          },
          { role: "user", content: body },
        ], 0.1);

        let wantsAppointment = false;
        try {
          const intent = JSON.parse(intentJson.replace(/```json\n?|\n?```/g, "").trim());
          wantsAppointment = intent.wants_appointment === true;
        } catch {}

        if (wantsAppointment) {
          replyText = await callGrok([
            {
              role: "system",
              content: `You are Sofia, concierge for L&S Custom Tailors NYC. The client wants to book an appointment. Respond warmly, tell them our hours are Mon-Fri 10am-6pm, Sat 10am-4pm, and ask them for their preferred day/time. Keep it to 2-3 sentences. Sign as Sofia.`,
            },
            ...conversationHistory,
            { role: "user", content: body },
          ]);
        }
      }
    }

    // 9. Detect order status inquiries
    if (!replyText) {
      const hasOrderIntent = ORDER_STATUS_WORDS.some((w) => bodyLower.includes(w));
      if (hasOrderIntent && clientId) {
        const { data: tickets } = await supabaseAdmin
          .from("alteration_tickets")
          .select("ticket_number, status, description, created_at")
          .eq("customer_id", clientId)
          .order("created_at", { ascending: false })
          .limit(5);

        if (tickets && tickets.length > 0) {
          const ticketSummary = tickets
            .map((t: any) => `Ticket #${t.ticket_number}: ${t.status} — ${t.description ?? "alteration"}`)
            .join("; ");

          replyText = await callGrok([
            {
              role: "system",
              content: `You are Sofia, concierge for L&S Custom Tailors NYC. Here are the client's recent tickets: ${ticketSummary}. Summarize the status warmly and professionally in 2-3 sentences. Sign as Sofia.`,
            },
            { role: "user", content: body },
          ]);
        }
      }
    }

    // 10. General concierge fallback — fetch dossier, call Grok
    if (!replyText) {
      let dossierContext = "";
      if (clientId) {
        try {
          const dossierRes = await fetch(`https://dossier.lstailors.com/api/dossier/${clientId}`, {
            signal: AbortSignal.timeout(4000),
          });
          if (dossierRes.ok) {
            const dossierData: any = await dossierRes.json();
            dossierContext = JSON.stringify(dossierData).slice(0, 1000);
          }
        } catch {}
      }

      replyText = await callGrok([
        {
          role: "system",
          content: `You are Sofia, the concierge assistant for L&S Custom Tailors, a bespoke tailoring atelier in New York City. You are warm, knowledgeable, and professional. Keep responses concise (2-3 sentences max). Always sign as Sofia.${dossierContext ? `\n\nClient dossier context: ${dossierContext}` : ""}`,
        },
        ...conversationHistory,
        { role: "user", content: body },
      ]);
    }

    if (!replyText) {
      replyText = "Thank you for reaching out to L&S Custom Tailors. We'll be in touch shortly. — Sofia";
    }

    // 11. Send reply via Twilio
    const outboundSid = await sendSms(fromRaw, replyText);

    // 12. Log outbound message
    await supabaseAdmin.from("sms_messages").insert({
      client_phone: fromRaw,
      client_id: clientId,
      direction: "outbound",
      content: replyText,
      status: outboundSid ? "sent" : "failed",
      agent_name: "sofia",
      timestamp: new Date().toISOString(),
      twilio_sid: outboundSid,
    });

    // 13. Post to Slack #concierge
    await postToSlack(
      `*Sofia SMS* | ${fromRaw}${isNewClient ? " 🆕" : ""}\n*In:* ${body}\n*Out:* ${replyText}`,
      "C0AV292BK5L"
    );

  } catch (err: any) {
    console.error("[sofia/sms] Error:", err?.message ?? err);
    await alertCarl(`SMS handler error: ${err?.message ?? "unknown"}`).catch(() => {});
  }

  c.header("Content-Type", "text/xml");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
});

// ────────────────────────────────────────────────────────────────────────────
// Tasks routes
// ────────────────────────────────────────────────────────────────────────────

// GET /api/sofia/tasks
sofiaRouter.get("/tasks", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });

  const status = c.req.query("status");
  const assignedTo = c.req.query("assigned_to");

  let query = supabaseAdmin
    .from("tasks")
    .select("id, title, description, project, section, assigned_to, assigned_agent, priority, status, is_completed, completed_at, due_date, due_datetime, labels, client_id, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (status) query = query.eq("status", status);
  if (assignedTo) query = query.eq("assigned_to", assignedTo);

  const { data, error } = await query;
  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data: data ?? [] });
});

// POST /api/sofia/tasks
sofiaRouter.post("/tasks", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const body = await c.req.json().catch(() => ({}));
  const { title, description, project, section, assigned_to, assigned_agent, priority, due_date, due_datetime, labels, client_id } = body;

  if (!title) return c.json({ error: { message: "title is required" } }, 400);

  const { data, error } = await supabaseAdmin
    .from("tasks")
    .insert({
      title,
      description: description ?? null,
      project: project ?? "General",
      section: section ?? null,
      assigned_to: assigned_to ?? null,
      assigned_agent: assigned_agent ?? null,
      priority: priority ?? 1,
      status: "open",
      due_date: due_date ?? null,
      due_datetime: due_datetime ?? null,
      labels: labels ?? [],
      client_id: client_id ?? null,
      created_by: user.email ?? "concierge",
    })
    .select()
    .single();

  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data }, 201);
});

// PATCH /api/sofia/tasks/:id
sofiaRouter.patch("/tasks/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);

  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const { status, assigned_to, assigned_agent, priority, due_date, due_datetime, title, description } = body;

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (status !== undefined) {
    updates.status = status;
    if (status === "completed") {
      updates.is_completed = true;
      updates.completed_at = new Date().toISOString();
      updates.completed_by = user.email ?? user.id;
    }
  }
  if (assigned_to !== undefined) updates.assigned_to = assigned_to;
  if (assigned_agent !== undefined) updates.assigned_agent = assigned_agent;
  if (priority !== undefined) updates.priority = priority;
  if (due_date !== undefined) updates.due_date = due_date;
  if (due_datetime !== undefined) updates.due_datetime = due_datetime;
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;

  const { data, error } = await supabaseAdmin
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return c.json({ error: { message: error.message } }, 500);
  return c.json({ data });
});
