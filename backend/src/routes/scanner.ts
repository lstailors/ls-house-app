// Backend proxy for the ERPNext ls_alterations.api.scanner whitelisted methods.
// The in-app scanner calls these through our existing ERPNext client.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getAuthedUser } from "../lib/scope";
import { erpRunMethod } from "../lib/erp";
import { ScannerResolveRequest } from "../types";

export const scannerRouter = new Hono();

// POST /api/scanner/resolve — resolve a scanned QR token.
// Note: resolve_qr never raises to the client; not-found comes back as a
// normal 200 { ok: false, reason, raw } payload.
scannerRouter.post("/resolve", zValidator("json", ScannerResolveRequest), async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { token } = (c.req as any).valid("json") as z.infer<typeof ScannerResolveRequest>;
  try {
    const result = await erpRunMethod("ls_alterations.api.scanner.resolve_qr", { token });
    return c.json({ data: result });
  } catch (err) {
    console.error("scanner.resolve error:", err);
    return c.json({ error: { message: "Scanner service error" } }, 502);
  }
});

// POST /api/scanner/mark-paid
scannerRouter.post(
  "/mark-paid",
  zValidator("json", z.object({ invoice_name: z.string().min(1) })),
  async (c) => {
    const user = await getAuthedUser(c);
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

    const { invoice_name } = (c.req as any).valid("json") as { invoice_name: string };
    try {
      const result = await erpRunMethod("ls_alterations.api.scanner.mark_paid", { invoice_name });
      return c.json({ data: result });
    } catch (err) {
      console.error("scanner.mark-paid error:", err);
      return c.json({ error: { message: "Scanner service error" } }, 502);
    }
  },
);

// POST /api/scanner/mark-delivered
scannerRouter.post(
  "/mark-delivered",
  zValidator("json", z.object({ delivery_name: z.string().min(1) })),
  async (c) => {
    const user = await getAuthedUser(c);
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

    const { delivery_name } = (c.req as any).valid("json") as { delivery_name: string };
    try {
      const result = await erpRunMethod("ls_alterations.api.scanner.mark_delivered", { delivery_name });
      return c.json({ data: result });
    } catch (err) {
      console.error("scanner.mark-delivered error:", err);
      return c.json({ error: { message: "Scanner service error" } }, 502);
    }
  },
);

// POST /api/scanner/advance-status
scannerRouter.post(
  "/advance-status",
  zValidator("json", z.object({ ticket_name: z.string().min(1), to_state: z.string().min(1) })),
  async (c) => {
    const user = await getAuthedUser(c);
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

    const { ticket_name, to_state } = (c.req as any).valid("json") as { ticket_name: string; to_state: string };
    try {
      const result = await erpRunMethod("ls_alterations.api.scanner.advance_alteration_status", {
        ticket_name,
        to_state,
      });
      return c.json({ data: result });
    } catch (err) {
      console.error("scanner.advance-status error:", err);
      return c.json({ error: { message: "Scanner service error" } }, 502);
    }
  },
);

// POST /api/scanner/confirm-transfer
scannerRouter.post(
  "/confirm-transfer",
  zValidator("json", z.object({ transfer_name: z.string().min(1) })),
  async (c) => {
    const user = await getAuthedUser(c);
    if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

    const { transfer_name } = (c.req as any).valid("json") as { transfer_name: string };
    try {
      const result = await erpRunMethod("ls_alterations.api.scanner.confirm_transfer", { transfer_name });
      return c.json({ data: result });
    } catch (err) {
      console.error("scanner.confirm-transfer error:", err);
      return c.json({ error: { message: "Scanner service error" } }, 502);
    }
  },
);
