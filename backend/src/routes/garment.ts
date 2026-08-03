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
import { erpList } from "../lib/erp";
import {
  GarmentJobCardRequest,
  GarmentStatusRequest,
  GarmentCompleteRequest,
} from "../types";

export const garmentRouter = new Hono();

const ERP_TIMEOUT_MS = 15_000;

// Lazy creds — mirrors src/lib/erp.ts (read from process.env at call time).
function erpCreds() {
  return {
    base: process.env.ERPNEXT_BASE_URL ?? "",
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };
}

function shortErpError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err || "Garment service error");
  return msg.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

// Like erpRunMethod, but returns message-or-data (server scripts vary).
async function erpRunMethodMsgOrData(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const { base, key, secret } = erpCreds();
  if (!base || !key || !secret) {
    throw new Error("ERP credentials not configured");
  }
  const res = await fetch(`${base}/api/method/${method}`, {
    method: "POST",
    headers: {
      Authorization: `token ${key}:${secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0; +https://app.lstailors.com)",
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(ERP_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as any;
    throw new Error(err._server_messages || err.exception || `ERP method failed: ${res.status}`);
  }
  const json = (await res.json()) as { message?: unknown; data?: unknown };
  return json.message ?? json.data ?? null;
}

function dayBounds(dateStr?: string | null): { start: string; end: string; date: string } {
  // America/New_York calendar day for floor reporting
  const tz = "America/New_York";
  const now = new Date();
  let y: number, m: number, d: number;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  } else {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    y = get("year");
    m = get("month");
    d = get("day");
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${y}-${pad(m)}-${pad(d)}`;
  return {
    date,
    start: `${date} 00:00:00`,
    end: `${date} 23:59:59`,
  };
}

// POST /api/garment/job-card
garmentRouter.post("/job-card", zValidator("json", GarmentJobCardRequest), async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { ticket, garment_id } = (c.req as any).valid("json") as z.infer<typeof GarmentJobCardRequest>;
  try {
    const data = await erpRunMethodMsgOrData("get_garment_job_card", { ticket, garment_id });
    if (data == null) {
      return c.json({ error: { message: "Garment not found on this ticket" } }, 404);
    }
    return c.json({ data });
  } catch (err) {
    console.error("garment.job-card error:", err);
    return c.json({ error: { message: shortErpError(err) || "Garment service error" } }, 502);
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
    if (data == null) {
      return c.json({ error: { message: "Could not update garment status" } }, 502);
    }
    return c.json({ data });
  } catch (err) {
    console.error("garment.status error:", err);
    return c.json({ error: { message: shortErpError(err) || "Garment service error" } }, 502);
  }
});

// POST /api/garment/complete
garmentRouter.post("/complete", zValidator("json", GarmentCompleteRequest), async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { ticket, garment_id, worker, actual_minutes } = (c.req as any).valid("json") as z.infer<
    typeof GarmentCompleteRequest
  >;
  try {
    const data = await erpRunMethodMsgOrData("complete_garment", {
      ticket,
      garment_id,
      worker,
      actual_minutes,
    });
    if (data == null) {
      return c.json({ error: { message: "Could not complete garment" } }, 502);
    }
    return c.json({ data });
  } catch (err) {
    console.error("garment.complete error:", err);
    return c.json({ error: { message: shortErpError(err) || "Garment service error" } }, 502);
  }
});

// GET /api/garment/workers — list active Tailor / Master Tailor employees.
garmentRouter.get("/workers", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { base, key, secret } = erpCreds();
  if (!base || !key || !secret) {
    return c.json({ error: { message: "ERP credentials not configured" } }, 502);
  }

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
      headers: {
        Authorization: `token ${key}:${secret}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0)",
      },
      signal: AbortSignal.timeout(ERP_TIMEOUT_MS),
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
    return c.json({ error: { message: shortErpError(err) || "Garment service error" } }, 502);
  }
});

type GarmentRow = {
  name: string;
  parent: string;
  garment_id?: string;
  garment_type?: string;
  completed_by?: string;
  completed_at?: string;
  actual_minutes?: number;
  garment_total?: number;
  garment_status?: string;
};

/**
 * GET /api/garment/tally?date=YYYY-MM-DD
 * Pieces completed today (NYC) by tailor — minutes + garment $ from complete chips.
 */
garmentRouter.get("/tally", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { date, start, end } = dayBounds(c.req.query("date"));

  try {
    const [rows, employees] = await Promise.all([
      erpList<GarmentRow>("Alteration Ticket Garment", {
        parent: "Alteration Ticket",
        filters: [
          ["completed_at", ">=", start],
          ["completed_at", "<=", end],
        ],
        fields: [
          "name",
          "parent",
          "garment_id",
          "garment_type",
          "completed_by",
          "completed_at",
          "actual_minutes",
          "garment_total",
          "garment_status",
        ],
        limit: 500,
        order_by: "completed_at desc",
      }),
      erpList<{ name: string; employee_name: string }>("Employee", {
        filters: [["status", "=", "Active"]],
        fields: ["name", "employee_name"],
        limit: 200,
      }),
    ]);

    const nameById = new Map(employees.map((e) => [e.name, e.employee_name || e.name]));

    type Bucket = {
      workerId: string;
      workerName: string;
      pieces: number;
      minutes: number;
      revenue: number;
      tickets: Set<string>;
    };
    const byWorker = new Map<string, Bucket>();

    for (const r of rows) {
      const wid = (r.completed_by || "").trim() || "unassigned";
      let b = byWorker.get(wid);
      if (!b) {
        b = {
          workerId: wid,
          workerName: wid === "unassigned" ? "Unassigned" : nameById.get(wid) || wid,
          pieces: 0,
          minutes: 0,
          revenue: 0,
          tickets: new Set(),
        };
        byWorker.set(wid, b);
      }
      b.pieces += 1;
      b.minutes += Number(r.actual_minutes) || 0;
      b.revenue += Number(r.garment_total) || 0;
      if (r.parent) b.tickets.add(r.parent);
    }

    const tailors = Array.from(byWorker.values())
      .map((b) => ({
        workerId: b.workerId,
        workerName: b.workerName,
        pieces: b.pieces,
        minutes: b.minutes,
        hours: Math.round((b.minutes / 60) * 10) / 10,
        revenue: Math.round(b.revenue * 100) / 100,
        tickets: b.tickets.size,
      }))
      .sort((a, b) => b.minutes - a.minutes || b.pieces - a.pieces);

    const totals = tailors.reduce(
      (acc, t) => {
        acc.pieces += t.pieces;
        acc.minutes += t.minutes;
        acc.revenue += t.revenue;
        return acc;
      },
      { pieces: 0, minutes: 0, revenue: 0 },
    );

    return c.json({
      data: {
        date,
        timezone: "America/New_York",
        totals: {
          pieces: totals.pieces,
          minutes: totals.minutes,
          hours: Math.round((totals.minutes / 60) * 10) / 10,
          revenue: Math.round(totals.revenue * 100) / 100,
          workers: tailors.length,
        },
        tailors,
        garments: rows.map((r) => ({
          ticket: r.parent,
          garmentId: r.garment_id,
          type: r.garment_type,
          workerId: r.completed_by,
          workerName: r.completed_by
            ? nameById.get(r.completed_by) || r.completed_by
            : "Unassigned",
          completedAt: r.completed_at,
          minutes: Number(r.actual_minutes) || 0,
          revenue: Number(r.garment_total) || 0,
          status: r.garment_status,
        })),
      },
    });
  } catch (err) {
    console.error("garment.tally error:", err);
    return c.json({ error: { message: shortErpError(err) || "Tally failed" } }, 502);
  }
});

/**
 * POST /api/garment/auto-progress-stale
 * Received tickets older than `hours` (default 24) → Start Work (In Progress).
 * Safe to call from cron; idempotent for already-progressed tickets.
 */
garmentRouter.post("/auto-progress-stale", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => ({}))) as { hours?: number; dry_run?: boolean };
  const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 168);
  const dryRun = !!body.dry_run;
  const cutoff = new Date(Date.now() - hours * 3600_000);
  const cutoffStr = cutoff.toISOString().slice(0, 19).replace("T", " ");

  const { base, key, secret } = erpCreds();
  if (!base || !key || !secret) {
    return c.json({ error: { message: "ERP credentials not configured" } }, 502);
  }

  try {
    const stale = await erpList<{ name: string; creation: string; workflow_state: string }>(
      "Alteration Ticket",
      {
        filters: [
          ["workflow_state", "=", "Received"],
          ["creation", "<=", cutoffStr],
        ],
        fields: ["name", "creation", "workflow_state"],
        limit: 200,
        order_by: "creation asc",
      },
    );

    const promoted: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    if (!dryRun) {
      for (const t of stale) {
        try {
          const res = await fetch(`${base}/api/method/frappe.model.workflow.apply_workflow`, {
            method: "POST",
            headers: {
              Authorization: `token ${key}:${secret}`,
              Accept: "application/json",
              "Content-Type": "application/json",
              "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0)",
            },
            body: JSON.stringify({
              doc: JSON.stringify({ doctype: "Alteration Ticket", name: t.name }),
              action: "Start Work",
            }),
            signal: AbortSignal.timeout(ERP_TIMEOUT_MS),
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as any;
            failed.push({
              name: t.name,
              error: String(err._server_messages || err.exception || res.status).slice(0, 160),
            });
            continue;
          }
          promoted.push(t.name);
        } catch (e: any) {
          failed.push({ name: t.name, error: String(e?.message || e).slice(0, 160) });
        }
      }
    }

    return c.json({
      data: {
        hours,
        cutoff: cutoffStr,
        dryRun,
        candidates: stale.map((t) => ({ name: t.name, creation: t.creation })),
        promoted,
        failed,
        count: dryRun ? stale.length : promoted.length,
      },
    });
  } catch (err) {
    console.error("garment.auto-progress-stale error:", err);
    return c.json({ error: { message: shortErpError(err) || "Auto-progress failed" } }, 502);
  }
});
