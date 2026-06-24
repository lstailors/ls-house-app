#!/usr/bin/env bun
/**
 * L&S Custom Tailors — Unified MCP Server
 *
 * Connects Claude directly to the LST stack (ERPNext + Hono backend).
 * Runs as a local stdio process — add to ~/.claude/claude_desktop_config.json
 * or Claude Code MCP config.
 *
 * Env vars required (set in .env or your shell):
 *   LST_BACKEND_URL   — https://app.lstailors.com
 *   MCP_SHARED_SECRET — shared secret (or legacy LST_MCP_SECRET)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE  = process.env.LST_BACKEND_URL ?? "https://app.lstailors.com";
const SECRET = process.env.MCP_SHARED_SECRET ?? process.env.LST_MCP_SECRET ?? "";

if (!SECRET) {
  process.stderr.write("[lst-mcp] WARNING: MCP_SHARED_SECRET/LST_MCP_SECRET is not set\n");
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}/api/mcp${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-MCP-Key": SECRET,
      ...(opts.headers ?? {}),
    },
  });
  const json = await res.json() as any;
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.data;
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "lst-mcp",
  version: "1.0.0",
});

// ── TOOLS ─────────────────────────────────────────────────────────────────────

// Daily snapshot
server.tool(
  "lst_summary",
  "Quick ops snapshot — how many tickets are In Progress, Ready, and Received right now.",
  {},
  async () => {
    const data = await api("/summary");
    return {
      content: [{
        type: "text",
        text: `📊 **L&S Snapshot**\n- Received: ${data.received}\n- In Progress: ${data.inProgress}\n- Ready for pickup: ${data.ready}\n- Total active: ${data.total}`,
      }],
    };
  }
);

// List tickets
server.tool(
  "lst_list_tickets",
  "List alteration tickets. Filter by workflow status and/or location.",
  {
    status:   z.enum(["Received", "In Progress", "Ready", "Picked Up"]).optional().describe("Workflow state filter"),
    location: z.enum(["NYC", "HOU"]).optional().describe("Store location"),
    limit:    z.number().min(1).max(200).default(30).describe("Max results"),
  },
  async ({ status, location, limit }) => {
    const params = new URLSearchParams();
    if (status)   params.set("status", status);
    if (location) params.set("location", location);
    params.set("limit", String(limit));
    const tickets = await api(`/tickets?${params}`);
    if (!tickets.length) return { content: [{ type: "text", text: "No tickets found." }] };

    const lines = tickets.map((t: any) =>
      `• **${t.name}** — ${t.customer_name ?? t.customer} | ${t.workflow_state} | ${t.origin_location} | Due: ${t.due_date ?? "—"}${t.is_rush ? " 🔴 RUSH" : ""}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Get single ticket
server.tool(
  "lst_get_ticket",
  "Get full details for a single alteration ticket including garments and alteration lines.",
  { ticket_id: z.string().describe("Ticket name e.g. ALT-NYC-2026-00036") },
  async ({ ticket_id }) => {
    const t = await api(`/tickets/${encodeURIComponent(ticket_id)}`);
    const garmentLines = (t.garments ?? []).map((g: any) =>
      `  - ${g.garment_id}: ${g.garment_type} (${g.color || "no color"}) — ${g.garment_status}`
    ).join("\n");
    const lines = (t.lines ?? []).map((l: any) =>
      `  - ${l.description} — $${l.price}`
    ).join("\n");

    return {
      content: [{
        type: "text",
        text: [
          `**${t.name}** — ${t.workflow_state}`,
          `Customer: ${t.customer_name ?? t.customer} | Phone: ${t.customer_phone || "—"}`,
          `Location: ${t.origin_location} | Due: ${t.due_date ?? "—"} | Total: $${t.ticket_total}`,
          `Payment: ${t.payment_status ?? "—"} | Delivery: ${t.delivery_method ?? "—"}`,
          `\nGarments:\n${garmentLines || "  (none)"}`,
          `\nAlteration Lines:\n${lines || "  (none)"}`,
        ].join("\n"),
      }],
    };
  }
);

// Mark garment ready
server.tool(
  "lst_update_garment_status",
  "Update the status of a single garment on a ticket. Use 'Ready' when tailor finishes it.",
  {
    ticket_id:  z.string().describe("e.g. ALT-NYC-2026-00036"),
    garment_id: z.string().describe("e.g. G1, G2"),
    status:     z.enum(["Received", "In Progress", "Ready"]).describe("New garment status"),
  },
  async ({ ticket_id, garment_id, status }) => {
    await api(`/garments/${encodeURIComponent(ticket_id)}/${garment_id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return { content: [{ type: "text", text: `✅ ${ticket_id} / ${garment_id} → **${status}**` }] };
  }
);

// Mark full ticket ready + fire SMS
server.tool(
  "lst_mark_ticket_ready",
  "Advance a ticket to Ready and immediately send the customer their pickup SMS.",
  { ticket_id: z.string().describe("e.g. ALT-NYC-2026-00036") },
  async ({ ticket_id }) => {
    const result = await api(`/tickets/${encodeURIComponent(ticket_id)}/ready`, { method: "POST" });
    const smsNote = result.smsSent ? "📱 Pickup SMS sent to customer." : "⚠️ No phone number on file — SMS not sent.";
    return { content: [{ type: "text", text: `✅ ${ticket_id} marked **Ready**.\n${smsNote}` }] };
  }
);

// Send SMS
server.tool(
  "lst_send_sms",
  "Send an SMS to any phone number. Use for customer follow-ups, reminders, or custom messages.",
  {
    to:      z.string().describe("Phone number in E.164 format e.g. +16319260917"),
    message: z.string().describe("The message text to send"),
  },
  async ({ to, message }) => {
    await api("/sms", { method: "POST", body: JSON.stringify({ to, message }) });
    return { content: [{ type: "text", text: `📱 SMS sent to ${to}` }] };
  }
);

// List SMS threads
server.tool(
  "lst_list_sms_threads",
  "List all active SMS conversation threads with customers.",
  {},
  async () => {
    const threads = await api("/threads");
    if (!threads.length) return { content: [{ type: "text", text: "No SMS threads found." }] };
    const lines = threads.slice(0, 20).map((t: any) =>
      `• ${t.phone} — "${t.lastMessage.body.slice(0, 60)}…" (${t.count} messages)`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Get SMS thread
server.tool(
  "lst_get_sms_thread",
  "Read the full SMS conversation with a customer phone number.",
  { phone: z.string().describe("Phone number e.g. +16319260917") },
  async ({ phone }) => {
    const messages = await api(`/threads/${encodeURIComponent(phone)}`);
    if (!messages.length) return { content: [{ type: "text", text: "No messages found." }] };
    const lines = messages.map((m: any) =>
      `[${m.direction === "inbound" ? "Customer" : "Sofia"}] ${m.body}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Search customers
server.tool(
  "lst_search_customers",
  "Search for customers by name.",
  { query: z.string().describe("Name to search for") },
  async ({ query }) => {
    const customers = await api(`/customers?q=${encodeURIComponent(query)}`);
    if (!customers.length) return { content: [{ type: "text", text: "No customers found." }] };
    const lines = customers.map((c: any) =>
      `• **${c.customer_name}** (${c.name}) | 📞 ${c.mobile_no || "—"} | ✉️ ${c.email_id || "—"}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Get customer
server.tool(
  "lst_get_customer",
  "Get full details for a customer by their ERPNext ID.",
  { customer_id: z.string().describe("ERPNext customer name/ID") },
  async ({ customer_id }) => {
    const c = await api(`/customers/${encodeURIComponent(customer_id)}`);
    return {
      content: [{
        type: "text",
        text: `**${c.customer_name}**\nPhone: ${c.mobile_no || "—"}\nEmail: ${c.email_id || "—"}\nTerritory: ${c.territory || "—"}`,
      }],
    };
  }
);

// Upcoming calendar events
server.tool(
  "lst_calendar",
  "Get upcoming appointments and calendar events.",
  { days: z.number().min(1).max(30).default(7).describe("How many days ahead to look") },
  async ({ days }) => {
    const events = await api(`/calendar?days=${days}`);
    if (!Array.isArray(events) || !events.length) return { content: [{ type: "text", text: "No upcoming events." }] };
    const lines = events.map((e: any) =>
      `• ${e.start ? new Date(e.start).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"} — ${e.title ?? e.summary ?? "Event"}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── Deliveries ────────────────────────────────────────────────────────────────

// Update delivery status
server.tool(
  "lst_update_delivery_status",
  "Update a delivery's status and append a timestamped timeline entry in ERPNext.",
  {
    delivery_id: z.string().describe("Delivery ID e.g. DN-NYC-2025-00042"),
    status: z.enum(["Queued", "Out for Delivery", "Delivered", "Failed", "Cancelled"]).describe("New delivery status"),
    actor: z.string().optional().describe("Name to record in the timeline (defaults to 'Claude MCP')"),
  },
  async ({ delivery_id, status, actor }) => {
    await api(`/deliveries/${encodeURIComponent(delivery_id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, actor }),
    });
    const emoji: Record<string, string> = {
      "Queued": "📋", "Out for Delivery": "🚚", "Delivered": "✅", "Failed": "❌", "Cancelled": "🚫",
    };
    return {
      content: [{ type: "text", text: `${emoji[status] ?? "📦"} **${delivery_id}** → **${status}**` }],
    };
  }
);

// AI: suggest next delivery status
server.tool(
  "lst_suggest_delivery_status",
  "Use AI to analyze a delivery's current state and timeline, then suggest the next logical status with a reason.",
  {
    delivery_id: z.string().describe("Delivery ID e.g. DN-NYC-2025-00042"),
  },
  async ({ delivery_id }) => {
    const result = await api(`/deliveries/${encodeURIComponent(delivery_id)}/suggest-status`);
    return {
      content: [{
        type: "text",
        text: [
          `🤖 **AI Status Suggestion — ${delivery_id}**`,
          ``,
          `Suggested: **${result.status}**`,
          `Reason: ${result.reason}`,
          ``,
          `_Model: ${result.model}_`,
        ].join("\n"),
      }],
    };
  }
);

// AI: summarize delivery timeline
server.tool(
  "lst_summarize_delivery_timeline",
  "Use AI to generate a concise, human-readable summary of a delivery's timeline for quick status briefings.",
  {
    delivery_id: z.string().describe("Delivery ID e.g. DN-NYC-2025-00042"),
  },
  async ({ delivery_id }) => {
    const result = await api(`/deliveries/${encodeURIComponent(delivery_id)}/summarize-timeline`);
    return {
      content: [{
        type: "text",
        text: [
          `📋 **Timeline Summary — ${delivery_id}**`,
          ``,
          result.summary,
          ``,
          `_Model: ${result.model}_`,
        ].join("\n"),
      }],
    };
  }
);

// AI: generate customer message
server.tool(
  "lst_generate_customer_message",
  "Draft a personalized SMS or email to a customer based on their delivery. Types: delay_apology, out_for_delivery, delivered_confirmation, pickup_reminder, custom.",
  {
    delivery_id:    z.string().describe("Delivery ID e.g. DN-NYC-2025-00042"),
    type:           z.enum(["delay_apology", "out_for_delivery", "delivered_confirmation", "pickup_reminder", "custom"]).describe("Message purpose"),
    channel:        z.enum(["sms", "email"]).default("sms").describe("Communication channel"),
    custom_context: z.string().optional().describe("Extra context when type is 'custom'"),
  },
  async ({ delivery_id, type, channel, custom_context }) => {
    const result = await api(`/deliveries/${encodeURIComponent(delivery_id)}/generate-message`, {
      method: "POST",
      body: JSON.stringify({ type, channel, customContext: custom_context }),
    });
    return {
      content: [{
        type: "text",
        text: [
          `✍️ **Drafted ${channel.toUpperCase()} — ${type.replace(/_/g, " ")} — ${delivery_id}**`,
          ``,
          result.message,
          ``,
          `_Model: ${result.model}_`,
        ].join("\n"),
      }],
    };
  }
);

// AI: estimate delivery time
server.tool(
  "lst_estimate_delivery_time",
  "Use AI to estimate when a delivery will be completed based on its current status, dispatch time, and timeline.",
  {
    delivery_id: z.string().describe("Delivery ID e.g. DN-NYC-2025-00042"),
  },
  async ({ delivery_id }) => {
    const result = await api(`/deliveries/${encodeURIComponent(delivery_id)}/estimate-time`);
    const conf = result.confidence === "high" ? "🟢" : result.confidence === "medium" ? "🟡" : "🔴";
    return {
      content: [{
        type: "text",
        text: [
          `⏱️ **Delivery Estimate — ${delivery_id}**`,
          ``,
          `${conf} **${result.estimate}**`,
          `Confidence: ${result.confidence}`,
          `Reasoning: ${result.reasoning}`,
          ``,
          `_Model: ${result.model}_`,
        ].join("\n"),
      }],
    };
  }
);

// AI: detect anomalies across all active deliveries
server.tool(
  "lst_detect_delivery_anomalies",
  "Use AI to scan all active deliveries and flag anything suspicious — overdue, stuck in transit, no courier, failed with no follow-up.",
  {},
  async () => {
    const anomalies = await api("/deliveries/anomalies");
    if (!anomalies.length) {
      return { content: [{ type: "text", text: "✅ No anomalies detected across active deliveries." }] };
    }
    const ICON: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };
    const lines = anomalies.map((a: any) =>
      `${ICON[a.severity] ?? "⚪"} **${a.deliveryId}** (${a.customer}) — ${a.issue}\n   → ${a.recommendation}`
    );
    return {
      content: [{
        type: "text",
        text: [`⚠️ **${anomalies.length} anomaly/anomalies detected**`, "", ...lines].join("\n"),
      }],
    };
  }
);

// AI: daily ops summary
server.tool(
  "lst_daily_ops_summary",
  "Generate an AI-written end-of-day operations briefing: what shipped, what failed, what's still open, and any patterns for the manager.",
  {},
  async () => {
    const result = await api("/deliveries/daily-ops-summary");
    const highlights = (result.highlights ?? []).map((h: string) => `  ✓ ${h}`).join("\n");
    const flagged    = (result.flagged    ?? []).map((f: string) => `  ⚑ ${f}`).join("\n");
    return {
      content: [{
        type: "text",
        text: [
          `📊 **Daily Ops Summary** (${result.totalDeliveries ?? "?"} deliveries today)`,
          ``,
          result.summary,
          highlights ? `\n**Highlights:**\n${highlights}` : "",
          flagged    ? `\n**Follow-up needed:**\n${flagged}` : "",
          ``,
          `_Model: ${result.model}_`,
        ].filter(Boolean).join("\n"),
      }],
    };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[lst-mcp] Connected ✓\n");
