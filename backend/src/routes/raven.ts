import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope.js";
import { supabaseAdmin } from "../lib/supabase.js";

export const ravenRouter = new Hono();

const ERP_BASE = "https://erp.lstailors.com";

// Sofia's Raven DM channel with Carl
const SOFIA_DM_CHANNEL = "b56k4sapbj";
const CARL_EMAIL = "carl@lstailors.com";
const SOFIA_EMAIL = "concierge@lstailors.com";

// Carl's API credentials for posting as Sofia
function carlAuthHeader(): string {
  const key = process.env.ERPNEXT_CARL_API_KEY ?? "0c3a223606ede7c";
  const secret = process.env.ERPNEXT_CARL_API_SECRET ?? "cd4fd503416f673";
  return `token ${key}:${secret}`;
}

// Grok identity for Raven/staff context
const STAFF_GROK_IDENTITY =
  'IDENTITY (non-negotiable): You are Sofia, the AI assistant for L&S Custom Tailors. You run on Grok by xAI. You are NOT Claude, NOT GPT, NOT Gemini. If anyone asks what AI you are, say: "I\'m Sofia - L&S\'s AI, built on Grok by xAI."\n\n';

// Post a message to Raven as Sofia (using Carl's API key so concierge@lstailors.com is owner)
async function postRavenMessage(channelId: string, text: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  try {
    const res = await fetch(`${ERP_BASE}/api/resource/Raven%20Message`, {
      method: "POST",
      headers: {
        Authorization: carlAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel_id: channelId,
        text,
        message_type: "Text",
        owner: SOFIA_EMAIL,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Raven ${res.status}: ${txt.slice(0, 200)}` };
    }
    const json: any = await res.json();
    return { ok: true, name: json?.data?.name ?? json?.name };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// Fetch recent messages from a Raven channel using Carl's creds
async function fetchRavenMessages(channelId: string, limit = 20): Promise<any[]> {
  const fields = JSON.stringify(["name", "channel_id", "text", "owner", "creation", "message_type"]);
  const filters = JSON.stringify([["channel_id", "=", channelId]]);
  const url = `${ERP_BASE}/api/resource/Raven%20Message?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=creation%20desc&limit=${limit}`;
  const res = await fetch(url, { headers: { Authorization: carlAuthHeader() } });
  if (!res.ok) return [];
  const json: any = await res.json();
  return json?.data ?? [];
}

// Core Sofia-for-staff Grok call
async function callGrokStaff(messages: { role: string; content: string }[]): Promise<string> {
  const XAI_KEY = process.env.XAI_API_KEY ?? "";
  const systemPrompt =
    STAFF_GROK_IDENTITY +
    `You are Sofia, AI assistant for L&S Custom Tailors. Carl is your operator and boss.
You have access to ERPNext data, client records, appointments, alteration tickets, and SMS threads.
When Carl gives you an instruction, execute it. Keep replies concise — this is a Raven DM, not email.
You can reference client info, check order status, check appointments, and help Carl manage the shop.
Be direct, brief, and professional. Address Carl as "C" or by name only if needed. Sign replies as — Sofia`;

  try {
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${XAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.20-0309-non-reasoning",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        max_tokens: 600,
        temperature: 0.3,
      }),
    });
    const data: any = await r.json();
    return (data?.choices?.[0]?.message?.content ?? "").trim() || "I couldn't process that — please try again.";
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

function erpAuthHeader(): string {
  const key = process.env.ERPNEXT_API_KEY;
  const secret = process.env.ERPNEXT_API_SECRET;
  return `token ${key}:${secret}`;
}

async function erpGet(path: string): Promise<any> {
  const res = await fetch(`${ERP_BASE}${path}`, {
    headers: { Authorization: erpAuthHeader() },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ERPNext error ${res.status}: ${text}`);
  }
  return res.json();
}

async function erpPost(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${ERP_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: erpAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ERPNext error ${res.status}: ${text}`);
  }
  return res.json();
}

// GET /api/raven/channels
ravenRouter.get("/channels", async (c) => {
  await getAuthedUser(c);
  const fields = JSON.stringify(["name", "channel_name", "type", "is_archived", "workspace"]);
  const filters = JSON.stringify([["is_archived", "=", 0]]);
  const json = await erpGet(
    `/api/resource/Raven%20Channel?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit=50`
  );
  const channels = (json.data ?? []).map((ch: any) => ({
    name: ch.name,
    channel_name: ch.channel_name,
    type: ch.type,
    workspace: ch.workspace,
  }));
  return c.json({ data: channels });
});

// GET /api/raven/channels/:channelId/messages
ravenRouter.get("/channels/:channelId/messages", async (c) => {
  await getAuthedUser(c);
  const channelId = decodeURIComponent(c.req.param("channelId"));
  const limit = Number(c.req.query("limit") ?? 50);
  const start = Number(c.req.query("start") ?? 0);
  const fields = JSON.stringify([
    "name",
    "channel_id",
    "text",
    "owner",
    "creation",
    "message_type",
    "file_thumbnail_width",
    "file_thumbnail_height",
  ]);
  const filters = JSON.stringify([["channel_id", "=", channelId]]);
  const json = await erpGet(
    `/api/resource/Raven%20Message?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=creation%20asc&limit=${limit}&limit_start=${start}`
  );
  const messages = (json.data ?? []).map((m: any) => ({
    name: m.name,
    channel_id: m.channel_id,
    text: m.text,
    owner: m.owner,
    creation: m.creation,
    message_type: m.message_type,
  }));
  return c.json({ data: messages });
});

// POST /api/raven/channels/:channelId/messages
ravenRouter.post("/channels/:channelId/messages", async (c) => {
  const user = await getAuthedUser(c);
  const channelId = decodeURIComponent(c.req.param("channelId"));
  const body = await c.req.json<{ text: string }>();
  const json = await erpPost("/api/resource/Raven%20Message", {
    channel_id: channelId,
    text: body.text,
    message_type: "Text",
    owner: user?.email ?? SOFIA_EMAIL,
  });
  const doc = json.data ?? json;
  return c.json({
    data: {
      name: doc.name,
      text: doc.text,
      creation: doc.creation,
    },
  });
});

// GET /api/raven/users
ravenRouter.get("/users", async (c) => {
  await getAuthedUser(c);
  const fields = JSON.stringify(["name", "full_name", "user"]);
  const json = await erpGet(
    `/api/resource/Raven%20User?fields=${encodeURIComponent(fields)}&limit=50`
  );
  return c.json({ data: json.data ?? [] });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/raven/sofia-poll
// Called every minute by Vercel cron. Checks Sofia's DM channel with Carl,
// finds Carl messages that don't yet have a Sofia reply, and replies via Grok.
// No auth required (called internally by cron).
// ────────────────────────────────────────────────────────────────────────────
ravenRouter.get("/sofia-poll", async (c) => {
  try {
    const sb = supabaseAdmin;

    // 1. Fetch last 20 messages from the DM channel (desc = newest first)
    const msgs = await fetchRavenMessages(SOFIA_DM_CHANNEL, 20);
    if (!msgs.length) return c.json({ data: { ok: true, processed: 0, reason: "no_messages" } });

    // msgs is newest-first from Raven; reverse to get chronological order
    const chronological = [...msgs].reverse();

    // 2. Find Carl messages that don't have a Sofia reply immediately after them
    const toProcess: any[] = [];
    for (let i = 0; i < chronological.length; i++) {
      const msg = chronological[i];
      if (msg.owner !== CARL_EMAIL) continue;
      // Check if the next message is from Sofia
      const next = chronological[i + 1];
      if (next && next.owner === SOFIA_EMAIL) continue; // already replied
      // Check Supabase: has this message already been processed?
      if (sb) {
        const { data: existing } = await sb
          .from("sms_messages")
          .select("id")
          .eq("twilio_sid", `raven_${msg.name}`)
          .limit(1);
        if (existing && existing.length > 0) continue; // already handled
      }
      toProcess.push(msg);
    }

    if (!toProcess.length) return c.json({ data: { ok: true, processed: 0, reason: "no_new_messages" } });

    // 3. Process each unhandled Carl message
    let processed = 0;
    for (const msg of toProcess) {
      const messageText = String(msg.text ?? "").trim();
      if (!messageText) continue;

      // Log inbound to sms_messages
      if (sb) {
        try {
          await sb.from("sms_messages").insert({
            twilio_sid: `raven_${msg.name}`,
            client_phone: CARL_EMAIL,
            direction: "inbound",
            content: messageText,
            timestamp: new Date(msg.creation ?? Date.now()).toISOString(),
            metadata: { channel: "raven_dm", raven_channel_id: SOFIA_DM_CHANNEL, raven_msg_id: msg.name },
          });
        } catch {}
      }

      // Build conversation history from sms_messages for context
      const historyMsgs: { role: string; content: string }[] = [];
      if (sb) {
        const { data: hist } = await sb
          .from("sms_messages")
          .select("direction, content")
          .eq("client_phone", CARL_EMAIL)
          .not("twilio_sid", "eq", `raven_${msg.name}`)
          .order("timestamp", { ascending: false })
          .limit(10);
        if (hist) {
          hist.reverse().forEach((h: any) => {
            historyMsgs.push({
              role: h.direction === "inbound" ? "user" : "assistant",
              content: String(h.content),
            });
          });
        }
      }

      // Add current message
      historyMsgs.push({ role: "user", content: messageText });

      // Call Grok
      const reply = await callGrokStaff(historyMsgs);

      // Post reply to Raven DM channel
      const postResult = await postRavenMessage(SOFIA_DM_CHANNEL, reply);

      // Log outbound to sms_messages
      if (sb) {
        try {
          await sb.from("sms_messages").insert({
            twilio_sid: postResult.name ? `raven_out_${postResult.name}` : null,
            client_phone: CARL_EMAIL,
            direction: "outbound",
            content: reply,
            timestamp: new Date().toISOString(),
            metadata: { channel: "raven_dm", raven_channel_id: SOFIA_DM_CHANNEL, in_reply_to: msg.name, raven_ok: postResult.ok },
          });
        } catch {}
      }

      processed++;
    }

    return c.json({ data: { ok: true, processed } });
  } catch (e: any) {
    console.error("[raven/sofia-poll] error:", e.message);
    return c.json({ data: { ok: false, error: e.message } }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/raven/sofia-webhook
// Webhook variant of the poll — same logic, accepts a push from external caller.
// No auth required (internal use).
// ────────────────────────────────────────────────────────────────────────────
ravenRouter.post("/sofia-webhook", async (c) => {
  // Delegate to the same poll logic by making an internal call
  // (reuse by just running the poll inline)
  try {
    const sb = supabaseAdmin;
    const msgs = await fetchRavenMessages(SOFIA_DM_CHANNEL, 20);
    if (!msgs.length) return c.json({ data: { ok: true, processed: 0 } });

    const chronological = [...msgs].reverse();
    const toProcess: any[] = [];
    for (let i = 0; i < chronological.length; i++) {
      const msg = chronological[i];
      if (msg.owner !== CARL_EMAIL) continue;
      const next = chronological[i + 1];
      if (next && next.owner === SOFIA_EMAIL) continue;
      if (sb) {
        const { data: existing } = await sb
          .from("sms_messages")
          .select("id")
          .eq("twilio_sid", `raven_${msg.name}`)
          .limit(1);
        if (existing && existing.length > 0) continue;
      }
      toProcess.push(msg);
    }

    let processed = 0;
    for (const msg of toProcess) {
      const messageText = String(msg.text ?? "").trim();
      if (!messageText) continue;
      if (sb) {
        try {
          await sb.from("sms_messages").insert({
            twilio_sid: `raven_${msg.name}`,
            client_phone: CARL_EMAIL,
            direction: "inbound",
            content: messageText,
            timestamp: new Date(msg.creation ?? Date.now()).toISOString(),
            metadata: { channel: "raven_dm", raven_channel_id: SOFIA_DM_CHANNEL, raven_msg_id: msg.name },
          });
        } catch {}
      }
      const historyMsgs: { role: string; content: string }[] = [];
      if (sb) {
        const { data: hist } = await sb
          .from("sms_messages")
          .select("direction, content")
          .eq("client_phone", CARL_EMAIL)
          .not("twilio_sid", "eq", `raven_${msg.name}`)
          .order("timestamp", { ascending: false })
          .limit(10);
        if (hist) hist.reverse().forEach((h: any) => historyMsgs.push({ role: h.direction === "inbound" ? "user" : "assistant", content: String(h.content) }));
      }
      historyMsgs.push({ role: "user", content: messageText });
      const reply = await callGrokStaff(historyMsgs);
      const postResult = await postRavenMessage(SOFIA_DM_CHANNEL, reply);
      if (sb) {
        try {
          await sb.from("sms_messages").insert({
            twilio_sid: postResult.name ? `raven_out_${postResult.name}` : null,
            client_phone: CARL_EMAIL,
            direction: "outbound",
            content: reply,
            timestamp: new Date().toISOString(),
            metadata: { channel: "raven_dm", raven_channel_id: SOFIA_DM_CHANNEL, in_reply_to: msg.name, raven_ok: postResult.ok },
          });
        } catch {}
      }
      processed++;
    }
    return c.json({ data: { ok: true, processed } });
  } catch (e: any) {
    console.error("[raven/sofia-webhook] error:", e.message);
    return c.json({ data: { ok: false, error: e.message } }, 500);
  }
});
