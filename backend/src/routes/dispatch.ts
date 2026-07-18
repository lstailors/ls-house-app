import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet, erpUpdate } from "../lib/erp";
import { DT } from "../lib/erpnext/doctypes";
import { DispatchSendRequest, DispatchComposeRequest, DispatchPhoneRequest } from "../types";

// Sofia Dispatch — UI glue over the WF-DISPATCH-10/11 n8n workflows.
// Sends go through n8n (which owns opt-out check, Twilio send, and the
// LSH SMS Message log); this router owns customer/thread/template reads
// and server-side merge-field resolution.

const N8N_WEBHOOK_BASE = process.env.N8N_WEBHOOK_BASE || "https://lstailors.app.n8n.cloud/webhook";
const DISPATCH_KEY = process.env.DISPATCH_WEBHOOK_KEY || "lsd_dsp_9k2fQ7xWm4vT";
const STORE_HOURS = "Tues-Fri 8:30am-5:30pm, Sat 8:30am-4pm";
const BOOKING_LINK = "https://book.lstailors.com";

const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const START_WORDS = ["START", "UNSTOP", "YES"];

const MSG_FIELDS = [
  "name", "client_phone", "client_name", "customer", "direction",
  "content", "sender", "timestamp", "twilio_sid", "status",
  "context_tag", "error_message",
];

export const dispatchRouter = new Hono();

// ── helpers ────────────────────────────────────────────────────────────────

function last10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/** Most recent STOP/re-opt-in keyword from this number decides. */
async function isOptedOut(phone: string): Promise<boolean> {
  if (!phone) return false;
  const inbound = await erpList<any>(DT.SMS_MESSAGE, {
    filters: [["client_phone", "=", phone], ["direction", "=", "inbound"]],
    fields: ["content", "timestamp"],
    order_by: "timestamp desc",
    limit: 200,
  }).catch(() => []);
  for (const m of inbound) {
    const txt = String(m.content ?? "").trim().toUpperCase();
    if (START_WORDS.includes(txt)) return false;
    if (STOP_WORDS.includes(txt)) return true;
  }
  return false;
}

/** Customer.mobile_no → fallback: client_phone of most recent SMS linked to the customer. */
async function resolvePhone(customerId: string | null, explicitPhone?: string | null): Promise<string | null> {
  if (explicitPhone?.trim()) return explicitPhone.trim();
  if (!customerId) return null;
  const cust = await erpGet<any>(DT.CUSTOMER, customerId).catch(() => null);
  if (cust?.mobile_no?.trim()) return String(cust.mobile_no).trim();
  const recent = await erpList<any>(DT.SMS_MESSAGE, {
    filters: [["customer", "=", customerId]],
    fields: ["client_phone", "timestamp"],
    order_by: "timestamp desc",
    limit: 1,
  }).catch(() => []);
  return recent[0]?.client_phone ?? null;
}

/** Resolve merge fields we know server-side; leave the composer-supplied ones. */
function resolveMergeFields(body: string, ctx: { firstName?: string | null; clientName?: string | null }): { resolved: string; pending: string[] } {
  let resolved = body;
  if (ctx.firstName) resolved = resolved.replaceAll("{first_name}", ctx.firstName);
  if (ctx.clientName) resolved = resolved.replaceAll("{client_name}", ctx.clientName);
  resolved = resolved.replaceAll("{booking_link}", BOOKING_LINK).replaceAll("{hours}", STORE_HOURS);
  const pending = [...new Set((resolved.match(/\{[a-z_]+\}/gi) ?? []))];
  return { resolved, pending };
}

async function callDispatchWebhook(path: "dispatch-send" | "dispatch-compose", payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${N8N_WEBHOOK_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dispatch-Key": DISPATCH_KEY },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`n8n ${path} failed: HTTP ${res.status}`);
  return res.json();
}

// ── GET /api/dispatch/templates ────────────────────────────────────────────
// Optional ?customer= resolves {first_name}/{client_name} server-side.
dispatchRouter.get("/templates", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const customerId = c.req.query("customer") ?? null;
  let clientName: string | null = null;
  if (customerId) {
    const cust = await erpGet<any>(DT.CUSTOMER, customerId).catch(() => null);
    clientName = cust?.customer_name ?? null;
  }
  const firstName = clientName ? clientName.split(/\s+/)[0] : null;

  const rows = await erpList<any>("LSH SMS Template", {
    filters: [["enabled", "=", 1]],
    fields: ["name", "template_name", "category", "body", "sort_order"],
    order_by: "sort_order asc",
    limit: 50,
  });

  const templates = rows.map((t) => {
    const { resolved, pending } = resolveMergeFields(String(t.body ?? ""), { firstName, clientName });
    return {
      name: t.name,
      template_name: t.template_name,
      category: t.category ?? "General",
      body: t.body,
      resolved_body: resolved,
      pending_fields: pending,
    };
  });
  return c.json({ data: templates });
});

// ── GET /api/dispatch/customers?q= ─────────────────────────────────────────
dispatchRouter.get("/customers", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ data: [] });

  const digits = q.replace(/\D/g, "");
  const [byName, byPhone] = await Promise.all([
    erpList<any>(DT.CUSTOMER, {
      filters: [["customer_name", "like", `%${q}%`]],
      fields: ["name", "customer_name", "mobile_no"],
      order_by: "modified desc",
      limit: 10,
    }).catch(() => []),
    digits.length >= 4
      ? erpList<any>(DT.CUSTOMER, {
          filters: [["mobile_no", "like", `%${digits}%`]],
          fields: ["name", "customer_name", "mobile_no"],
          order_by: "modified desc",
          limit: 10,
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const seen = new Set<string>();
  const results = [...byName, ...byPhone]
    .filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)))
    .slice(0, 12)
    .map((r) => ({ id: r.name, name: r.customer_name ?? r.name, phone: r.mobile_no ?? null }));
  return c.json({ data: results });
});

// ── GET /api/dispatch/recent — last 15 distinct conversations ──────────────
dispatchRouter.get("/recent", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const rows = await erpList<any>(DT.SMS_MESSAGE, {
    fields: ["client_phone", "client_name", "customer", "content", "direction", "timestamp"],
    order_by: "timestamp desc",
    limit: 300,
  });

  const threads: any[] = [];
  const seen = new Set<string>();
  for (const m of rows) {
    const phone = m.client_phone;
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    threads.push({
      phone,
      customerId: m.customer ?? null,
      name: m.client_name ?? m.customer ?? phone,
      lastMessage: String(m.content ?? "").slice(0, 120),
      lastDirection: m.direction,
      lastTimestamp: m.timestamp,
    });
    if (threads.length >= 15) break;
  }
  return c.json({ data: threads });
});

// ── GET /api/dispatch/thread?customer=&phone=&limit=&start= ────────────────
dispatchRouter.get("/thread", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const customerId = c.req.query("customer") ?? null;
  const phoneParam = c.req.query("phone") ?? null;
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const start = Math.max(Number(c.req.query("start") ?? 0), 0);
  if (!customerId && !phoneParam) return c.json({ error: { message: "customer or phone required" } }, 400);

  const phone = await resolvePhone(customerId, phoneParam);

  // Prefer the customer link; fall back to phone so unlinked history still shows.
  let filters: unknown[] = customerId ? [["customer", "=", customerId]] : [["client_phone", "=", phone]];
  let rows = await erpList<any>(DT.SMS_MESSAGE, {
    filters, fields: MSG_FIELDS, order_by: "timestamp desc", limit, start,
  } as any);
  if (!rows.length && customerId && phone) {
    filters = [["client_phone", "=", phone]];
    rows = await erpList<any>(DT.SMS_MESSAGE, {
      filters, fields: MSG_FIELDS, order_by: "timestamp desc", limit, start,
    } as any);
  }

  let customer: { id: string; name: string; phone: string | null } | null = null;
  if (customerId) {
    const cust = await erpGet<any>(DT.CUSTOMER, customerId).catch(() => null);
    if (cust) customer = { id: cust.name, name: cust.customer_name ?? cust.name, phone: cust.mobile_no ?? null };
  }

  const optedOut = phone ? await isOptedOut(phone) : false;

  return c.json({
    data: {
      messages: rows.reverse(),
      hasMore: rows.length === limit,
      phone,
      customer,
      optedOut,
    },
  });
});

// ── POST /api/dispatch/send — modes 1 & 2 (and approved Sofia drafts) ──────
dispatchRouter.post("/send", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const parsed = DispatchSendRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { message: "Invalid request", code: "bad_request" } }, 400);
  const { customer, clientName, phone, body, mode, template, batch } = parsed.data;

  const unresolved = [...new Set(body.match(/\{[a-z_]+\}/gi) ?? [])];
  if (unresolved.length) {
    return c.json({ error: { message: `Unresolved merge fields: ${unresolved.join(", ")}`, code: "unresolved_fields", fields: unresolved } }, 422);
  }

  if (await isOptedOut(phone)) {
    return c.json({ error: { message: "This customer has opted out (STOP). Sending is blocked.", code: "opted_out" } }, 409);
  }

  const sender =
    mode === "sofia" ? "dispatch:sofia" :
    mode === "template" && template ? `dispatch:template:${template}` :
    "dispatch:C";
  const contextTag = batch ? "sofia-dispatch:batch" : mode === "sofia" ? "sofia-dispatch:instructed" : "sofia-dispatch";

  try {
    const result = await callDispatchWebhook("dispatch-send", {
      phone,
      body,
      customer: customer ?? null,
      client_name: clientName ?? null,
      sender,
      context_tag: contextTag,
      mode,
      template: template ?? null,
    });
    if (result?.blocked) {
      return c.json({ error: { message: result.error ?? "Customer has opted out.", code: "opted_out" } }, 409);
    }
    return c.json({
      data: {
        ok: !!result?.ok,
        messageId: result?.message_id ?? null,
        twilioSid: result?.twilio_sid ?? null,
        status: result?.status ?? (result?.ok ? "sent" : "failed"),
        error: result?.error ?? null,
      },
    });
  } catch (e: any) {
    console.error("[dispatch/send] webhook error:", e?.message);
    return c.json({ error: { message: "Send failed: could not reach the dispatch workflow.", code: "webhook_error" } }, 502);
  }
});

// ── POST /api/dispatch/compose — mode 3 (draft only, never sends) ──────────
dispatchRouter.post("/compose", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const parsed = DispatchComposeRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { message: "Invalid request", code: "bad_request" } }, 400);
  const { customer, customerName, phone, instruction } = parsed.data;

  try {
    const result = await callDispatchWebhook("dispatch-compose", {
      phone: phone ?? null,
      customer: customer ?? null,
      customer_name: customerName ?? null,
      instruction,
    });
    if (!result?.ok || !result?.draft) {
      return c.json({ error: { message: result?.error ?? "Sofia could not compose a draft.", code: "compose_failed" } }, 502);
    }
    return c.json({ data: { draft: String(result.draft) } });
  } catch (e: any) {
    console.error("[dispatch/compose] webhook error:", e?.message);
    return c.json({ error: { message: "Compose failed: could not reach the dispatch workflow.", code: "webhook_error" } }, 502);
  }
});

// ── POST /api/dispatch/phone — write a number back to the Customer ─────────
dispatchRouter.post("/phone", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const parsed = DispatchPhoneRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { message: "Invalid request", code: "bad_request" } }, 400);
  const { customer, phone } = parsed.data;

  const digits = last10(phone);
  if (digits.length !== 10) return c.json({ error: { message: "Enter a valid 10-digit US number.", code: "bad_phone" } }, 422);
  const e164 = `+1${digits}`;

  try {
    await erpUpdate(DT.CUSTOMER, customer, { mobile_no: e164 });
    return c.json({ data: { ok: true, phone: e164 } });
  } catch (e: any) {
    console.error("[dispatch/phone] update failed:", e?.message);
    return c.json({ error: { message: "Could not save the phone number.", code: "update_failed" } }, 500);
  }
});
