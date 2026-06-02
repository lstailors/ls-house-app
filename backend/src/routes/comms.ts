import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpCreate } from "../lib/erp";

// ── Log communication to ERPNext Customer timeline ────────────────────────
export async function logErpCommunication(opts: {
  customerId: string;
  medium: "Phone" | "SMS" | "Meeting" | "Other";
  subject: string;
  content: string;
  direction: "Sent" | "Received";
  date?: string;
  phoneNo?: string;
}): Promise<void> {
  await erpCreate("Communication", {
    communication_type: "Communication",
    communication_medium: opts.medium,
    subject: opts.subject,
    content: opts.content,
    sent_or_received: opts.direction,
    communication_date: opts.date ?? new Date().toISOString(),
    phone_no: opts.phoneNo ?? null,
    reference_doctype: "Customer",
    reference_name: opts.customerId,
    status: "Linked",
  }).catch(e => console.error("[comms/erp] Communication log failed:", e.message));
}

export const commsRouter = new Hono();

// ── Customer matching helper ──────────────────────────────────────────────
export async function matchCustomerByPhone(phone: string): Promise<{ name: string; id: string } | null> {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, "").slice(-10);
  const results = await erpList<any>("Customer", {
    filters: [["mobile_no", "like", `%${clean}`]],
    fields: ["name", "customer_name"],
    limit: 1,
  }).catch(() => []);
  if (results.length) return { id: results[0].name, name: results[0].customer_name };
  return null;
}

// ── GET /api/comms — main feed ─────────────────────────────────────────────
commsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: null });

  const limit = Number(c.req.query("limit") ?? "100");
  const todayStr = new Date().toISOString().slice(0, 10);

  const [callsRes, recordingsRes, smsRes] = await Promise.all([
    supabaseAdmin
      .from("unifi_call_logs")
      .select("id, time, from, to, from_caller_name, direction, duration, status, transcript_raw, transcript_summary, recording_url, sensitivity_flag")
      .order("time", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("plaud_captures")
      .select("id, recorded_at, duration_seconds, detected_customer_names, summary_raw, transcript_raw, detected_type, status, title")
      .order("recorded_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("sms_messages")
      .select("id, client_phone, client_id, direction, content, timestamp, body")
      .order("timestamp", { ascending: false })
      .limit(limit),
  ]);

  const calls = (callsRes.data ?? []) as any[];
  const recordings = (recordingsRes.data ?? []) as any[];
  const sms = (smsRes.data ?? []) as any[];

  // Group SMS by phone number (threads)
  type SmsThread = { phone: string; messages: any[]; lastMessage: any; unread: number };
  const threadMap = new Map<string, SmsThread>();
  for (const msg of sms) {
    const phone = msg.client_phone ?? "unknown";
    const thread: SmsThread = threadMap.get(phone) ?? { phone, messages: [] as any[], lastMessage: msg, unread: 0 };
    thread.messages.push(msg);
    if (!thread.lastMessage || new Date(msg.timestamp) > new Date(thread.lastMessage.timestamp)) {
      thread.lastMessage = msg;
    }
    if (msg.direction === "inbound") thread.unread++;
    threadMap.set(phone, thread);
  }
  const smsThreads = Array.from(threadMap.values())
    .sort((a, b) => new Date(b.lastMessage.timestamp).getTime() - new Date(a.lastMessage.timestamp).getTime());

  // Build unified timeline
  const timeline: any[] = [
    ...calls.map(call => ({ type: "call", ts: call.time, data: call })),
    ...recordings.map(r => ({ type: "recording", ts: r.recorded_at, data: r })),
    ...smsThreads.map(t => ({ type: "sms_thread", ts: t.lastMessage.timestamp, data: t })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const callsToday = calls.filter(call => call.time?.startsWith(todayStr)).length;
  const missedCalls = calls.filter(call => call.status === "missed").length;

  return c.json({
    data: {
      calls,
      recordings,
      smsThreads,
      timeline,
      counts: {
        callsToday,
        missedCalls,
        totalRecordings: recordings.length,
        smsThreads: smsThreads.length,
        unreadSms: smsThreads.reduce((s, t) => s + t.unread, 0),
      },
      generatedAt: new Date().toISOString(),
    },
  });
});

// ── GET /api/comms/thread/:phone — SMS thread ──────────────────────────────
commsRouter.get("/thread/:phone", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: [] });
  const phone = decodeURIComponent(c.req.param("phone"));
  const { data } = await supabaseAdmin.from("sms_messages")
    .select("*").eq("client_phone", phone)
    .order("timestamp", { ascending: true }).limit(200);
  const customer = await matchCustomerByPhone(phone);
  return c.json({ data: { messages: data ?? [], customer } });
});

// ── GET /api/comms/calls/:id — single call ─────────────────────────────────
commsRouter.get("/calls/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: null });
  const { data } = await supabaseAdmin.from("unifi_call_logs").select("*").eq("id", c.req.param("id")).single();
  const customer = data ? await matchCustomerByPhone(data.from) : null;
  return c.json({ data: { ...data, customer } });
});

// ── GET /api/comms/recordings/:id — single recording ──────────────────────
commsRouter.get("/recordings/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ data: null });
  const { data } = await supabaseAdmin.from("plaud_captures").select("*").eq("id", c.req.param("id")).single();
  return c.json({ data });
});

// ── POST /api/comms/brief/:phone — Grok brief for customer ─────────────────
commsRouter.post("/brief/:phone", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const phone = decodeURIComponent(c.req.param("phone"));
  if (!supabaseAdmin) return c.json({ data: { brief: "Supabase not available" } });

  const [smsRes, callsRes] = await Promise.all([
    supabaseAdmin.from("sms_messages").select("direction, content, timestamp").eq("client_phone", phone).order("timestamp", { ascending: false }).limit(20),
    supabaseAdmin.from("unifi_call_logs").select("time, direction, duration, transcript_raw, transcript_summary, from_caller_name").or(`from.eq.${phone},to.eq.${phone}`).order("time", { ascending: false }).limit(10),
  ]);

  const customer = await matchCustomerByPhone(phone);
  const sms = smsRes.data ?? [];
  const calls = callsRes.data ?? [];

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return c.json({ data: { brief: "AI not configured" } });

  const context = [
    customer ? `Customer: ${customer.name} (${customer.id})` : `Phone: ${phone}`,
    `Recent SMS (${sms.length}): ${sms.slice(0, 5).map((m: any) => `[${m.direction}] ${m.content?.slice(0, 80)}`).join(" | ")}`,
    `Calls (${calls.length}): ${calls.slice(0, 3).map((call: any) => `${call.direction} ${Math.round((call.duration || 0) / 60)}min ${call.transcript_summary || call.transcript_raw?.slice(0, 100) || ""}`).join(" | ")}`,
  ].join("\n");

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-3-mini",
      messages: [{ role: "user", content: `You are briefing the owner of L&S Custom Tailors about a customer. Be direct and specific. 3-5 sentences max. Include: last contact, what was discussed, any commitments or follow-ups needed.\n\nContext:\n${context}` }],
      max_tokens: 250, temperature: 0.4,
    }),
  });
  const grokData = await res.json() as any;
  const brief = grokData?.choices?.[0]?.message?.content?.trim() ?? "Unable to generate brief.";
  return c.json({ data: { brief, customer } });
});
