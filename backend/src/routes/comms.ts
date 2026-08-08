import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpCreate } from "../lib/erp";
import {
  listCallLogs,
  getCallLog,
  listPlaudCaptures,
  getPlaudCapture,
  listSmsMessagesFiltered,
  insertAgentBrief,
} from "../lib/erpnext/agents";
import { requireCronOrSession } from "../lib/require-secret";

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

  const limit = Number(c.req.query("limit") ?? "100");
  const todayStr = new Date().toISOString().slice(0, 10);

  const [calls, recordings, sms] = await Promise.all([
    listCallLogs({ limit }),
    listPlaudCaptures({ limit: 50 }),
    listSmsMessagesFiltered({ limit }),
  ]);

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

// ── GET /api/comms/thread/:phone — SMS thread ──────────────────────────────
commsRouter.get("/thread/:phone", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const phone = decodeURIComponent(c.req.param("phone"));
  const data = await listSmsMessagesFiltered({ phone, limit: 200, ascending: true });
  const customer = await matchCustomerByPhone(phone);
  return c.json({ data: { messages: data ?? [], customer } });
});

commsRouter.get("/calls/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const data = await getCallLog(c.req.param("id"));
  const customer = data ? await matchCustomerByPhone(data.from) : null;
  return c.json({ data: data ? { ...data, id: data.name, customer } : null });
});

commsRouter.get("/recordings/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const data = await getPlaudCapture(c.req.param("id"));
  return c.json({ data: data ? { ...data, id: data.name } : null });
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
  if (!rec) return c.json({ error: { message: "Recording not found" } }, 404);

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
  if (!rec) return c.json({ error: { message: "Recording not found" } }, 404);

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
  });

  return c.json({ data: { tagged, count: tagged.length } });
});
