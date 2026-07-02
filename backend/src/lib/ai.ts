import { createGateway } from "@ai-sdk/gateway";
import { generateText, streamText } from "ai";

if (!process.env.AI_GATEWAY_API_KEY) {
  console.warn("[ai] WARNING: AI_GATEWAY_API_KEY is not set — AI features will fail");
}

const _gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? "",
});

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6" as const;

export function gatewayModel(modelId: string = DEFAULT_MODEL) {
  return _gateway(modelId);
}

export { generateText, streamText };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeliveryAnomaly {
  deliveryId: string;
  customer: string;
  status: string;
  issue: string;
  severity: "high" | "medium" | "low";
  recommendation: string;
}

export interface DailyOpsSummary {
  summary: string;
  highlights: string[];
  flagged: string[];
}

export type MessageType =
  | "delay_apology"
  | "out_for_delivery"
  | "delivered_confirmation"
  | "pickup_reminder"
  | "custom";

// ── Delivery domain AI helpers ────────────────────────────────────────────────

export async function suggestDeliveryStatus(doc: any): Promise<{ status: string; reason: string }> {
  const timelineText = (doc.lsh_timeline ?? [])
    .map((t: any) =>
      `  - ${t.event_type} at ${t.event_at} by ${t.actor_label}${t.message ? `: ${t.message}` : ""}`
    )
    .join("\n") || "  (no timeline entries yet)";

  const prompt = `You are a logistics coordinator for L&S Custom Tailors, a luxury tailoring service in New York and Houston.

Analyze this delivery record and recommend the most logical next status.

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

Be conservative — only suggest "Delivered" if there is clear evidence of delivery. Prefer the most probable next step given the timeline.

Respond ONLY with this exact JSON (no markdown, no extra text):
{"status": "<next status>", "reason": "<one concise sentence explaining why>"}`;

  const { text, usage } = await generateText({ model: gatewayModel(), prompt, maxOutputTokens: 256 });

  console.log(`[ai:suggest-status] ${doc.name} in=${usage.inputTokens} out=${usage.outputTokens}`);

  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error(`AI returned unexpected format`);
  return JSON.parse(match[0]) as { status: string; reason: string };
}

export async function generateCustomerMessage(
  doc: any,
  type: MessageType,
  channel: "sms" | "email",
  customContext?: string,
): Promise<string> {
  const typeInstructions: Record<MessageType, string> = {
    delay_apology: "The delivery is running behind schedule. Apologize professionally, reassure the customer, and indicate it will arrive soon.",
    out_for_delivery: "The delivery is currently on its way to the customer. Give them a warm heads-up to expect it shortly.",
    delivered_confirmation: "The garments have been successfully delivered. Confirm receipt and thank the customer.",
    pickup_reminder: "The customer's alterations are ready for pickup at the store. Remind them warmly.",
    custom: customContext ?? "Write a helpful customer message relevant to the delivery situation.",
  };

  const charGuidance = channel === "sms"
    ? "Keep it under 160 characters. No line breaks. Warm but concise."
    : "Write a subject line on the first line, then a blank line, then 2-3 short paragraphs. Professional and warm.";

  const prompt = `You are a customer service representative for L&S Custom Tailors, a luxury tailoring boutique.

Write a ${channel === "sms" ? "text message (SMS)" : "professional email"} to this customer.

Customer: ${doc.customer_name ?? "Valued Customer"}
Delivery: ${doc.name}
Current Status: ${doc.lsh_status ?? "Queued"}
Scheduled: ${doc.lsh_scheduled_at ?? "Not specified"}
Courier: ${doc.lsh_courier_name ?? "Our team"}
Notes: ${doc.lsh_delivery_notes ?? "None"}

Purpose: ${typeInstructions[type]}

Style: ${charGuidance}
Always sign off as "— L&S Custom Tailors"

Write the message now (plain text only):`;

  const { text, usage } = await generateText({ model: gatewayModel(), prompt, maxOutputTokens: 400 });
  console.log(`[ai:generate-message] ${doc.name} type=${type} channel=${channel} in=${usage.inputTokens} out=${usage.outputTokens}`);
  return text.trim();
}

export async function detectDeliveryAnomalies(deliveries: any[]): Promise<DeliveryAnomaly[]> {
  if (!deliveries.length) return [];

  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  const rows = deliveries.map((d) =>
    `${d.name} | status=${d.lsh_status ?? "?"} | customer=${d.customer_name ?? "?"} | courier=${d.lsh_courier_name ?? "none"} | scheduled=${d.lsh_scheduled_at ?? "—"} | dispatched=${d.lsh_dispatched_at ?? "—"}`
  ).join("\n");

  const prompt = `You are an operations manager at L&S Custom Tailors reviewing active deliveries.

Current time (UTC): ${now}

ACTIVE DELIVERIES:
${rows}

Identify deliveries that are problematic or need immediate attention. Look for:
- Overdue: scheduled time has passed and delivery is still "Queued"
- Stuck in transit: "Out for Delivery" for more than 4 hours with no completion
- No courier assigned but scheduled for today or earlier
- Failed deliveries that haven't been rescheduled
- Any other operational concerns

Return ONLY a JSON array (empty array if no issues):
[{"deliveryId":"DN-...","customer":"...","status":"...","issue":"<one sentence>","severity":"high|medium|low","recommendation":"<one actionable sentence>"}]`;

  const { text, usage } = await generateText({ model: gatewayModel(), prompt, maxOutputTokens: 800 });
  console.log(`[ai:detect-anomalies] scanned=${deliveries.length} in=${usage.inputTokens} out=${usage.outputTokens}`);

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as DeliveryAnomaly[];
  } catch {
    return [];
  }
}

export async function estimateDeliveryTime(doc: any): Promise<{
  estimate: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}> {
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  const timelineText = (doc.lsh_timeline ?? [])
    .map((t: any) => `  - ${t.event_type} at ${t.event_at}`)
    .join("\n") || "  (no entries)";

  const prompt = `You are a logistics coordinator at L&S Custom Tailors.

Current time (UTC): ${now}

DELIVERY:
Status: ${doc.lsh_status ?? "Queued"}
Scheduled At: ${doc.lsh_scheduled_at ?? "Not set"}
Dispatched At: ${doc.lsh_dispatched_at ?? "Not dispatched"}
Courier: ${doc.lsh_courier_name ?? "Not assigned"}
Address: ${[doc.lsh_delivery_address, doc.lsh_delivery_city].filter(Boolean).join(", ") || "Not set"}
Timeline:
${timelineText}

Estimate when this delivery will be completed. Assume typical L&S delivery time is 30–90 minutes from dispatch.

Return ONLY JSON:
{"estimate":"<e.g. 'Within 30 minutes' or 'Overdue — was due at 2:00 PM'>","confidence":"high|medium|low","reasoning":"<one sentence>"}`;

  const { text, usage } = await generateText({ model: gatewayModel(), prompt, maxOutputTokens: 200 });
  console.log(`[ai:estimate-time] ${doc.name} in=${usage.inputTokens} out=${usage.outputTokens}`);

  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("AI returned unexpected format");
  return JSON.parse(match[0]);
}

export async function summarizeDailyOps(deliveries: any[], locationLabel?: string): Promise<DailyOpsSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const counts = {
    scheduled: deliveries.filter((d) => d.lsh_status === "Queued").length,
    out: deliveries.filter((d) => d.lsh_status === "Out for Delivery").length,
    delivered: deliveries.filter((d) => d.lsh_status === "Delivered").length,
    failed: deliveries.filter((d) => d.lsh_status === "Failed").length,
  };

  const rows = deliveries.slice(0, 40).map((d) =>
    `- ${d.name} | ${d.lsh_status} | ${d.customer_name ?? "?"} | courier=${d.lsh_courier_name ?? "none"}`
  ).join("\n");

  const prompt = `You are the operations manager at L&S Custom Tailors reviewing today's delivery operations.

Date: ${today}${locationLabel ? ` | Location: ${locationLabel}` : ""}

TOTALS: Scheduled=${counts.scheduled} · Out for Delivery=${counts.out} · Delivered=${counts.delivered} · Failed=${counts.failed}

DETAILS:
${rows}

Write a brief end-of-day operational summary (3–5 sentences). Then list up to 3 highlights (things that went well) and up to 3 flagged items (concerns for tomorrow or follow-up needed).

Return ONLY JSON:
{"summary":"...","highlights":["..."],"flagged":["..."]}`;

  const { text, usage } = await generateText({ model: gatewayModel(), prompt, maxOutputTokens: 600 });
  console.log(`[ai:daily-ops] deliveries=${deliveries.length} in=${usage.inputTokens} out=${usage.outputTokens}`);

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI returned unexpected format");
  return JSON.parse(match[0]) as DailyOpsSummary;
}

export async function summarizeDeliveryTimeline(doc: any): Promise<string> {
  const timeline: any[] = doc.lsh_timeline ?? [];
  if (!timeline.length) return "No timeline events recorded yet.";

  const timelineText = timeline
    .map((t) =>
      `- ${t.event_type} on ${t.event_at} (by ${t.actor_label})${t.message ? `: "${t.message}"` : ""}`
    )
    .join("\n");

  const prompt = `You are a customer service assistant for L&S Custom Tailors, a luxury tailoring business.

Write a short, clear, human-friendly summary (2–4 sentences) of the following delivery timeline for internal staff use. Focus on key milestones and current state. Be concise and professional.

Delivery: ${doc.name}
Customer: ${doc.customer_name ?? "Unknown"}
Current Status: ${doc.lsh_status ?? "Unknown"}

Timeline:
${timelineText}

Write the summary now (plain text only, no bullet points or headers):`;

  const { text, usage } = await generateText({ model: gatewayModel(), prompt, maxOutputTokens: 300 });

  console.log(`[ai:summarize-timeline] ${doc.name} in=${usage.inputTokens} out=${usage.outputTokens}`);

  return text.trim();
}

// ── Shop Floor production brief ────────────────────────────────────────────────
// Turns production stats + the top "needs attention" items into a tight,
// glanceable headline for the shop-floor team. Returns a plain string.

export interface ProductionBriefInput {
  stats: { active: number; rush: number; shippingThisWeek: number; overdue: number; attention: number };
  items: Array<{ order_no: string; customer_name: string | null; reason: string; severity: "high" | "medium" }>;
}

export async function summarizeProduction(input: ProductionBriefInput): Promise<string> {
  const { stats, items } = input;
  const today = new Date().toISOString().slice(0, 10);

  const lines = items.slice(0, 12).map((i) =>
    `- [${i.severity}] ${i.order_no} ${i.customer_name ?? "?"}: ${i.reason}`
  ).join("\n") || "  (nothing flagged)";

  const prompt = `You are the production manager at L&S Custom Tailors reviewing the YongZheng workshop floor.

Date: ${today}
TOTALS: Active=${stats.active} · Rush=${stats.rush} · Shipping this week=${stats.shippingThisWeek} · Overdue=${stats.overdue} · Needs attention=${stats.attention}

FLAGGED ITEMS (most urgent first):
${lines}

Write a concise 2-3 sentence briefing for the shop-floor team: lead with what needs action today, name the most urgent one or two orders (by order no + customer), and end on overall state. Direct and calm — no fluff, no bullet points, no markdown.

Write the briefing now (plain text only):`;

  const { text, usage } = await generateText({ model: gatewayModel(), prompt, maxOutputTokens: 300 });
  console.log(`[ai:production-brief] items=${items.length} in=${usage.inputTokens} out=${usage.outputTokens}`);

  return text.trim();
}
