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
 *   LST_MCP_SECRET    — shared secret (set same value in Vercel as LST_MCP_SECRET)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE  = process.env.LST_BACKEND_URL ?? "https://app.lstailors.com";
const SECRET = process.env.LST_MCP_SECRET ?? "";

if (!SECRET) {
  process.stderr.write("[lst-mcp] WARNING: LST_MCP_SECRET is not set\n");
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

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[lst-mcp] Connected ✓\n");
