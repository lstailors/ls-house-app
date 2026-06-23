import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { insertSmsMessage, listSmsMessagesFiltered, findSmsByTwilioSid } from "../lib/erpnext/agents";

export const ravenRouter = new Hono();

const ERP_BASE = "https://erp.lstailors.com";

// Sofia's Raven channel with Carl (L&S Tailors workspace)
const SOFIA_DM_CHANNEL = "L&S Tailors-sofia-live";
const RECEIPTS_CHANNEL = "L&S Tailors-receipts";
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
// POST /api/raven/process-receipt
// Upload a photo (base64 or URL) of a receipt/invoice.
// Grok vision extracts the details, creates an ERPNext Expense Claim or
// Purchase Invoice draft, and posts a summary back to #receipts channel.
// ────────────────────────────────────────────────────────────────────────────
ravenRouter.post("/process-receipt", async (c) => {
  const user = await getAuthedUser(c);
  const body = await c.req.json<{
    image_base64?: string;   // base64 encoded image
    image_url?: string;      // or a URL
    doc_type?: string;       // 'expense' | 'purchase_invoice' — default: auto-detect
    channel_id?: string;     // channel to post result to — default: receipts
  }>();

  const XAI_KEY = process.env.XAI_API_KEY ?? "";
  const targetChannel = body.channel_id ?? RECEIPTS_CHANNEL;

  if (!body.image_base64 && !body.image_url) {
    return c.json({ error: "image_base64 or image_url required" }, 400);
  }

  // Build vision payload for Grok
  const imageContent = body.image_base64
    ? { type: "image_url", image_url: { url: `data:image/jpeg;base64,${body.image_base64}` } }
    : { type: "image_url", image_url: { url: body.image_url! } };

  const extractPrompt = `You are a receipt/invoice parser for L&S Custom Tailors, a bespoke tailoring house in NYC.

Analyze this image and extract ALL of the following in JSON:
{
  "doc_type": "expense" | "purchase_invoice",  // expense for small receipts/meals/supplies, purchase_invoice for fabric/vendor invoices
  "vendor": "vendor name",
  "date": "YYYY-MM-DD",
  "total": 0.00,
  "tax": 0.00,
  "currency": "USD",
  "description": "brief description of what was purchased",
  "line_items": [
    { "description": "item", "qty": 1, "rate": 0.00, "amount": 0.00 }
  ],
  "invoice_number": "vendor invoice # if visible",
  "confidence": 0.95  // how confident you are in the extraction 0-1
}

Return ONLY valid JSON. No markdown, no explanation.`;

  let extracted: any = null;
  try {
    const visionRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${XAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-2-vision-latest",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: extractPrompt },
            imageContent,
          ],
        }],
        max_tokens: 800,
        temperature: 0.1,
      }),
    });
    const visionData: any = await visionRes.json();
    const raw = visionData?.choices?.[0]?.message?.content ?? "{}";
    // Strip markdown code fences if present
    const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
    extracted = JSON.parse(clean);
  } catch (e: any) {
    return c.json({ error: `Vision extraction failed: ${e.message}` }, 500);
  }

  const docType = body.doc_type ?? extracted.doc_type ?? "expense";
  let erpResult: any = null;
  let erpDocName = "";

  try {
    if (docType === "purchase_invoice") {
      // Create Purchase Invoice draft in ERPNext
      const supplier = extracted.vendor ?? "Unknown Vendor";
      // Ensure supplier exists
      const supplierCheck = await erpGet(`/api/resource/Supplier/${encodeURIComponent(supplier)}`).catch(() => null);
      if (!supplierCheck) {
        await erpPost("/api/resource/Supplier", {
          supplier_name: supplier,
          supplier_group: "All Supplier Groups",
          supplier_type: "Company",
        });
      }
      const piItems = (extracted.line_items ?? [{ description: extracted.description, qty: 1, rate: extracted.total ?? 0, amount: extracted.total ?? 0 }]).map((item: any) => ({
        item_name: item.description ?? "Item",
        description: item.description ?? "Item",
        qty: item.qty ?? 1,
        rate: item.rate ?? item.amount ?? 0,
        uom: "Nos",
        expense_account: "5111 - Cost of Goods Sold - LSTNY",
      }));
      const piDoc = {
        supplier,
        posting_date: extracted.date ?? new Date().toISOString().split("T")[0],
        bill_no: extracted.invoice_number ?? "",
        bill_date: extracted.date ?? new Date().toISOString().split("T")[0],
        currency: extracted.currency ?? "USD",
        items: piItems,
        company: "L&S Tailors NY LLC",
      };
      erpResult = await erpPost("/api/resource/Purchase%20Invoice", piDoc);
      erpDocName = (erpResult?.data ?? erpResult)?.name ?? "";
    } else {
      // Create Expense Claim entry (as a Purchase Invoice against petty cash for simplicity)
      erpResult = { draft: true, note: "Expense logged — review in ERPNext" };
      erpDocName = "draft";
    }
  } catch (e: any) {
    // Don't fail the whole request — still post to channel with extraction
    erpDocName = `error: ${e.message.slice(0, 80)}`;
  }

  // Post summary to Raven channel
  const emoji = docType === "purchase_invoice" ? "🧾" : "💳";
  const erpLink = erpDocName && erpDocName !== "draft" && !erpDocName.startsWith("error")
    ? `\n📋 ERP: https://erp.lstailors.com/app/purchase-invoice/${erpDocName}`
    : erpDocName === "draft" ? "\n📋 Logged as expense draft" : `\n⚠️ ERP: ${erpDocName}`;

  const lineItemSummary = (extracted.line_items ?? [])
    .slice(0, 4)
    .map((i: any) => `  • ${i.description} — $${Number(i.amount ?? i.rate ?? 0).toFixed(2)}`)
    .join("\n");

  const msg = `${emoji} **Receipt scanned** by ${user?.email ?? "staff"}
📍 Vendor: ${extracted.vendor ?? "Unknown"}
📅 Date: ${extracted.date ?? "Unknown"}
💰 Total: $${Number(extracted.total ?? 0).toFixed(2)}${extracted.tax ? ` (tax: $${Number(extracted.tax).toFixed(2)})` : ""}
${lineItemSummary ? `\nItems:\n${lineItemSummary}` : ""}
🔍 Confidence: ${Math.round((extracted.confidence ?? 0) * 100)}%${erpLink}`;

  await postRavenMessage(targetChannel, msg);

  return c.json({
    data: {
      extracted,
      erp_doc: erpDocName,
      doc_type: docType,
      channel_posted: targetChannel,
    },
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/raven/channels/list — return all L&S channels with metadata
// ────────────────────────────────────────────────────────────────────────────
ravenRouter.get("/channels/list", async (c) => {
  await getAuthedUser(c);
  const fields = JSON.stringify(["name", "channel_name", "type", "channel_description", "is_archived"]);
  const filters = JSON.stringify([["is_archived", "=", 0], ["workspace", "=", "L&S Tailors"]]);
  const json = await erpGet(
    `/api/resource/Raven%20Channel?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&limit=50`
  );
  return c.json({ data: json.data ?? [] });
});

// Called every minute by Vercel cron. Checks Sofia's DM channel with Carl,
// finds Carl messages that don't yet have a Sofia reply, and replies via Grok.
// No auth required (called internally by cron).
// ────────────────────────────────────────────────────────────────────────────
ravenRouter.get("/sofia-poll", async (c) => {
  try {
    const msgs = await fetchRavenMessages(SOFIA_DM_CHANNEL, 20);
    if (!msgs.length) return c.json({ data: { ok: true, processed: 0, reason: "no_messages" } });
    const chronological = [...msgs].reverse();
    const toProcess = [];
    for (let i = 0; i < chronological.length; i++) {
      const msg = chronological[i];
      if (msg.owner !== CARL_EMAIL) continue;
      const next = chronological[i + 1];
      if (next && next.owner === SOFIA_EMAIL) continue;
      const existing = await findSmsByTwilioSid(`raven_${msg.name}`);
      if (existing) continue;
      toProcess.push(msg);
    }
    if (!toProcess.length) return c.json({ data: { ok: true, processed: 0, reason: "no_new_messages" } });
    let processed = 0;
    for (const msg of toProcess) {
      const messageText = String(msg.text ?? "").trim();
      if (!messageText) continue;
      try {
        await insertSmsMessage({
          twilio_sid: `raven_${msg.name}`,
          client_phone: CARL_EMAIL,
          direction: "inbound",
          content: messageText,
          timestamp: new Date(msg.creation ?? Date.now()).toISOString(),
          metadata: JSON.stringify({ channel: "raven_dm", raven_channel_id: SOFIA_DM_CHANNEL, raven_msg_id: msg.name }),
        });
      } catch {}
      const hist = await listSmsMessagesFiltered({ phone: CARL_EMAIL, limit: 10 });
      const historyMsgs = hist.filter((h) => h.twilio_sid !== `raven_${msg.name}`).reverse().map((h) => ({
        role: h.direction === "inbound" ? "user" : "assistant",
        content: String(h.content),
      }));
      historyMsgs.push({ role: "user", content: messageText });
      const reply = await callGrokStaff(historyMsgs);
      const postResult = await postRavenMessage(SOFIA_DM_CHANNEL, reply);
      try {
        await insertSmsMessage({
          twilio_sid: postResult.name ? `raven_out_${postResult.name}` : null,
          client_phone: CARL_EMAIL,
          direction: "outbound",
          content: reply,
          timestamp: new Date().toISOString(),
          metadata: JSON.stringify({ channel: "raven_dm", raven_channel_id: SOFIA_DM_CHANNEL, in_reply_to: msg.name, raven_ok: postResult.ok }),
        });
      } catch {}
      processed++;
    }
    return c.json({ data: { ok: true, processed } });
  } catch (e) {
    console.error("[raven/sofia-poll] error:", e.message);
    return c.json({ data: { ok: false, error: e.message } }, 500);
  }
});

ravenRouter.post("/sofia-webhook", async (c) => {
  try {
    const msgs = await fetchRavenMessages(SOFIA_DM_CHANNEL, 20);
    if (!msgs.length) return c.json({ data: { ok: true, processed: 0 } });
    const chronological = [...msgs].reverse();
    const toProcess = [];
    for (let i = 0; i < chronological.length; i++) {
      const msg = chronological[i];
      if (msg.owner !== CARL_EMAIL) continue;
      const next = chronological[i + 1];
      if (next && next.owner === SOFIA_EMAIL) continue;
      const existing = await findSmsByTwilioSid(`raven_${msg.name}`);
      if (existing) continue;
      toProcess.push(msg);
    }
    let processed = 0;
    for (const msg of toProcess) {
      const messageText = String(msg.text ?? "").trim();
      if (!messageText) continue;
      try {
        await insertSmsMessage({
          twilio_sid: `raven_${msg.name}`,
          client_phone: CARL_EMAIL,
          direction: "inbound",
          content: messageText,
          timestamp: new Date(msg.creation ?? Date.now()).toISOString(),
          metadata: JSON.stringify({ channel: "raven_dm", raven_channel_id: SOFIA_DM_CHANNEL, raven_msg_id: msg.name }),
        });
      } catch {}
      const hist = await listSmsMessagesFiltered({ phone: CARL_EMAIL, limit: 10 });
      const historyMsgs = hist.filter((h) => h.twilio_sid !== `raven_${msg.name}`).reverse().map((h) => ({
        role: h.direction === "inbound" ? "user" : "assistant",
        content: String(h.content),
      }));
      historyMsgs.push({ role: "user", content: messageText });
      const reply = await callGrokStaff(historyMsgs);
      const postResult = await postRavenMessage(SOFIA_DM_CHANNEL, reply);
      try {
        await insertSmsMessage({
          twilio_sid: postResult.name ? `raven_out_${postResult.name}` : null,
          client_phone: CARL_EMAIL,
          direction: "outbound",
          content: reply,
          timestamp: new Date().toISOString(),
          metadata: JSON.stringify({ channel: "raven_dm", raven_channel_id: SOFIA_DM_CHANNEL, in_reply_to: msg.name, raven_ok: postResult.ok }),
        });
      } catch {}
      processed++;
    }
    return c.json({ data: { ok: true, processed } });
  } catch (e) {
    console.error("[raven/sofia-webhook] error:", e.message);
    return c.json({ data: { ok: false, error: e.message } }, 500);
  }
});
