import { Hono } from "hono";
import { saveCart, listParkedCarts, getParkedCart, deleteParkedCart, commitParkedCart, type CartPayload, type ParkedCart } from "../lib/cart/parked";
import type { CustomerInput } from "../lib/erpnext/customer";
import { getAuthedUser } from "../lib/scope";

export const cartsRouter = new Hono();

// POST /api/carts — save or update a parked cart
cartsRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const body = await c.req.json() as {
      id?: string;
      createdBy: string;
      location: string;
      customer: Partial<CustomerInput>;
      customerRef?: string | null;
      cart: CartPayload;
    };

    if (!body.createdBy || !body.location) {
      return c.json({ error: { message: "createdBy and location are required" } }, 400);
    }

    const result = await saveCart(body);
    return c.json({ data: result }, 201);
  } catch (e: any) {
    console.error("[carts] save failed:", e?.message);
    return c.json({ error: { message: e?.message ?? "Failed to save cart" } }, 500);
  }
});

// GET /api/carts — list parked carts
cartsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const location = c.req.query("location");
    const carts = await listParkedCarts(location);
    return c.json({ data: carts });
  } catch (e: any) {
    console.error("[carts] list failed:", e?.message);
    return c.json({ error: { message: e?.message ?? "Failed to list carts" } }, 500);
  }
});

// GET /api/carts/:id — get a specific parked cart
cartsRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const id = c.req.param("id");
    const cart = await getParkedCart(id);
    return c.json({ data: cart });
  } catch (e: any) {
    console.error("[carts] get failed:", e?.message);
    return c.json({ error: { message: e?.message ?? "Cart not found" } }, 404);
  }
});

// DELETE /api/carts/:id — abandon a parked cart
cartsRouter.delete("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const id = c.req.param("id");
    await deleteParkedCart(id);
    return c.json({ data: { ok: true } });
  } catch (e: any) {
    console.error("[carts] delete failed:", e?.message);
    return c.json({ error: { message: e?.message ?? "Failed to delete cart" } }, 500);
  }
});

// POST /api/carts/:id/commit — commit a parked cart to ERPNext
cartsRouter.post("/:id/commit", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const id = c.req.param("id");
    const result = await commitParkedCart(id);
    return c.json({ data: result });
  } catch (e: any) {
    console.error("[carts] commit failed:", e?.message);
    return c.json({ error: { message: e?.message ?? "Failed to commit cart" } }, 500);
  }
});
