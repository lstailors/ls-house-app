import { Hono } from "hono";
import {
  erpCount,
  erpCreate,
  erpDelete,
  erpDoctypeFields,
  erpGet,
  erpList,
  erpRunMethod,
  erpUpdate,
  ErpRestError,
  type ErpListOptions,
} from "../lib/erp";
import { getAuthedUser } from "../lib/scope";

export const erpRestRouter = new Hono();

erpRestRouter.use("*", async (c, next) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  await next();
});

function parseJsonParam<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function routeError(c: any, err: unknown) {
  const status = err instanceof ErpRestError ? err.status : 500;
  const message = err instanceof Error ? err.message : "ERPNext request failed";
  return c.json({ error: { message } }, status);
}

function listOptions(c: any): ErpListOptions {
  return {
    filters: parseJsonParam(c.req.query("filters"), undefined),
    fields: parseJsonParam(c.req.query("fields"), undefined),
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    limit_page_length: c.req.query("limit_page_length")
      ? Number(c.req.query("limit_page_length"))
      : undefined,
    limit_start: c.req.query("limit_start") ? Number(c.req.query("limit_start")) : undefined,
    order_by: c.req.query("order_by"),
  };
}

erpRestRouter.get("/ping", async (c) => {
  try {
    return c.json({ data: await erpRunMethod("frappe.auth.get_logged_user") });
  } catch (err) {
    return routeError(c, err);
  }
});

erpRestRouter.post("/method/*", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const method = new URL(c.req.url).pathname.split("/api/erp-rest/method/")[1] ?? "";
    return c.json({ data: await erpRunMethod(decodeURIComponent(method), body) });
  } catch (err) {
    return routeError(c, err);
  }
});

erpRestRouter.get("/resource/:doctype/fields", async (c) => {
  try {
    return c.json({ data: await erpDoctypeFields(decodeURIComponent(c.req.param("doctype"))) });
  } catch (err) {
    return routeError(c, err);
  }
});

erpRestRouter.get("/resource/:doctype/count", async (c) => {
  try {
    const doctype = decodeURIComponent(c.req.param("doctype"));
    const filters = parseJsonParam(c.req.query("filters"), undefined);
    return c.json({ data: await erpCount(doctype, filters) });
  } catch (err) {
    return routeError(c, err);
  }
});

erpRestRouter.get("/resource/:doctype", async (c) => {
  try {
    const doctype = decodeURIComponent(c.req.param("doctype"));
    return c.json({ data: await erpList(doctype, listOptions(c)) });
  } catch (err) {
    return routeError(c, err);
  }
});

erpRestRouter.post("/resource/:doctype", async (c) => {
  try {
    const doctype = decodeURIComponent(c.req.param("doctype"));
    const doc = await c.req.json();
    return c.json({ data: await erpCreate(doctype, doc) }, 201);
  } catch (err) {
    return routeError(c, err);
  }
});

erpRestRouter.get("/resource/:doctype/:name", async (c) => {
  try {
    const doc = await erpGet(
      decodeURIComponent(c.req.param("doctype")),
      decodeURIComponent(c.req.param("name")),
    );
    if (!doc) return c.json({ error: { message: "Not found" } }, 404);
    return c.json({ data: doc });
  } catch (err) {
    return routeError(c, err);
  }
});

async function updateDoc(c: any) {
  const doctype = decodeURIComponent(c.req.param("doctype"));
  const name = decodeURIComponent(c.req.param("name"));
  const doc = await c.req.json();
  return c.json({ data: await erpUpdate(doctype, name, doc) });
}

erpRestRouter.put("/resource/:doctype/:name", async (c) => {
  try {
    return await updateDoc(c);
  } catch (err) {
    return routeError(c, err);
  }
});

erpRestRouter.patch("/resource/:doctype/:name", async (c) => {
  try {
    return await updateDoc(c);
  } catch (err) {
    return routeError(c, err);
  }
});

erpRestRouter.delete("/resource/:doctype/:name", async (c) => {
  try {
    await erpDelete(
      decodeURIComponent(c.req.param("doctype")),
      decodeURIComponent(c.req.param("name")),
    );
    return c.json({ data: { ok: true } });
  } catch (err) {
    return routeError(c, err);
  }
});
