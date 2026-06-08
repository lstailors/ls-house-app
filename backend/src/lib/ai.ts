import { createGateway } from "@ai-sdk/gateway";
import { generateText, streamText } from "ai";

if (!process.env.AI_GATEWAY_API_KEY) {
  process.stderr.write("[ai] WARNING: AI_GATEWAY_API_KEY is not set — AI features will fail\n");
}

const _gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? "",
});

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6" as const;

export function gatewayModel(modelId: string = DEFAULT_MODEL) {
  return _gateway(modelId);
}

export { generateText, streamText };

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
