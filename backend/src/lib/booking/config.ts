/**
 * Public booking config — store hours, per-type durations, public tailors.
 *
 * Per-type durations + room flags are locked by C's booking spec (Jul 2026).
 * Per-tailor weekly hours: NOT in ERP yet — weeklyHours stays null (full store
 * hours) until C supplies real schedules. Do not invent Sal's reduced hours.
 *
 * typeModes seed matches live LSH Booking Agent.type_rules (ERP) where set;
 * unset types default to Auto for Carl/Christopher, Off for anyone not listed.
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
    needsRoom: true, // spec: Consultation consumes a room (ERP flag currently 0)
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

/** Physical fitting rooms at 138 E 61st. Matches Appointment Booking Settings.fitting_room_count. */
export const FITTING_ROOM_COUNT = 2;

/** How far ahead public can book (days). Matches advance_booking_days. */
export const ADVANCE_BOOKING_DAYS = 60;

/** Minimum notice before a slot can be booked (minutes). */
export const MIN_NOTICE_MINUTES = 120;

/**
 * Locked shop-level hours (NYC) — base daily windows.
 * Open-days mask is seasonal (store-hours.ts): Sep–Jun Tue–Sat; summer Mon–Fri.
 */
export const STORE_HOURS_WEEKDAY: TimeWindow = { fromMin: 9 * 60, toMin: 17 * 60 };
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
   * null = full store hours for that day.
   * DATA GAP: no weekly_schedule field on LSH Booking Agent; HR Shift* empty.
   */
  weeklyHours: WeeklyHours | null;
  /**
   * Per-type eligibility. Auto = in no-preference pool.
   * On request = only when customer picks them by name.
   * Off = not offered for that type.
   * Seeded from live LSH Booking Agent.type_rules.
   */
  typeModes: Record<string, "Auto" | "On request" | "Off">;
  publicBookable: boolean;
  notes?: string;
}

/**
 * Public bookable tailors: Sal, Carl, Christopher.
 * Kelvin is on LSH Booking Agent but out of the public picker (HOU / internal).
 *
 * weeklyHours: ALL null until C provides real reduced schedules (esp. Sal part-time).
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
      "Alterations Appointment": "On request", // ERP type_rules
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
      "Alterations Appointment": "Off", // ERP type_rules
    },
    publicBookable: true,
  },
  {
    id: "sal",
    agentUser: "sal@lstailors.com",
    displayName: "Salvatore Cristiano",
    shortName: "Sal",
    tagAliases: ["salvatore", "sal", "papa"],
    // SCAFFOLD — part-time reduced hours (confirm with C before cutover).
    weeklyHours: {
      Tuesday: [{ fromMin: 10 * 60, toMin: 15 * 60 }],
      Wednesday: [{ fromMin: 10 * 60, toMin: 15 * 60 }],
      Thursday: [{ fromMin: 10 * 60, toMin: 15 * 60 }],
      Saturday: [{ fromMin: 9 * 60, toMin: 13 * 60 }],
    },
    typeModes: {
      // ERP has Sal as On request for public types (by-name / part-time)
      "Initial Consultation": "On request",
      "Fitting Appointment": "On request",
      "Alterations Appointment": "On request",
    },
    publicBookable: true,
    notes:
      "Part-time scaffold (Tue–Thu 10–15, Sat 9–13). Confirm reduced schedule with C before cutover.",
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
  const [h, m] = String(t).split(":");
  return Number(h) * 60 + Number(m);
}
