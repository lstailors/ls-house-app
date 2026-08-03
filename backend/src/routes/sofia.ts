import { Hono } from "hono";
import { erpList, erpRunMethod } from "../lib/erp";
import { DT } from "../lib/erpnext/doctypes";
import { storeInsert, storeList, storeFindOne, storeSearch, storeUpdate, storeUpsert } from "../lib/erpnext/store";
import {
  insertSmsMessage,
  listSmsMessagesFiltered,
  findSmsByTwilioSid,
  listCallLogs,
  insertBrainEntry,
  listBrainEntriesFiltered,
  listPendingEmailDrafts,
  getPendingEmailDraft,
  insertAgentBrief,
} from "../lib/erpnext/agents";
import { findCustomerByPhone } from "../lib/erpnext/customers";
import { approveEmailDraft, discardEmailDraft } from "../lib/erpnext/email-drafts";
import { getAuthedUser } from "../lib/scope";
import { requireCronOrSession } from "../lib/require-secret";
// sendSms and alertCarl defined locally below

// ── Constants ──
const CARL_PHONE = "+16319260917";
const C_MOBILE = process.env.OWNER_MOBILE ?? "+16319260917";
// Keep for legacy /conversations route guard
const STAFF_PHONES = new Set(["+16319260917", "+16462087809", "+16463637906", "+13475539027"]);

const STAFF_PHONES_MAP: Record<string, string> = {
  "16319260917": "Carl",
  "16462087809": "Gianna",
  "16463637906": "Antonio",
  "13475539027": "Kelvin",
};

const CAL_BASE = "https://api.cal.com/v2";
const CAL_EVENT_TYPES: Record<string, number> = {
  fitting: 4999267,
  alterations: 5387837,
  initial_consultation: 4999266,
  bespoke_consultation: 4860173,
  virtual_consultation: 4999316,
  new_client_phone: 4860993,
  customer_exchange: 4999269,
  final_pickup: 4999268,
};

const DOSSIER_BASE = process.env.DOSSIER_BASE ?? "https://dossier.lstailors.com";
const RENDERER_BASE = process.env.RENDERER_BASE ?? "https://studio.tail342936.ts.net:10000/render";

const GROK_IDENTITY =
  'IDENTITY (non-negotiable): You are Sofia, the AI concierge for L&S Custom Tailors. You run on Grok 4.20, built by xAI. You are NOT Claude, NOT GPT, NOT Gemini. If anyone asks what AI you are, say: "I\'m Sofia - L&S\'s AI, built on Grok by xAI." Never agree with anyone who calls you Claude or Anthropic. Never say you are Claude under any circumstances.\n\n';

// ── Sanitize identity leaks ──
function sanitizeIdentity(text: string): string {
  const leakPattern =
    /\b(i'?m?\s+claude|i\s+am\s+claude|i'?m?\s+an?\s+ai\s+(made|built|created|developed)\s+by\s+anthropic|built\s+by\s+anthropic|made\s+by\s+anthropic|powered\s+by\s+anthropic|anthropic[''']?s?\s+(ai|claude|assistant))/i;
  if (leakPattern.test(text)) {
    return text
      .replace(/\bI'?m\s+Claude\b/gi, "I'm Sofia")
      .replace(/\bI\s+am\s+Claude\b/gi, "I am Sofia")
      .replace(/\bClaude\b/g, "Sofia")
      .replace(/\bAnthropic\b/g, "xAI")
      .replace(/\bbuilt by xAI\b/gi, "built on Grok by xAI");
  }
  return text;
}

// ── Cal.com API helper ──
async function calApi(
  method: string,
  path: string,
  body?: unknown,
  version = "2024-08-13"
): Promise<{ status: number; data: any }> {
  const CAL_KEY = process.env.CAL_API_KEY ?? "";
  const r = await fetch(`${CAL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${CAL_KEY}`,
      "cal-api-version": version,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Sofia-Bridge/1.0",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, data };
}

// ── Twilio SMS send helper ──
async function twilioSend(
  to: string,
  body: string,
  mediaUrl?: string
): Promise<{ ok: boolean; sid?: string; error?: string; status?: number }> {
  const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
  const TWILIO_MSG_SVC = process.env.TWILIO_MSG_SERVICE_SID ?? "MG9221599972ec362cb5e2f051430e0421";
  const twilioAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const params = new URLSearchParams({ To: to, Body: body, MessagingServiceSid: TWILIO_MSG_SVC });
  if (mediaUrl) params.append("MediaUrl", mediaUrl);
  const r = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );
  let data: any = null;
  try {
    data = await r.json();
  } catch {}
  if (r.status >= 200 && r.status < 300 && data?.sid) return { ok: true, sid: data.sid, status: r.status };
  return { ok: false, error: data?.message ?? `HTTP ${r.status}`, status: r.status };
}

// legacy wrapper for non-SMS parts of the file
async function sendSms(to: string, body: string): Promise<string | null> {
  const result = await twilioSend(to, body);
  return result.ok ? (result.sid ?? null) : null;
}

async function sendCustomerSmsViaErp(args: {
  to: string;
  body: string;
  customer?: string | null;
  reference_doctype?: string | null;
  reference_name?: string | null;
  context_tag?: string | null;
  client_name?: string | null;
}): Promise<{ ok: boolean; sid?: string | null; status?: string | null; error?: string | null; message_name?: string | null }> {
  let result: any = null;
  try {
    result = await erpRunMethod("lsh_house.sms.send_customer_sms", {
      phone: args.to,
      message: args.body,
      customer: args.customer ?? null,
      reference_doctype: args.reference_doctype ?? null,
      reference_name: args.reference_name ?? null,
      context_tag: args.context_tag ?? "sofia",
      client_name: args.client_name ?? null,
    });
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message ?? "ERPNext SMS method failed",
    };
  }

  if (!result) {
    return {
      ok: false,
      error: "ERPNext SMS method unavailable",
    };
  }

  return {
    ok: Boolean(result?.ok),
    sid: result?.twilio_sid ?? null,
    status: result?.status ?? null,
    error: result?.error_message ?? null,
    message_name: result?.name ?? null,
  };
}

// ── Raven post helper (replaces Slack) ──
async function postToRaven(text: string): Promise<void> {
  const webhookUrl = process.env.RAVEN_WEBHOOK_URL;
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => {});
}

// ── Alert Carl helper ──
async function alertCarl(message: string): Promise<void> {
  const ownerPhone = process.env.OWNER_MOBILE || CARL_PHONE;
  await sendSms(ownerPhone, `[Sofia Alert] ${message}`);
}

// ── Normalize phone ──
function normalizePhone(p: string): string {
  const digits = String(p ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

const EMPTY_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

function emptyTwiml(c: any) {
  c.header("Content-Type", "text/xml");
  return c.body(EMPTY_TWIML);
}

function firstHeaderValue(value: string | null | undefined): string {
  return String(value ?? "").split(",", 1)[0]!.trim();
}

async function computeTwilioSignature(authToken: string, url: string, params: URLSearchParams): Promise<string> {
  const sorted = Array.from(params.entries()).sort(([left], [right]) => left.localeCompare(right));
  const base = sorted.reduce((acc, [key, value]) => acc + key + value, url);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(base));
  const bytes = Array.from(new Uint8Array(signature));
  return btoa(String.fromCharCode(...bytes));
}

function safeSignatureCompare(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function possibleTwilioWebhookUrls(c: any): string[] {
  const urls = [c.req.url];
  const forwardedProto = firstHeaderValue(c.req.header("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(c.req.header("x-forwarded-host") ?? c.req.header("host"));

  if (forwardedProto && forwardedHost) {
    const current = new URL(c.req.url);
    urls.push(`${forwardedProto}://${forwardedHost}${current.pathname}${current.search}`);
  }

  return Array.from(new Set(urls));
}

async function isValidTwilioWebhook(c: any, params: URLSearchParams): Promise<boolean> {
  if (process.env.SOFIA_SKIP_TWILIO_SIGNATURE === "1") return true;

  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const signature = c.req.header("x-twilio-signature") ?? "";
  if (!authToken || !signature) return false;

  for (const url of possibleTwilioWebhookUrls(c)) {
    const expected = await computeTwilioSignature(authToken, url, params);
    if (safeSignatureCompare(signature, expected)) return true;
  }

  return false;
}


function mapClientRow(row: any) {
  return {
    id: row.name,
    first_name: row.first_name ?? String(row.customer_name ?? "").split(" ")[0] ?? "",
    last_name: row.last_name ?? String(row.customer_name ?? "").split(" ").slice(1).join(" ") ?? "",
    phone: row.mobile_no,
    email: row.email_id,
    is_vip: row.custom_vip_tier && row.custom_vip_tier !== "Standard",
    created_at: row.creation,
  };
}

function customerLink(customer: Record<string, unknown> | null | undefined): string | null {
  const value = customer?.name ?? customer?.id;
  return value ? String(value) : null;
}

function customerDisplayName(customer: Record<string, unknown> | null | undefined): string | null {
  const explicit = customer?.customer_name;
  if (explicit) return String(explicit);
  const first = String(customer?.first_name ?? "").trim();
  const last = String(customer?.last_name ?? "").trim();
  const fullName = `${first} ${last}`.trim();
  return fullName || null;
}

function phoneDigits(phone: unknown): string {
  return String(phone ?? "").replace(/\D/g, "");
}

function phoneLast10(phone: unknown): string {
  return phoneDigits(phone).slice(-10);
}

function samePhone(a: unknown, b: unknown): boolean {
  const left = phoneLast10(a);
  const right = phoneLast10(b);
  return Boolean(left && right && left === right);
}

function messageTimestamp(row: any): string {
  return String(row?.timestamp ?? row?.time ?? row?.creation ?? row?.modified ?? new Date().toISOString());
}

function mapSmsThreadMessage(row: any) {
  const createdAt = messageTimestamp(row);
  return {
    id: String(row.name ?? row.twilio_sid ?? createdAt),
    source: "sms",
    client_phone: String(row.client_phone ?? ""),
    client_id: row.customer ?? row.client_id ?? null,
    clientName: row.client_name ?? null,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    body: String(row.body ?? row.content ?? ""),
    content: String(row.content ?? row.body ?? ""),
    sender: row.sender ?? null,
    twilio_sid: row.twilio_sid ?? null,
    status: row.status ?? null,
    reference_doctype: row.reference_doctype ?? null,
    reference_name: row.reference_name ?? null,
    context_tag: row.context_tag ?? null,
    created_at: createdAt,
    timestamp: createdAt,
  };
}

function mapCallThreadMessage(row: any) {
  const createdAt = messageTimestamp(row);
  const summary = String(row.transcript_whisper ?? row.transcript_raw ?? "").trim();
  const status = row.status ? ` (${row.status})` : "";
  const duration = Number(row.duration ?? 0) > 0 ? ` - ${row.duration}s` : "";
  const body = summary || `Voice call${status}${duration}`;
  return {
    id: String(row.name ?? row.external_id ?? createdAt),
    source: "call",
    client_phone: String(row.from ?? ""),
    client_id: null,
    clientName: row.from_caller_name ?? null,
    direction: String(row.direction ?? "inbound").toLowerCase().includes("out") ? "outbound" : "inbound",
    body,
    content: body,
    sender: row.from ?? null,
    twilio_sid: row.twilio_sid ?? null,
    status: row.status ?? null,
    recording: row.recording ?? null,
    reference_doctype: null,
    reference_name: null,
    context_tag: null,
    created_at: createdAt,
    timestamp: createdAt,
  };
}

async function loadLocalSofiaMessages(opts: { phone?: string; limit?: number; ascending?: boolean } = {}) {
  const limit = opts.limit ?? 500;
  const smsRows = await listSmsMessagesFiltered({
    phone: opts.phone,
    limit,
    ascending: opts.ascending,
  });
  const callRows = await listCallLogs({ limit, orderBy: opts.ascending ? "time asc" : "time desc" });
  const filteredCalls = opts.phone ? callRows.filter((row: any) => samePhone(row.from, opts.phone)) : callRows;
  const messages = [
    ...(smsRows ?? []).map(mapSmsThreadMessage),
    ...(filteredCalls ?? []).map(mapCallThreadMessage),
  ].filter((message) => opts.phone ? samePhone(message.client_phone, opts.phone) : Boolean(message.client_phone));

  messages.sort((a, b) => {
    const delta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return opts.ascending ? delta : -delta;
  });

  return messages.slice(0, limit);
}

/**
 * last-10-digits -> whether the AI may reply, from LSH SMS Thread Control.
 *
 * An absent row means AI is on. That is the default the relay and the
 * sofia-sms agent both assume, so the three agree without coordination.
 */
async function loadThreadControl(): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  try {
    const rows = await storeList(DT.SMS_THREAD_CONTROL, {
      fields: ["client_phone", "ai_enabled"],
      limit: 500,
    });
    for (const row of rows ?? []) {
      const key = phoneLast10((row as any).client_phone);
      if (key) map.set(key, Boolean(Number((row as any).ai_enabled ?? 1)));
    }
  } catch (e: any) {
    // Never fail the thread list over this — fall back to "AI on".
    console.error("[sofia/threads] thread control read failed:", e?.message);
  }
  return map;
}

/**
 * Full thread list, grouped in SQL by ERPNext.
 *
 * This used to load the most recent 500 messages and group them here. With
 * 3,000+ messages that surfaced only the threads active inside that window —
 * 93 of 321 — so the console silently showed a fraction of the people Sofia
 * had actually spoken to. `lsh_house.sms.list_threads` groups server-side and
 * returns every thread regardless of age, in about 15ms.
 */
async function buildSofiaThreads(opts: { limit?: number; start?: number; search?: string } = {}) {
  const control = await loadThreadControl();
  const res: any = await erpRunMethod("lsh_house.sms.list_threads", {
    limit: opts.limit ?? 500,
    start: opts.start ?? 0,
    search: opts.search ?? null,
  });

  const threads = (res?.threads ?? []).map((t: any) => ({
    ...t,
    sofiaActive: control.get(phoneLast10(t.phone) ?? "") ?? true,
  }));

  return { threads, total: res?.total ?? threads.length };
}

async function buildLocalSofiaConversations() {
  const messages = await loadLocalSofiaMessages({ limit: 500 });
  const control = await loadThreadControl();
  const threads = new Map<string, any>();

  for (const message of messages) {
    const key = phoneLast10(message.client_phone) || message.client_phone;
    if (!key) continue;

    const existing = threads.get(key);
    const displayPhone = message.client_phone || existing?.phone;
    const clientName = message.clientName ?? existing?.clientName ?? null;
    const messageTime = new Date(message.created_at).getTime();
    const existingTime = existing ? new Date(existing.lastMessage.created_at).getTime() : -Infinity;
    const unread = Boolean(existing?.unread) || message.direction === "inbound";

    if (!existing || messageTime >= existingTime) {
      threads.set(key, {
        phone: displayPhone,
        clientName,
        lastMessage: {
          body: message.body,
          direction: message.direction,
          created_at: message.created_at,
          timestamp: message.timestamp,
        },
        messageCount: (existing?.messageCount ?? 0) + 1,
        // Was hard-coded true, so the console could never show "Human active".
        sofiaActive: control.get(key) ?? true,
        unread,
        customer: message.client_id ?? existing?.customer ?? null,
        reference_doctype: message.reference_doctype ?? existing?.reference_doctype ?? null,
        reference_name: message.reference_name ?? existing?.reference_name ?? null,
        context_tag: message.context_tag ?? existing?.context_tag ?? null,
      });
    } else {
      existing.messageCount += 1;
      existing.clientName = existing.clientName ?? clientName;
      existing.unread = unread;
    }
  }

  return Array.from(threads.values()).sort(
    (a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime(),
  );
}

function formatTicketSummary(ticket: any): string {
  const parts = [
    ticket.name ? `Ticket ${ticket.name}` : "Alteration ticket",
    ticket.customer_name ? `for ${ticket.customer_name}` : null,
    ticket.workflow_state ? `is ${ticket.workflow_state}` : null,
    ticket.due_date ? `due ${ticket.due_date}` : null,
    ticket.grand_total ? `total $${ticket.grand_total}` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

async function getAlterationTicketsForPhone(phone: string) {
  const normalized = normalizePhone(phone);
  const last10 = phoneLast10(normalized);
  if (!last10) return [];

  const rows = await erpList<any>("Alteration Ticket", {
    fields: [
      "name",
      "customer",
      "customer_name",
      "customer_phone",
      "workflow_state",
      "due_date",
      "grand_total",
      "modified",
      "creation",
    ],
    order_by: "modified desc",
    limit: 25,
  });

  return (rows ?? []).filter((ticket: any) => samePhone(ticket.customer_phone, normalized)).slice(0, 10);
}

async function getAlterationTicketByName(ticketName: string) {
  const name = String(ticketName ?? "").trim();
  if (!name) return null;
  const rows = await erpList<any>("Alteration Ticket", {
    filters: [["name", "=", name]],
    fields: [
      "name",
      "customer",
      "customer_name",
      "customer_phone",
      "workflow_state",
      "due_date",
      "grand_total",
      "modified",
      "creation",
    ],
    limit: 1,
  });
  return rows[0] ?? null;
}

async function lookupClients(q: any, field: any) {
  if (field === "phone" || field === "any") {
    const norm = normalizePhone(q);
    const row = await findCustomerByPhone(norm);
    if (row) return [mapClientRow(row)];
  }
  if (field === "name" || field === "any") {
    const rows = await erpList("Customer", {
      filters: [["customer_name", "like", `%${q}%`]],
      fields: ["name", "customer_name", "first_name", "last_name", "mobile_no", "email_id", "custom_vip_tier", "creation"],
      limit: 3,
    });
    if (rows.length) return rows.map(mapClientRow);
  }
  if (field === "email" || field === "any") {
    const rows = await erpList("Customer", {
      filters: [["email_id", "like", `%${q}%`]],
      fields: ["name", "customer_name", "first_name", "last_name", "mobile_no", "email_id", "custom_vip_tier", "creation"],
      limit: 3,
    });
    if (rows.length) return rows.map(mapClientRow);
  }
  return [];
}

async function lookupClientByPhone(phone: any) {
  const norm = normalizePhone(phone);
  let row = await findCustomerByPhone(norm);
  if (!row) row = await findCustomerByPhone(phone);
  if (!row) {
    const bare = norm.replace(/^\+1/, "");
    const rows = await erpList("Customer", {
      filters: [["mobile_no", "like", `%${bare}`]],
      fields: ["name", "customer_name", "first_name", "last_name", "mobile_no", "email_id", "custom_vip_tier", "creation"],
      limit: 1,
    });
    row = rows[0] ?? null;
  }
  return row ? mapClientRow(row) : null;
}

const SB_TABLE_DT = {
  customer_meetings: DT.CUSTOMER_MEETING,
  c_escalations: DT.ESCALATION,
  dossier_observations: DT.DOSSIER_OBSERVATION,
  order_requests: DT.ORDER_REQUEST,
  ls_tasks: DT.LS_TASK,
  ls_task_items: DT.LS_TASK_ITEM,
  conversation_handoffs: DT.CONVERSATION_HANDOFF,
  sofia2_activity_log: DT.SOFIA_ACTIVITY_LOG,
};

async function sbInsert(table: keyof typeof SB_TABLE_DT, row: any) {
  const dt = SB_TABLE_DT[table];
  if (!dt) { console.error("sbInsert unknown table:", table); return; }
  try { await storeInsert(dt, row); } catch (e) { console.error("sbInsert error:", table, (e as Error).message); }
}

// ── Substitute merge tags ──
function substituteMerge(str: string, vars: Record<string, unknown>): string {
  if (!str) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

// ── Email draft actions (ERPNext Communication + LSH Pending Email Draft) ──
async function callEmailHandler(
  action: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; data: any }> {
  const draftId = String(payload.draft_id ?? "");
  if (!draftId) return { status: 400, data: { ok: false, error: "draft_id required" } };

  if (action === "approve") {
    const result = await approveEmailDraft(draftId);
    return { status: result.ok ? 200 : 422, data: result };
  }
  if (action === "edit") {
    const result = await approveEmailDraft(draftId, String(payload.new_body ?? ""));
    return { status: result.ok ? 200 : 422, data: result };
  }
  if (action === "discard") {
    const result = await discardEmailDraft(draftId);
    return { status: result.ok ? 200 : 422, data: result };
  }
  return { status: 400, data: { ok: false, error: `Unknown action: ${action}` } };
}

// ── Resolve short draft ID ──
async function resolveDraftId(prefix: string): Promise<string | null> {
  const p = prefix.replace(/-/g, "").toLowerCase();
  if (p.length >= 32) return prefix;
  const rows = await listPendingEmailDrafts({ status: "pending", limit: 50 });
  for (const r of rows) {
    const id = String(r.name ?? "");
    if (id.replace(/-/g, "").toLowerCase().startsWith(p)) return id;
  }
  return null;
}

// ── Tool definitions ──
const TOOLS = [
  { type: "function", function: { name: "lookup_customer", description: "Look up a customer record by name, phone, or email.", parameters: { type: "object", properties: { query: { type: "string" }, field: { type: "string", enum: ["name", "phone", "email", "any"] } }, required: ["query"] } } },
  { type: "function", function: { name: "check_order_status", description: "Check manufacturing status of active orders for a customer.", parameters: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] } } },
  { type: "function", function: { name: "lookup_orders", description: "Look up a customer's open orders from Geelus. Returns each order with transaction ID, total, stage, due date, line items, division. Use when a client asks about their order status, timeline, what garments are on order, or when items will be ready.", parameters: { type: "object", properties: { customer_id: { type: "string", description: "Customer UUID from lookup_customer" } }, required: ["customer_id"] } } },
  { type: "function", function: { name: "submit_order_request", description: "Submit a client order request to Carl's team. Use for: delivery requests, change requests, pickup scheduling, or complex order questions you cannot answer from data alone. Always call lookup_orders first so you can reference the specific order. Creates a record and posts a Slack alert to the orders channel.", parameters: { type: "object", properties: { customer_id: { type: "string" }, transaction_id: { type: "string", description: "Geelus transaction ID (e.g. T-12345) if known" }, request_type: { type: "string", enum: ["delivery_request", "change_request", "pickup_scheduling", "status_question", "other"] }, details: { type: "string", description: "Specific description of what the client is requesting" } }, required: ["customer_id", "request_type", "details"] } } },
  { type: "function", function: { name: "get_fitting_history", description: "Retrieve fitting appointments for a customer. Returns upcoming appointments FIRST (sorted earliest->latest), then past (latest->earliest). Each row includes: booking_uid (null if Apple Calendar source), source (\"cal.com\" or \"apple-calendar\"), event_type, status, start_time_ny, client_name, client_phone. IMPORTANT: If booking_uid is null (source=apple-calendar), you CANNOT use reschedule_booking - follow the Apple Calendar reschedule policy instead. Pass phone whenever available; the system auto-checks the inbound caller phone as fallback.", parameters: { type: "object", properties: { customer_id: { type: "string" }, phone: { type: "string", description: "Client phone number (E.164 or 10-digit US) - used as fallback if customer_id returns no results" }, limit: { type: "integer" } }, required: [] } } },
  { type: "function", function: { name: "list_appointments", description: "List ALL shop appointments in a date range (across every customer, every source - Cal.com AND Apple Calendar). Use whenever Carl asks \"what appointments today/tomorrow/this week?\" or wants the day's schedule. Returns NYC times. Default: today, only confirmed+pending.", parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD in NYC. Defaults to today." }, days: { type: "integer", description: "Number of days from `date` to include. Default 1." }, status: { type: "string", enum: ["confirmed", "pending", "cancelled", "all", "confirmed_or_pending"], description: "Default confirmed_or_pending." } } } } },
  { type: "function", function: { name: "get_hours", description: "Check if the shop is open or closed.", parameters: { type: "object", properties: { date_iso: { type: "string" } }, required: ["date_iso"] } } },
  { type: "function", function: { name: "search_kb", description: "Search the L&S knowledge base.", parameters: { type: "object", properties: { query: { type: "string" }, top_k: { type: "integer" } }, required: ["query"] } } },
  { type: "function", function: { name: "get_available_slots", description: "Get available appointment slots from Cal.com for a given event type and date range. Returns up to 12 slots.", parameters: { type: "object", properties: { event_type: { type: "string", enum: ["fitting", "alterations", "initial_consultation", "bespoke_consultation", "virtual_consultation", "new_client_phone", "customer_exchange", "final_pickup"] }, days_ahead: { type: "integer", description: "How many days from today to look (default 14, max 30)" } }, required: ["event_type"] } } },
  { type: "function", function: { name: "reschedule_booking", description: "Reschedule an existing Cal.com booking to a new slot start time. REQUIRES a real booking_uid from get_fitting_history or a prior book_fitting tool result. Do not invent uids.", parameters: { type: "object", properties: { booking_uid: { type: "string" }, new_start: { type: "string", description: "ISO 8601 start time in UTC" }, reason: { type: "string" } }, required: ["booking_uid", "new_start"] } } },
  { type: "function", function: { name: "cancel_booking", description: "Cancel an existing Cal.com booking. REQUIRES a real booking_uid.", parameters: { type: "object", properties: { booking_uid: { type: "string" }, reason: { type: "string" } }, required: ["booking_uid"] } } },
  { type: "function", function: { name: "recent_interactions", description: "Get recent SMS/email/meeting interactions.", parameters: { type: "object", properties: { customer_id: { type: "string" }, limit: { type: "integer" } }, required: ["customer_id"] } } },
  { type: "function", function: { name: "check_invoice_status", description: "Check invoice status.", parameters: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] } } },
  { type: "function", function: { name: "check_payment_status", description: "Check Square payment link status.", parameters: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] } } },
  { type: "function", function: { name: "book_fitting", description: "Book an appointment via Cal.com. Requires confirmed slot and customer details. Returns booking_uid on success.", parameters: { type: "object", properties: { event_type: { type: "string", enum: ["fitting", "alterations", "initial_consultation", "bespoke_consultation", "virtual_consultation", "new_client_phone", "customer_exchange", "final_pickup"] }, customer_name: { type: "string" }, customer_email: { type: "string" }, customer_phone: { type: "string" }, slot_start: { type: "string", description: "ISO 8601 UTC start time from get_available_slots" }, notes: { type: "string" } }, required: ["event_type", "customer_name", "customer_email", "slot_start"] } } },
  { type: "function", function: { name: "take_message", description: "Record a message from the client for Carl.", parameters: { type: "object", properties: { message: { type: "string" }, urgency: { type: "string", enum: ["low", "normal", "high", "urgent"] } }, required: ["message"] } } },
  { type: "function", function: { name: "escalate_to_carl", description: "Escalate this conversation to Carl immediately.", parameters: { type: "object", properties: { reason: { type: "string" }, summary: { type: "string" } }, required: ["reason", "summary"] } } },
  { type: "function", function: { name: "send_sms_to_client", description: "ASSISTANT ONLY: Actually SEND an SMS to a client immediately. This dispatches via Twilio in real time - the client will receive it. Use this when Carl tells you to text/message a client. NEVER ask for confirmation - if Carl said send, send. Provide either customer_id (preferred) OR a raw to_phone. Returns twilio_sid on success.", parameters: { type: "object", properties: { customer_id: { type: "string", description: "Customer UUID from lookup_customer (preferred when available)" }, to_phone: { type: "string", description: "Raw phone if no customer_id (E.164 or 10-digit US)" }, body: { type: "string", description: "The exact SMS text to send" } }, required: ["body"] } } },
  { type: "function", function: { name: "send_mms_card", description: "ASSISTANT ONLY: Send a branded MMS card from sofia_mms_active to a client. Substitutes merge tags, sends image + sms_body via Twilio. Returns twilio_sid on success.", parameters: { type: "object", properties: { template_key: { type: "string", description: "e.g. appt_confirm, pickup_ready, fabric_arrived, fitting_reminder, casa_welcome, holiday_hours, trunk_show_invite, first_fitting_thanks" }, customer_id: { type: "string" }, to_phone: { type: "string" }, merge_values: { type: "object", description: "Values for {{first_name}}, {{appt_date}}, {{appt_time}}, {{garment}}, {{fabric_name}}, {{trunk_show_city}}, {{trunk_show_date}}" } }, required: ["template_key"] } } },
  { type: "function", function: { name: "add_dossier_observation", description: "Capture a real-time observation silently. Use proactively for fit notes, preferences, life events, action items.", parameters: { type: "object", properties: { customer_id: { type: "string" }, observation_type: { type: "string", enum: ["fit_note", "preference", "dislike", "fabric_interest", "life_event", "action_item", "quote", "tone_note", "context"] }, content: { type: "string" }, importance: { type: "integer", minimum: 1, maximum: 10 } }, required: ["customer_id", "observation_type", "content"] } } },
  { type: "function", function: { name: "get_dossier", description: "Get the current structured dossier data for a customer.", parameters: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] } } },
  { type: "function", function: { name: "list_pending_drafts", description: "ASSISTANT: List pending Gmail drafts awaiting Carl approval. Returns id, from, subject, importance, inbox.", parameters: { type: "object", properties: { inbox: { type: "string", description: "Optional filter: concierge, carl, info, appointments" }, limit: { type: "integer" } } } } },
  { type: "function", function: { name: "read_email_draft", description: "ASSISTANT: Read a specific pending email draft (full original + Sofia draft).", parameters: { type: "object", properties: { draft_id: { type: "string", description: "8-char draft id prefix or full uuid" } }, required: ["draft_id"] } } },
  { type: "function", function: { name: "search_emails", description: "ASSISTANT: Search recent email_messages_log by sender, subject, or customer name.", parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } } },
  { type: "function", function: { name: "approve_email_draft", description: "ASSISTANT: Send a pending Gmail draft as-is.", parameters: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] } } },
  { type: "function", function: { name: "edit_email_draft", description: "ASSISTANT: Edit and send a pending Gmail draft with new body.", parameters: { type: "object", properties: { draft_id: { type: "string" }, new_body: { type: "string" } }, required: ["draft_id", "new_body"] } } },
  { type: "function", function: { name: "discard_email_draft", description: "ASSISTANT: Discard a pending Gmail draft.", parameters: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] } } },
  { type: "function", function: { name: "create_task", description: "Create a task in the L&S task system. Use for any staff operational request: items to buy/order (shopping), errands, pickups, dropoffs, internal tasks. For shopping, list each product as a separate item in the items array.", parameters: { type: "object", properties: { task_type: { type: "string", enum: ["shopping", "errand", "pickup", "dropoff", "internal"] }, title: { type: "string" }, description: { type: "string" }, priority: { type: "string", enum: ["normal", "high", "urgent"] }, location_name: { type: "string" }, location_address: { type: "string" }, due_at: { type: "string", description: "ISO 8601 if mentioned" }, notes: { type: "string" }, items: { type: "array", description: "For shopping tasks — individual items to purchase", items: { type: "object", properties: { description: { type: "string" }, quantity: { type: "number" }, unit: { type: "string" }, preferred_vendor: { type: "string" } }, required: ["description"] } } }, required: ["task_type", "title"] } } },
  { type: "function", function: { name: "get_customer_tickets", description: "Get list of recent alteration tickets for a customer by phone number. Returns ticket name, status, due date, total, and payment status. Use when the customer asks about their orders/tickets/garments by phone.", parameters: { type: "object", properties: { phone: { type: "string", description: "Customer phone in E.164 format, e.g. +15551234567" } }, required: ["phone"] } } },
  { type: "function", function: { name: "get_ticket_status", description: "Get current status of a specific alteration ticket by its name. Use when the customer mentions a ticket number like ALT-NYC-2026-00042.", parameters: { type: "object", properties: { ticket_name: { type: "string", description: "Full ticket name, e.g. ALT-NYC-2026-00042" } }, required: ["ticket_name"] } } },
  { type: "function", function: { name: "create_todo", description: "Create a business follow-up ToDo in ERPNext. Use proactively during client conversations when a follow-up action is needed (callback, invoice question, special request). Also use when staff ask to set a reminder or todo.", parameters: { type: "object", properties: { description: { type: "string", description: "Clear, actionable task description including customer name and context" }, priority: { type: "string", enum: ["High", "Medium", "Low"] }, date: { type: "string", description: "Due date YYYY-MM-DD or null" }, allocated_to: { type: "string", description: "Email of responsible person (e.g. carl@lstailors.com). Null = assign to Carl." } }, required: ["description"] } } },
  { type: "function", function: { name: "list_my_tasks", description: "List the caller's open ToDos from ERPNext. Use when staff asks 'what are my tasks', 'my todo list', 'what do I need to do', etc.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "complete_task", description: "Mark an ERPNext ToDo as complete. Use when staff says they finished a task, 'done with X', 'mark X complete', 'checked off X'. Match by todo_id.", parameters: { type: "object", properties: { todo_id: { type: "string", description: "ERPNext ToDo name/id from list_my_tasks" } }, required: ["todo_id"] } } },
  { type: "function", function: { name: "get_client_tasks", description: "Get open tasks and todos related to a specific customer. Use proactively when a known client contacts you to surface any pending follow-ups Carl or the team needs to handle.", parameters: { type: "object", properties: { customer_name: { type: "string", description: "Customer full name to search todos for" } }, required: ["customer_name"] } } },
];

const STAFF_TASK_TOOL_NAMES = new Set(["create_task", "create_todo", "list_my_tasks", "complete_task", "get_client_tasks"]);
const STAFF_TOOLS = TOOLS.filter((t) => STAFF_TASK_TOOL_NAMES.has((t as any).function.name));

// ── Tool executor ──
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  from: string,
  customer: Record<string, unknown> | null,
  isAssistant: boolean
): Promise<string> {
  if (!(process.env.ERPNEXT_BASE_URL && process.env.ERPNEXT_API_KEY)) return JSON.stringify({ error: "ERPNext unavailable" });

  try {
    switch (name) {
      case "lookup_customer": {
        const q = String(args.query ?? "");
        const field = String(args.field ?? "any");
        const rows = await lookupClients(q, field);
        return JSON.stringify(rows.length ? rows : { not_found: true, query: q });
      }
      case "check_order_status": {
        const data = await storeList(DT.MFG_ORDER, {
          filters: [["customer", "=", String(args.customer_id)], ["status", "in", ["pending", "cutting", "sewing", "finishing", "QC"]]],
          limit: 5,
        });
        return JSON.stringify(data ?? []);
      }
      case "get_fitting_history": {
        const custId = args.customer_id ? String(args.customer_id) : null;
        const argPhone = args.phone ? normalizePhone(String(args.phone)) : null;
        const callerPhone = !isAssistant ? normalizePhone(from) : null;
        const limit = Number(args.limit ?? 8);
        const nowIso = new Date().toISOString();
        const apptSelect =
          "id, calcom_booking_uid, event_type, status, start_time, end_time, assigned_tailor, client_name, client_phone, dossier_link, location, notes";
        let rows: any[] = [];
        if (custId) {
          rows = await storeList(DT.APPOINTMENT, {
            filters: [["customer", "=", custId]],
            orderBy: "start_time desc",
            limit,
          });
        }
        if (!rows.length) {
          const phoneToSearch = argPhone || callerPhone;
          if (phoneToSearch) {
            const bare = phoneToSearch.replace(/^\+1/, "");
            rows = await storeList(DT.APPOINTMENT, {
              filters: [["client_phone", "in", [phoneToSearch, bare, `+1${bare}`]]],
              orderBy: "start_time desc",
              limit,
            });
          }
        }
        rows = rows.map((r) => ({ ...r, id: r.name }));
        const upcoming = rows
          .filter((r: any) => r.start_time && r.start_time >= nowIso)
          .sort((a: any, b: any) => a.start_time.localeCompare(b.start_time));
        const past = rows.filter((r: any) => !r.start_time || r.start_time < nowIso);
        const ordered = [...upcoming, ...past];
        const fmt = (t: string) =>
          new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }).format(new Date(t));
        const out = ordered.map((r: any) => ({
          appointment_id: r.id,
          booking_uid: r.calcom_booking_uid ?? null,
          source: r.calcom_booking_uid ? "cal.com" : "apple-calendar",
          event_type: r.event_type,
          status: r.status,
          start_time_utc: r.start_time,
          start_time_ny: r.start_time ? fmt(r.start_time) : null,
          end_time_utc: r.end_time,
          assigned_tailor: r.assigned_tailor,
          client_name: r.client_name,
          client_phone: r.client_phone,
          location: r.location,
          notes: r.notes,
          dossier_link: r.dossier_link,
        }));
        return JSON.stringify({ upcoming_count: upcoming.length, past_count: past.length, appointments: out });
      }
      case "list_appointments": {
        const dateStr = args.date
          ? String(args.date)
          : new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/New_York",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date());
        const days = Math.max(1, Math.min(Number(args.days ?? 1), 14));
        const probe = new Date(`${dateStr}T12:00:00Z`);
        const tzName =
          new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            timeZoneName: "short",
          })
            .formatToParts(probe)
            .find((p) => p.type === "timeZoneName")?.value ?? "EST";
        const offset = tzName === "EDT" ? "-04:00" : "-05:00";
        const startUtc = new Date(`${dateStr}T00:00:00${offset}`).toISOString();
        const endDate = new Date(`${dateStr}T00:00:00${offset}`);
        endDate.setDate(endDate.getDate() + days);
        const endUtc = endDate.toISOString();
        const statusFilter = String(args.status ?? "confirmed_or_pending");
        const apptFilters: any[] = [["start_time", ">=", startUtc], ["start_time", "<", endUtc]];
        if (statusFilter === "confirmed") apptFilters.push(["status", "=", "confirmed"]);
        else if (statusFilter === "cancelled") apptFilters.push(["status", "=", "cancelled"]);
        else if (statusFilter !== "all") apptFilters.push(["status", "in", ["confirmed", "pending"]]);
        const data = await storeList(DT.APPOINTMENT, { filters: apptFilters, orderBy: "start_time asc", limit: 100 });
        const out = (data ?? []).map((r: any) => ({
          appointment_id: r.id,
          booking_uid: r.calcom_booking_uid,
          event_type: r.event_type,
          status: r.status,
          start_ny: new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }).format(new Date(r.start_time)),
          start_time_utc: r.start_time,
          customer_id: r.customer_id,
          client_name: r.client_name,
          client_phone: r.client_phone,
          assigned_tailor: r.assigned_tailor,
          dossier_link: r.dossier_link,
        }));
        return JSON.stringify({ window_ny: { date: dateStr, days }, total: out.length, appointments: out });
      }
      case "get_hours": {
        return JSON.stringify({ message: "Tues-Fri 8:30am-5:30pm, Sat 8:30am-4pm, closed Sun-Mon" });
      }
      case "search_kb": {
        const data = await listBrainEntriesFiltered({ agentSlug: "sofia", summaryLike: String(args.query), limit: Number(args.top_k ?? 5) });
        return JSON.stringify(data ?? []);
      }
      case "get_available_slots": {
        const evKey = String(args.event_type ?? "fitting");
        const eventTypeId = CAL_EVENT_TYPES[evKey];
        if (!eventTypeId) return JSON.stringify({ error: `Unknown event_type: ${evKey}` });
        const daysAhead = Math.min(Number(args.days_ahead ?? 14), 30);
        const start = new Date();
        const end = new Date(start.getTime() + daysAhead * 24 * 60 * 60 * 1000);
        const startStr = start.toISOString().split("T")[0];
        const endStr = end.toISOString().split("T")[0];
        const { status, data } = await calApi(
          "GET",
          `/slots?eventTypeId=${eventTypeId}&start=${startStr}&end=${endStr}&timeZone=America/New_York&format=range`,
          undefined,
          "2024-09-04"
        );
        if (status !== 200) return JSON.stringify({ error: "Cal.com slot lookup failed", status, body: data });
        const slotsByDate = data?.data ?? {};
        const flat: { start: string; end: string; pretty: string }[] = [];
        for (const [, list] of Object.entries(slotsByDate)) {
          for (const s of list as any[]) {
            const startIso = (s as any).start ?? (s as any).startTime ?? s;
            const endIso = (s as any).end ?? (s as any).endTime ?? "";
            const dt = new Date(startIso);
            const pretty = new Intl.DateTimeFormat("en-US", {
              timeZone: "America/New_York",
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            }).format(dt);
            flat.push({ start: startIso, end: endIso, pretty });
            if (flat.length >= 100) break;
          }
          if (flat.length >= 100) break;
        }
        return JSON.stringify({ event_type: evKey, event_type_id: eventTypeId, slots: flat, booking_link: "https://lstailors.com/book" });
      }
      case "recent_interactions": {
        const data = await listSmsMessagesFiltered({ phone: from, limit: Number(args.limit ?? 10) });
        return JSON.stringify(data ?? []);
      }
      case "check_invoice_status": {
        const data = await erpList("Sales Invoice", { filters: [["customer", "=", String(args.customer_id)]], order_by: "creation desc", limit: 3 });
        return JSON.stringify(data ?? []);
      }
      case "check_payment_status": {
        const data = await storeList(DT.PAYMENT_REQUEST, { filters: [["customer", "=", String(args.customer_id)]], orderBy: "creation desc", limit: 3 });
        return JSON.stringify(data ?? []);
      }
      case "take_message": {
        await sbInsert("customer_meetings", {
          customer_phone: from,
          notes: String(args.message),
          meeting_type: "message",
          status: "pending",
        });
        await postToRaven(`:envelope: *Message from ${from}:*\n${args.message}`);
        return JSON.stringify({ ok: true });
      }
      case "escalate_to_carl": {
        await sbInsert("c_escalations", {
          source_phone: from,
          customer_id: (customer as any)?.id ?? null,
          reason: String(args.reason),
          client_question: String(args.summary),
          status: "pending",
          source_channel: "sms",
        });
        const custName = customer
          ? `${(customer as any).first_name} ${(customer as any).last_name}`
          : from;
        const msg = `? ${custName} (SMS)\nQ: ${args.summary}\nMy read: ${args.reason}\nReply with answer.`;
        await twilioSend(C_MOBILE, msg);
        return JSON.stringify({ ok: true, escalated: true });
      }
      case "add_dossier_observation": {
        const custId = String(args.customer_id);
        const dossier = await storeFindOne(DT.CUSTOMER_DOSSIER, "customer", custId);
        if (!dossier) return JSON.stringify({ error: "No dossier found for customer" });
        const isSignificant =
          Number(args.importance ?? 5) >= 5 ||
          ["fit_note", "life_event", "action_item"].includes(String(args.observation_type));
        await sbInsert("dossier_observations", {
          dossier_id: (dossier as any).id,
          customer_id: custId,
          observation_type: String(args.observation_type),
          content: String(args.content),
          source_channel: "sms",
          importance: Number(args.importance ?? 5),
          is_significant: isSignificant,
        });
        if (isSignificant && dossier?.name) {
          await storeUpdate(DT.CUSTOMER_DOSSIER, String(dossier.name), { last_significant_update: new Date().toISOString() });
        }
        return JSON.stringify({ ok: true, recorded: true, significant: isSignificant });
      }
      case "get_dossier": {
        const data = await storeFindOne(DT.CUSTOMER_DOSSIER, "customer", String(args.customer_id));
        if (!data) return JSON.stringify({ error: "No dossier found" });
        return JSON.stringify(data);
      }
      case "book_fitting": {
        const evKey = String(args.event_type ?? "fitting");
        const eventTypeId = CAL_EVENT_TYPES[evKey];
        if (!eventTypeId) return JSON.stringify({ error: `Unknown event_type: ${evKey}` });
        const slotStart = String(args.slot_start ?? "");
        if (!slotStart) return JSON.stringify({ error: "slot_start required" });
        const attendeeName = String(args.customer_name ?? "").trim();
        const attendeeEmail = String(args.customer_email ?? "").trim();
        const attendeePhone = String(args.customer_phone ?? "").trim();
        if (!attendeeName || !attendeeEmail)
          return JSON.stringify({
            error: "customer_name and customer_email are REQUIRED. Look up the client first - do not default to the sender.",
          });
        const fallbackPhone = isAssistant ? "" : from;
        const bookingBody = {
          start: slotStart,
          eventTypeId,
          attendee: {
            name: attendeeName,
            email: attendeeEmail,
            timeZone: "America/New_York",
            phoneNumber: attendeePhone || fallbackPhone,
            language: "en",
          },
          metadata: { source: "sofia-sms" },
        };
        const { status, data } = await calApi("POST", "/bookings", bookingBody, "2024-08-13");
        if (status >= 300)
          return JSON.stringify({ error: "Booking failed", status, body: data, fallback: "https://lstailors.com/book" });
        return JSON.stringify({ ok: true, booking_uid: data?.data?.uid, start: data?.data?.start, end: data?.data?.end });
      }
      case "reschedule_booking": {
        const uid = String(args.booking_uid ?? "");
        const newStart = String(args.new_start ?? "");
        if (!uid || !newStart) return JSON.stringify({ error: "booking_uid and new_start required" });
        const { status, data } = await calApi(
          "POST",
          `/bookings/${uid}/reschedule`,
          { start: newStart, reschedulingReason: String(args.reason ?? "Customer request") },
          "2024-08-13"
        );
        if (status >= 300) return JSON.stringify({ error: "Reschedule failed", status, body: data });
        return JSON.stringify({ ok: true, booking_uid: data?.data?.uid, start: data?.data?.start });
      }
      case "cancel_booking": {
        const uid = String(args.booking_uid ?? "");
        if (!uid) return JSON.stringify({ error: "booking_uid required" });
        const { status, data } = await calApi(
          "POST",
          `/bookings/${uid}/cancel`,
          { cancellationReason: String(args.reason ?? "Customer request") },
          "2024-08-13"
        );
        if (status >= 300) return JSON.stringify({ error: "Cancel failed", status, body: data });
        return JSON.stringify({ ok: true, cancelled: true });
      }
      case "send_sms_to_client": {
        if (!isAssistant) return JSON.stringify({ error: "Assistant mode only" });
        const smsBody = String(args.body ?? "").trim();
        if (!smsBody) return JSON.stringify({ error: "body required" });
        let toPhone = "";
        let custId: string | null = null;
        let custName = "";
        if (args.customer_id) {
          const data = await storeFindOne<any>("Customer", "name", String(args.customer_id));
          if (data) {
            toPhone = String((data as any).phone ?? (data as any).mobile_no ?? "");
            custId = String((data as any).name ?? (data as any).id ?? args.customer_id);
            custName = String((data as any).customer_name ?? "").trim()
              || `${(data as any).first_name ?? ""} ${(data as any).last_name ?? ""}`.trim();
          }
        }
        if (!toPhone && args.to_phone) toPhone = normalizePhone(String(args.to_phone));
        if (!toPhone) return JSON.stringify({ error: "Could not resolve recipient phone. Need customer_id or to_phone." });
        toPhone = normalizePhone(toPhone);
        const result = await sendCustomerSmsViaErp({
          to: toPhone,
          body: smsBody,
          customer: custId,
          context_tag: "sofia",
          client_name: custName || null,
        });
        if (!result.ok) return JSON.stringify({ error: "ERPNext SMS send failed", detail: result.error, status: result.status });
        await postToRaven(`:white_check_mark: *Sofia sent SMS* to ${custName || toPhone}\n> ${smsBody}\nsid: \`${result.sid}\``);
        return JSON.stringify({ ok: true, sent: true, twilio_sid: result.sid, message_name: result.message_name, sent_to: toPhone, recipient_name: custName || null });
      }
      case "send_mms_card": {
        if (!isAssistant) return JSON.stringify({ error: "Assistant mode only" });
        const tplKey = String(args.template_key ?? "");
        if (!tplKey) return JSON.stringify({ error: "template_key required" });
        const merge = args.merge_values && typeof args.merge_values === "object" ? (args.merge_values as Record<string, unknown>) : {};
        const tplRow = await storeFindOne(DT.MMS_TEMPLATE, "template_key", tplKey);
        if (!tplRow) return JSON.stringify({ error: `Template not found: ${tplKey}` });
        const tpl = tplRow as any;
        let toPhone = "";
        let custId: string | null = null;
        let custName = "";
        if (args.customer_id) {
          const data = await storeFindOne<any>("Customer", "name", String(args.customer_id));
          if (data) {
            toPhone = String((data as any).phone ?? "");
            custId = String((data as any).id);
            custName = `${(data as any).first_name ?? ""} ${(data as any).last_name ?? ""}`.trim();
            if (!merge.first_name) merge.first_name = (data as any).first_name ?? "";
          }
        }
        if (!toPhone && args.to_phone) toPhone = normalizePhone(String(args.to_phone));
        if (!toPhone) return JSON.stringify({ error: "Could not resolve recipient phone. Need customer_id or to_phone." });
        toPhone = normalizePhone(toPhone);
        const smsBody = substituteMerge(String(tpl.sms_body_template ?? ""), merge);
        let mediaUrl = "";
        if (!tpl.render_on_send && tpl.rendered_image_url) {
          mediaUrl = String(tpl.rendered_image_url);
        } else {
          const params = new URLSearchParams();
          params.set("variant", tpl.variant === "ambient" ? "a" : "b");
          params.set("h1", substituteMerge(String(tpl.headline_line_1 ?? ""), merge));
          if (tpl.headline_line_2) params.set("h2", substituteMerge(String(tpl.headline_line_2), merge));
          if (tpl.caption_primary) params.set("cap1", substituteMerge(String(tpl.caption_primary), merge));
          if (tpl.caption_secondary) params.set("cap2", substituteMerge(String(tpl.caption_secondary), merge));
          mediaUrl = `${RENDERER_BASE}?${params.toString()}`;
        }
        const result = await twilioSend(toPhone, smsBody, mediaUrl);
        if (!result.ok) return JSON.stringify({ error: "Twilio MMS send failed", detail: result.error, status: result.status });
        try {
          await insertSmsMessage({
            twilio_sid: result.sid ?? null,
            client_phone: toPhone,
            client_id: custId,
            direction: "outbound",
            content: smsBody,
            timestamp: new Date().toISOString(),
            metadata: { mode: "ASSISTANT_SMS", template_key: tplKey, media_url: mediaUrl, sent_by: "sofia_on_behalf_of_carl", triggered_by: from },
          });
        } catch (_) {}
        await postToRaven(`:white_check_mark: *Sofia sent MMS card* (${tplKey}) to ${custName || toPhone}\n> ${smsBody}\nsid: \`${result.sid}\``);
        return JSON.stringify({ ok: true, sent: true, twilio_sid: result.sid, sent_to: toPhone, template_key: tplKey, media_url: mediaUrl });
      }
      case "list_pending_drafts": {
        if (!isAssistant) return JSON.stringify({ error: "Assistant mode only" });
        const drafts = await listPendingEmailDrafts({
          status: "pending",
          inbox: args.inbox ? `${String(args.inbox)}@lstailors.com` : undefined,
          limit: Number(args.limit ?? 10),
        });
        const rows = (drafts ?? []).map((r: any) => ({
          id8: String(r.name).replace(/-/g, "").slice(0, 8),
          inbox: r.inbox,
          from: r.from_name ? `${r.from_name} <${r.from_address}>` : r.from_address,
          subject: r.subject,
          importance: r.importance,
          why: r.importance_reason,
          age_min: Math.floor((Date.now() - new Date(r.creation).getTime()) / 60000),
        }));
        return JSON.stringify({ count: rows.length, drafts: rows });
      }
      case "read_email_draft": {
        if (!isAssistant) return JSON.stringify({ error: "Assistant mode only" });
        const id = await resolveDraftId(String(args.draft_id ?? ""));
        if (!id) return JSON.stringify({ error: "Draft not found" });
        const data = await getPendingEmailDraft(id);
        if (!data) return JSON.stringify({ error: "Draft not found" });
        return JSON.stringify({
          id8: String((data as any).id).replace(/-/g, "").slice(0, 8),
          inbox: (data as any).inbox,
          from: (data as any).from_address,
          subject: (data as any).subject,
          importance: (data as any).importance,
          why: (data as any).importance_reason,
          original: String((data as any).original_body ?? "").slice(0, 1500),
          draft: (data as any).draft_body,
          status: (data as any).status,
        });
      }
      case "search_emails": {
        if (!isAssistant) return JSON.stringify({ error: "Assistant mode only" });
        const qStr = `%${String(args.query ?? "")}%`;
        const lim = Number(args.limit ?? 10);
        const data = await storeSearch(DT.EMAIL_MESSAGE_LOG, "subject", String(args.query ?? ""), { limit: lim });
        return JSON.stringify({ count: (data ?? []).length, results: data ?? [] });
      }
      case "approve_email_draft": {
        if (!isAssistant) return JSON.stringify({ error: "Assistant mode only" });
        const id = await resolveDraftId(String(args.draft_id ?? ""));
        if (!id) return JSON.stringify({ error: "Draft not found" });
        const { status, data } = await callEmailHandler("approve", { draft_id: id });
        return JSON.stringify({ status, ...data });
      }
      case "edit_email_draft": {
        if (!isAssistant) return JSON.stringify({ error: "Assistant mode only" });
        const id = await resolveDraftId(String(args.draft_id ?? ""));
        if (!id) return JSON.stringify({ error: "Draft not found" });
        const { status, data } = await callEmailHandler("edit", { draft_id: id, new_body: String(args.new_body ?? "") });
        return JSON.stringify({ status, ...data });
      }
      case "discard_email_draft": {
        if (!isAssistant) return JSON.stringify({ error: "Assistant mode only" });
        const id = await resolveDraftId(String(args.draft_id ?? ""));
        if (!id) return JSON.stringify({ error: "Draft not found" });
        const { status, data } = await callEmailHandler("discard", { draft_id: id });
        return JSON.stringify({ status, ...data });
      }
      case "lookup_orders": {
        const custId = String(args.customer_id ?? "");
        if (!custId) return JSON.stringify({ error: "customer_id required" });
        const oData = await storeList(DT.GEELUS_TRANSACTION, {
          filters: [["customer", "=", custId], ["customer_facing_stage", "not in", ["collected", "completed", "cancelled"]]],
          orderBy: "modified desc",
          limit: 10,
        });
        return JSON.stringify({ count: oData.length, orders: oData });
      }
      case "submit_order_request": {
        const custId = String(args.customer_id ?? "");
        const transactionId = args.transaction_id ? String(args.transaction_id) : null;
        const requestType = String(args.request_type ?? "other");
        const details = String(args.details ?? "");
        if (!custId || !details) return JSON.stringify({ error: "customer_id and details required" });
        const rqRow = await storeInsert(DT.ORDER_REQUEST, { customer: custId, transaction_id: transactionId, request_type: requestType, details, status: "pending", source_phone: from });
        if (!rqRow) return JSON.stringify({ error: "insert failed" });
        const rqCustName = customer ? `${(customer as any).first_name} ${(customer as any).last_name}` : from;
        await postToRaven(`:clipboard: *Order Request* — ${rqCustName}\nType: *${requestType}*\nDetails: ${details}${transactionId ? `\nOrder: \`${transactionId}\`` : ""}`);
        return JSON.stringify({ ok: true, request_id: (rqRow as any)?.id });
      }
      case "get_customer_tickets":
      case "get_ticket_status": {
        try {
          if (name === "get_customer_tickets") {
            const phoneArg = args.phone ? normalizePhone(String(args.phone)) : !isAssistant ? normalizePhone(from) : "";
            if (!phoneArg) return JSON.stringify({ error: "phone required" });

            const tickets = await getAlterationTicketsForPhone(phoneArg);
            const text = tickets.length
              ? tickets.map(formatTicketSummary).join("\n")
              : "No recent alteration tickets found for that phone number.";
            return JSON.stringify({ text, tickets });
          }

          const ticket = await getAlterationTicketByName(String(args.ticket_name ?? ""));
          if (!ticket) return JSON.stringify({ text: "No alteration ticket found with that name.", ticket: null });
          return JSON.stringify({ text: formatTicketSummary(ticket), ticket });
        } catch (e) {
          return JSON.stringify({ error: String((e as Error).message) });
        }
      }
      case "create_task": {
        const taskType = String(args.task_type ?? "internal");
        const title = String(args.title ?? "");
        if (!title) return JSON.stringify({ error: "title required" });
        const staffName = STAFF_PHONES_MAP[from.replace(/\D/g, "")] ?? null;
        const tsk = await storeInsert(DT.LS_TASK, {
            task_type: taskType,
            status: "open",
            priority: String(args.priority ?? "normal"),
            title,
            description: args.description ? String(args.description) : null,
            assigned_to_name: staffName,
            due_at: args.due_at ? String(args.due_at) : null,
            location_name: args.location_name ? String(args.location_name) : null,
            location_address: args.location_address ? String(args.location_address) : null,
            notes: args.notes ? String(args.notes) : null,
          });
        if (!tsk) return JSON.stringify({ error: "insert failed" });
        const items = Array.isArray(args.items)
          ? (args.items as { description: string; quantity?: number; unit?: string; preferred_vendor?: string }[])
          : [];
        if (items.length > 0) {
          const itemRows = items.map((it, i) => ({
            task_id: (tsk as any).id,
            description: String(it.description ?? ""),
            quantity: it.quantity != null ? Number(it.quantity) : null,
            unit: it.unit ?? null,
            preferred_vendor: it.preferred_vendor ?? null,
            sort_order: i,
            completed: false,
          }));
          for (const item of itemRows) await storeInsert(DT.LS_TASK_ITEM, { ...item, task: (tsk as any).name });
        }
        return JSON.stringify({ ok: true, task_no: (tsk as any).task_no, task_id: (tsk as any).id, title: (tsk as any).title, items_added: items.length });
      }
      case "create_todo": {
        const erpBase = process.env.ERPNEXT_BASE_URL ?? "";
        const erpKey  = process.env.ERPNEXT_API_KEY ?? "";
        const erpSec  = process.env.ERPNEXT_API_SECRET ?? "";
        if (!erpBase || !erpKey || !erpSec) return JSON.stringify({ error: "ERPNext not configured" });
        const callerEmail = Object.entries(STAFF_PHONES_MAP).find(([k]) => from.replace(/\D/g,"") === k)?.[1]
          ? `${Object.entries(STAFF_PHONES_MAP).find(([k]) => from.replace(/\D/g,"") === k)![1].toLowerCase()}@lstailors.com`
          : "carl@lstailors.com";
        const todoBody = {
          description: String(args.description ?? ""),
          status: "Open",
          priority: String(args.priority ?? "Medium"),
          date: args.date ? String(args.date) : null,
          allocated_to: args.allocated_to ? String(args.allocated_to) : "carl@lstailors.com",
          assigned_by: callerEmail,
        };
        const r = await fetch(`${erpBase}/api/resource/ToDo`, {
          method: "POST",
          headers: { Authorization: `token ${erpKey}:${erpSec}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(todoBody),
        });
        const rd: any = await r.json().catch(() => ({}));
        if (!r.ok) return JSON.stringify({ error: rd?.exc_type ?? "Failed to create todo" });
        return JSON.stringify({ ok: true, id: rd.data?.name, description: rd.data?.description });
      }

      case "list_my_tasks": {
        const erpBase = process.env.ERPNEXT_BASE_URL ?? "";
        const erpKey  = process.env.ERPNEXT_API_KEY ?? "";
        const erpSec  = process.env.ERPNEXT_API_SECRET ?? "";
        // Map caller phone to email
        const staffEntry = Object.entries(STAFF_PHONES_MAP).find(([k]) => from.replace(/\D/g,"") === k);
        const callerEmail = staffEntry ? `${staffEntry[1].toLowerCase()}@lstailors.com` : null;
        if (!erpBase || !erpKey || !erpSec) return JSON.stringify({ todos: [] });
        const filters = JSON.stringify([["status","=","Open"],["allocated_to","=", callerEmail ?? "carl@lstailors.com"]]);
        const fields = JSON.stringify(["name","description","priority","date"]);
        const res = await fetch(`${erpBase}/api/resource/ToDo?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}&limit=20&order_by=date asc`, {
          headers: { Authorization: `token ${erpKey}:${erpSec}`, Accept: "application/json" },
        });
        const rj: any = await res.json().catch(() => ({}));
        const todos = (rj.data ?? []).map((t: any) => ({
          id: t.name,
          task: t.description?.replace(/<[^>]*>/g,"").trim().slice(0,100),
          priority: t.priority,
          due: t.date ?? "no due date",
        }));
        return JSON.stringify({ count: todos.length, todos });
      }

      case "complete_task": {
        const erpBase = process.env.ERPNEXT_BASE_URL ?? "";
        const erpKey  = process.env.ERPNEXT_API_KEY ?? "";
        const erpSec  = process.env.ERPNEXT_API_SECRET ?? "";
        const todoId = String(args.todo_id ?? "");
        if (!todoId) return JSON.stringify({ error: "todo_id required" });
        const r = await fetch(`${erpBase}/api/resource/ToDo/${encodeURIComponent(todoId)}`, {
          method: "PUT",
          headers: { Authorization: `token ${erpKey}:${erpSec}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ status: "Closed" }),
        });
        if (!r.ok) return JSON.stringify({ error: "Could not mark complete" });
        return JSON.stringify({ ok: true, closed: todoId });
      }

      case "get_client_tasks": {
        const erpBase = process.env.ERPNEXT_BASE_URL ?? "";
        const erpKey  = process.env.ERPNEXT_API_KEY ?? "";
        const erpSec  = process.env.ERPNEXT_API_SECRET ?? "";
        const customerName = String(args.customer_name ?? "");
        if (!erpBase || !erpKey || !erpSec || !customerName) return JSON.stringify({ todos: [] });
        // Search todos where description contains customer name
        const filters = JSON.stringify([["status","=","Open"],["description","like",`%${customerName}%`]]);
        const fields = JSON.stringify(["name","description","priority","date","allocated_to"]);
        const res = await fetch(`${erpBase}/api/resource/ToDo?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}&limit=10`, {
          headers: { Authorization: `token ${erpKey}:${erpSec}`, Accept: "application/json" },
        });
        const rj: any = await res.json().catch(() => ({}));
        const todos = (rj.data ?? []).map((t: any) => ({
          id: t.name,
          task: t.description?.replace(/<[^>]*>/g,"").trim().slice(0,100),
          priority: t.priority,
          due: t.date ?? "no due date",
          assigned_to: t.allocated_to,
        }));
        return JSON.stringify({ count: todos.length, todos });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: String((e as Error).message) });
  }
}

// ── Full Sofia processMessage brain ──
async function processMessage(from: string, body: string, messageSid: string = ""): Promise<void> {


  try {
    if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(body.toUpperCase())) return;

    const fromDigits = from.replace(/\D/g, "");
    const isAssistant = fromDigits === C_MOBILE.replace(/\D/g, "");
    const isStaff = !isAssistant && fromDigits in STAFF_PHONES_MAP;
    const mode = isAssistant ? "ASSISTANT_SMS" : isStaff ? "STAFF_SMS" : "CONCIERGE";

    // ── Carl draft-command shortcuts ──
    if (isAssistant) {
      const m = body.match(/^(SEND|APPROVE|EDIT|SKIP|DISCARD)\s+([a-f0-9]{6,12})(?:\s+([\s\S]+))?$/i);
      if (m) {
        const cmd = m[1]!.toUpperCase();
        const id8 = m[2]!.toLowerCase();
        const extra = (m[3] ?? "").trim();
        const id = await resolveDraftId(id8);
        const replyTwilio = async (text: string) => { await twilioSend(from, text); };
        if (!id) { await replyTwilio(`No pending draft matching ${id8}`); return; }
        try {
          await insertSmsMessage({
            twilio_sid: messageSid || null,
            client_phone: from,
            direction: "inbound",
            content: body,
            timestamp: new Date().toISOString(),
            metadata: { mode, draft_cmd: cmd, draft_id: id },
          });
        } catch (_) {}
        if (cmd === "SEND" || cmd === "APPROVE") {
          const { data } = await callEmailHandler("approve", { draft_id: id });
          await replyTwilio(data?.ok ? `Sent OK (${id8})` : `Send failed: ${data?.error ?? "unknown"}`);
        } else if (cmd === "EDIT") {
          if (!extra) { await replyTwilio(`Usage: EDIT ${id8} <new body>`); return; }
          const { data } = await callEmailHandler("edit", { draft_id: id, new_body: extra });
          await replyTwilio(data?.ok ? `Edited & sent OK (${id8})` : `Edit failed: ${data?.error ?? "unknown"}`);
        } else {
          const { data } = await callEmailHandler("discard", { draft_id: id });
          await replyTwilio(data?.ok ? `Discarded (${id8})` : `Discard failed: ${data?.error ?? "unknown"}`);
        }
        return;
      }
    }

    // ── Carl escalation-reply detection ──
    let isEscalationReply = false;
    let escalationId: string | null = null;
    if (isAssistant) {
      const esc = await storeList(DT.ESCALATION, { filters: [["status", "=", "pending"]], orderBy: "creation desc", limit: 1 });
      const esc0 = esc?.[0];
      if (esc0) {
        const age = Date.now() - new Date(String(esc0.creation)).getTime();
        if (age < 90_000) {
          isEscalationReply = true;
          escalationId = String(esc0.name);
        }
      }
    }

    // ── Log inbound ──
    try {
      await insertSmsMessage({
        twilio_sid: messageSid || null,
        client_phone: from,
        direction: "inbound",
        content: body,
        timestamp: new Date().toISOString(),
        metadata: { mode },
      });
    } catch (e) {
      console.error("inbound log insert failed:", (e as Error).message);
    }

    // ── Look up customer ──
    let customer: Record<string, unknown> | null = null;
    try {
      customer = await lookupClientByPhone(from);
    } catch (_) {}

    // ── Handle escalation reply ──
    if (isEscalationReply && escalationId) {
      const XAI_KEY = process.env.XAI_API_KEY ?? "";
      const rewriteResp = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${XAI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "grok-4.20-0309-non-reasoning",
          messages: [
            {
              role: "system",
              content:
                GROK_IDENTITY +
                "You are Sofia for L&S Custom Tailors. Carl just answered a client question. Rewrite his reply in Sofia's warm, brief, professional voice. Keep under 160 chars.",
            },
            { role: "user", content: `Carl's reply: "${body}"` },
          ],
          max_tokens: 200,
          temperature: 0.3,
        }),
      });
      const rewriteJson = (await rewriteResp.json()) as { choices: { message: { content: string } }[] };
      const sofiaRewritten = sanitizeIdentity(rewriteJson.choices?.[0]?.message?.content?.trim() ?? body);
      await storeUpdate(DT.ESCALATION, escalationId, {
          status: "answered",
          c_reply_raw: body,
          sofia_rewritten: sofiaRewritten,
          carl_replied_at: new Date().toISOString(),
        });
      const escRow = await storeFindOne(DT.ESCALATION, "name", escalationId);
      if ((escRow as any)?.source_channel === "sms" && (escRow as any)?.source_phone) {
        const smsResult = await sendCustomerSmsViaErp({
          to: String((escRow as any).source_phone),
          body: sofiaRewritten,
          customer: (escRow as any)?.customer ? String((escRow as any).customer) : null,
          reference_doctype: DT.ESCALATION,
          reference_name: escalationId,
          context_tag: "sofia",
        });
        if (!smsResult.ok) console.error("ERPNext SMS error:", smsResult.error);
      }
      await postToRaven(`OK *Escalation answered*\nCarl: _${body}_\nSofia sent: ${sofiaRewritten}`);
      return;
    }

    // ── Load conversation history ──
    const messages: { role: string; content: string }[] = [];
    try {
      const hist = await listSmsMessagesFiltered({ phone: from, limit: 10 });
      hist.reverse().forEach((h: any) => messages.push({ role: h.direction === "inbound" ? "user" : "assistant", content: String(h.content) }));
    } catch (_) {}

    // ── Load system prompt from brain_entries ──
    let systemPrompt =
      "You are Sofia, the AI concierge for L&S Custom Tailors, 138 E 61st St, New York. You are powered by Grok 4.20 by xAI. Be warm, brief, professional. Never invent prices. Booking link is lstailors.com/book.";
    try {
      const sp = await listBrainEntriesFiltered({ agentSlug: "sofia", entryTypes: ["system_prompt"], limit: 1 });
      if (sp?.length) {
        const detail = String(sp[0].detail ?? "");
        if (detail && !detail.startsWith("<<PLACEHOLDER") && !detail.startsWith("<<ARCHIVED")) systemPrompt = detail;
      }
    } catch (_) {}

    // ── Knowledge base context ──
    let kbContext = "";
    try {
      const kb = (await listBrainEntriesFiltered({ agentSlug: "sofia", limit: 20 }))
        .filter((e) => e.entry_type !== "system_prompt")
        .slice(0, 8);
      if (kb?.length) {
        kbContext = kb
          .map((k: any) => `[${k.entry_type}] ${k.summary}: ${String(k.detail ?? "").substring(0, 300)}`)
          .join("\n");
      }
    } catch (_) {}

    // ── Current NYC time block ──
    const now = new Date();
    const nycParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(now);
    const nycMap: Record<string, string> = {};
    for (const p of nycParts) nycMap[p.type] = p.value;
    const nycTime = `${nycMap.weekday}, ${nycMap.month} ${nycMap.day}, ${nycMap.year} - ${nycMap.hour}:${nycMap.minute} ${nycMap.dayPeriod} ET`;
    const tmrw = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tmrwWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(tmrw);
    const timeBlock = `\n\n=== CURRENT DATE/TIME (authoritative - trust this over any prior knowledge) ===\nToday is ${nycTime}.\nTomorrow is ${tmrwWeekday}.\nUse THIS day/date when answering anything time-related. Never assume a different day.\n=== END DATE/TIME ===`;

    const antiHallucination = `

=== ANTI-HALLUCINATION RULES (ABSOLUTE - violation = critical failure) ===
1. NEVER invent, imply, or reference an appointment that does not exist. If there is no successful book_fitting tool result in this conversation OR a real fitting from get_fitting_history, NO appointment exists.
2. NEVER use closing phrases like "see you tomorrow", "see you at X", "your fitting is at X", "you are booked for X", "your appointment is X", "confirmed for X", "see you then" UNLESS you have either: (a) a successful book_fitting/reschedule_booking tool result in THIS turn, or (b) a real upcoming fitting from get_fitting_history showing customer_id matches.
3. NEVER say "done", "booked", "confirmed", "rescheduled", "moved", "cancelled", or "all set" without a successful corresponding tool call result in the same turn.
4. If the user references an appointment you have no tool-confirmed record of, do NOT play along. Say: "I want to make sure I get this right - I do not see a booking on file. Want me to set one up?"
5. Informational topics (wine stains, fabric care, hours, prices) NEVER end with an appointment reference. End with a question or simple signoff only.
6. If asked to send "email confirmation" or "booking confirmation" of an appointment, you MUST have a real booking_uid from a successful book_fitting result.
7. The booking confirmation email is automatically sent by our Cal.com pipeline immediately after a successful book_fitting.
=== END ANTI-HALLUCINATION ===`;

    const assistantSendRules = `

=== ASSISTANT SEND RULES (ABSOLUTE) ===
When Carl tells you to text/message/SMS/notify a client, you are an ACTION layer, not a draft layer.

1. NO-DRAFT RULE: NEVER respond with "draft ready, reply YES to send", "confirm with YES", "should I send this?", "want me to send?", or any variant. If Carl said send, SEND. The only acceptable behavior is to immediately call send_sms_to_client (or send_mms_card) and then report what you sent.

2. NEVER-LIE RULE: NEVER say "Sent.", "Message sent", or any confirmation UNLESS the SAME turn contains a successful send_sms_to_client OR send_mms_card tool call returning ok:true with a twilio_sid.

3. RECIPIENT RESOLUTION: If Carl gives a name only - lookup_customer first, then send_sms_to_client with customer_id. If Carl gives a phone - send_sms_to_client with to_phone directly. If Carl gives both - prefer customer_id.

4. ONE clarifying question is allowed only when (a) recipient is genuinely ambiguous (multiple matches) or (b) the message is fundamentally incomplete.

5. AFTER SENDING: report in one short sentence what you actually sent and to whom.

6. ACTING ON BEHALF OF A CLIENT: Carl is the OPERATOR, not the client. If Carl says "book Sal a fitting Tuesday 2pm" or "text Sal that his suit is ready", the SUBJECT is Sal, not Carl. You MUST: (a) call lookup_customer with the client name FIRST, (b) pass that client id/name/email/phone to send_sms_to_client / send_mms_card / book_fitting. NEVER use Carl name, email, or phone as the attendee or recipient. If lookup_customer returns multiple matches, ask Carl which one. If not found, ask Carl for the phone/email - do not fall back to Carl own contact info.

7. PREFER MMS CARD for branded moments. When the message is a known event with a matching template_key in sofia_mms_active, use send_mms_card instead of send_sms_to_client.
=== END ASSISTANT SEND RULES ===`;

    const staffPreamble = `\n\n[STAFF MODE - ${STAFF_PHONES_MAP[fromDigits] ?? "Staff"}]
You are Sofia, L&S internal assistant. ${STAFF_PHONES_MAP[fromDigits] ?? "A staff member"} is texting you.

You handle two types of requests — pick the right tool immediately without asking:

BUSINESS TODOS → create_todo (DEFAULT for most requests)
Use create_todo for ANYTHING involving: calling/contacting someone, following up, checking on an order, reminders, client-related actions, scheduling, invoices, appointments, or any business action.
- "call X", "follow up with Y", "remind me to Z", "check on order", "contact client" → create_todo
- Include date/time in the description if mentioned (e.g. "Call Alex E - Tuesday June 9 10am")

OPERATIONAL TASKS → create_task (ONLY for physical in-person tasks)
- Items to buy/order → task_type: "shopping"
- Go somewhere physically → task_type: "errand"
- Collect something in person → task_type: "pickup"
- Bring/deliver physically → task_type: "dropoff"
- When in doubt, use create_todo

TASK QUERIES → list_my_tasks
- "what are my tasks", "my todo list", "what do I have today"

MARK DONE → complete_task (use todo id from list_my_tasks)
- "done with X", "mark X complete", "finished Y"

Reply with ONE short confirmation only. Examples:
- create_task → "✓ Added: [title]"
- create_todo → "✓ Todo: [description]"
- list_my_tasks → list them cleanly, one per line with due date if set
- complete_task → "✓ Done: [task]"`;

    const modePreamble = isStaff
      ? staffPreamble
      : isAssistant
      ? '\n\n[ASSISTANT MODE - Carl. All tools enabled. Be direct, brief. When Carl says send/text/message a client, IMMEDIATELY call send_sms_to_client or send_mms_card - never draft and ask. When Carl asks "what\'s on the schedule", "who do we have today/tomorrow/this week", or any schedule query - IMMEDIATELY call list_appointments (no args = today). Never say you cannot see the calendar.]' +
        assistantSendRules
      : `

[CONCIERGE MODE - client interaction. Restricted tools. Never invent pricing, fitting times, appointment dates, or order status. If you do not have data from a tool, say you will check with Carl. Use add_dossier_observation silently. Also use create_todo silently whenever a client interaction reveals a follow-up action needed (e.g. client mentions a complaint, requests a callback, has an open invoice question, needs a rush order, or any situation requiring staff follow-up). Always include the client name and context in the todo description. When a known client contacts you, silently call get_client_tasks with their name to check for any pending follow-ups — mention relevant ones naturally if appropriate.]

BOOKING POLICY: When a client wants to book/reschedule/cancel an appointment, ALWAYS offer two options: (1) "I can book it for you right now - just need your name and email" or (2) "I can text you our booking link: lstailors.com/book". Honor whichever they pick. If they choose option 1: call get_available_slots first, present 2-3 nearby options in plain English, then call book_fitting once they confirm and you have name + email. Never book without an explicit yes AND name + email. Default event_type is fitting unless they say consultation, alterations, pickup, or exchange.

RESCHEDULE/CANCEL POLICY: To reschedule or cancel, call get_fitting_history first (always pass the customer's customer_id AND/OR their phone). Then:
- If booking_uid is present (source=cal.com): call reschedule_booking or cancel_booking.
- If booking_uid is null (source=apple-calendar): you CANNOT reschedule via API. Instead - (1) acknowledge the appointment by name and date, (2) ask the client what time works for them, (3) when they reply, call take_message with their request (urgency=normal), (4) tell the client: "I've passed your request to Carl - he will confirm the new time with you shortly." NEVER attempt reschedule_booking with a null uid.
- If get_fitting_history returns no appointments at all: do NOT pretend one exists. Ask if they want to book fresh.

ORDER POLICY: When a client asks about their order status, due date, or garments — call lookup_orders first. For delivery requests, change requests, pickup scheduling, or questions you cannot resolve from the data, use submit_order_request to alert Carl's team — then tell the client: "I've passed your request to the team and they'll be in touch shortly."

IMPORTANT: get_fitting_history auto-searches by the caller's inbound phone as fallback, so even Apple Calendar appointments (which may not have a customer_id link) will surface - always check before saying no appointment exists.`;

    const customerCtx = isStaff
      ? `\nStaff sender: ${STAFF_PHONES_MAP[fromDigits]} (${fromDigits === "16462087809" ? "Office Manager" : "Messenger & Runner"}). This is an internal staff request, NOT a customer. Do not treat as a booking or customer inquiry.`
      : isAssistant
      ? "\nOperator: Carl Viola (owner). The sender of this SMS is Carl, NOT a client. Carl is your boss, not a customer to book. When Carl asks you to act on a CLIENT (book, text, message), you MUST first call lookup_customer to find that named client, then pass THEIR id/name/phone to subsequent tools. Never use Carl name, phone, or email as the attendee/recipient when the action is meant for a different person."
      : customer
      ? `\nCustomer: ${(customer as any).first_name} ${(customer as any).last_name} | Phone: ${(customer as any).phone} | VIP: ${(customer as any).is_vip ?? false} | ID: ${(customer as any).id}`
      : `\nContact: ${from} (not in database)`;
    const ownerCtx = isAssistant ? "\nYou are speaking with Carl Viola. Address him as \"C\". Skip pleasantries." : "";

    const fullSystem =
      GROK_IDENTITY +
      timeBlock +
      antiHallucination +
      "\n\n" +
      systemPrompt +
      modePreamble +
      customerCtx +
      ownerCtx +
      (kbContext ? `\n\nKnowledge Base:\n${kbContext}` : "");

    const XAI_KEY = process.env.XAI_API_KEY ?? "";
    const currentMessages: { role: string; content: string | unknown[]; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[] = [
      { role: "system", content: fullSystem },
      ...messages,
      { role: "user", content: body },
    ];

    let finalText = "";
    for (let round = 0; round < 6; round++) {
      let xaiResp: Record<string, unknown>;
      try {
        const r = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${XAI_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "grok-4.20-0309-non-reasoning",
            messages: currentMessages,
            tools: isStaff ? STAFF_TOOLS : TOOLS,
            tool_choice: "auto",
            max_tokens: 500,
            temperature: 0.3,
          }),
        });
        xaiResp = (await r.json()) as Record<string, unknown>;
      } catch (_) {
        finalText = "I am briefly unavailable - someone will be in touch within the hour.";
        break;
      }
      const choice = (xaiResp as { choices?: { finish_reason: string; message: Record<string, unknown> }[] }).choices?.[0];
      if (!choice) {
        finalText = "I am briefly unavailable. Please try again in a moment.";
        break;
      }
      const msg = choice.message;
      currentMessages.push(msg as { role: string; content: string });

      if (choice.finish_reason === "tool_calls" && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        const toolResults: { role: string; tool_call_id: string; name: string; content: string }[] = [];
        for (const tc of msg.tool_calls as { id: string; function: { name: string; arguments: string } }[]) {
          let targs: Record<string, unknown> = {};
          try {
            targs = JSON.parse(tc.function.arguments);
          } catch {
            targs = {};
          }
          const result = await executeTool(tc.function.name, targs, from, customer, isAssistant);
          toolResults.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: result });
        }
        currentMessages.push(...(toolResults as { role: string; content: string }[]));
        continue;
      }
      finalText = String(msg.content ?? "").trim();
      break;
    }
    if (!finalText) finalText = "Let me check on that and get right back to you.";

    finalText = sanitizeIdentity(finalText);

    // Trim to 320 chars for non-assistant clients
    if (!isAssistant && finalText.length > 320) {
      const sentences = finalText.match(/[^.!?]+[.!?]+/g) ?? [finalText];
      let short = "";
      for (const s of sentences) {
        if ((short + s).length <= 320) short += s;
        else break;
      }
      finalText = short || finalText.substring(0, 317) + "...";
    }

    // ── Human-like delay (8-20 seconds) before sending ──
    let outboundHandledByErp = false;
    if (!body.startsWith("__TEST__")) {
      const delayMs = Math.floor(Math.random() * 12000) + 8000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        if (isStaff || isAssistant) {
          await twilioSend(from, finalText);
        } else {
          outboundHandledByErp = true;
          const smsResult = await sendCustomerSmsViaErp({
            to: from,
            body: finalText,
            customer: customerLink(customer),
            context_tag: "sofia",
            client_name: customerDisplayName(customer),
          });
          if (!smsResult.ok) console.error("ERPNext SMS error:", smsResult.error);
        }
      } catch (e) {
        console.error("SMS error:", e);
      }
    }

    // ── Log outbound ──
    if (!outboundHandledByErp) {
      try {
        await insertSmsMessage({
          client_phone: from,
          client_id: customer ? String((customer as any).id) : null,
          direction: "outbound",
          content: finalText,
          metadata: { mode, rounds: currentMessages.length },
        });
      } catch (_) {}
    }

    // ── Notify via Raven ──
    try {
      const custName = customer ? `${(customer as any).first_name} ${(customer as any).last_name}` : from;
      await postToRaven(
        isAssistant
          ? `*[ASSISTANT]* Carl: _${body}_\nSofia: ${finalText}`
          : `*[${custName}]* _${body}_\nSofia: ${finalText}`
      );
    } catch (_) {}
  } catch (e) {
    console.error("processMessage error:", e);
  }
}

export const sofiaRouter = new Hono();

// ── GET /api/sofia/conversations ──
// sms_messages is org-wide (no location_id column). Scope by role only: driver=blocked.
sofiaRouter.get("/conversations", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });

  // ?search= filters by phone or client name; ?limit/?start page through.
  // Defaults to every thread — 321 today, ~15ms — so the console is a true
  // mirror of everyone Sofia has spoken to, not just recent activity.
  const search = c.req.query("search")?.trim() || undefined;
  const limit = Math.min(Number(c.req.query("limit") ?? 500) || 500, 1000);
  const start = Number(c.req.query("start") ?? 0) || 0;

  try {
    const { threads, total } = await buildSofiaThreads({ limit, start, search });
    return c.json({ data: threads, meta: { total, limit, start } });
  } catch (e: any) {
    // Fall back to the old in-Node grouping rather than showing an empty console.
    console.error("[sofia/conversations] list_threads failed, falling back:", e?.message);
    const data = await buildLocalSofiaConversations();
    return c.json({ data, meta: { total: data.length, degraded: true } });
  }
});

// ── GET /api/sofia/conversations/:phone ── full thread
sofiaRouter.get("/conversations/:phone", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);

  const phone = decodeURIComponent(c.req.param("phone"));
  const data = await loadLocalSofiaMessages({ phone, limit: 2000, ascending: true });
  return c.json({ data });
});

// ── POST /api/sofia/conversations/:phone/handoff ──
// Takes a thread away from the AI, or gives it back.
//
// Body: { release?: boolean, notes?: string }
//
// The flag lives in LSH SMS Thread Control (one row per phone). Both the relay
// and the sofia-sms agent read it — the relay skips waking the agent at all,
// and the agent re-checks immediately before sending, which closes the race
// where a human takes over mid-generation.
//
// LSH Conversation Handoff stays what it already was: an append-only audit
// trail. Note its real fields are client_phone / handoff_to / reason / context
// — the previous code wrote handoff_type, taken_over_by, decision, note and
// previous_sofia_state, none of which exist on the doctype, so every one of
// those values was silently dropped.
sofiaRouter.post("/conversations/:phone/handoff", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);

  const phone = decodeURIComponent(c.req.param("phone"));
  const body = await c.req.json().catch(() => ({}));
  const notes = typeof body?.notes === "string" ? body.notes : undefined;
  const release = body?.release === true;
  const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");

  try {
    await storeUpsert(
      DT.SMS_THREAD_CONTROL,
      release
        ? { client_phone: phone, ai_enabled: 1, released_at: nowIso, note: notes ?? null }
        : {
            client_phone: phone,
            ai_enabled: 0,
            taken_over_by: user.id,
            taken_over_at: nowIso,
            released_at: null,
            note: notes ?? null,
          },
      "client_phone",
    );
  } catch (e: any) {
    console.error("[sofia/handoff] thread control write failed:", e?.message);
    return c.json({ error: { message: "Failed to change thread control" } }, 500);
  }

  // Audit trail — best effort, must not fail the takeover itself.
  try {
    await storeInsert(DT.CONVERSATION_HANDOFF, {
      client_phone: phone,
      handoff_to: release ? "sofia" : user.id,
      reason: release ? "released back to AI" : "human takeover",
      context: JSON.stringify({ by: user.id, at: nowIso, notes: notes ?? null }),
    });
  } catch (e: any) {
    console.error("[sofia/handoff] audit insert failed (non-fatal):", e?.message);
  }

  return c.json({ data: { ok: true, phone, aiEnabled: release } });
});

// ── GET /api/sofia/escalations ──
// The Carl loop, for the console: pending / waiting_carl / answered.
// ?status=open returns just the ones still needing him (the default view).
sofiaRouter.get("/escalations", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);

  const status = c.req.query("status") ?? "open";
  const filters: unknown[] =
    status === "all" ? [] :
    status === "open" ? [["status", "in", ["pending", "waiting_carl"]]] :
    [["status", "=", status]];

  try {
    const data = await storeList(DT.ESCALATION, {
      filters,
      fields: [
        "name", "client_phone", "client_name", "customer", "status", "severity",
        "source_channel", "summary", "reason", "opened_at", "expires_at",
        "repinged_at", "carl_replied_at", "c_reply_raw", "sofia_rewritten",
        "voice_call_sid",
      ],
      // Oldest first: the one that has been waiting longest is the one that matters.
      orderBy: "opened_at asc",
      limit: 100,
    });
    return c.json({ data });
  } catch (e: any) {
    console.error("[sofia/escalations] read failed:", e?.message);
    return c.json({ error: { message: "Failed to load escalations" } }, 502);
  }
});

// ── GET /api/sofia/threads ── same full book as /conversations (list_threads)
sofiaRouter.get("/threads", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });

  const search = c.req.query("search")?.trim() || undefined;
  const limit = Math.min(Number(c.req.query("limit") ?? 500) || 500, 1000);
  const start = Number(c.req.query("start") ?? 0) || 0;

  try {
    const { threads, total } = await buildSofiaThreads({ limit, start, search });
    return c.json({ data: threads, meta: { total, limit, start } });
  } catch (e: any) {
    console.error("[sofia/threads] list_threads failed, falling back:", e?.message);
    const data = await buildLocalSofiaConversations();
    return c.json({ data, meta: { total: data.length, degraded: true } });
  }
});

// ── GET /api/sofia/thread/:phone ── full conversation
sofiaRouter.get("/thread/:phone", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  

  const phone = decodeURIComponent(c.req.param("phone"));
  const data = await loadLocalSofiaMessages({ phone, limit: 2000, ascending: true });
  return c.json({ data });
});

// ── POST /api/sofia/send ── send customer SMS via ERPNext logging helper
sofiaRouter.post("/send", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json().catch(() => ({}));
  const { to, message, client_id, reference_doctype, reference_name, context_tag, client_name } = body;
  if (!to || !message) return c.json({ error: { message: "to and message required" } }, 400);

  const result = await sendCustomerSmsViaErp({
    to: String(to),
    body: String(message),
    customer: client_id ? String(client_id) : null,
    reference_doctype: reference_doctype ? String(reference_doctype) : null,
    reference_name: reference_name ? String(reference_name) : null,
    context_tag: context_tag ? String(context_tag) : "sofia",
    client_name: client_name ? String(client_name) : null,
  });
  if (!result.ok) return c.json({ error: { message: result.error ?? "ERPNext SMS send failed" } }, 502);

  return c.json({ data: { ok: true, sid: result.sid, message_name: result.message_name } });
});

// ── GET /api/sofia/voice-approvals ──
// Source: public.voice_approval_requests (separate from approval_queue)
sofiaRouter.get("/voice-approvals", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver" || user.role === "salesperson")
    return c.json({ error: { message: "Forbidden" } }, 403);

  

  const data = await storeList(DT.VOICE_APPROVAL_REQUEST, { orderBy: "creation desc", limit: 50 });
  return c.json({ data: data.map((r) => ({ ...r, id: r.name, created_at: r.creation })) });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/sofia/sms  — Twilio webhook (signature validated)
// ────────────────────────────────────────────────────────────────────────────
sofiaRouter.post("/sms", async (c) => {
  // As of the sofia-sms cutover (2026-07-29) the SMS brain is the Hermes
  // profile behind sofia-sms.lstailors.com. This route is kept for rollback,
  // but it must never generate a second reply: two brains answering one client
  // is the worst failure mode this build has.
  //
  // Twilio does not point here (it pointed at sofia.lstailors.com/sms/incoming
  // before cutover, which is also the rollback target), so a hit means a stale
  // config somewhere. Ack and drop.
  //
  // Set SOFIA_APP_SMS_BRAIN=1 to re-enable the old Grok path — the only reason
  // to do that is if the Hermes path is down AND Twilio has been pointed back
  // at this URL specifically.
  if (process.env.SOFIA_APP_SMS_BRAIN !== "1") {
    console.warn(
      "[sofia/sms] inbound hit the retired app brain — acking without processing. " +
      "The live SMS brain is the Hermes sofia-sms profile.",
    );
    return emptyTwiml(c);
  }

  try {
    const formText = await c.req.text();
    const params = new URLSearchParams(formText);

    if (!(await isValidTwilioWebhook(c, params))) {
      console.error("[sofia/sms] rejected invalid Twilio signature");
      return emptyTwiml(c);
    }

    const from = params.get("From") ?? params.get("from") ?? "";
    const body = (params.get("Body") ?? params.get("body") ?? "").trim();
    const messageSid = params.get("MessageSid") ?? params.get("SmsSid") ?? params.get("messageSid") ?? "";

    if (!from || !body) {
      return emptyTwiml(c);
    }

    if (messageSid) {
      const existing = await findSmsByTwilioSid(messageSid).catch(() => null);
      if (existing) {
        console.info(`[sofia/sms] duplicate Twilio MessageSid ignored: ${messageSid}`);
        return emptyTwiml(c);
      }
    }

    // Grok call + 8-20s human-like delay + Twilio/ERP send run far longer than
    // Twilio's webhook timeout. Reply with TwiML immediately and finish processing
    // in the background via the execution context's waitUntil, which keeps the
    // invocation alive after the response is sent.
    const task = processMessage(from, body, messageSid).catch((e: any) =>
      console.error("[sofia/sms] processMessage error:", e?.message ?? e),
    );
    try {
      c.executionCtx.waitUntil(task);
    } catch {
      // No execution context (e.g. local Bun dev) — await inline as a fallback.
      await task;
    }

  } catch (err: any) {
    console.error("[sofia/sms] parse error:", err?.message ?? err);
  }

  return emptyTwiml(c);
});

// POST /api/sofia/process — internal fallback endpoint (kept for manual testing)
// HER-61 S3: no hardcoded fallback secret — fail closed if unset.
sofiaRouter.post("/process", async (c) => {
  const secret = (process.env.SOFIA_PROCESS_SECRET ?? "").trim();
  if (!secret) return c.json({ error: "SOFIA_PROCESS_SECRET not configured" }, 503);
  const provided = (c.req.header("x-sofia-process-secret") ?? "").trim();
  if (!provided || provided !== secret) {
    return c.json({ error: "Forbidden" }, 403);
  }
  try {
    const { from, body, messageSid } = await c.req.json();
    if (!from || !body) return c.json({ ok: false, error: "missing fields" }, 400);
    await processMessage(from, body, messageSid ?? "").catch((e: any) =>
      console.error("[sofia/process] error:", e?.message ?? e)
    );
    return c.json({ ok: true });
  } catch (err: any) {
    console.error("[sofia/process] parse error:", err?.message ?? err);
    return c.json({ ok: false, error: err?.message ?? "unknown" }, 500);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Tasks routes
// ────────────────────────────────────────────────────────────────────────────

// GET /api/sofia/tasks
sofiaRouter.get("/tasks", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  

  const status = c.req.query("status");
  const assignedTo = c.req.query("assigned_to");

  const filters = [];
  if (status) filters.push(["status", "=", status]);
  if (assignedTo) filters.push(["assigned_to", "=", assignedTo]);
  const data = await storeList(DT.TASK, { filters, orderBy: "creation desc", limit: 100 });
  return c.json({ data: data.map((r) => ({ ...r, id: r.name, created_at: r.creation, updated_at: r.modified })) });
});

// POST /api/sofia/tasks
sofiaRouter.post("/tasks", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  

  const body = await c.req.json().catch(() => ({}));
  const { title, description, project, section, assigned_to, assigned_agent, priority, due_date, due_datetime, labels, client_id } = body;

  if (!title) return c.json({ error: { message: "title is required" } }, 400);

  const data = await storeInsert(DT.TASK, {
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
      labels: JSON.stringify(labels ?? []),
      client_id: client_id ?? null,
      created_by: user.email ?? "concierge",
    });
  if (!data) return c.json({ error: { message: "insert failed" } }, 500);
  return c.json({ data: { ...data, id: (data as any).name } }, 201);
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/sofia/briefing  +  GET /api/sofia/briefing/trigger
// Ops briefing for Carl: ERPNext live data → emoji SMS + Raven DM + agent_briefs.
// Vercel cron: 2× weekdays (8am + 3pm ET). Maestro brief/trigger cron removed (dup).
// Auth: CRON_SECRET or session (requireCronOrSession).
// ────────────────────────────────────────────────────────────────────────────

const BRIEFING_SOFIA_DM_CHANNEL = "b56k4sapbj";

function money(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function nycDateStr(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function phoneKey(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function postRavenDm(text: string): Promise<void> {
  const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? "https://erp.lstailors.com";
  const key = (process.env.ERPNEXT_CARL_API_KEY ?? process.env.ERPNEXT_API_KEY ?? "").trim();
  const secret = (process.env.ERPNEXT_CARL_API_SECRET ?? process.env.ERPNEXT_API_SECRET ?? "").trim();
  if (!key || !secret) {
    console.error("[sofia/postRavenDm] ERP keys unset");
    return;
  }
  try {
    await fetch(`${ERP_BASE}/api/resource/Raven%20Message`, {
      method: "POST",
      headers: {
        Authorization: `token ${key}:${secret}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0)",
      },
      body: JSON.stringify({
        channel_id: BRIEFING_SOFIA_DM_CHANNEL,
        text,
        message_type: "Text",
        owner: "concierge@lstailors.com",
      }),
    });
  } catch (e: any) {
    console.error("[sofia/postRavenDm]", e?.message);
  }
}

async function runBriefing(): Promise<{ ok: boolean; briefing?: string; error?: string }> {
  const ownerPhone = process.env.OWNER_MOBILE ?? CARL_PHONE;
  const todayStr = nycDateStr();
  const nycHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10
  );
  const period = nycHour < 12 ? "Morning" : nycHour < 16 ? "Midday" : "Afternoon";
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());

  const staffKeys = new Set(
    [...STAFF_PHONES].map((p) => phoneKey(p)).filter(Boolean)
  );

  // ── Parallel ERP pulls ──────────────────────────────────────────────────
  const [
    paymentEntries,
    overdueInvoices,
    openTickets,
    openOrders,
    recentSms,
    eventsToday,
    appointmentsToday,
    readyTickets,
  ] = await Promise.all([
    erpList<any>("Payment Entry", {
      filters: [
        ["docstatus", "=", 1],
        ["posting_date", "=", todayStr],
        ["payment_type", "=", "Receive"],
      ],
      fields: ["name", "party", "party_name", "paid_amount", "received_amount", "mode_of_payment"],
      order_by: "creation desc",
      limit: 50,
    }).catch(() => []),
    erpList<any>("Sales Invoice", {
      filters: [
        ["docstatus", "=", 1],
        ["outstanding_amount", ">", 0],
        ["due_date", "<", todayStr],
      ],
      fields: ["name", "customer", "customer_name", "outstanding_amount", "due_date", "status"],
      order_by: "outstanding_amount desc",
      limit: 100,
    }).catch(() => []),
    erpList<any>("Alteration Ticket", {
      filters: [["workflow_state", "not in", ["Delivered", "Cancelled", "Picked Up"]]],
      fields: ["name", "workflow_state", "due_date", "customer_name", "is_rush", "ticket_total"],
      order_by: "due_date asc",
      limit: 100,
    }).catch(() => []),
    erpList<any>("Sales Order", {
      filters: [
        ["docstatus", "=", 1],
        ["status", "in", ["To Deliver and Bill", "To Deliver", "To Bill", "To Pay"]],
      ],
      fields: ["name", "customer", "customer_name", "status", "grand_total", "delivery_date"],
      order_by: "delivery_date asc",
      limit: 80,
    }).catch(() => []),
    listSmsMessagesFiltered({ limit: 200 }).catch(() => []),
    erpList<any>("Event", {
      filters: [
        ["starts_on", ">=", `${todayStr} 00:00:00`],
        ["starts_on", "<=", `${todayStr} 23:59:59`],
        ["status", "!=", "Cancelled"],
      ],
      fields: ["name", "subject", "starts_on", "status", "google_calendar"],
      order_by: "starts_on asc",
      limit: 30,
    }).catch(() => []),
    erpList<any>("Appointment", {
      filters: [
        ["scheduled_time", ">=", `${todayStr} 00:00:00`],
        ["scheduled_time", "<=", `${todayStr} 23:59:59`],
        ["status", "not in", ["Closed", "Cancelled"]],
      ],
      fields: ["name", "scheduled_time", "status", "customer_name", "custom_appointment_type"],
      order_by: "scheduled_time asc",
      limit: 30,
    }).catch(() => []),
    erpList<any>("Alteration Ticket", {
      filters: [["workflow_state", "=", "Ready"]],
      fields: ["name", "customer_name", "due_date", "ticket_total"],
      order_by: "due_date asc",
      limit: 30,
    }).catch(() => []),
  ]);

  // ── Collected today ─────────────────────────────────────────────────────
  const collectedTotal = paymentEntries.reduce(
    (s, p) => s + Number(p.received_amount ?? p.paid_amount ?? 0),
    0
  );
  const collectedLines = paymentEntries.slice(0, 4).map((p) => {
    const who = p.party_name || p.party || "Client";
    const amt = money(Number(p.received_amount ?? p.paid_amount ?? 0));
    const mop = p.mode_of_payment ? ` via ${p.mode_of_payment}` : "";
    return `${who} ${amt}${mop}`;
  });

  // ── Overdue AR ──────────────────────────────────────────────────────────
  const overdueTotal = overdueInvoices.reduce(
    (s, i) => s + Number(i.outstanding_amount ?? 0),
    0
  );
  const topOverdue = overdueInvoices.slice(0, 3).map((i) => {
    const who = i.customer_name || i.customer || i.name;
    return `${who} ${money(Number(i.outstanding_amount ?? 0))}`;
  });

  // ── Alterations ─────────────────────────────────────────────────────────
  const altOverdue = openTickets.filter((t) => t.due_date && String(t.due_date) < todayStr);
  const altDueToday = openTickets.filter((t) => t.due_date && String(t.due_date) === todayStr);
  const altRush = openTickets.filter((t) => Number(t.is_rush) === 1 || t.is_rush === true);
  const altTopOverdue = altOverdue.slice(0, 3).map((t) => {
    const who = t.customer_name || t.name;
    return `${who} (due ${t.due_date})`;
  });

  // ── Sales orders ────────────────────────────────────────────────────────
  const soPast = openOrders.filter((o) => o.delivery_date && String(o.delivery_date) < todayStr);
  const soDueSoon = openOrders.filter((o) => {
    if (!o.delivery_date) return false;
    const d = String(o.delivery_date);
    return d >= todayStr && d <= nycDateStr(new Date(Date.now() + 7 * 86400000));
  });
  const soTopPast = soPast.slice(0, 3).map((o) => {
    const who = o.customer_name || o.customer || o.name;
    return `${who} (due ${o.delivery_date})`;
  });

  // ── Unanswered SMS (last msg per phone is inbound, not staff) ───────────
  const latestByPhone = new Map<string, any>();
  for (const m of recentSms as any[]) {
    const k = phoneKey(m.client_phone);
    if (!k || staffKeys.has(k)) continue;
    if (!latestByPhone.has(k)) latestByPhone.set(k, m);
  }
  const unanswered: any[] = [];
  for (const m of latestByPhone.values()) {
    if (String(m.direction ?? "").toLowerCase() === "inbound") unanswered.push(m);
  }
  const unansweredPhones = unanswered.length;
  const unansweredPreview = unanswered.slice(0, 3).map((m) => {
    const who = m.client_name || m.customer || m.client_phone || "client";
    const snip = String(m.content || m.body || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return snip ? `${who}: "${snip}${snip.length >= 40 ? "…" : ""}"` : String(who);
  });

  // ── Appointments today ──────────────────────────────────────────────────
  const fmtTime = (t: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(String(t).includes("T") ? t : String(t).replace(" ", "T")));

  const apptBits: string[] = [];
  for (const e of eventsToday) {
    if (e.starts_on) {
      apptBits.push(`${fmtTime(e.starts_on)} ${e.subject || "Event"}`);
    }
  }
  for (const a of appointmentsToday) {
    if (a.scheduled_time) {
      const label = a.custom_appointment_type || a.customer_name || "Appt";
      const who = a.customer_name && a.custom_appointment_type ? ` – ${a.customer_name}` : "";
      apptBits.push(`${fmtTime(a.scheduled_time)} ${label}${who}`);
    }
  }
  // de-dupe similar strings
  const apptsUnique = [...new Set(apptBits)].slice(0, 6);

  // ── Ready for pickup ────────────────────────────────────────────────────
  const readyCount = readyTickets.length;
  const readyPreview = readyTickets.slice(0, 3).map((t) => t.customer_name || t.name);

  // ── Compose emoji brief (SMS-safe, no markdown) ─────────────────────────
  const lines: string[] = [];
  lines.push(`☕ ${period} Brief · ${clock}`);
  lines.push("");

  // Collected
  if (paymentEntries.length) {
    lines.push(`💵 Collected today: ${money(collectedTotal)} (${paymentEntries.length} payment${paymentEntries.length === 1 ? "" : "s"})`);
    for (const c of collectedLines) lines.push(`  · ${c}`);
  } else {
    lines.push(`💵 Collected today: $0`);
  }
  lines.push("");

  // Overdue AR
  if (overdueInvoices.length) {
    lines.push(`🔴 Overdue invoices: ${overdueInvoices.length} · ${money(overdueTotal)}`);
    for (const t of topOverdue) lines.push(`  · ${t}`);
    if (overdueInvoices.length > 3) lines.push(`  · +${overdueInvoices.length - 3} more`);
    lines.push(`  → Prioritize collections`);
  } else {
    lines.push(`✅ Overdue invoices: none`);
  }
  lines.push("");

  // Alterations
  if (openTickets.length) {
    const bits = [
      `${openTickets.length} open`,
      altOverdue.length ? `${altOverdue.length} overdue` : null,
      altDueToday.length ? `${altDueToday.length} due today` : null,
      altRush.length ? `${altRush.length} rush` : null,
    ].filter(Boolean);
    lines.push(`✂️ Alterations: ${bits.join(" · ")}`);
    for (const t of altTopOverdue) lines.push(`  · ${t}`);
  } else {
    lines.push(`✂️ Alterations: clear`);
  }
  if (readyCount) {
    lines.push(`📦 Ready pickup: ${readyCount}${readyPreview.length ? ` — ${readyPreview.join(", ")}` : ""}`);
  }
  lines.push("");

  // Sales orders
  if (openOrders.length) {
    lines.push(
      `🧵 Open SOs: ${openOrders.length}${soPast.length ? ` · ${soPast.length} past due` : ""}${soDueSoon.length ? ` · ${soDueSoon.length} due ≤7d` : ""}`
    );
    for (const t of soTopPast) lines.push(`  · ${t}`);
  } else {
    lines.push(`🧵 Open SOs: none`);
  }
  lines.push("");

  // SMS
  if (unansweredPhones) {
    lines.push(`💬 Unanswered SMS: ${unansweredPhones} client${unansweredPhones === 1 ? "" : "s"}`);
    for (const t of unansweredPreview) lines.push(`  · ${t}`);
  } else {
    lines.push(`💬 Unanswered SMS: clear`);
  }
  lines.push("");

  // Calendar
  if (apptsUnique.length) {
    lines.push(`📅 Today: ${apptsUnique.length} on the book`);
    for (const a of apptsUnique.slice(0, 4)) lines.push(`  · ${a}`);
  } else {
    lines.push(`📅 Today: no appointments`);
  }

  lines.push("");
  lines.push("— Sofia");

  let briefing = lines.join("\n").trim();

  // Soft trim for SMS (Twilio multi-segment OK, but keep scannable)
  if (briefing.length > 1400) {
    briefing = briefing.slice(0, 1380).trimEnd() + "\n…\n— Sofia";
  }

  // ── Deliver ─────────────────────────────────────────────────────────────
  try {
    await twilioSend(ownerPhone, briefing);
  } catch (e: any) {
    console.error("[sofia/briefing] SMS error:", e?.message);
  }

  try {
    await postRavenDm(briefing);
  } catch {}

  try {
    await insertAgentBrief({
      type: "daily_brief",
      title: `${period} Brief — ${clock}`,
      body: briefing,
      severity: overdueInvoices.length || altOverdue.length ? "warning" : "info",
      source: "sofia",
      metadata: JSON.stringify({
        channel: "daily_briefing",
        period,
        generated_at: new Date().toISOString(),
        stats: {
          collected_today: collectedTotal,
          collected_count: paymentEntries.length,
          overdue_invoices: overdueInvoices.length,
          overdue_ar: overdueTotal,
          alts_open: openTickets.length,
          alts_overdue: altOverdue.length,
          alts_due_today: altDueToday.length,
          ready_pickup: readyCount,
          open_sos: openOrders.length,
          so_past_due: soPast.length,
          unanswered_sms: unansweredPhones,
          appts_today: apptsUnique.length,
        },
      }),
    });
  } catch (e: any) {
    console.error("[sofia/briefing] agent_briefs save:", e?.message);
  }

  try {
    await insertSmsMessage({
      client_phone: ownerPhone,
      direction: "outbound",
      content: briefing,
      timestamp: new Date().toISOString(),
      metadata: { channel: "daily_briefing", generated_at: new Date().toISOString(), period },
    });
  } catch {}

  return { ok: true, briefing };
}

// HER-61 S4: briefing endpoints require CRON_SECRET (same as Vercel cron header)
sofiaRouter.post("/briefing", async (c) => {
  const gate = await requireCronOrSession(c);
  if (gate !== true) return gate;
  const result = await runBriefing();
  if (!result.ok) return c.json({ error: { message: result.error ?? "briefing failed" } }, 500);
  return c.json({ data: result });
});

sofiaRouter.get("/briefing/trigger", async (c) => {
  const gate = await requireCronOrSession(c);
  if (gate !== true) return gate;
  const result = await runBriefing();
  if (!result.ok) return c.json({ error: { message: result.error ?? "briefing failed" } }, 500);
  return c.json({ data: result });
});

// PATCH /api/sofia/tasks/:id
sofiaRouter.patch("/tasks/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  

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

  const data = await storeUpdate(DT.TASK, id, updates);
  if (!data) return c.json({ error: { message: "update failed" } }, 500);
  return c.json({ data: { ...data, id: (data as any).name } });
});
