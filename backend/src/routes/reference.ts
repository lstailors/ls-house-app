import { Hono } from "hono";
import { getAuthedUser, canAccessSuperAdminPortal } from "../lib/scope";
import {
  listFabrics,
  serializeFabric,
  createFabric,
  updateFabric,
  listStyles,
  serializeStyle,
  createStyle,
  updateStyle,
  listTailors,
  serializeTailor,
  createTailor,
  updateTailor,
} from "../lib/erpnext/reference";

export const referenceRouter = new Hono();

referenceRouter.get("/fabrics", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const rows = await listFabrics(true);
    return c.json({ data: rows.map(serializeFabric) });
  } catch (e: any) {
    console.error("fabrics GET error:", e.message);
    return c.json({ data: [] });
  }
});

referenceRouter.post("/fabrics", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role) && user.role !== "store_manager") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;

  try {
    const data = await createFabric(body);
    return c.json({ data: serializeFabric(data) });
  } catch (e: any) {
    console.error("fabrics POST error:", e.message);
    return c.json({ error: { message: e.message ?? "Failed to create fabric" } }, 500);
  }
});

referenceRouter.patch("/fabrics/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role) && user.role !== "store_manager") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;

  try {
    const data = await updateFabric(c.req.param("id"), body);
    return c.json({ data: serializeFabric(data) });
  } catch (e: any) {
    console.error("fabrics PATCH error:", e.message);
    return c.json({ error: { message: e.message ?? "Failed to update fabric" } }, 500);
  }
});

referenceRouter.get("/styles", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const rows = await listStyles(true);
    return c.json({ data: rows.map(serializeStyle) });
  } catch (e: any) {
    console.error("styles GET error:", e.message);
    return c.json({ data: [] });
  }
});

referenceRouter.post("/styles", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role) && user.role !== "store_manager") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;

  try {
    const data = await createStyle(body);
    return c.json({ data: serializeStyle(data) });
  } catch (e: any) {
    console.error("styles POST error:", e.message);
    return c.json({ error: { message: e.message ?? "Failed to create style" } }, 500);
  }
});

referenceRouter.patch("/styles/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role) && user.role !== "store_manager") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;

  try {
    const data = await updateStyle(c.req.param("id"), body);
    return c.json({ data: serializeStyle(data) });
  } catch (e: any) {
    console.error("styles PATCH error:", e.message);
    return c.json({ error: { message: e.message ?? "Failed to update style" } }, 500);
  }
});

referenceRouter.get("/tailors", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const locationCode =
      !canAccessSuperAdminPortal(user.role) && !user.canViewAllLocations && user.locationCode
        ? user.locationCode
        : undefined;
    const rows = await listTailors(locationCode);
    return c.json({ data: rows.map(serializeTailor) });
  } catch (e: any) {
    console.error("tailors GET error:", e.message);
    return c.json({ data: [] });
  }
});

referenceRouter.post("/tailors", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as { name: string; locationId: string };

  try {
    const data = await createTailor(body);
    return c.json({ data: serializeTailor(data) });
  } catch (e: any) {
    console.error("tailors POST error:", e.message);
    return c.json({ error: { message: e.message ?? "Failed to create tailor" } }, 500);
  }
});

referenceRouter.patch("/tailors/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json()) as any;

  try {
    const data = await updateTailor(c.req.param("id"), body);
    return c.json({ data: serializeTailor(data) });
  } catch (e: any) {
    console.error("tailors PATCH error:", e.message);
    return c.json({ error: { message: "Failed to update tailor" } }, 500);
  }
});
