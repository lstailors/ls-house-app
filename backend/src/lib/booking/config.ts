/**
 * Public booking config — store hours, per-type durations, public tailors.
 *
 * Per-type durations + room flags locked by C's booking spec (Jul 2026).
 * Per-tailor weekly hours (C 2026-07-22):
 *   Carl + Christopher = full store hours
 *   Sal = Wed / Thu / Fri + Sat when store is open
 */

export type DayName =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export const DAY_NAMES: DayName[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Minutes from midnight window. */
export type TimeWindow = { fromMin: number; toMin: number };

export type WeeklyHours = Partial<Record<DayName, TimeWindow[]>>;

export interface PublicAppointmentType {
  /** Stable public slug used by the book UI. */
  id: "consultation" | "fitting" | "alterations";
  /** ERPNext LSH Appointment Type name. */
  erpName: string;
  label: string;
  description: string;
  durationMinutes: number;
  /** Consumes one of FITTING_ROOM_COUNT rooms while booked. Spec overrides ERP. */
  needsRoom: boolean;
  /**
   * Alterations-only gate (UI): custom client OR Casa L&S member.
   * Availability engine does not enforce — the book page interstitial does.
   */
  requiresEligibilityGate: boolean;
}

/** Spec durations — per-type, NOT the flat Appointment Booking Settings value. */
export const PUBLIC_APPOINTMENT_TYPES: PublicAppointmentType[] = [
  {
    id: "consultation",
    erpName: "Initial Consultation",
    label: "Consultation",
    description: "New custom clothing consultation",
    durationMinutes: 60,
    needsRoom: true,
    requiresEligibilityGate: false,
  },
  {
    id: "fitting",
    erpName: "Fitting Appointment",
    label: "Fitting",
    description: "Bespoke / custom fitting",
    durationMinutes: 30,
    needsRoom: true,
    requiresEligibilityGate: false,
  },
  {
    id: "alterations",
    erpName: "Alterations Appointment",
    label: "Alterations",
    description: "Alterations fitting — custom clients & Casa L&S members",
    durationMinutes: 15,
    needsRoom: true,
    requiresEligibilityGate: true,
  },
];

/** Physical fitting rooms at 138 E 61st. */
export const FITTING_ROOM_COUNT = 2;

/** How far ahead public can book (days). */
export const ADVANCE_BOOKING_DAYS = 60;

/** Minimum notice before a slot can be booked (minutes). */
export const MIN_NOTICE_MINUTES = 120;

/**
 * Locked shop-level hours (NYC) — base daily windows.
 * Open-days mask is seasonal (store-hours.ts): Sep–Jun Tue–Sat; summer Mon–Fri.
 * C: no starts before 9am; nothing that runs past 6pm (slot end ≤ 18:00).
 */
export const STORE_HOURS_WEEKDAY: TimeWindow = { fromMin: 9 * 60, toMin: 18 * 60 };
export const STORE_HOURS_SATURDAY: TimeWindow = { fromMin: 9 * 60, toMin: 15 * 60 };

export interface PublicTailor {
  id: string;
  agentUser: string;
  displayName: string;
  shortName: string;
  /** Calendar Event subject prefixes (lowercase, no colon). */
  tagAliases: string[];
  /**
   * Individual bookable hours. Intersected with store hours.
   * null = full store hours for open store days.
   */
  weeklyHours: WeeklyHours | null;
  /**
   * Per-type eligibility. Auto = in no-preference pool.
   * On request = only when customer picks them by name.
   * Off = not offered for that type.
   */
  typeModes: Record<string, "Auto" | "On request" | "Off">;
  publicBookable: boolean;
  notes?: string;
}

/**
 * Public bookable tailors: Sal, Carl, Christopher.
 * Kelvin out of public picker (HOU / internal).
 *
 * Locked C 2026-07-22:
 *   Carl + Christopher = full store hours
 *   Sal = Wed / Thu / Fri + Saturdays when store has Sat hours
 *   (summer Sat closed → Sal has no Sat slots then)
 */
export const PUBLIC_TAILORS: PublicTailor[] = [
  {
    id: "carl",
    agentUser: "carl@lstailors.com",
    displayName: "Calogero Cristiano",
    shortName: "Carl",
    tagAliases: ["calogero", "carl"],
    weeklyHours: null,
    typeModes: {
      "Initial Consultation": "Auto",
      "Fitting Appointment": "Auto",
      "Alterations Appointment": "On request",
    },
    publicBookable: true,
  },
  {
    id: "christopher",
    agentUser: "chris@ckcny.com",
    displayName: "Christopher Korey",
    shortName: "Christopher",
    tagAliases: ["christopher", "chris"],
    weeklyHours: null,
    typeModes: {
      "Initial Consultation": "Auto",
      "Fitting Appointment": "Auto",
      "Alterations Appointment": "Off",
    },
    publicBookable: true,
  },
  {
    id: "sal",
    agentUser: "sal@lstailors.com",
    displayName: "Salvatore Cristiano",
    shortName: "Sal",
    tagAliases: ["salvatore", "sal", "papa"],
    weeklyHours: {
      Wednesday: [STORE_HOURS_WEEKDAY],
      Thursday: [STORE_HOURS_WEEKDAY],
      Friday: [STORE_HOURS_WEEKDAY],
      Saturday: [STORE_HOURS_SATURDAY],
    },
    typeModes: {
      "Initial Consultation": "On request",
      "Fitting Appointment": "On request",
      "Alterations Appointment": "On request",
    },
    publicBookable: true,
    notes:
      "Part-time: Wed / Thu / Fri + Sat when store open (C confirmed 2026-07-22). Off Mon–Tue.",
  },
];

export const GOOGLE_APPOINTMENTS_CALENDAR = "L&S Appointments";

/** ERP Holiday List linked from Appointment Booking Settings. */
export const DEFAULT_HOLIDAY_LIST = "LSTNY 2026";

/** Alterations interstitial — custom clients OR Casa L&S members */
export const ALTERATIONS_GATE = {
  question: "Are you a current custom clothing client or Casa L&S member?",
  yes_label: "Yes",
  no_label: "No",
  decline_title: "Alterations are reserved",
  decline_body:
    "L&S now reserves alteration services for custom clients and Casa L&S members.",
  custom_clothing_url: "https://lstailors.com/",
  casa_membership_url: "https://lstailors.com/", // TODO: confirm Casa L&S URL
} as const;

export function getTypeById(id: string): PublicAppointmentType | undefined {
  return PUBLIC_APPOINTMENT_TYPES.find((t) => t.id === id);
}

export function getTypeByErpName(name: string): PublicAppointmentType | undefined {
  return PUBLIC_APPOINTMENT_TYPES.find((t) => t.erpName === name);
}

export function getTailorByUser(agentUser: string): PublicTailor | undefined {
  return PUBLIC_TAILORS.find((t) => t.agentUser === agentUser);
}

/** Minutes → "HH:MM:SS" */
export function minToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}

/** "HH:MM" | "HH:MM:SS" → minutes from midnight */
export function timeToMin(t: string): number {
  const parts = String(t).split(":");
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return h * 60 + m;
}
