/**
 * UI labels only. ERPNext billing_status values stay:
 *   Billable | Included in Custom Order | Warranty | (and any 4th SoT value)
 * Never rewrite payload fields — only display strings.
 */

/** Map ERP billing_status → floor-facing chip/label */
export function billingStatusLabel(status?: string | null): string {
  if (!status) return "";
  if (status === "Warranty") return "Re-do";
  if (status === "Included in Custom Order") return "On custom order";
  if (status === "Billable") return "Billable";
  return status;
}

/** Five canonical display strings (C 2026-07-28 — Warranty = Re-do in UI). */
export const REDO_DISPLAY = {
  /** Kind tile title */
  kindTitle: "Re-do",
  /** Kind tile body */
  kindBody:
    "Fix on work we already did — full shop prices for tailor stats; client is never charged twice.",
  /** Kind chip */
  kindChip: "Re-do",
  /** Intake billing strip */
  intakeStrip: "Re-do · valued · no SI",
  /** Intake helper under billing */
  intakeHelper:
    "Re-do — keep full prices for internal value & tailor stats. No SI / no AR.",
} as const;
