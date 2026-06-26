// Thin server-side proxy for the garment job-card feature.
// No business logic — attaches ERP credentials and passes payloads through.
//
// The ERP methods are Frappe Server Scripts (API type), called by BARE NAME
// at /api/method/<name> (NOT module-pathed):
//   get_garment_job_card | update_garment_status | complete_garment
//
// NOTE: these server scripts may put their payload under `.message` OR `.data`.
// erpRunMethod only returns `.message`, so we use a local helper that returns
// `json.message ?? json.data ?? null` instead.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { z } from "zod";
import { getAuthedUser } from "../lib/scope";
import {
  GarmentJobCardRequest,
  GarmentStatusRequest,
  GarmentCompleteRequest,
} from "../types";

export const garmentRouter = new Hono();

// Lazy creds — mirrors src/lib/erp.ts (read from process.env at call time).
function erpCreds() {
  return {
    base: process.env.ERPNEXT_BASE_URL ?? "",
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}

// Like erpRunMethod, but returns message-or-data (server scripts vary).
async function erpRunMethodMsgOrData(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const { base, key, secret } = erpCreds();
  if (!base || !key || !secret) return null;
  const res = await fetch(`${base}/api/method/${method}`, {
    method: "POST",
    headers: {
      Authorization: `token ${key}:${secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as any;
    throw new Error(err._server_messages || err.exception || `ERP method failed: ${res.status}`);
  }
  const json = (await res.json()) as { message?: unknown; data?: unknown };
  return json.message ?? json.data ?? null;
}

// POST /api/garment/job-card
garmentRouter.post("/job-card", zValidator("json", GarmentJobCardRequest), async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { ticket, garment_id } = (c.req as any).valid("json") as z.infer<typeof GarmentJobCardRequest>;
  try {
    const data = await erpRunMethodMsgOrData("get_garment_job_card", { ticket, garment_id });
    return c.json({ data });
  } catch (err) {
    console.error("garment.job-card error:", err);
    return c.json({ error: { message: "Garment service error" } }, 502);
  }
});

// POST /api/garment/status
garmentRouter.post("/status", zValidator("json", GarmentStatusRequest), async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { ticket, garment_id, status, worker } = (c.req as any).valid("json") as z.infer<
    typeof GarmentStatusRequest
  >;
  const params: Record<string, unknown> = { ticket, garment_id, status };
  if (worker !== undefined) params.worker = worker;
  try {
    const data = await erpRunMethodMsgOrData("update_garment_status", params);
    return c.json({ data });
  } catch (err) {
    console.error("garment.status error:", err);
    return c.json({ error: { message: "Garment service error" } }, 502);
  }
});

// POST /api/garment/complete
garmentRouter.post("/complete", zValidator("json", GarmentCompleteRequest), async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { ticket, garment_id, worker, actual_minutes } = (c.req as any).valid("json") as z.infer<
    typeof GarmentCompleteRequest
  >;
  const params: Record<string, unknown> = { ticket, garment_id, worker };
  if (actual_minutes !== undefined) params.actual_minutes = actual_minutes;
  try {
    const data = await erpRunMethodMsgOrData("complete_garment", params);
    return c.json({ data });
  } catch (err) {
    console.error("garment.complete error:", err);
    return c.json({ error: { message: "Garment service error" } }, 502);
  }
});

// GET /api/garment/workers — list active Tailor / Master Tailor employees.
// REST resource list (not a method); limit_page_length=0 means "all".
garmentRouter.get("/workers", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { base, key, secret } = erpCreds();
  if (!base || !key || !secret) return c.json({ data: [] });

  const url = new URL(`${base}/api/resource/Employee`);
  url.searchParams.set(
    "filters",
    JSON.stringify([
      ["status", "=", "Active"],
      ["designation", "in", ["Tailor", "Master Tailor"]],
    ]),
  );
  url.searchParams.set("fields", JSON.stringify(["name", "employee_name"]));
  url.searchParams.set("limit_page_length", "0");

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" },
    });
    if (!res.ok) {
      console.error("garment.workers error: ERP status", res.status);
      return c.json({ error: { message: "Garment service error" } }, 502);
    }
    const json = (await res.json()) as { data?: Array<{ name: string; employee_name: string }> };
    const workers = (json.data ?? []).map((row) => ({ id: row.name, name: row.employee_name }));
    return c.json({ data: workers });
  } catch (err) {
    console.error("garment.workers error:", err);
    return c.json({ error: { message: "Garment service error" } }, 502);
  }
});
