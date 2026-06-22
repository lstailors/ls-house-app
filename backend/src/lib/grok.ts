// Shared Sofia/Grok client (server-only).
// Sofia is L&S's AI, powered by Grok 4.20 via xAI. Every route used to inline
// this fetch + identity prompt; this is the single source of truth.

const XAI_URL = "https://api.x.ai/v1/chat/completions";

// Default to the same model Sofia's concierge uses. Overridable via env.
const SOFIA_MODEL = process.env.SOFIA_MODEL ?? "grok-4.20-0309-non-reasoning";

// Non-negotiable identity, mirrored from routes/sofia.ts.
const SOFIA_IDENTITY =
  "IDENTITY (non-negotiable): You are Sofia, the AI for L&S Custom Tailors, " +
  "built on Grok by xAI. You are NOT Claude, NOT GPT, NOT Gemini. Never say you " +
  "are Claude or Anthropic under any circumstances.";

export type GrokMessage = { role: "system" | "user" | "assistant"; content: string };

export interface GrokOpts {
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}

// Ensure the Sofia identity leads the conversation without clobbering caller
// system prompts.
function withIdentity(messages: GrokMessage[]): GrokMessage[] {
  if (messages[0]?.role === "system") {
    return [
      { role: "system", content: `${SOFIA_IDENTITY}\n\n${messages[0].content}` },
      ...messages.slice(1),
    ];
  }
  return [{ role: "system", content: SOFIA_IDENTITY }, ...messages];
}

function stripFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/**
 * Call Sofia (Grok). Returns the assistant text, or "" if unconfigured / failed.
 * Never throws — callers degrade gracefully (empty briefing, no suggestions).
 */
export async function grokChat(messages: GrokMessage[], opts: GrokOpts = {}): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return "";
  try {
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SOFIA_MODEL,
        messages: withIdentity(messages),
        max_tokens: opts.maxTokens ?? 400,
        temperature: opts.temperature ?? 0.3,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as any;
    return (data?.choices?.[0]?.message?.content ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * Call Sofia and parse a JSON object response. Returns null on any failure.
 * The prompt MUST instruct the model to return JSON (xAI/OpenAI json_object
 * semantics require the word "json" somewhere in the messages).
 */
export async function grokJSON<T = unknown>(messages: GrokMessage[], opts: GrokOpts = {}): Promise<T | null> {
  const raw = await grokChat(messages, { ...opts, json: true });
  if (!raw) return null;
  try {
    return JSON.parse(stripFences(raw)) as T;
  } catch {
    return null;
  }
}
