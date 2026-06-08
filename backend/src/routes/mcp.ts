// MCP router — authenticated via X-MCP-Key header (LST_MCP_SECRET env var).
// All tools Claude needs to operate the L&S stack from chat.

import { Hono } from "hono";
import { erpList, erpGet, erpUpdate } from "../lib/erp";
import { sendSms } from "../lib/twilio";
import { supabaseAdmin } from "../lib/supabase";
import { generateText, gatewayModel, DEFAULT_MODEL } from "../lib/ai";

export const mcpRouter = new Hono();

// ── Auth middleware ──────────────────────────────────────────────────────────

mcpRouter.use("*", async (c, next) => {
  const secret = process.env.LST_MCP_SECRET;
  if (!secret) return c.json({ error: "MCP not configured" }, 503);
  const key = c.req.header("X-MCP-Key");
  if (key !== secret) return c.json({ error: "Forbidden" }, 403);
  await next();
});

// ── Tickets ──────────────────────────────────────────────────────────────────

// GET /api/mcp/tickets?status=In+Progress&location=NYC&limit=50
mcpRouter.get("/tickets", async (c) => {
  const status   = c.req.query("status");
  const location = c.req.query("location");
  const limit    = Number(c.req.query("limit") ?? "50");

  const filters: unknown[] = [["workflow_state", "!=", "Cancelled"]];
  if (status)   filters.push(["workflow_state", "=", status]);
  if (location) filters.push(["origin_location", "=", location]);

  const tickets = await erpList<Record<string, unknown>>("Alteration Ticket", {
    filters,
    fields: [
      "name", "customer", "customer_name", "customer_phone",
      "origin_location", "workflow_state", "ticket_date",
      "due_date", "promised_date", "ticket_total",
      "payment_status", "delivery_method", "notified_ready_at",
      "is_rush", "modified",
    ],
    limit,
    order_by: "modified desc",
  });

  return c.json({ data: tickets });
});

// GET /api/mcp/tickets/:id
mcpRouter.get("/tickets/:id", async (c) => {
  const ticket = await erpGet<Record<string, unknown>>("Alteration Ticket", c.req.param("id"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  return c.json({ data: ticket });
});

// ── Garments ─────────────────────────────────────────────────────────────────

// PATCH /api/mcp/garments/:ticketId/:garmentId  { "status": "Ready" }
mcpRouter.patch("/garments/:ticketId/:garmentId", async (c) => {
  const { status } = await c.req.json() as { status: string };
  const { base, key, secret } = erpCreds();

  const res = await fetch(`${base}/api/resource/Alteration%20Ticket/${encodeURIComponent(c.req.param("ticketId"))}`, {
    headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" },
  });
  if (!res.ok) return c.json({ error: "Ticket not found" }, 404);

  const { data: ticket } = await res.json() as { data: any };
  const garment = ticket.garments?.find((g: any) => g.garment_id === c.req.param("garmentId"));
  if (!garment) return c.json({ error: "Garment not found" }, 404);

  garment.garment_status = status;

  const saveRes = await fetch(`${base}/api/resource/Alteration%20Ticket/${encodeURIComponent(c.req.param("ticketId"))}`, {
    method: "PUT",
    headers: { Authorization: `token ${key}:${secret}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(ticket),
  });
  if (!saveRes.ok) return c.json({ error: "Save failed" }, 502);

  return c.json({ data: { ticketId: c.req.param("ticketId"), garmentId: c.req.param("garmentId"), status } });
});

// POST /api/mcp/tickets/:id/ready — advance ticket + fire pickup SMS
mcpRouter.post("/tickets/:id/ready", async (c) => {
  const { base, key, secret } = erpCreds();
  const id = c.req.param("id");

  // Apply workflow
  const wfRes = await fetch(`${base}/api/method/frappe.model.workflow.apply_workflow`, {
    method: "POST",
    headers: { Authorization: `token ${key}:${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ doc: JSON.stringify({ doctype: "Alteration Ticket", name: id }), action: "Mark Ready" }),
  });
  if (!wfRes.ok) return c.json({ error: "Workflow failed" }, 502);

  // Fire SMS
  const ticket = await erpGet<any>("Alteration Ticket", id);
  if (ticket?.customer_phone) {
    const store = ticket.origin_location === "HOU" ? "Houston" : "New York";
    await sendSms(
      ticket.customer_phone,
      `Hi ${ticket.customer_name || "there"}, your alterations are ready for pickup at our ${store} location! — L&S Custom Tailors`
    );
  }

  return c.json({ data: { ticketId: id, state: "Ready", smsSent: !!ticket?.customer_phone } });
});

// ── SMS ───────────────────────────────────────────────────────────────────────

// POST /api/mcp/sms  { "to": "+1...", "message": "..." }
mcpRouter.post("/sms", async (c) => {
  const { to, message } = await c.req.json() as { to: string; message: string };
  if (!to || !message) return c.json({ error: "to and message required" }, 400);
  const sid = await sendSms(to, message);
  if (!sid) return c.json({ error: "SMS failed — check Twilio config" }, 502);

  // Log to Supabase if available
  if (supabaseAdmin) {
    await supabaseAdmin.from("sms_messages").insert({
      client_phone: to, direction: "outbound", body: message,
      sent_by: "claude-mcp", timestamp: new Date().toISOString(),
    }).catch(() => {});
  }

  return c.json({ data: { sid, to, message } });
});

// GET /api/mcp/threads — all SMS conversation threads
mcpRouter.get("/threads", async (c) => {
  if (!supabaseAdmin) return c.json({ data: [] });
  const { data: messages } = await supabaseAdmin
    .from("sms_messages")
    .select("client_phone, body, direction, timestamp")
    .order("timestamp", { ascending: false })
    .limit(200);

  const threadMap = new Map<string, any>();
  for (const msg of messages ?? []) {
    if (!threadMap.has(msg.client_phone)) {
      threadMap.set(msg.client_phone, { phone: msg.client_phone, lastMessage: msg, count: 1 });
    } else {
      threadMap.get(msg.client_phone).count++;
    }
  }

  return c.json({ data: Array.from(threadMap.values()) });
});

// GET /api/mcp/threads/:phone — messages for one phone number
mcpRouter.get("/threads/:phone", async (c) => {
  if (!supabaseAdmin) return c.json({ data: [] });
  const phone = decodeURIComponent(c.req.param("phone"));
  const { data: messages } = await supabaseAdmin
    .from("sms_messages")
    .select("*")
    .eq("client_phone", phone)
    .order("timestamp", { ascending: true })
    .limit(100);
  return c.json({ data: messages ?? [] });
});

// ── Customers ─────────────────────────────────────────────────────────────────

// GET /api/mcp/customers?q=smith
mcpRouter.get("/customers", async (c) => {
  const q = c.req.query("q") ?? "";
  const customers = await erpList<Record<string, unknown>>("Customer", {
    filters: q ? [["customer_name", "like", `%${q}%`]] : undefined,
    fields: ["name", "customer_name", "mobile_no", "email_id", "territory"],
    limit: 20,
    order_by: "modified desc",
  });
  return c.json({ data: customers });
});

// GET /api/mcp/customers/:id
mcpRouter.get("/customers/:id", async (c) => {
  const customer = await erpGet<Record<string, unknown>>("Customer", c.req.param("id"));
  if (!customer) return c.json({ error: "Not found" }, 404);
  return c.json({ data: customer });
});

// ── Calendar ──────────────────────────────────────────────────────────────────

// GET /api/mcp/calendar?days=7
mcpRouter.get("/calendar", async (c) => {
  const days = Number(c.req.query("days") ?? "7");
  const base = process.env.BACKEND_URL || "https://app.lstailors.com";
  // Forward to our own calendar route using a service token if available
  // Fall back to returning empty so the MCP still boots cleanly
  const serviceToken = process.env.LST_SERVICE_TOKEN;
  if (!serviceToken) return c.json({ data: [], note: "LST_SERVICE_TOKEN not set" });

  const res = await fetch(`${base}/api/calendar/events?days=${days}`, {
    headers: { Authorization: `Bearer ${serviceToken}` },
  });
  if (!res.ok) return c.json({ data: [] });
  const json = await res.json() as { data: unknown };
  return c.json(json);
});

// ── Summary ───────────────────────────────────────────────────────────────────

// GET /api/mcp/summary — quick ops snapshot
mcpRouter.get("/summary", async (c) => {
  const [inProgress, ready, received] = await Promise.all([
    erpList("Alteration Ticket", { filters: [["workflow_state", "=", "In Progress"]], fields: ["name"], limit: 200 }),
    erpList("Alteration Ticket", { filters: [["workflow_state", "=", "Ready"]], fields: ["name"], limit: 200 }),
    erpList("Alteration Ticket", { filters: [["workflow_state", "=", "Received"]], fields: ["name"], limit: 200 }),
  ]);

  return c.json({
    data: {
      inProgress: inProgress.length,
      ready: ready.length,
      received: received.length,
      total: inProgress.length + ready.length + received.length,
    },
  });
});

// ── Deliveries (MCP) ──────────────────────────────────────────────────────────

function erpDatetimeMcp(d?: Date | string | null): string {
  const dt = d ? new Date(d) : new Date();
  return dt.toISOString().replace("T", " ").slice(0, 19);
}

function buildDeliveryTimelineEntry(status: string, actor: string) {
  const labels: Record<string, string> = {
    "Queued": "Queued",
    "Out for Delivery": "Out for Delivery",
    "Delivered": "Delivered",
    "Failed": "Attempted — Failed",
    "Cancelled": "Cancelled",
  };
  return {
    doctype: "LSH Delivery Timeline",
    event_type: labels[status] ?? status,
    event_at: erpDatetimeMcp(),
    actor_label: actor,
    message: "",
  };
}

function withDeliveryTimeline(existing: any, newEntry: Record<string, unknown>) {
  const rows = (existing?.lsh_timeline ?? []).map((r: any) => ({
    doctype: "LSH Delivery Timeline",
    name: r.name,
    event_type: r.event_type,
    event_at: r.event_at,
    actor_label: r.actor_label,
    message: r.message ?? "",
  }));
  return [...rows, newEntry];
}

// PATCH /api/mcp/deliveries/:id/status — update delivery status + timeline
mcpRouter.patch("/deliveries/:id/status", async (c) => {
  const id = c.req.param("id");
  const { status, actor } = await c.req.json() as { status: string; actor?: string };

  const VALID: Record<string, string> = {
    "Queued": "Queued",
    "Out for Delivery": "Out for Delivery",
    "Delivered": "Delivered",
    "Failed": "Failed",
    "Cancelled": "Cancelled",
  };
  const erpStatus = VALID[status];
  if (!erpStatus) return c.json({ error: `Invalid status. Allowed: ${Object.keys(VALID).join(", ")}` }, 400);

  const existing = await erpGet<any>("LSH Delivery", id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const updates: Record<string, unknown> = {
    lsh_status: erpStatus,
    lsh_timeline: withDeliveryTimeline(existing, buildDeliveryTimelineEntry(erpStatus, actor ?? "Claude MCP")),
  };
  if (erpStatus === "Delivered") updates.lsh_delivered_at = erpDatetimeMcp();
  if (erpStatus === "Out for Delivery") updates.lsh_dispatched_at = erpDatetimeMcp();

  const updated = await erpUpdate<any>("LSH Delivery", id, updates);
  if (!updated) return c.json({ error: "Update failed" }, 502);

  return c.json({ data: { deliveryId: id, status: erpStatus } });
});

// GET /api/mcp/deliveries/:id/suggest-status — AI-powered next-status suggestion
mcpRouter.get("/deliveries/:id/suggest-status", async (c) => {
  const id = c.req.param("id");
  const doc = await erpGet<any>("LSH Delivery", id);
  if (!doc) return c.json({ error: "Not found" }, 404);

  const timelineText = (doc.lsh_timeline ?? [])
    .map((t: any) => `  - ${t.event_type} at ${t.event_at} by ${t.actor_label}${t.message ? `: ${t.message}` : ""}`)
    .join("\n") || "  (no timeline entries yet)";

  const prompt = `You are a logistics coordinator for L&S Custom Tailors, a luxury tailoring service in New York and Houston.

Analyze the following delivery record and recommend what the next status should be.

Delivery ID: ${doc.name}
Customer: ${doc.customer_name ?? "Unknown"}
Current Status: ${doc.lsh_status ?? "Queued"}
Method: ${doc.lsh_delivery_method ?? "Hand Delivery"}
Scheduled At: ${doc.lsh_scheduled_at ?? "Not scheduled"}
Address: ${[doc.lsh_delivery_address, doc.lsh_delivery_city].filter(Boolean).join(", ") || "Not set"}
Courier: ${doc.lsh_courier_name ?? "Not assigned"}
Notes: ${doc.lsh_delivery_notes ?? "None"}

Timeline:
${timelineText}

Valid next statuses: Queued, Out for Delivery, Delivered, Failed, Cancelled

Respond ONLY with this exact JSON (no markdown, no extra text):
{"status": "<next status>", "reason": "<one concise sentence explaining why>"}`;

  try {
    const { text, usage } = await generateText({
      model: gatewayModel(),
      prompt,
      maxOutputTokens: 256,
    });

    console.log(`[ai:suggest-status] ${id} in=${usage.inputTokens} out=${usage.outputTokens}`);

    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return c.json({ error: "AI returned unexpected format", raw: text }, 502);

    const parsed = JSON.parse(match[0]) as { status: string; reason: string };
    return c.json({ data: { deliveryId: id, status: parsed.status, reason: parsed.reason, model: DEFAULT_MODEL } });
  } catch (err: any) {
    console.error("[ai:suggest-status] error:", err?.message ?? err);
    return c.json({ error: err?.message ?? "AI call failed" }, 502);
  }
});

// GET /api/mcp/deliveries/:id/summarize-timeline — AI-generated timeline narrative
mcpRouter.get("/deliveries/:id/summarize-timeline", async (c) => {
  const id = c.req.param("id");
  const doc = await erpGet<any>("LSH Delivery", id);
  if (!doc) return c.json({ error: "Not found" }, 404);

  const timeline: any[] = doc.lsh_timeline ?? [];
  if (!timeline.length) {
    return c.json({ data: { deliveryId: id, summary: "No timeline events recorded yet.", model: DEFAULT_MODEL } });
  }

  const timelineText = timeline
    .map((t) => `- ${t.event_type} on ${t.event_at} (by ${t.actor_label})${t.message ? `: "${t.message}"` : ""}`)
    .join("\n");

  const prompt = `You are a customer service assistant for L&S Custom Tailors, a luxury tailoring business.

Write a short, clear, human-friendly summary (2–4 sentences) of the following delivery timeline for internal staff use. Focus on the key milestones and current state. Be concise and professional.

Delivery: ${doc.name}
Customer: ${doc.customer_name ?? "Unknown"}
Current Status: ${doc.lsh_status ?? "Unknown"}

Timeline events:
${timelineText}

Write the summary now (plain text only, no bullet points or headers):`;

  try {
    const { text, usage } = await generateText({
      model: gatewayModel(),
      prompt,
      maxOutputTokens: 300,
    });

    console.log(`[ai:summarize-timeline] ${id} in=${usage.inputTokens} out=${usage.outputTokens}`);

    return c.json({ data: { deliveryId: id, summary: text.trim(), model: DEFAULT_MODEL } });
  } catch (err: any) {
    console.error("[ai:summarize-timeline] error:", err?.message ?? err);
    return c.json({ error: err?.message ?? "AI call failed" }, 502);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function erpCreds() {
  return {
    base:   process.env.ERPNEXT_BASE_URL   ?? "",
    key:    process.env.ERPNEXT_API_KEY    ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}
