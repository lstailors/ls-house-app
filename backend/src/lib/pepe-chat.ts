/** Pepe staff-chat helpers — Raven DM resolve + message shaping. No channel create. */

export const PEPE_EMAIL = "pepe@lstailors.com";

/** Live Raven DMs (Maestro). Channel Member REST is empty / 409s — do not intersect. */
export const PEPE_DM_BY_EMAIL: Record<string, string> = {
  "carl@lstailors.com": "lgrkaihbcd",
  "gianna@lstailors.com": "lgs0shpjio",
};

export function pepeChannelIdForEmail(email: string | null | undefined): string | null {
  const key = String(email ?? "").trim().toLowerCase();
  return PEPE_DM_BY_EMAIL[key] ?? null;
}

export type ChatContext = { doctype: string; name: string };

export type RawRavenMessage = {
  name?: string;
  text?: string;
  owner?: string;
  creation?: string;
  message_type?: string;
  file?: string | null;
  file_url?: string | null;
  file_size?: number | string | null;
  is_bot_message?: unknown;
};

export type ChatMessage = {
  name: string;
  text: string;
  owner: string;
  creation: string;
  message_type: string;
  file: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  is_bot_message: boolean;
  is_pepe: boolean;
};

export function pickPepeChannelId(
  staffMemberChannelIds: string[],
  pepeMemberChannelIds: string[],
  directMessageIds: string[],
): string | null {
  const staff = new Set(staffMemberChannelIds.filter(Boolean));
  const pepe = new Set(pepeMemberChannelIds.filter(Boolean));
  const dms = new Set(directMessageIds.filter(Boolean));
  for (const id of staff) {
    if (pepe.has(id) && dms.has(id)) return id;
  }
  return null;
}

export function oldestFirst<T extends { creation?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => String(a.creation ?? "").localeCompare(String(b.creation ?? "")));
}

/** Pepe only. Sofia posts as bot=concierge@ — never treat is_bot_message as Pepe. */
export function isPepeOwner(owner: string | null | undefined, _isBot?: unknown): boolean {
  return String(owner ?? "").trim().toLowerCase() === PEPE_EMAIL;
}

function truthyFlag(v: unknown): boolean {
  return v === 1 || v === true || v === "1";
}

export function applyContextPrefix(text: string, ctx?: ChatContext | null): string {
  const body = String(text ?? "");
  if (!ctx?.doctype?.trim() || !ctx?.name?.trim()) return body;
  return `[context: ${ctx.doctype.trim()} / ${ctx.name.trim()}]\n${body}`;
}

export function fileNameFromPath(file: string | null | undefined): string | null {
  if (!file) return null;
  const cleaned = file.split("?")[0] ?? file;
  const base = cleaned.split("/").pop();
  return base || null;
}

export function normalizeRavenMessages(
  rows: RawRavenMessage[],
  proxyFileUrl: (file: string) => string,
  limit = 50,
): ChatMessage[] {
  const sorted = oldestFirst(rows).slice(-Math.max(1, Math.min(limit, 200)));
  return sorted.map((m, i) => {
    const file = String(m.file || m.file_url || "").trim() || null;
    const sizeRaw = m.file_size;
    const file_size =
      typeof sizeRaw === "number"
        ? sizeRaw
        : typeof sizeRaw === "string" && sizeRaw.trim()
          ? Number(sizeRaw) || null
          : null;
    const owner = String(m.owner ?? "");
    const is_pepe = isPepeOwner(owner);
    return {
      name: String(m.name ?? `msg-${i}`),
      text: String(m.text ?? ""),
      owner,
      creation: String(m.creation ?? ""),
      message_type: String(m.message_type ?? "Text"),
      file,
      file_url: file ? proxyFileUrl(file) : null,
      file_name: fileNameFromPath(file),
      file_size,
      is_bot_message: truthyFlag(m.is_bot_message),
      is_pepe,
    };
  });
}

export function unwrapGetMessages(payload: unknown): RawRavenMessage[] {
  if (Array.isArray(payload)) return payload as RawRavenMessage[];
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec.messages)) return rec.messages as RawRavenMessage[];
    if (Array.isArray(rec.message)) return rec.message as RawRavenMessage[];
    if (Array.isArray(rec.data)) return rec.data as RawRavenMessage[];
  }
  return [];
}

export function isImageType(filename: string, mime = ""): boolean {
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(filename);
}
