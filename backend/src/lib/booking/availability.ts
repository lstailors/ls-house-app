/**
 * Public booking availability engine (keystone).
 *
 * Per-type duration grid × per-tailor hours × store seasonal hours × rooms × ERP busy.
 * No Cal.com. No Supabase. ERPNext Appointment + Event on "L&S Appointments".
 *
 * Alterations eligibility gate is UI-only (see ALTERATIONS_GATE in config).
 */

import { erpGet, erpList } from "../erp";
import {
  ADVANCE_BOOKING_DAYS,
  DEFAULT_HOLIDAY_LIST,
  FITTING_ROOM_COUNT,
  GOOGLE_APPOINTMENTS_CALENDAR,
  MIN_NOTICE_MINUTES,
  PUBLIC_APPOINTMENT_TYPES,
  PUBLIC_TAILORS,
  type DayName,
  type PublicAppointmentType,
  type PublicTailor,
  type TimeWindow,
  getTailorByUser,
  getTypeByErpName,
  getTypeById,
  minToTime,
} from "./config";
import {
  type TimeRange,
  intersectRanges,
  storeDayAvailability,
  usFederalHolidaySet,
  weekdayNy,
} from "./store-hours";
import { addMinutes, eachDate, normDt, nowInNyc, overlaps } from "./time";

export interface FreeAgent {
  agent_user: string;
  display_name: string;
  short_name: string;
}

export interface AvailableSlot {
  datetime: string; // "YYYY-MM-DD HH:MM:SS"
  date: string;
  time: string; // "HH:MM"
  end_datetime: string;
  duration_minutes: number;
  free_agents: FreeAgent[];
  rooms_free: number;
}

export interface AvailabilityQuery {
  /** Public type id OR ERP type name. */
  appointmentType: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  /** agent_user email, or omit / "any" for no preference. */
  agentUser?: string | null;
}

export interface AvailabilityResult {
  appointment_type: string;
  appointment_type_id: string;
  duration_minutes: number;
  needs_room: boolean;
  requires_eligibility_gate: boolean;
  fitting_room_count: number;
  agent_filter: string | null;
  slots: AvailableSlot[];
  meta: {
    generated_at: string;
    holidays_loaded: number;
    holiday_source: "erp" | "fallback";
    appointments_loaded: number;
    events_loaded: number;
    warnings: string[];
  };
}

type Interval = { start: string; end: string };

function resolveType(input: string): PublicAppointmentType {
  const byId = getTypeById(input);
  if (byId) return byId;
  const byErp = getTypeByErpName(input);
  if (byErp) return byErp;
  const lower = input.toLowerCase();
  if (lower.includes("consult")) return getTypeById("consultation")!;
  if (lower.includes("fit")) return getTypeById("fitting")!;
  if (lower.includes("alter")) return getTypeById("alterations")!;
  throw new Error(`Unknown appointment type: ${input}`);
}

function storeWindowsForDate(date: string, holidays: Set<string>): TimeWindow[] {
  const day = storeDayAvailability(date, holidays);
  if (!day.open) return [];
  return day.ranges.map((r: TimeRange) => ({ fromMin: r.startMin, toMin: r.endMin }));
}

function dayNameForDate(date: string): DayName {
  const wd = weekdayNy(date); // 0=Sun … 6=Sat
  const map: DayName[] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return map[wd] ?? "Monday";
}

function tailorWindows(tailor: PublicTailor, date: string, holidays: Set<string>): TimeWindow[] {
  const store = storeWindowsForDate(date, holidays);
  if (!store.length) return [];
  if (!tailor.weeklyHours) return store;
  const day = dayNameForDate(date);
  const own = tailor.weeklyHours[day] ?? [];
  if (!own.length) return [];
  const ownRanges: TimeRange[] = own.map((w) => ({ startMin: w.fromMin, endMin: w.toMin }));
  const storeRanges: TimeRange[] = store.map((w) => ({ startMin: w.fromMin, endMin: w.toMin }));
  return intersectRanges(storeRanges, ownRanges).map((r) => ({
    fromMin: r.startMin,
    toMin: r.endMin,
  }));
}

function modeFor(tailor: PublicTailor, erpTypeName: string): "Auto" | "On request" | "Off" {
  return tailor.typeModes[erpTypeName] ?? "Off";
}

/**
 * No preference → Auto pool only.
 * Named tailor → that person if mode !== Off (On request allowed when picked).
 */
function eligibleTailors(erpTypeName: string, agentUser?: string | null): PublicTailor[] {
  const publicTailors = PUBLIC_TAILORS.filter((t) => t.publicBookable);

  if (agentUser && agentUser !== "any" && agentUser !== "none" && agentUser !== "no_preference") {
    let t = getTailorByUser(agentUser);
    if (!t) t = PUBLIC_TAILORS.find((x) => x.id === agentUser);
    if (!t || !t.publicBookable) throw new Error(`Tailor not found: ${agentUser}`);
    const mode = modeFor(t, erpTypeName);
    if (mode === "Off") throw new Error(`Tailor not available for ${erpTypeName}`);
    return [t];
  }

  const auto = publicTailors.filter((t) => modeFor(t, erpTypeName) === "Auto");
  if (auto.length) return auto;
  // Fallback: if nobody is Auto (e.g. Alterations are On-request only), pool On-request tailors
  const onReq = publicTailors.filter((t) => modeFor(t, erpTypeName) === "On request");
  if (!onReq.length) throw new Error(`No bookable tailors for ${erpTypeName}`);
  return onReq;
}

function buildTagMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of PUBLIC_TAILORS) {
    for (const alias of t.tagAliases) map.set(alias.toLowerCase(), t.agentUser);
    map.set(t.shortName.toLowerCase(), t.agentUser);
    map.set(t.displayName.toLowerCase(), t.agentUser);
  }
  return map;
}

async function loadHolidays(
  dateFrom: string,
  dateTo: string,
): Promise<{ set: Set<string>; source: "erp" | "fallback" }> {
  const set = new Set<string>();
  try {
    const settings = await erpGet<any>("Appointment Booking Settings", "Appointment Booking Settings");
    const listName = (settings?.holiday_list as string | undefined) || DEFAULT_HOLIDAY_LIST;
    const list = await erpGet<any>("Holiday List", listName);
    const rows = (list?.holidays as any[]) || [];
    for (const r of rows) {
      const d = r?.holiday_date ? String(r.holiday_date).slice(0, 10) : "";
      if (d && d >= dateFrom && d <= dateTo) set.add(d);
    }
    if (set.size || rows.length) return { set, source: "erp" };
  } catch {
    // fall through
  }

  // Offline fallback: US federal only (store-hours still applies August vacation + open days)
  const y0 = Number(dateFrom.slice(0, 4));
  const y1 = Number(dateTo.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const d of usFederalHolidaySet(y)) {
      if (d >= dateFrom && d <= dateTo) set.add(d);
    }
  }
  return { set, source: "fallback" };
}

async function loadOpenAppointments(dateFrom: string, dateTo: string) {
  return erpList<any>("Appointment", {
    filters: [
      ["scheduled_time", ">=", `${dateFrom} 00:00:00`],
      ["scheduled_time", "<=", `${dateTo} 23:59:59`],
      ["status", "not in", ["Closed"]],
    ],
    fields: ["name", "scheduled_time", "assigned_agent", "custom_appointment_type", "status"],
    limit: 500,
    order_by: "scheduled_time asc",
  });
}

async function loadCalendarEvents(dateFrom: string, dateTo: string) {
  return erpList<any>("Event", {
    filters: [
      ["google_calendar", "=", GOOGLE_APPOINTMENTS_CALENDAR],
      ["starts_on", "<=", `${dateTo} 23:59:59`],
      ["ends_on", ">=", `${dateFrom} 00:00:00`],
      ["status", "!=", "Cancelled"],
    ],
    fields: ["name", "subject", "starts_on", "ends_on", "all_day", "status"],
    limit: 500,
  });
}

function durationForErpType(erpName: string | null | undefined, fallback: number): number {
  if (!erpName) return fallback;
  const t = getTypeByErpName(erpName);
  if (t) return t.durationMinutes;
  return fallback;
}

function appointmentInterval(appt: any, fallbackDuration: number): Interval {
  const start = normDt(appt.scheduled_time);
  const mins = durationForErpType(appt.custom_appointment_type, fallbackDuration);
  return { start, end: addMinutes(start, mins) };
}

function eventInterval(ev: any): Interval {
  const start = normDt(ev.starts_on);
  const end = ev.ends_on ? normDt(ev.ends_on) : addMinutes(start, 60);
  return { start, end };
}

/**
 * Parse Event subject tags:
 *  - "Carl: ..." / "Sal: ..." → that tailor
 *  - "ALL: ..." or no colon → whole shop block
 */
function eventTargets(subject: string, tagMap: Map<string, string>): "all" | string[] {
  const subj = (subject || "").trim();
  if (!subj) return "all";
  const colon = subj.indexOf(":");
  if (colon < 0) return "all";
  const prefix = subj.slice(0, colon).trim().toLowerCase();
  if (prefix === "all") return "all";
  const user = tagMap.get(prefix);
  return user ? [user] : [];
}

export async function getAvailableSlots(query: AvailabilityQuery): Promise<AvailabilityResult> {
  const warnings: string[] = [];
  const type = resolveType(query.appointmentType);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)) {
    throw new Error("date_from and date_to must be YYYY-MM-DD");
  }
  if (query.dateFrom > query.dateTo) throw new Error("date_from must be <= date_to");

  const todayNyc = nowInNyc().slice(0, 10);
  const maxDate = addMinutes(`${todayNyc} 00:00:00`, ADVANCE_BOOKING_DAYS * 24 * 60).slice(0, 10);
  const dateFrom = query.dateFrom < todayNyc ? todayNyc : query.dateFrom;
  const dateTo = query.dateTo > maxDate ? maxDate : query.dateTo;

  // DATA GAP: no per-tailor weekly_schedule on LSH Booking Agent / HR Shift*
  if (PUBLIC_TAILORS.some((t) => t.weeklyHours === null && t.publicBookable)) {
    warnings.push(
      "Per-tailor weekly schedules missing in ERP (LSH Booking Agent has no weekly_schedule; Shift Assignment empty). All public tailors currently use full store hours. Sal part-time hours need C input.",
    );
  }

  const pool = eligibleTailors(type.erpName, query.agentUser);
  const poolUsers = new Set(pool.map((t) => t.agentUser));
  const tagMap = buildTagMap();

  const [holidayResult, appointments, events] = await Promise.all([
    loadHolidays(dateFrom, dateTo),
    loadOpenAppointments(dateFrom, dateTo),
    loadCalendarEvents(dateFrom, dateTo),
  ]);
  const holidays = holidayResult.set;

  const busy: Record<string, Interval[]> = {};
  for (const t of pool) busy[t.agentUser] = [];

  for (const appt of appointments) {
    const au = appt.assigned_agent as string | null;
    if (!au || !poolUsers.has(au)) continue;
    const list = busy[au] ?? (busy[au] = []);
    list.push(appointmentInterval(appt, type.durationMinutes));
  }

  for (const ev of events) {
    const iv = eventInterval(ev);
    const targets = eventTargets(ev.subject || "", tagMap);
    if (targets === "all") {
      for (const u of poolUsers) {
        const list = busy[u] ?? (busy[u] = []);
        list.push(iv);
      }
    } else {
      for (const u of targets) {
        if (!poolUsers.has(u)) continue;
        const list = busy[u] ?? (busy[u] = []);
        list.push(iv);
      }
    }
  }

  // Room intervals: open appts whose type needs a room
  const roomTypes = new Set(PUBLIC_APPOINTMENT_TYPES.filter((t) => t.needsRoom).map((t) => t.erpName));
  const roomIntervals: Interval[] = [];
  if (type.needsRoom) {
    for (const appt of appointments) {
      const erpType = appt.custom_appointment_type as string | undefined;
      if (erpType && roomTypes.has(erpType)) {
        roomIntervals.push(appointmentInterval(appt, type.durationMinutes));
      }
    }
  }

  const minStart = addMinutes(nowInNyc(), MIN_NOTICE_MINUTES);
  const slots: AvailableSlot[] = [];

  for (const date of eachDate(dateFrom, dateTo)) {
    const candidateStarts = new Set<number>();
    for (const t of pool) {
      for (const w of tailorWindows(t, date, holidays)) {
        // Slot grid steps by appointment-type duration
        for (let m = w.fromMin; m + type.durationMinutes <= w.toMin; m += type.durationMinutes) {
          candidateStarts.add(m);
        }
      }
    }

    const starts = [...candidateStarts].sort((a, b) => a - b);
    for (const startMin of starts) {
      const slotStart = `${date} ${minToTime(startMin)}`;
      const slotEnd = addMinutes(slotStart, type.durationMinutes);
      if (slotStart < minStart) continue;

      let roomsUsed = 0;
      if (type.needsRoom) {
        for (const ri of roomIntervals) {
          if (overlaps(slotStart, slotEnd, ri.start, ri.end)) roomsUsed += 1;
        }
        if (roomsUsed >= FITTING_ROOM_COUNT) continue;
      }

      const free: FreeAgent[] = [];
      for (const t of pool) {
        const wins = tailorWindows(t, date, holidays);
        const inHours = wins.some(
          (w) => startMin >= w.fromMin && startMin + type.durationMinutes <= w.toMin,
        );
        if (!inHours) continue;
        let occupied = false;
        for (const b of busy[t.agentUser] || []) {
          if (overlaps(slotStart, slotEnd, b.start, b.end)) {
            occupied = true;
            break;
          }
        }
        if (!occupied) {
          free.push({
            agent_user: t.agentUser,
            display_name: t.displayName,
            short_name: t.shortName,
          });
        }
      }
      if (!free.length) continue;

      slots.push({
        datetime: slotStart,
        date,
        time: minToTime(startMin).slice(0, 5),
        end_datetime: slotEnd,
        duration_minutes: type.durationMinutes,
        free_agents: free,
        rooms_free: type.needsRoom ? FITTING_ROOM_COUNT - roomsUsed : FITTING_ROOM_COUNT,
      });
    }
  }

  return {
    appointment_type: type.erpName,
    appointment_type_id: type.id,
    duration_minutes: type.durationMinutes,
    needs_room: type.needsRoom,
    requires_eligibility_gate: type.requiresEligibilityGate,
    fitting_room_count: FITTING_ROOM_COUNT,
    agent_filter:
      query.agentUser && query.agentUser !== "any" && query.agentUser !== "no_preference"
        ? query.agentUser
        : null,
    slots,
    meta: {
      generated_at: nowInNyc(),
      holidays_loaded: holidays.size,
      holiday_source: holidayResult.source,
      appointments_loaded: appointments.length,
      events_loaded: events.length,
      warnings,
    },
  };
}

export function listPublicTypes() {
  return PUBLIC_APPOINTMENT_TYPES.map((t) => ({
    id: t.id,
    erp_name: t.erpName,
    label: t.label,
    description: t.description,
    duration_minutes: t.durationMinutes,
    needs_room: t.needsRoom,
    requires_eligibility_gate: t.requiresEligibilityGate,
  }));
}

export function listPublicTailors(appointmentType?: string) {
  let erpName: string | undefined;
  if (appointmentType) {
    try {
      erpName = resolveType(appointmentType).erpName;
    } catch {
      erpName = undefined;
    }
  }

  const rows = PUBLIC_TAILORS.filter((t) => t.publicBookable).map((t) => {
    const mode = erpName ? modeFor(t, erpName) : "Auto";
    return {
      id: t.id,
      agent_user: t.agentUser,
      display_name: t.displayName,
      short_name: t.shortName,
      mode,
      part_time: Boolean(t.weeklyHours),
      notes: t.notes ?? null,
      available_for_type: erpName ? mode !== "Off" : true,
    };
  });

  return {
    no_preference: {
      id: "any",
      agent_user: null,
      display_name: "No preference",
      short_name: "Any",
      mode: "Auto",
    },
    tailors: erpName ? rows.filter((r) => r.available_for_type) : rows,
  };
}
