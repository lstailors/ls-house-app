import { Hono } from "hono";
import { sendSms } from "../lib/twilio";
import { erpGet } from "../lib/erp";

export const outreachRouter = new Hono();

// POST /api/outreach/order-ready
// Called by n8n when a Sales Order status changes to ready
// HER-61 S2: fail closed when OUTREACH_SECRET unset (undefined===undefined was open).
outreachRouter.post("/order-ready", async (c) => {
  const expected = (process.env.OUTREACH_SECRET ?? "").trim();
  if (!expected) {
    return c.json(
      { error: { message: "OUTREACH_SECRET not configured", code: "SECRET_UNSET" } },
      503,
    );
  }
  const secret = (c.req.header("x-outreach-secret") ?? "").trim();
  if (!secret || secret !== expected) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const orderName: string = body.order_name ?? body.name ?? "";
  if (!orderName) return c.json({ error: { message: "order_name required" } }, 400);

  // Fetch order from ERPNext
  const order = await erpGet<any>("Sales Order", orderName).catch(() => null);
  if (!order) return c.json({ error: { message: "Order not found" } }, 404);

  const customerName: string = order.customer_name ?? "Valued Client";
  const phone: string = order.contact_mobile ?? order.contact_phone ?? "";

  if (!phone) return c.json({ data: { sent: false, reason: "no phone on file" } });

  // Sofia-style message
  const firstName = customerName.split(" ")[0];
  const message = `Hi ${firstName}, great news — your order from L&S Custom Tailors is ready. Please contact us to schedule your pickup or delivery. We look forward to seeing you!`;

  await sendSms(phone, message, undefined, "outreach.orderReady");

  return c.json({ data: { sent: true, to: phone, order: orderName } });
});
