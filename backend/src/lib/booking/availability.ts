/**
 * Public booking availability engine (keystone).
 *
 * Mia contract (2026-07-22):
 *   bookable = (availability events on tailor's Availability calendar)
 *              − (already booked on "L&S Appointments" / open Appointments)
 *              − (room full, ≥2 rooms)
 *   then intersect outer bounds:
 *     store hours + holiday list "LSTNY 2026" + Aug 1–14 + type_rules
 *     + per-type duration + absolute clamp [09:00, 18:00] (Sat end 15:00)
 *
 * SEMANTICS: availability = events ON these calendars (presence = bookable).
 * NOT blocks. Fewer/shorter events = less availability.
 * Confirmed bookings write ONLY to "L&S Appointments".
 *
 * No Cal.com. No Supabase in the scheduling path.
 */

import { erpCreate, erpGet, erpList } from "../erp";
import {
  ADVANCE_BOOKING_DAYS,
  AVAILABILITY_CALENDARS,
  BOOKABLE_CLAMP_SATURDAY,
  BOOKABLE_CLAMP_WEEKDAY,
  DEFAULT_HOLIDAY_LIST,
  FITTING_ROOM_COUNT,
  GOOGLE_APPOINTMENTS_CALENDAR,
  MIN_NOTICE_MINUTES,
  PUBLIC_APPOINTMENT_TYPES,
  PUBLIC_TAILORS,
  type PublicAppointmentType,
  type PublicTailor,
  type TimeWindow,
  getTailorById,
  getTailorByUser,
  getTypeByErpName,
  getTypeById,
  minToTime,
  timeToMin,
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
  /** agent_user email, tailor id, or omit / "any" for no preference. */
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
    booked_events_loaded: number;
    availability_events_loaded: number;
    availability_source: "erp_events";
    warnings: string[];
  };
}

export interface CreateBookingInput {
  appointmentType: string;
  /** "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS" */
  scheduledTime: string;
  /** agent_user email, tailor id, or "any" / omit for no preference */
  agentUser?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  notes?: string;
}

export interface CreateBookingResult {
  appointment_name: string;
  event_name: string | null;
  assigned_agent: string;
  scheduled_time: string;
  end_time: string;
  appointment_type: string;
  google_calendar: string;
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

function modeFor(tailor: PublicTailor, erpTypeName: string): "Auto" | "On request" | "Off" {
  return tailor.typeModes[erpTypeName] ?? "Off";
}

/**
 * No preference → Auto pool only (fallback On request if none Auto).
 * Named tailor → that person if mode !== Off (On request allowed when picked).
 */
function eligibleTailors(erpTypeName: string, agentUser?: string | null): PublicTailor[] {
  const publicTailors = PUBLIC_TAILORS.filter((t) => t.publicBookable);

  if (agentUser && agentUser !== "any" && agentUser !== "none" && agentUser !== "no_preference") {
    let t = getTailorByUser(agentUser);
    if (!t) t = getTailorById(agentUser);
    if (!t || !t.publicBookable) throw new Error(`Tailor not found: ${agentUser}`);
    const mode = modeFor(t, erpTypeName);
    if (mode === "Off") throw new Error(`Tailor not available for ${erpTypeName}`);
    return [t];
  }

  const auto = publicTailors.filter((t) => modeFor(t, erpTypeName) === "Auto");
  if (auto.length) return auto;
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

  const y0 = Number(dateFrom.slice(0, 4));
  const y1 = Number(dateTo.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const d of usFederalHolidaySet(y)) {
      if (d >= dateFrom && d <= dateTo) set.add(d);
    }
  }
  return { set, source: "fallback" };
}

/**
 * Resolve availability calendar name per tailor.
 * Prefer live LSH Booking Agent.availability_google_calendar; fall back to config.
 */
async function loadAgentCalendarMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const t of PUBLIC_TAILORS) {
    if (t.availabilityGoogleCalendar) map.set(t.agentUser, t.availabilityGoogleCalendar);
  }
  try {
    const agents = await erpList<any>("LSH Booking Agent", {
      filters: [["active", "=", 1]],
      fields: ["name", "agent_user", "availability_google_calendar", "active"],
      limit: 50,
    });
    for (const a of agents) {
      const cal = a.availability_google_calendar as string | null;
      const user = a.agent_user as string;
      if (user && cal) map.set(user, cal);
    }
  } catch {
    // keep config fallbacks
  }
  return map;
}

async function loadOpenAppointments(dateFrom: string, dateTo: string) {
  return erpList<any>("Appointment", {
    filters: [
      ["scheduled_time", ">=", `${dateFrom} 00:00:00`],
      ["scheduled_time", "<=", `${dateTo} 23:59:59`],
      ["status", "not in", ["Closed", "Cancelled"]],
    ],
    fields: ["name", "scheduled_time", "assigned_agent", "custom_appointment_type", "status"],
    limit: 500,
    order_by: "scheduled_time asc",
  });
}

/** Confirmed / shop blocks on L&S Appointments only. */
async function loadBookedEvents(dateFrom: string, dateTo: string) {
  return erpList<any>("Event", {
    filters: [
      ["google_calendar", "=", GOOGLE_APPOINTMENTS_CALENDAR],
      ["starts_on", "<=", `${dateTo} 23:59:59`],
      ["ends_on", ">=", `${dateFrom} 00:00:00`],
      ["status", "!=", "Cancelled"],
    ],
    fields: ["name", "subject", "starts_on", "ends_on", "all_day", "status", "google_calendar"],
    limit: 500,
  });
}

/** Positive availability windows from Carl/Christopher/Sal Availability calendars. */
async function loadAvailabilityEvents(dateFrom: string, dateTo: string, calendars: string[]) {
  const unique = [...new Set(calendars.filter(Boolean))];
  if (!unique.length) return [] as any[];

  // ERPNext REST "in" filter
  return erpList<any>("Event", {
    filters: [
      ["google_calendar", "in", unique],
      ["starts_on", "<=", `${dateTo} 23:59:59`],
      ["ends_on", ">=", `${dateFrom} 00:00:00`],
      ["status", "!=", "Cancelled"],
    ],
    fields: ["name", "subject", "starts_on", "ends_on", "all_day", "status", "google_calendar"],
    limit: 500,
    order_by: "starts_on asc",
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
  if (ev.all_day) {
    const d = String(ev.starts_on).slice(0, 10);
    const endD = ev.ends_on ? String(ev.ends_on).slice(0, 10) : d;
    return { start: `${d} 00:00:00`, end: `${endD} 23:59:59` };
  }
  const start = normDt(ev.starts_on);
  const end = ev.ends_on ? normDt(ev.ends_on) : addMinutes(start, 60);
  return { start, end };
}

/**
 * Parse L&S Appointments Event subject tags:
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

/** Outer bounds for a store-open day: store hours ∩ absolute clamp. */
function outerBoundsForDate(date: string, holidays: Set<string>): TimeWindow[] {
  const day = storeDayAvailability(date, holidays);
  if (!day.open) return [];
  const storeRanges: TimeRange[] = day.ranges.map((r) => ({
    startMin: r.startMin,
    endMin: r.endMin,
  }));
  const wd = weekdayNy(date);
  const clamp: TimeRange =
    wd === 6
      ? { startMin: BOOKABLE_CLAMP_SATURDAY.fromMin, endMin: BOOKABLE_CLAMP_SATURDAY.toMin }
      : { startMin: BOOKABLE_CLAMP_WEEKDAY.fromMin, endMin: BOOKABLE_CLAMP_WEEKDAY.toMin };
  return intersectRanges(storeRanges, [clamp]).map((r) => ({
    fromMin: r.startMin,
    toMin: r.endMin,
  }));
}

function minutesOnDate(dt: string, date: string): number | null {
  const n = normDt(dt);
  if (!n.startsWith(date)) {
    // Event may span midnight — clamp to day edges
    const d = n.slice(0, 10);
    if (d < date) return 0;
    if (d > date) return 24 * 60;
    return null;
  }
  return timeToMin(n.slice(11, 16));
}

/**
 * Convert availability events for one tailor into minutes-windows on a given date,
 * then intersect with outer store/clamp bounds.
 */
function availabilityWindowsForDay(
  events: any[],
  date: string,
  outer: TimeWindow[],
): TimeWindow[] {
  if (!outer.length) return [];
  const raw: TimeRange[] = [];
  for (const ev of events) {
    const iv = eventInterval(ev);
    // Skip if no overlap with this calendar day
    if (iv.end <= `${date} 00:00:00` || iv.start >= `${date} 23:59:59`) continue;
    let startMin = minutesOnDate(iv.start, date);
    let endMin = minutesOnDate(iv.end, date);
    if (startMin == null || endMin == null) continue;
    if (normDt(iv.start).slice(0, 10) < date) startMin = 0;
    if (normDt(iv.end).slice(0, 10) > date) endMin = 24 * 60;
    if (startMin < endMin) raw.push({ startMin, endMin });
  }
  if (!raw.length) return [];
  const outerRanges: TimeRange[] = outer.map((w) => ({
    startMin: w.fromMin,
    endMin: w.toMin,
  }));
  return intersectRanges(raw, outerRanges).map((r) => ({
    fromMin: r.startMin,
    toMin: r.endMin,
  }));
}

function firstTagAlias(tailor: PublicTailor): string {
  return tailor.tagAliases[0]
    ? tailor.tagAliases[0].charAt(0).toUpperCase() + tailor.tagAliases[0].slice(1)
    : tailor.shortName;
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

  const pool = eligibleTailors(type.erpName, query.agentUser);
  const poolUsers = new Set(pool.map((t) => t.agentUser));
  const tagMap = buildTagMap();

  const [holidayResult, appointments, bookedEvents, agentCalMap] = await Promise.all([
    loadHolidays(dateFrom, dateTo),
    loadOpenAppointments(dateFrom, dateTo),
    loadBookedEvents(dateFrom, dateTo),
    loadAgentCalendarMap(),
  ]);
  const holidays = holidayResult.set;

  const calendarsNeeded = [
    ...new Set(
      pool
        .map((t) => agentCalMap.get(t.agentUser) || t.availabilityGoogleCalendar)
        .filter(Boolean),
    ),
  ];
  // Safety: only query known availability calendars
  const safeCals = calendarsNeeded.filter((c) =>
    (AVAILABILITY_CALENDARS as readonly string[]).includes(c) || c.endsWith(" Availability"),
  );

  const availabilityEvents = await loadAvailabilityEvents(dateFrom, dateTo, safeCals);

  // Index availability events by calendar name
  const availByCal = new Map<string, any[]>();
  for (const ev of availabilityEvents) {
    const cal = String(ev.google_calendar || "");
    const list = availByCal.get(cal) ?? [];
    list.push(ev);
    availByCal.set(cal, list);
  }

  // Busy per agent: open Appointments (field-based) + tagged L&S Appointments events
  const busy: Record<string, Interval[]> = {};
  for (const t of pool) busy[t.agentUser] = [];

  for (const appt of appointments) {
    const au = appt.assigned_agent as string | null;
    if (!au || !poolUsers.has(au)) continue;
    const list = busy[au] ?? (busy[au] = []);
    list.push(appointmentInterval(appt, type.durationMinutes));
  }

  for (const ev of bookedEvents) {
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

  // Room intervals from open appointments whose type needs a room
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

  if (!availabilityEvents.length) {
    warnings.push(
      "No availability events found on tailor Availability calendars for this range. " +
        "Slots require posted availability (presence = bookable). Seed or post windows on " +
        "Carl/Christopher/Sal Availability calendars.",
    );
  }

  const minStart = addMinutes(nowInNyc(), MIN_NOTICE_MINUTES);
  const slots: AvailableSlot[] = [];

  for (const date of eachDate(dateFrom, dateTo)) {
    const outer = outerBoundsForDate(date, holidays);
    if (!outer.length) continue;

    // Per-tailor positive windows for this day
    const windowsByUser = new Map<string, TimeWindow[]>();
    for (const t of pool) {
      const cal = agentCalMap.get(t.agentUser) || t.availabilityGoogleCalendar;
      const evs = cal ? availByCal.get(cal) || [] : [];
      windowsByUser.set(t.agentUser, availabilityWindowsForDay(evs, date, outer));
    }

    const candidateStarts = new Set<number>();
    for (const t of pool) {
      for (const w of windowsByUser.get(t.agentUser) || []) {
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
        const wins = windowsByUser.get(t.agentUser) || [];
        const inAvail = wins.some(
          (w) => startMin >= w.fromMin && startMin + type.durationMinutes <= w.toMin,
        );
        if (!inAvail) continue;
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
      booked_events_loaded: bookedEvents.length,
      availability_events_loaded: availabilityEvents.length,
      availability_source: "erp_events",
      warnings,
    },
  };
}

/**
 * Create a public booking:
 *  1. Re-check availability for the requested slot (refuse if not free)
 *  2. Write Event on "L&S Appointments" (sync_with_google_calendar=1)
 *  3. Write Appointment with assigned_agent
 * Never writes to Availability calendars.
 */
export async function createPublicBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const type = resolveType(input.appointmentType);
  const scheduled = normDt(input.scheduledTime.replace("T", " "));
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(scheduled)) {
    throw new Error("scheduled_time must be YYYY-MM-DD HH:MM[:SS]");
  }
  const date = scheduled.slice(0, 10);
  const end = addMinutes(scheduled, type.durationMinutes);

  if (!input.customerName?.trim()) throw new Error("customer_name is required");
  if (!input.customerEmail?.trim()) throw new Error("customer_email is required");

  // Resolve named tailor vs any
  let agentFilter = input.agentUser ?? null;
  if (agentFilter && !agentFilter.includes("@")) {
    const byId = getTailorById(agentFilter);
    if (byId) agentFilter = byId.agentUser;
  }

  const availability = await getAvailableSlots({
    appointmentType: type.id,
    dateFrom: date,
    dateTo: date,
    agentUser: agentFilter,
  });

  const match = availability.slots.find((s) => s.datetime.slice(0, 16) === scheduled.slice(0, 16));
  if (!match || !match.free_agents.length) {
    const err = new Error(
      `No availability for ${type.label} at ${scheduled}` +
        (agentFilter ? ` with ${agentFilter}` : "") +
        ". Slot is not bookable (no posted availability, already booked, store closed, or rooms full).",
    );
    (err as any).code = "NO_AVAILABILITY";
    throw err;
  }

  // Pick assigned agent: prefer requested if free, else first free
  let assigned = match.free_agents[0]!;
  if (agentFilter && agentFilter !== "any") {
    const pref = match.free_agents.find((a) => a.agent_user === agentFilter);
    if (!pref) {
      const err = new Error(`No availability for requested tailor at ${scheduled}`);
      (err as any).code = "NO_AVAILABILITY";
      throw err;
    }
    assigned = pref;
  }

  const tailor =
    getTailorByUser(assigned.agent_user) ||
    PUBLIC_TAILORS.find((t) => t.agentUser === assigned.agent_user);
  const prefix = tailor ? firstTagAlias(tailor) : assigned.short_name;
  const eventSubject = `${prefix}: ${input.customerName.trim()} - ${type.erpName}`;

  let eventName: string | null = null;
  try {
    const ev = await erpCreate<any>("Event", {
      subject: eventSubject,
      event_type: "Public",
      starts_on: scheduled,
      ends_on: end,
      all_day: 0,
      sync_with_google_calendar: 1,
      google_calendar: GOOGLE_APPOINTMENTS_CALENDAR,
      status: "Open",
      description:
        `Public booking via book.lstailors.com\n` +
        `Customer: ${input.customerName.trim()}\n` +
        `Email: ${input.customerEmail.trim()}\n` +
        (input.customerPhone ? `Phone: ${input.customerPhone}\n` : "") +
        (input.notes ? `Notes: ${input.notes}\n` : ""),
    });
    eventName = (ev?.name as string) ?? null;
  } catch (e: any) {
    throw new Error(`Failed to create calendar Event on L&S Appointments: ${e?.message || e}`);
  }

  const apptDoc: Record<string, unknown> = {
    scheduled_time: scheduled,
    status: "Open",
    assigned_agent: assigned.agent_user,
    customer_name: input.customerName.trim(),
    customer_email: input.customerEmail.trim(),
    customer_phone_number: input.customerPhone?.trim() || "",
    customer_details: input.notes?.trim() || "",
    custom_appointment_type: type.erpName,
  };
  if (eventName) apptDoc.calendar_event = eventName;

  let appointmentName: string;
  try {
    const created = await erpCreate<any>("Appointment", apptDoc);
    appointmentName = created?.name as string;
    if (!appointmentName) throw new Error("ERP returned empty Appointment name");
  } catch (e: any) {
    throw new Error(`Failed to create Appointment: ${e?.message || e}`);
  }

  return {
    appointment_name: appointmentName,
    event_name: eventName,
    assigned_agent: assigned.agent_user,
    scheduled_time: scheduled,
    end_time: end,
    appointment_type: type.erpName,
    google_calendar: GOOGLE_APPOINTMENTS_CALENDAR,
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
      availability_google_calendar: t.availabilityGoogleCalendar,
      mode,
      part_time: t.id === "sal",
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
