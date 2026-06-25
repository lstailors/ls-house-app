import { Hono } from "hono";
import { getAuthedUser, resolveLocationCode } from "../lib/scope";
import { CreateCustomOrderInput, TakeDepositInput, UpdateOrderStatusInput } from "../types";
import { getCustomersByIds } from "../lib/erpnext/customers";
import { erpRunMethod } from "../lib/erp";
import {
  listCustomOrders,
  getCustomOrder,
  createCustomOrder,
  updateCustomOrderStatus,
} from "../lib/erpnext/custom-orders";

export const customOrdersRouter = new Hono();

customOrdersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });

  const locCode = resolveLocationCode(user, c.req.query("locationId"));
  const filterCustomerId = c.req.query("customerId");
  const limitParam = parseInt(c.req.query("limit") ?? "200");
  const limit = Math.min(isNaN(limitParam) ? 200 : limitParam, 500);

  try {
    const data = await listCustomOrders({
      locationCode: locCode,
      customerId: filterCustomerId,
      salesRepId: user.role === "salesperson" ? user.email : undefined,
      limit,
    });
    return c.json({ data });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to list orders" } }, 500);
  }
});

customOrdersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");

  try {
    const data = await getCustomOrder(id);
    if (!data) return c.json({ error: { message: "Not found" } }, 404);

    const locCode = resolveLocationCode(user, null);
    if (user.role !== "super_admin" && locCode && data.locationId !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }

    return c.json({ data });
  } catch {
    return c.json({ error: { message: "Not found" } }, 404);
  }
});

customOrdersRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);

  const parsed = CreateCustomOrderInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { message: "Invalid input" } }, 400);
  const body = parsed.data;

  const locCode =
    user.role === "super_admin"
      ? (body.locationId || user.locationCode)
      : user.locationCode;
  if (!locCode) return c.json({ error: { message: "Location required" } }, 400);

  const orderBody = user.role === "super_admin" ? body : { ...body, locationId: locCode };

  try {
    const data = await createCustomOrder(orderBody, { email: user.email, locationCode: locCode });
    return c.json({ data }, 201);
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to create order" } }, 500);
  }
});

customOrdersRouter.post("/deposit", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const parsed = TakeDepositInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { message: "Invalid input" } }, 400);
  const { customOrderId, amount } = parsed.data;

  try {
    const existing = await getCustomOrder(customOrderId);
    if (!existing) return c.json({ error: { message: "Order not found" } }, 404);

    const locCode = resolveLocationCode(user, null);
    if (user.role !== "super_admin" && locCode && existing.locationId !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }

    const paymentResult = await erpRunMethod("ls_alterations.ls_square.pos.create_payment_link", {
      invoice: (existing as any).erpName ?? (existing as any).erp_sales_order ?? customOrderId,
      amount,
    }) as any;
    const paymentData = paymentResult?.data ?? paymentResult ?? {};

    return c.json({
      data: {
        order: existing,
        receipt: {
          provider: "Square Payment Link",
          status: "pending",
          amount,
          transactionId: paymentData.payment_link_id ?? paymentData.id ?? "",
          last4: "",
          timestamp: new Date().toISOString(),
          url: paymentData.url ?? paymentData.payment_url ?? "",
        },
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Update failed" } }, 500);
  }
});

customOrdersRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const parsed = UpdateOrderStatusInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { message: "Invalid input" } }, 400);
  const input = parsed.data;

  try {
    const existing = await getCustomOrder(id);
    if (!existing) return c.json({ error: { message: "Not found" } }, 404);

    const locCode = resolveLocationCode(user, null);
    if (user.role !== "super_admin" && locCode && existing.locationId !== locCode) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }

    await updateCustomOrderStatus(id, input.status);
    const data = await getCustomOrder(id);
    return c.json({ data });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Update failed" } }, 500);
  }
});
