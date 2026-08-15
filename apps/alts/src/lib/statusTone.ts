/**
 * Unified floor status colors.
 * Pickup = green, QC = yellow, Tasks = red, Shop Floor = brass.
 * Every badge in Alts should go through this map.
 */
export type StatusTone = "pickup" | "qc" | "tasks" | "shop" | "neutral";

export const STATUS_TONES: Record<
  StatusTone,
  { label: string; bg: string; fg: string; border: string; bar: string }
> = {
  pickup: {
    label: "Pickup",
    bg: "rgba(79,191,142,0.18)",
    fg: "#7EE0B0",
    border: "rgba(79,191,142,0.45)",
    bar: "#4FBF8E",
  },
  qc: {
    label: "QC",
    bg: "rgba(232,168,92,0.18)",
    fg: "#F0C48A",
    border: "rgba(232,168,92,0.5)",
    bar: "#E8A85C",
  },
  tasks: {
    label: "Tasks",
    bg: "rgba(217,123,108,0.2)",
    fg: "#F0A090",
    border: "rgba(217,123,108,0.5)",
    bar: "#D97B6C",
  },
  shop: {
    label: "Shop Floor",
    bg: "rgba(176,141,87,0.2)",
    fg: "#E3C48F",
    border: "rgba(176,141,87,0.5)",
    bar: "#B08D57",
  },
  neutral: {
    label: "Status",
    bg: "rgba(241,233,214,0.08)",
    fg: "#D4CDB8",
    border: "rgba(176,141,87,0.28)",
    bar: "#A39C8A",
  },
};

const PICKUP = /\b(pickup|picked.?up|ready|delivered|pass(ed)?|complete(d)?|done|processed)\b/i;
const QC = /\b(qc|quality control|waiting|unverified|due soon|out for delivery|pending)\b/i;
const TASKS = /\b(task|overdue|fail(ed)?|cancel(led)?|on hold|hold|alert|conflict|unpaid)\b/i;
const SHOP =
  /\b(shop|floor|progress|received|queued|scheduled|open|production|intake|cutting|fitting|alteration)\b/i;

export function toneFor(status?: string | null, hint?: StatusTone | null): StatusTone {
  if (hint) return hint;
  const s = String(status || "").trim();
  if (!s) return "neutral";
  if (PICKUP.test(s)) return "pickup";
  if (TASKS.test(s)) return "tasks";
  if (QC.test(s)) return "qc";
  if (SHOP.test(s)) return "shop";
  return "neutral";
}

export function toneClass(tone: StatusTone) {
  return `st-badge st-${tone}`;
}
