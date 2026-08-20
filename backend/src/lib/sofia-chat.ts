/** Staff "Ask Sofia" web-chat request helpers. */

export type SofiaChatTurn = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 20;
const MAX_CONTENT = 2000;

export function parseSofiaChatHistory(raw: unknown, limit = MAX_TURNS): SofiaChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: SofiaChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const rawRole = String(rec.role ?? "");
    const role: SofiaChatTurn["role"] | null =
      rawRole === "user" || rawRole === "staff"
        ? "user"
        : rawRole === "assistant" || rawRole === "sofia"
          ? "assistant"
          : null;
    if (!role) continue;
    const content = String(rec.content ?? rec.text ?? "").trim().slice(0, MAX_CONTENT);
    if (!content) continue;
    out.push({ role, content });
  }
  return out.slice(-Math.max(1, limit));
}

export function parseContextPhone(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return s.slice(0, 32);
}
