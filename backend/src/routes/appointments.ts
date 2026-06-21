// Staff Appointments Dashboard — API routes
// All endpoints require an authenticated staff user (not guest).

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet, erpCreate, erpUpdate, erpDelete } from "../lib/erp";
import {
  BlockTimeRequest,
  StaffBookingRequest,
  SetAppointmentStatusRequest,
} from "../types";

export const appointmentsRouter = new Hono();

const LS_CALENDAR = "L&S Appointments";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toErpDatetime(s: string): string {
  return s.replace("T", " ").replace(/Z$/, "").slice(0, 19);
}

function firstTagAlias(tagAliases: string, fallback: string): string {
  const parts = (tagAliases ?? "").split(",");
  const first = (parts[0] ?? "").replace(":", "").trim();
  return first || fallback;
}

function buildAliasMap(agents: any[]): Record<string, any> {
  const map: Record<string, any> = {};
  for (const a of agents) {
    const aliases = (a.tag_aliases ?? "")
      .split(",")
      .map((s: string) => s.replace(":", "").trim().toLowerCase())
      .filter(Boolean);
    for (const alias of aliases) map[alias] = a;
    map[(a.display_name as string).toLowerCase()] = a;
  }
  return map;
}

function parseBlockSubject(subject: string, aliasMap: Record<string, any>) {
  const colonIdx = subject.indexOf(": ");
  if (colonIdx < 0) return null;
  const prefix = subject.slice(0, colonIdx);
  const reason = subject.slice(colonIdx + 2);
  const isWholeshop = prefix.toUpperCase() === "ALL";
  const agentRecord = isWholeshop ? null : (aliasMap[prefix.toLowerCase()] ?? null);
  if (!isWholeshop && !agentRecord) return null;
  return { prefix, reason, isWholeshop, agentRecord };
}

// ── GET /api/appointments ─────────────────────────────────────────────────────
appointmentsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const dateFrom  = c.req.query("date_from") ?? new Date().toISOString().split("T")[0];
  const dateTo    = c.req.query("date_to")   ?? dateFrom;
  const agentUser = c.req.query("agent_user");

  const apptFilters: unknown[] = [
    ["scheduled_time", ">=", `${dateFrom} 00:00:00`],
    ["scheduled_time", "<=", `${dateTo} 23:59:59`],
  ];
  if (agentUser) apptFilters.push(["assigned_agent", "=", agentUser]);

  const [appts, agents, types] = await Promise.all([
    erpList<any>("Appointment", {
      filters: apptFilters,
      fields: [
        "name", "scheduled_time", "status", "assigned_agent",
        "customer_name", "customer_email", "customer_phone_number",
        "customer_details", "custom_appointment_type", "calendar_event",
      ],
      limit: 300,
      order_by: "scheduled_time asc",
    }),
    erpList<any>("LSH Booking Agent", {
      filters: [["active", "=", 1]],
      fields: ["name", "agent_user", "display_name", "tag_aliases"],
      limit: 20,
    }),
    erpList<any>("LSH Appointment Type", {
      fields: ["name", "needs_room"],
      limit: 50,
    }),
  ]);

  const agentByEmail: Record<string, any> = {};
  for (const a of agents) agentByEmail[a.agent_user] = a;

  const typeNeedsRoom: Record<string, boolean> = {};
  for (const t of types) typeNeedsRoom[t.name] = !!t.needs_room;

  const aliasMap = buildAliasMap(agents);

  // Collect linked calendar event IDs
  const linkedEventIds = new Set(
    appts.filter((a: any) => a.calendar_event).map((a: any) => a.calendar_event as string)
  );

  // Single query for all L&S Appointments calendar events in range
  const allCalEvents = await erpList<any>("Event", {
    filters: [
      ["google_calendar", "=", LS_CALENDAR],
      ["starts_on", ">=", `${dateFrom} 00:00:00`],
      ["starts_on", "<=", `${dateTo} 23:59:59`],
      ["status", "!=", "Cancelled"],
    ],
    fields: ["name", "subject", "starts_on", "ends_on", "all_day"],
    limit: 300,
    order_by: "starts_on asc",
  });

  // Separate event end-times from block events
  const eventEndMap: Record<string, string | null> = {};
  const rawBlockEvents: any[] = [];
  for (const ev of allCalEvents) {
    eventEndMap[ev.name] = ev.ends_on ?? null;
    if (!linkedEventIds.has(ev.name)) rawBlockEvents.push(ev);
  }

  const appointments = appts.map((a: any) => ({
    name: a.name,
    scheduledTime: a.scheduled_time,
    endTime: a.calendar_event ? (eventEndMap[a.calendar_event] ?? null) : null,
    status: (a.status ?? "Unverified") as "Open" | "Unverified" | "Closed",
    assignedAgent: a.assigned_agent ?? null,
    agentDisplayName: a.assigned_agent ? (agentByEmail[a.assigned_agent]?.display_name ?? null) : null,
    customerName: a.customer_name ?? "",
    customerEmail: a.customer_email ?? "",
    customerPhone: a.customer_phone_number || null,
    customerDetails: a.customer_details || null,
    appointmentType: a.custom_appointment_type ?? null,
    needsRoom: a.custom_appointment_type ? (typeNeedsRoom[a.custom_appointment_type] ?? false) : false,
    calendarEventId: a.calendar_event ?? null,
    isBlock: false as const,
  }));

  const blocks = rawBlockEvents
    .map((ev: any) => {
      const parsed = parseBlockSubject(ev.subject ?? "", aliasMap);
      if (!parsed) return null;
      return {
        name: ev.name,
        subject: ev.subject ?? "",
        startsOn: ev.starts_on,
        endsOn: ev.ends_on ?? null,
        allDay: !!ev.all_day,
        agentUser: parsed.agentRecord?.agent_user ?? null,
        agentDisplayName: parsed.isWholeshop ? "Whole Shop" : (parsed.agentRecord?.display_name ?? null),
        reason: parsed.reason || null,
        isWholeshop: parsed.isWholeshop,
        isBlock: true as const,
      };
    })
    .filter(Boolean) as any[];

  return c.json({ data: { appointments, blocks } });
});

// ── GET /api/appointments/agents ─────────────────────────────────────────────
appointmentsRouter.get("/agents", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const agents = await erpList<any>("LSH Booking Agent", {
    filters: [["active", "=", 1]],
    fields: ["name", "agent_user", "display_name", "tag_aliases"],
    limit: 20,
  });

  return c.json({
    data: agents.map((a: any) => ({
      name: a.name,
      agentUser: a.agent_user,
      displayName: a.display_name,
      tagAliases: a.tag_aliases ?? "",
      active: true,
    })),
  });
});

// ── GET /api/appointments/types ───────────────────────────────────────────────
appointmentsRouter.get("/types", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const types = await erpList<any>("LSH Appointment Type", {
    fields: ["name", "appointment_type", "category", "needs_room", "publicly_bookable"],
    limit: 50,
  });

  return c.json({
    data: types.map((t: any) => ({
      name: t.name,
      appointmentType: t.appointment_type,
      category: t.category,
      needsRoom: !!t.needs_room,
      publiclyBookable: !!t.publicly_bookable,
    })),
  });
});

// ── POST /api/appointments/block ─────────────────────────────────────────────
// Creates a tagged busy event on L&S Appointments calendar.
// The authenticated user's agent record is used automatically — no calendar picking.
appointmentsRouter.post(
  "/block",
  zValidator("json", BlockTimeRequest),
  async (c) => {
    const user = await getAuthedUser(c);
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

    const body = (c.req as any).valid("json") as typeof BlockTimeRequest._type;

    if (body.whole_shop && user.role !== "super_admin" && user.role !== "store_manager") {
      return c.json({ error: { message: "Only admins can create whole-shop blocks" } }, 403);
    }

    let subjectPrefix: string;

    if (body.whole_shop) {
      subjectPrefix = "ALL";
    } else {
      const agents = await erpList<any>("LSH Booking Agent", {
        filters: [["agent_user", "=", user.email], ["active", "=", 1]],
        fields: ["name", "display_name", "tag_aliases"],
        limit: 1,
      });
      if (!agents.length) {
        return c.json({ error: { message: "No booking agent record found for your account" } }, 400);
      }
      const agent = agents[0];
      subjectPrefix = firstTagAlias(agent.tag_aliases, agent.display_name);
    }

    const reason = body.reason?.trim() || "Blocked";
    const subject = `${subjectPrefix}: ${reason}`;
    const startErp = toErpDatetime(body.start);

    let endsOn: string | undefined;
    if (!body.all_day) {
      if (body.end) {
        endsOn = toErpDatetime(body.end);
      } else {
        const d = new Date(body.start.replace(" ", "T"));
        d.setHours(d.getHours() + 1);
        endsOn = d.toISOString().replace("T", " ").slice(0, 19);
      }
    }

    const eventDoc: Record<string, unknown> = {
      subject,
      event_type: "Public",
      starts_on: startErp,
      all_day: body.all_day ? 1 : 0,
      sync_with_google_calendar: 1,
      google_calendar: LS_CALENDAR,
      status: "Open",
    };
    if (endsOn) eventDoc.ends_on = endsOn;

    try {
      const created = await erpCreate<any>("Event", eventDoc);
      return c.json({ data: { name: created?.name, subject } });
    } catch (err: any) {
      return c.json({ error: { message: err.message ?? "Failed to create block" } }, 500);
    }
  },
);

// ── POST /api/appointments/book ───────────────────────────────────────────────
appointmentsRouter.post(
  "/book",
  zValidator("json", StaffBookingRequest),
  async (c) => {
    const user = await getAuthedUser(c);
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

    const body = (c.req as any).valid("json") as typeof StaffBookingRequest._type;

    const agents = await erpList<any>("LSH Booking Agent", {
      filters: [["agent_user", "=", body.agent_user], ["active", "=", 1]],
      fields: ["name", "display_name", "tag_aliases"],
      limit: 1,
    });
    if (!agents.length) {
      return c.json({ error: { message: "Agent not found" } }, 400);
    }
    const agent = agents[0];
    const agentPrefix = firstTagAlias(agent.tag_aliases, agent.display_name);

    const scheduledErp = toErpDatetime(body.scheduled_time);
    const endErp = body.end_time
      ? toErpDatetime(body.end_time)
      : (() => {
          const d = new Date(body.scheduled_time.replace(" ", "T"));
          d.setMinutes(d.getMinutes() + 30);
          return d.toISOString().replace("T", " ").slice(0, 19);
        })();

    const eventSubject = `${agentPrefix}: ${body.customer_name} - ${body.appointment_type}`;

    let calendarEventName: string | undefined;
    try {
      const ev = await erpCreate<any>("Event", {
        subject: eventSubject,
        event_type: "Public",
        starts_on: scheduledErp,
        ends_on: endErp,
        all_day: 0,
        sync_with_google_calendar: 1,
        google_calendar: LS_CALENDAR,
        status: "Open",
        send_reminder: 1,
      });
      calendarEventName = ev?.name;
    } catch {
      // Non-fatal
    }

    const apptDoc: Record<string, unknown> = {
      scheduled_time: scheduledErp,
      status: "Open",
      assigned_agent: body.agent_user,
      customer_name: body.customer_name,
      customer_email: body.customer_email,
      customer_phone_number: body.customer_phone ?? "",
      customer_details: body.notes ?? "",
      custom_appointment_type: body.appointment_type,
    };
    if (calendarEventName) apptDoc.calendar_event = calendarEventName;

    try {
      const created = await erpCreate<any>("Appointment", apptDoc);
      return c.json({ data: { name: created?.name } });
    } catch (err: any) {
      return c.json({ error: { message: err.message ?? "Failed to create appointment" } }, 500);
    }
  },
);

// ── PATCH /api/appointments/:name/status ─────────────────────────────────────
appointmentsRouter.patch(
  "/:name/status",
  zValidator("json", SetAppointmentStatusRequest),
  async (c) => {
    const user = await getAuthedUser(c);
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

    const appointmentName = c.req.param("name");
    const { status } = (c.req as any).valid("json") as typeof SetAppointmentStatusRequest._type;

    const appt = await erpGet<any>("Appointment", appointmentName);
    if (!appt) return c.json({ error: { message: "Appointment not found" } }, 404);

    const isOwn  = appt.assigned_agent === user.email;
    const isAdmin = user.role === "super_admin" || user.role === "store_manager";
    if (!isOwn && !isAdmin) {
      return c.json({ error: { message: "You can only modify your own appointments" } }, 403);
    }

    try {
      if (status === "confirm") {
        await erpUpdate("Appointment", appointmentName, { status: "Open" });
        if (appt.calendar_event) {
          await erpUpdate("Event", appt.calendar_event, { status: "Open" }).catch(() => {});
        }
      } else if (status === "complete") {
        await erpUpdate("Appointment", appointmentName, { status: "Closed" });
        if (appt.calendar_event) {
          await erpUpdate("Event", appt.calendar_event, { status: "Completed" }).catch(() => {});
        }
      } else if (status === "no_show") {
        const details = appt.customer_details ?? "";
        await erpUpdate("Appointment", appointmentName, {
          status: "Closed",
          customer_details: `[No-show] ${details}`.trim(),
        });
        if (appt.calendar_event) {
          await erpUpdate("Event", appt.calendar_event, { status: "Closed" }).catch(() => {});
        }
      } else if (status === "cancel") {
        if (appt.calendar_event) {
          await erpUpdate("Event", appt.calendar_event, { status: "Cancelled" }).catch(() => {});
        }
        await erpDelete("Appointment", appointmentName);
      }

      return c.json({ data: { ok: true } });
    } catch (err: any) {
      return c.json({ error: { message: err.message ?? "Status update failed" } }, 500);
    }
  },
);
