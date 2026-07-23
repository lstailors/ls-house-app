/**
 * Public booking API — availability keystone for book.lstailors.com rebuild.
 *
 * Canonical mount: /api/public/booking/*
 * Alias mount:     /api/booking/*  (same router)
 *
 * GET /types
 * GET /tailors?appointment_type=
 * GET /slots?appointment_type=&date_from=&date_to=&tailor=|agent_user=
 */

import { Hono } from "hono";
import {
  getAvailableSlots,
  listPublicTailors,
  listPublicTypes,
} from "../lib/booking/availability";
import { ALTERATIONS_GATE, PUBLIC_TAILORS, getTailorByUser } from "../lib/booking/config";

export const bookingRouter = new Hono();
/** Alias export used by app.ts as publicBookingRouter */
export const publicBookingRouter = bookingRouter;

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

bookingRouter.get("/health", (c) =>
  c.json({
    data: {
      ok: true,
      service: "booking-availability",
      types: listPublicTypes().map((x) => x.id),
    },
  }),
);
