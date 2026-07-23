/**
 * Public booking API — availability keystone for book.lstailors.com rebuild.
 *
 * Canonical mount: /api/public/booking/*
 * Alias mount:     /api/booking/*  (same router)
 *
 * GET  /types
 * GET  /tailors?appointment_type=
 * GET  /slots?appointment_type=&date_from=&date_to=&tailor=|agent_user=
 * POST /book  — create booking (Event on L&S Appointments + Appointment)
 * GET  /health
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  createPublicBooking,
  getAvailableSlots,
  listPublicTailors,
  listPublicTypes,
} from "../lib/booking/availability";
import { ALTERATIONS_GATE, PUBLIC_TAILORS, getTailorByUser } from "../lib/booking/config";

export const bookingRouter = new Hono();
/** Alias export used by app.ts as publicBookingRouter */
export const publicBookingRouter = bookingRouter;

const CreateBookingBody = z.object({
  appointment_type: z.string().min(1),
  scheduled_time: z.string().min(1),
  customer_name: z.string().min(1),
  customer_email: z.string().email(),
  customer_phone: z.string().optional(),
  notes: z.string().optional(),
  tailor: z.string().optional(),
  agent_user: z.string().optional(),
});

bookingRouter.get("/types", (c) => {
  return c.json({
    data: {
      types: listPublicTypes(),
      alterations_gate: ALTERATIONS_GATE,
    },
  });
});

bookingRouter.get("/tailors", (c) => {
  const appointmentType = c.req.query("appointment_type") ?? c.req.query("type") ?? undefined;
  try {
    return c.json({ data: listPublicTailors(appointmentType) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list tailors";
    return c.json({ error: { message } }, 400);
  }
});

bookingRouter.get("/slots", async (c) => {
  const appointmentType = c.req.query("appointment_type") ?? c.req.query("type") ?? "";
  const dateFrom = c.req.query("date_from") ?? c.req.query("from") ?? "";
  const dateTo = c.req.query("date_to") ?? c.req.query("to") ?? dateFrom;
  const tailorRaw = c.req.query("tailor") ?? c.req.query("agent_user") ?? null;

  if (!appointmentType) {
    return c.json({ error: { message: "appointment_type is required" } }, 400);
  }
  if (!dateFrom || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    return c.json({ error: { message: "date_from is required (YYYY-MM-DD)" } }, 400);
  }
  if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return c.json({ error: { message: "date_to must be YYYY-MM-DD" } }, 400);
  }

  const maxSpanDays = 21;
  const fromMs = Date.parse(`${dateFrom}T00:00:00Z`);
  const toMs = Date.parse(`${dateTo || dateFrom}T00:00:00Z`);
  if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
    const span = Math.round((toMs - fromMs) / 86400000);
    if (span > maxSpanDays) {
      return c.json({ error: { message: `date range max ${maxSpanDays} days per request` } }, 400);
    }
  }

  let agentUser: string | null = null;
  if (tailorRaw && !["any", "none", "no_preference"].includes(tailorRaw)) {
    const byId = PUBLIC_TAILORS.find((t) => t.id === tailorRaw);
    if (byId) agentUser = byId.agentUser;
    else if (getTailorByUser(tailorRaw) || tailorRaw.includes("@")) agentUser = tailorRaw;
    else return c.json({ error: { message: `Unknown tailor: ${tailorRaw}` } }, 400);
  }

  try {
    const result = await getAvailableSlots({
      appointmentType,
      dateFrom,
      dateTo: dateTo || dateFrom,
      agentUser,
    });
    return c.json({
      data: result,
      // thin-client alias (matches legacy book.lstailors.com shape)
      slots: result.slots,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "availability failed";
    const status = /required|Unknown|must be|not found|not available/i.test(message) ? 400 : 500;
    return c.json({ error: { message } }, status as 400);
  }
});

/**
 * POST /book — public create.
 * Body: appointment_type, scheduled_time, customer_name, customer_email,
 *       customer_phone?, notes?, tailor?|agent_user?
 * Writes Event → L&S Appointments (sync_with_google_calendar=1) + Appointment.
 * Rejects with 409 when slot has no posted availability / already taken.
 */
bookingRouter.post("/book", async (c) => {
  let body: z.infer<typeof CreateBookingBody>;
  try {
    const raw = await c.req.json();
    body = CreateBookingBody.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid body";
    return c.json({ error: { message, code: "INVALID_BODY" } }, 400);
  }

  const tailorRaw = body.tailor ?? body.agent_user ?? null;
  let agentUser: string | null = null;
  if (tailorRaw && !["any", "none", "no_preference"].includes(tailorRaw)) {
    const byId = PUBLIC_TAILORS.find((t) => t.id === tailorRaw);
    if (byId) agentUser = byId.agentUser;
    else if (getTailorByUser(tailorRaw) || tailorRaw.includes("@")) agentUser = tailorRaw;
    else return c.json({ error: { message: `Unknown tailor: ${tailorRaw}`, code: "UNKNOWN_TAILOR" } }, 400);
  }

  try {
    const result = await createPublicBooking({
      appointmentType: body.appointment_type,
      scheduledTime: body.scheduled_time,
      agentUser,
      customerName: body.customer_name,
      customerEmail: body.customer_email,
      customerPhone: body.customer_phone,
      notes: body.notes,
    });
    return c.json({ data: result }, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "booking failed";
    const code = (err as any)?.code as string | undefined;
    if (code === "NO_AVAILABILITY" || /No availability/i.test(message)) {
      return c.json({ error: { message, code: "NO_AVAILABILITY" } }, 409);
    }
    const status = /required|Unknown|must be|not found|not available|Invalid/i.test(message)
      ? 400
      : 500;
    return c.json({ error: { message, code: code ?? "BOOKING_FAILED" } }, status as 400);
  }
});

bookingRouter.get("/health", (c) =>
  c.json({
    data: {
      ok: true,
      service: "booking-availability",
      engine: "availability-calendar-events",
      types: listPublicTypes().map((x) => x.id),
      write_calendar: "L&S Appointments",
    },
  }),
);
