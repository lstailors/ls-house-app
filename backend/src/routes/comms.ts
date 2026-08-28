import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { canShowTestData, isTestSmsBody, phoneKey } from "../lib/ops-mode";
import { canReadVoiceNote, isHouseVisibleVoice } from "../lib/voice-privacy";
import { erpList, erpCreate, erpRunMethod } from "../lib/erp";
import {
  listCallLogs,
  getCallLog,
  listPlaudCaptures,
  getPlaudCapture,
  listSmsMessagesFiltered,
  insertAgentBrief,
  insertSmsMessage,
} from "../lib/erpnext/agents";
import { requireCronOrSession } from "../lib/require-secret";
import { resolveCustomerByPhone } from "../lib/identity-resolve";
import { getCommsEvents } from "../lib/comms-events";
import {
  DeskChannel,
  DeskPerson,
  fmtE164ish,
  isNoiseCall,
  isNoiseSms,
  isOwnerPhone,
  previewClean,
  recordingPlayUrl,
  resolveCallTranscript,
  tsMs,
} from "../lib/messages-desk";

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

// ── Customer matching — single house resolver (Phase 0 identity) ──────────
export async function matchCustomerByPhone(phone: string): Promise<{ name: string; id: string } | null> {
  const hit = await resolveCustomerByPhone(phone);
  if (!hit) return null;
  return { id: hit.id, name: hit.name };
}

// ── GET /api/comms/events — Phase 1 unified feed (customer-keyed) ─────────
// Query: customer=ERP_ID | phone=E164 · source=all|sms|call|plaud · limit · since
commsRouter.get("/events", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const customer = c.req.query("customer") || null;
  const phone = c.req.query("phone") || null;
  if (!customer && !phone) {
    return c.json({ error: { message: "customer or phone required" } }, 400);
  }

  const data = await getCommsEvents({
    customer,
    phone,
    source: c.req.query("source") || "all",
    limit: Number(c.req.query("limit") ?? "100"),
    since: c.req.query("since") || null,
    role: user.role,
  });

  return c.json({
    data: {
      ...data,
      generatedAt: new Date().toISOString(),
    },
  });
});

// Alias for timeline UI / Sofia brain
commsRouter.get("/customer/:customerId/timeline", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const customerId = decodeURIComponent(c.req.param("customerId"));
  const data = await getCommsEvents({
    customer: customerId,
    source: c.req.query("source") || "all",
    limit: Number(c.req.query("limit") ?? "100"),
    since: c.req.query("since") || null,
    role: user.role,
  });
  return c.json({ data: { ...data, generatedAt: new Date().toISOString() } });
});

// ── GET /api/comms — main feed ─────────────────────────────────────────────
commsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const limit = Number(c.req.query("limit") ?? "100");
  const todayStr = new Date().toISOString().slice(0, 10);

  const [calls, recordingsRaw, sms] = await Promise.all([
    listCallLogs({ limit }),
    listPlaudCaptures({ limit: 50 }),
    listSmsMessagesFiltered({ limit }),
  ]);

  const showTest = canShowTestData({
    role: user.role,
    showTest: c.req.query("showTest") === "1",
  });
  const recordings = recordingsRaw.filter(isHouseVisibleVoice);
  const smsVisible = sms.filter((m) => {
    if (showTest) return true;
    if (isTestSmsBody(m.content || m.body)) return false;
    return true;
  });

  // Group SMS by phone number (threads)
  type SmsThread = { phone: string; messages: any[]; lastMessage: any; unread: number };
  const threadMap = new Map<string, SmsThread>();
  for (const msg of smsVisible) {
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
    ...calls.map((call: any) => ({ type: "call", ts: call.time, data: { ...call, id: call.name } })),
    ...recordings.map((r: any) => ({ type: "recording", ts: r.recorded_at, data: { ...r, id: r.name } })),
    ...smsThreads.map(t => ({ type: "sms_thread", ts: t.lastMessage.timestamp, data: t })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  // ── Rich stats ───────────────────────────────────────────────────────────
  const todayCalls = calls.filter(c => c.time?.startsWith(todayStr));
  const missedCalls = calls.filter(c => c.status === "missed");
  const answeredCalls = calls.filter(c => c.status === "accepted" || c.status === "answered");
  const totalDuration = calls.reduce((s, c) => s + (c.duration || 0), 0);
  const avgDuration = answeredCalls.length ? Math.round(totalDuration / answeredCalls.length) : 0;
  const todayTalkTime = todayCalls.reduce((s, c) => s + (c.duration || 0), 0);

  // Top callers (by frequency)
  const callerCount = new Map<string, { name: string; count: number; phone: string }>();
  for (const c of calls) {
    const phone = c.from || "unknown";
    const name = c.from_caller_name || phone;
    const entry = callerCount.get(phone) ?? { name, count: 0, phone };
    entry.count++;
    callerCount.set(phone, entry);
  }
  const topCallers = [...callerCount.values()].sort((a, b) => b.count - a.count).slice(0, 5);

  // Calls by hour today (for heatmap)
  const callsByHour: Record<number, number> = {};
  for (const c of todayCalls) {
    if (!c.time) continue;
    const h = new Date(c.time).getHours();
    callsByHour[h] = (callsByHour[h] ?? 0) + 1;
  }

  // Latest daily brief from lsh.agent_briefs
  let dailyBrief = null;
  try {
    const { listAgentBriefsFiltered } = await import("../lib/erpnext/agents");
    const briefRows = await listAgentBriefsFiltered({ source: "comms-daily", limit: 1 });
    dailyBrief = briefRows[0] ? { title: briefRows[0].title, body: briefRows[0].body, created_at: briefRows[0].creation } : null;
  } catch { /* non-fatal */ }

  return c.json({
    data: {
      calls,
      recordings,
      smsThreads,
      timeline,
      counts: {
        callsToday: todayCalls.length,
        missedCalls: missedCalls.length,
        answeredCalls: answeredCalls.length,
        totalRecordings: recordings.length,
        smsThreads: smsThreads.length,
        unreadSms: smsThreads.reduce((s, t) => s + t.unread, 0),
        avgDuration,
        todayTalkTime,
        missedRate: calls.length ? Math.round((missedCalls.length / calls.length) * 100) : 0,
        topCallers,
        callsByHour,
      },
      dailyBrief,
      generatedAt: new Date().toISOString(),
    },
  });
});

// ── SPEC 081: GET /api/comms/inbox — people-ranked floor desk ─────────────
commsRouter.get("/inbox", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const filter = (c.req.query("filter") || "needs_you").toLowerCase();
  const noise = (c.req.query("noise") || "hide").toLowerCase();
  const showNoise = noise === "show";
  const limit = Math.min(Number(c.req.query("limit") ?? "120") || 120, 250);
  const doneKeys = new Set(
    String(c.req.query("done") || "")
      .split(",")
      .map((s) => phoneKey(s))
      .filter((k) => k.length >= 10),
  );

  const [smsRaw, callsRaw] = await Promise.all([
    listSmsMessagesFiltered({ limit: Math.min(limit * 3, 400) }),
    listCallLogs({ limit: Math.min(limit * 2, 250) }),
  ]);

  const sms = showNoise
    ? smsRaw
    : smsRaw.filter((m) => !isNoiseSms(m) && !isTestSmsBody(m.content || m.body));
  const calls = showNoise ? callsRaw : callsRaw.filter((call) => !isNoiseCall(call));

  type Agg = {
    phone: string;
    phone_key: string;
    customer_id: string | null;
    customer_name: string | null;
    last_at_ms: number;
    last_at: string | null;
    preview: string;
    channels: Set<DeskChannel>;
    via_shop_line: boolean;
    last_client_ms: number;
    last_house_ms: number;
    inbound_since_house: number;
    last_direction: string | null;
  };

  const map = new Map<string, Agg>();

  const touch = (phoneRaw: string | null | undefined): Agg | null => {
    const key = phoneKey(phoneRaw);
    if (key.length < 10) return null;
    const phone = fmtE164ish(phoneRaw || key);
    let a = map.get(key);
    if (!a) {
      a = {
        phone,
        phone_key: key,
        customer_id: null,
        customer_name: null,
        last_at_ms: 0,
        last_at: null,
        preview: "",
        channels: new Set(),
        via_shop_line: false,
        last_client_ms: 0,
        last_house_ms: 0,
        inbound_since_house: 0,
        last_direction: null,
      };
      map.set(key, a);
    }
    return a;
  };

  for (const m of sms) {
    const a = touch(m.client_phone);
    if (!a) continue;
    const at = tsMs(m.timestamp || m.creation);
    const body = previewClean(m.content || m.body, 110);
    const inbound = String(m.direction || "").toLowerCase() === "inbound";
    if (inbound) {
      a.last_client_ms = Math.max(a.last_client_ms, at);
      if (at >= a.last_house_ms) a.inbound_since_house += 1;
    } else {
      a.last_house_ms = Math.max(a.last_house_ms, at);
    }
    if (String(m.context_tag || "").includes("unifi")) a.via_shop_line = true;
    if (m.customer && !a.customer_id) a.customer_id = String(m.customer);
    if (m.client_name && !a.customer_name) a.customer_name = String(m.client_name);
    a.channels.add("sms");
    if (at >= a.last_at_ms) {
      a.last_at_ms = at;
      a.last_at = m.timestamp || m.creation || null;
      a.preview = inbound ? body : body ? `Sofia: ${body}` : a.preview;
      a.last_direction = inbound ? "inbound" : "outbound";
    }
  }

  for (const call of calls) {
    const a = touch(call.from || call.to);
    if (!a) continue;
    const at = tsMs(call.time || call.creation);
    const st = String(call.status || "").toLowerCase();
    if (st === "missed") a.channels.add("missed");
    else if (st === "voicemail") a.channels.add("vm");
    else a.channels.add("call");
    // treat missed/vm/failed as client activity needing follow-up
    if (st === "missed" || st === "voicemail" || st === "emergency" || st === "failed") {
      a.last_client_ms = Math.max(a.last_client_ms, at);
    }
    if (call.customer && !a.customer_id) a.customer_id = String(call.customer);
    if (call.from_caller_name && !a.customer_name) a.customer_name = String(call.from_caller_name);
    if (at >= a.last_at_ms) {
      a.last_at_ms = at;
      a.last_at = call.time || call.creation || null;
      const tx = resolveCallTranscript(call);
      if (st === "missed") a.preview = "Missed call";
      else if (st === "voicemail")
        a.preview = previewClean(tx.summary || tx.full || "Voicemail", 110);
      else
        a.preview = previewClean(
          tx.summary || tx.summary_bullets[0] || tx.full || (tx.pending ? "Call · transcript pending" : "Call"),
          110,
        );
      a.last_direction = "call";
    }
  }

  // Enrich missing names (bounded)
  const needName = [...map.values()].filter((a) => !a.customer_name).slice(0, 40);
  await Promise.all(
    needName.map(async (a) => {
      const hit = await matchCustomerByPhone(a.phone).catch(() => null);
      if (hit) {
        a.customer_id = hit.id;
        a.customer_name = hit.name;
      }
    }),
  );

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  let people: DeskPerson[] = [...map.values()].map((a) => {
    const done = doneKeys.has(a.phone_key);
    const needs =
      !done &&
      a.last_client_ms > 0 &&
      a.last_client_ms > a.last_house_ms;
    const channels = [...a.channels].slice(0, 3) as DeskChannel[];
    return {
      phone: a.phone,
      phone_key: a.phone_key,
      customer_id: a.customer_id,
      customer_name: a.customer_name,
      preview: a.preview || "No messages",
      last_at: a.last_at,
      needs_you: needs,
      unread_count: needs ? Math.max(1, a.inbound_since_house || 1) : 0,
      channels,
      via_shop_line: a.via_shop_line,
      last_direction: a.last_direction,
    };
  });

  const counts = {
    needs_you: people.filter((p) => p.needs_you).length,
    texts: people.filter((p) => p.channels.includes("sms")).length,
    calls: people.filter((p) => p.channels.some((c) => c === "call" || c === "missed" || c === "vm")).length,
    today: people.filter((p) => tsMs(p.last_at) >= todayMs).length,
    all: people.length,
  };

  if (filter === "needs_you") people = people.filter((p) => p.needs_you);
  else if (filter === "texts") people = people.filter((p) => p.channels.includes("sms"));
  else if (filter === "calls")
    people = people.filter((p) => p.channels.some((c) => c === "call" || c === "missed" || c === "vm"));
  else if (filter === "today") people = people.filter((p) => tsMs(p.last_at) >= todayMs);

  people.sort((a, b) => {
    if (a.needs_you !== b.needs_you) return a.needs_you ? -1 : 1;
    return tsMs(b.last_at) - tsMs(a.last_at);
  });

  people = people.slice(0, limit);

  return c.json({
    data: {
      people,
      counts,
      filter,
      noise: showNoise ? "show" : "hide",
      generatedAt: new Date().toISOString(),
    },
  });
});

// ── SPEC 081: GET /api/comms/thread/:phone — unified timeline ─────────────
commsRouter.get("/thread/:phone", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const phoneParam = decodeURIComponent(c.req.param("phone"));
  const key = phoneKey(phoneParam);
  const variants = new Set<string>([
    phoneParam,
    fmtE164ish(phoneParam),
    key.length === 10 ? `+1${key}` : "",
    key.length === 10 ? key : "",
  ].filter(Boolean));

  // Fetch SMS by primary formats; merge
  const smsLists = await Promise.all(
    [...variants].slice(0, 3).map((p) => listSmsMessagesFiltered({ phone: p, limit: 200, ascending: true })),
  );
  const smsMap = new Map<string, any>();
  for (const list of smsLists) {
    for (const m of list) {
      if (m?.name) smsMap.set(m.name, m);
    }
  }
  let sms = [...smsMap.values()].sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp));

  // Calls: filter from bulk by phone key (ERP from= exact match is flaky)
  const callsBulk = await listCallLogs({ limit: 200 });
  const calls = callsBulk.filter((call) => {
    const k = phoneKey(call.from || call.to);
    return k && k === key;
  });

  const showNoise = c.req.query("noise") === "show";
  if (!showNoise) {
    sms = sms.filter((m) => !isNoiseSms(m) && !isTestSmsBody(m.content || m.body));
  }
  const callsVis = showNoise ? calls : calls.filter((call) => !isNoiseCall(call));

  const customer = await matchCustomerByPhone(fmtE164ish(phoneParam) || phoneParam);

  type Ev = { type: string; at: string; sort: number; [k: string]: unknown };
  const events: Ev[] = [];

  for (const m of sms) {
    const inbound = String(m.direction || "").toLowerCase() === "inbound";
    const tag = String(m.context_tag || "");
    events.push({
      type: "sms",
      at: m.timestamp || m.creation,
      sort: tsMs(m.timestamp || m.creation),
      id: m.name,
      direction: inbound ? "inbound" : "outbound",
      body: m.content || m.body || "",
      sent_by: inbound
        ? null
        : tag.includes("staff") || tag.includes("alts_messages")
          ? "staff_manual"
          : tag.includes("sofia") || !tag
            ? "sofia_ai"
            : "staff_manual",
      context_tag: tag || null,
      via_shop: tag.includes("unifi"),
    });
  }

  for (const call of callsVis) {
    const st = String(call.status || "").toLowerCase();
    const at = call.time || call.creation;
    const sort = tsMs(at);
    const play = recordingPlayUrl(call);
    // Prefer full ERP doc when list row still has marker (Long Text sometimes thin on list)
    let doc = call;
    let tx = resolveCallTranscript(call);
    if ((tx.pending || !tx.full) && call.name) {
      try {
        const fullDoc = await getCallLog(String(call.name));
        if (fullDoc) {
          doc = fullDoc;
          tx = resolveCallTranscript(fullDoc);
        }
      } catch {
        /* keep list row */
      }
    }
    if (st === "missed") {
      events.push({
        type: "missed_call",
        at,
        sort,
        call_id: call.name,
        duration: call.duration || 0,
        from: call.from,
        from_caller_name: call.from_caller_name,
      });
    } else if (st === "voicemail") {
      events.push({
        type: "voicemail",
        at,
        sort,
        call_id: call.name,
        duration: call.duration || 0,
        summary: tx.summary || previewClean(tx.full, 200) || "Voicemail",
        recording_url: play,
      });
    } else {
      events.push({
        type: "call_transcript",
        at,
        sort,
        call_id: call.name,
        direction: doc.direction || call.direction || "inbound",
        duration: call.duration || 0,
        status: call.status,
        // AI / UniFi summary when present on ERP transcript_whisper
        summary: tx.summary,
        summary_bullets: tx.summary_bullets,
        // Full transcript from ERP transcript_raw (never "whisper" marker)
        transcript: tx.full,
        transcript_pending: tx.pending,
        recording_url: play,
        from_caller_name: call.from_caller_name,
      });
    }
  }

  events.sort((a, b) => a.sort - b.sort);

  const viaShop = events.some((e) => e.type === "sms" && e.via_shop);

  // Legacy messages array for any old clients
  const messages = sms.map((m) => ({
    name: m.name,
    content: m.content || m.body,
    body: m.body || m.content,
    direction: m.direction,
    timestamp: m.timestamp,
  }));

  return c.json({
    data: {
      person: {
        phone: fmtE164ish(phoneParam) || phoneParam,
        customer_name: customer?.name ?? null,
        customer_id: customer?.id ?? null,
        via_shop_line: viaShop,
      },
      customer,
      events,
      messages,
    },
  });
});

// ── SPEC 081: POST /api/comms/send — Reply as Sofia (308) ─────────────────
commsRouter.post("/send", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "invalid_json" } }, 400);
  }
  const to = String(body.to || body.phone || "").trim();
  const text = String(body.body || body.message || "").trim();
  const source = String(body.source || "alts_messages");
  if (!to || !text) return c.json({ error: { message: "to and body required" } }, 400);
  if (isOwnerPhone(to) && source === "alts_messages") {
    // still allow; floor may need it
  }

  const customer = await matchCustomerByPhone(to);
  let sid: string | null = null;
  let messageName: string | null = null;
  let err: string | null = null;

  try {
    const result: any = await erpRunMethod("lsh_house.sms.send_customer_sms", {
      phone: to,
      message: text,
      customer: customer?.id ?? null,
      client_name: customer?.name ?? null,
      context_tag: "alts_messages:staff_manual",
    });
    if (result && typeof result === "object") {
      sid = result.twilio_sid ?? result.sid ?? null;
      messageName = result.name ?? null;
      if (result.ok === false) err = result.error_message || result.error || "send_failed";
    }
  } catch (e: any) {
    err = e?.message || "erp_send_failed";
  }

  // Fallback log if ERP method didn't write
  if (!messageName && !err) {
    try {
      const row = await insertSmsMessage({
        client_phone: to,
        client_name: customer?.name ?? null,
        customer: customer?.id ?? null,
        direction: "outbound",
        content: text,
        body: text,
        timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
        twilio_sid: sid,
        status: sid ? "sent" : "failed",
        context_tag: "alts_messages:staff_manual",
      });
      messageName = (row as any)?.name ?? null;
    } catch {
      /* non-fatal */
    }
  }

  if (err) return c.json({ error: { message: err }, data: { ok: false } }, 502);

  return c.json({
    data: {
      ok: true,
      sid,
      message_name: messageName,
      to,
      sent_by: "staff_manual",
      from: "+12123084431",
    },
  });
});

// Mark done is client-local primarily; endpoint exists for future ERP write
commsRouter.post("/thread/:phone/done", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const phone = decodeURIComponent(c.req.param("phone"));
  return c.json({
    data: {
      ok: true,
      phone,
      phone_key: phoneKey(phone),
      done_at: new Date().toISOString(),
    },
  });
});

commsRouter.get("/calls/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const data = await getCallLog(c.req.param("id"));
  const customer = data ? await matchCustomerByPhone(data.from) : null;
  return c.json({
    data: data
      ? { ...data, id: data.name, customer, recording_url: recordingPlayUrl(data) }
      : null,
  });
});

commsRouter.get("/recordings/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const data = await getPlaudCapture(c.req.param("id"));
  if (!data || !canReadVoiceNote(user, data)) {
    return c.json({ error: { message: "Not found" } }, 404);
  }
  return c.json({ data: { ...data, id: data.name } });
});

// ── POST /api/comms/brief/:phone — Grok brief for customer ─────────────────
commsRouter.post("/brief/:phone", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const phone = decodeURIComponent(c.req.param("phone"));

  const [sms, calls] = await Promise.all([
    listSmsMessagesFiltered({ phone, limit: 30, ascending: true }),
    listCallLogs({ phone, limit: 10 }),
  ]);

  const customer = await matchCustomerByPhone(phone);
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return c.json({ data: { brief: "AI not configured" } });

  // Build rich context from all available data
  const smsContext = sms.length
    ? sms.map((m: any) => `  [${m.direction === "inbound" ? "Customer" : "Sofia"}] ${m.content}`).join("\n")
    : "  No SMS history";

  const callContext = calls.length
    ? calls.map((call: any) => {
        const mins = Math.round((call.duration || 0) / 60);
        const transcript = call.transcript_raw || call.transcript_whisper || "";
        return `  - ${call.direction} call, ${mins}m, status: ${call.status}\n    ${transcript ? `Transcript: ${transcript.slice(0, 500)}` : "No transcript"}`;
      }).join("\n")
    : "  No call history";

  const prompt = `You are Sofia at L&S Custom Tailors. Give a quick, practical brief on this customer. Keep it tight.

Format:
• 2-3 bullet highlights (what matters most)
• Any dates or appointments mentioned
• Call to actions — what needs to happen next (be specific)

No headers. No fluff. Just the useful stuff.

---
SMS HISTORY:
${smsContext}

CALL HISTORY:
${callContext}
---

Be specific. Use actual names, dates, amounts from the transcripts. If a 10-minute call happened, extract everything meaningful from it — don't summarize into one vague sentence.`;

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-3",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    }),
  });
  const grokData = await res.json() as any;
  const brief = grokData?.choices?.[0]?.message?.content?.trim() ?? "Unable to generate brief.";
  return c.json({ data: { brief, customer } });
});

// ── POST /api/comms/brief/recording/:id — Grok brief for a Plaud recording ─
commsRouter.post("/brief/recording/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const rec = await getPlaudCapture(c.req.param("id"));
  if (!rec || !canReadVoiceNote(user, rec)) return c.json({ error: { message: "Recording not found" } }, 404);

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return c.json({ data: { brief: "AI not configured" } });

  const transcript = rec.transcript || rec.transcript_raw || rec.transcript_whisper || "";
  const summary = rec.summary || rec.summary_raw || "";
  const duration = Math.round((rec.duration_sec || rec.duration_seconds || 0) / 60);
  const date = rec.recorded_at ? new Date(rec.recorded_at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "unknown date";
  // detected_customer_names comes from lsh-plaud adjudication extraction_json; fall back to title
  const customers = Array.isArray(rec.detected_customer_names) ? rec.detected_customer_names.join(", ") : (rec.detected_customer_names || rec.title || "unknown");
  const existingActions = rec.extracted_action_items || rec.detected_action_items;

  const prompt = `You are Sofia, the intelligence assistant for L&S Custom Tailors — a luxury bespoke house in NYC.

A ${duration}-minute ${rec.capture_type || rec.detected_type || "meeting"} was recorded on ${date} with: ${customers}.

Analyze the full content and produce a structured intelligence brief:

**SUMMARY**
What was this meeting/call about? 2-3 specific sentences.

**KEY DECISIONS**
Any decisions made or agreed upon.

**ACTION ITEMS**
- [ ] Task (Owner — due date if mentioned)
List every concrete next step mentioned.

**COMMITMENTS**
What was promised by each party? Include any dates, amounts, deadlines.

**FOLLOW-UPS NEEDED**
Open questions or items needing resolution.

**CALENDAR / APPOINTMENTS**
Any appointments, fittings, delivery dates, or deadlines mentioned.

**ORDERS / BUSINESS**
Any order details, fabric choices, measurements, or product discussions.

**SENTIMENT & RELATIONSHIP**
How did the conversation go? Customer satisfaction, relationship health.

---
${summary ? `EXISTING SUMMARY:\n${summary.slice(0, 2000)}\n\n` : ""}${transcript ? `FULL TRANSCRIPT:\n${transcript.slice(0, 4000)}` : "No transcript available."}
${existingActions ? `\nEXISTING ACTION ITEMS DETECTED:\n${JSON.stringify(existingActions)}` : ""}
---

Extract everything concrete. Use actual names, amounts, dates from the transcript. This is a ${duration}-minute recording — there should be substantial detail.`;

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-3",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
      temperature: 0.3,
    }),
  });
  const grokData = await res.json() as any;
  const brief = grokData?.choices?.[0]?.message?.content?.trim() ?? "Unable to generate brief.";
  return c.json({ data: { brief } });
});

// ── GET /api/comms/daily-brief/trigger — Sofia scans all day's comms ───────
// Called by Vercel cron at end of day. Generates full intelligence brief.
// HER-61 S4: require CRON_SECRET
commsRouter.get("/daily-brief/trigger", async (c) => {
  const gate = await requireCronOrSession(c);
  if (gate !== true) return gate;
  const todayStr = new Date().toISOString().slice(0, 10);
  const nycDate = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });

  const [calls, sms, recordings] = await Promise.all([
    listCallLogs({ since: `${todayStr}T00:00:00`, limit: 200, orderBy: "time asc" }),
    listSmsMessagesFiltered({ limit: 200 }),
    listPlaudCaptures({ since: `${todayStr}T00:00:00`, limit: 20 }),
  ]);

  const smsToday = sms.filter((m: any) => String(m.timestamp ?? "").startsWith(todayStr));

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return c.json({ error: { message: "XAI_API_KEY not set" } }, 503);

  // Build rich context
  const callSummary = calls.length
    ? calls.map(c => `  [${c.direction}] ${c.from_caller_name || c.from} • ${Math.round((c.duration||0)/60)}m • ${c.status}${c.transcript_raw ? `\n    "${c.transcript_raw.slice(0,200)}"` : ""}`).join("\n")
    : "  No calls today";

  const smsByPhone = new Map<string, string[]>();
  for (const m of smsToday) {
    const arr = smsByPhone.get(m.client_phone) ?? [];
    arr.push(`[${m.direction}] ${m.content?.slice(0, 100)}`);
    smsByPhone.set(m.client_phone, arr);
  }
  const smsSummary = smsByPhone.size
    ? [...smsByPhone.entries()].map(([phone, msgs]) => `  ${phone} (${msgs.length} msgs):\n${msgs.slice(0,3).map(m=>`    ${m}`).join("\n")}`).join("\n")
    : "  No SMS today";

  const recSummary = recordings.length
    ? recordings.map(r => `  ${r.capture_type || "Recording"} • ${Math.round((r.duration_sec || r.duration_seconds || 0)/60)}m${r.detected_customer_names ? ` • ${r.detected_customer_names}` : r.title ? ` • ${r.title}` : ""}\n  ${(r.summary || r.summary_raw)?.slice(0,200) || ""}`).join("\n")
    : "  No recordings today";

  const prompt = `You are Sofia, the intelligence system for L&S Custom Tailors.

Today is ${nycDate}. Analyze ALL communications from today and produce the DAILY INTELLIGENCE BRIEF.

FORMAT:

**DAILY SUMMARY**
How was today? Volume, key themes, notable interactions.

**CALLS (${calls.length} total)**
Key call highlights — who called, what was discussed, outcomes.

**ACTION ITEMS FROM CALLS**
- [ ] Specific task extracted from calls (owner)

**SMS SUMMARY**
Key SMS threads — commitments, questions, follow-ups needed.

**ACTION ITEMS FROM SMS**
- [ ] Specific task (owner)

**RECORDINGS / MEETINGS**
Any meetings or recordings — key decisions and actions.

**APPOINTMENTS & CALENDAR**
Any dates, fittings, pickups, deliveries mentioned today.

**FOLLOW-UPS FOR TOMORROW**
What Sofia should proactively follow up on tomorrow.

**CUSTOMERS TO CALL BACK**
Anyone who needs a callback, hasn't been reached, or needs attention.

**END OF DAY SENTIMENT**
Overall customer sentiment and relationship health today.

---
CALLS:
${callSummary}

SMS:
${smsSummary}

RECORDINGS:
${recSummary}
---

Be specific — use names, amounts, dates. Extract every commitment and action item.`;

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "grok-3-mini", messages: [{ role: "user", content: prompt }], max_tokens: 800, temperature: 0.3 }),
    signal: AbortSignal.timeout(8000),
  });
  const grokData = await res.json() as any;
  const brief = grokData?.choices?.[0]?.message?.content?.trim() ?? "Unable to generate brief.";

  try {
    await insertAgentBrief({
      type: "daily_brief",
      title: `Comms Daily Brief — ${todayStr}`,
      body: brief,
      severity: "info",
      source: "comms-daily",
      metadata: JSON.stringify({ date: todayStr, calls: calls.length, sms: smsToday.length, recordings: recordings.length }),
    });
  } catch (e: any) {
    console.error("[comms/daily-brief] save:", e.message);
  }

  return c.json({ data: { brief, date: todayStr, stats: { calls: calls.length, sms: smsToday.length, recordings: recordings.length } } });
});

// ── POST /api/comms/recordings/:id/auto-tag — extract garment IDs from transcript ─
// Scans transcript for LST-*, ALT-*, LSTNY-SO-* IDs, validates each in ERP,
// writes back to tagged_garment_ids field. Safe to re-run (idempotent).
commsRouter.post("/recordings/:id/auto-tag", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const rec = await getPlaudCapture(c.req.param("id"));
  if (!rec || !canReadVoiceNote(user, rec)) return c.json({ error: { message: "Recording not found" } }, 404);

  const transcript = rec.transcript || rec.transcript_raw || rec.transcript_whisper || "";
  const summary = rec.summary || rec.summary_raw || "";
  const haystack = `${transcript} ${summary}`;

  // Extract ID candidates from text
  const patterns = [
    /\bLST-\d{6,}-\d+\b/gi,      // MTMPro: LST-122413-3
    /\bALT-[A-Z]+-\d{4}-\d+\b/gi, // Alteration ticket: ALT-NYC-2026-00061
    /\bLSTNY-SO-\d{4}-\d+\b/gi,   // Sales order: LSTNY-SO-2026-00001
  ];

  const candidates = new Set<string>();
  for (const re of patterns) {
    const matches = haystack.match(re) ?? [];
    for (const m of matches) candidates.add(m.toUpperCase());
  }

  // Validate each candidate against ERP
  const tagged: Array<{ id: string; doctype: string; title?: string; status?: string }> = [];

  for (const id of candidates) {
    try {
      if (/^LST-\d+-\d+$/.test(id)) {
        const doc = await import("../lib/erp").then(m => m.erpGet<any>("MTMPro Order", id).catch(() => null));
        if (doc) tagged.push({ id, doctype: "MTMPro Order", title: doc.customer_name || id, status: doc.production_status || doc.status });
      } else if (/^ALT-/.test(id)) {
        const doc = await import("../lib/erp").then(m => m.erpGet<any>("Alteration Ticket", id).catch(() => null));
        if (doc) tagged.push({ id, doctype: "Alteration Ticket", title: doc.customer_name || id, status: doc.workflow_state });
      } else if (/^LSTNY-SO-/.test(id)) {
        const doc = await import("../lib/erp").then(m => m.erpGet<any>("Sales Order", id).catch(() => null));
        if (doc) tagged.push({ id, doctype: "Sales Order", title: doc.customer_name || id, status: doc.status });
      }
    } catch {
      // ERP miss — not a real record, skip
    }
  }

  // Persist to LSH Plaud Capture
  const { erpUpdate } = await import("../lib/erp");
  await erpUpdate("LSH Plaud Capture", rec.name, {
    tagged_garment_ids: JSON.stringify(tagged),
    visibility: tagged.length ? "house" : "private",
  });

  return c.json({ data: { tagged, count: tagged.length } });
});
