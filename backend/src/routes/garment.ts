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

const TALLY_TZ = "America/New_York";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function nyCalendarDay(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TALLY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${get("year")}-${pad(get("month"))}-${pad(get("day"))}`;
}

/** Parse ERP/ISO datetime into America/New_York YYYY-MM-DD. */
function nyDayFromStamp(stamp?: string | null): string | null {
  if (!stamp) return null;
  const s = String(stamp).trim();
  if (ISO_DAY.test(s.slice(0, 10)) && (s.length === 10 || s[10] === " " || s[10] === "T")) {
    // Naive ERP wall clock is already store-local (NY); take the date prefix.
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s.slice(0, 10);
  }
  const d = new Date(s.includes("T") || s.endsWith("Z") ? s : s.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) {
    return ISO_DAY.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
  }
  return nyCalendarDay(d);
}

function dayBounds(dateStr?: string | null): { start: string; end: string; date: string } {
  // America/New_York calendar day for floor reporting
  const date = dateStr && ISO_DAY.test(dateStr) ? dateStr : nyCalendarDay();
  return {
    date,
    start: `${date} 00:00:00`,
    end: `${date} 23:59:59`,
  };
}

/**
 * Single day: ?date=YYYY-MM-DD (default today NY).
 * Range (week rollup): ?start=YYYY-MM-DD&end=YYYY-MM-DD — one query, not 7 round-trips.
 */
function tallyBounds(opts: {
  date?: string | null;
  start?: string | null;
  end?: string | null;
}): {
  date: string | null;
  rangeStart: string;
  rangeEnd: string;
  start: string;
  end: string;
  multiDay: boolean;
} {
  const startQ = opts.start && ISO_DAY.test(opts.start) ? opts.start : null;
  const endQ = opts.end && ISO_DAY.test(opts.end) ? opts.end : null;
  if (startQ && endQ) {
    const rangeStart = startQ <= endQ ? startQ : endQ;
    const rangeEnd = startQ <= endQ ? endQ : startQ;
    // Cap range at 31 days to protect ERP list
    const startMs = Date.parse(`${rangeStart}T12:00:00Z`);
    const endMs = Date.parse(`${rangeEnd}T12:00:00Z`);
    const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
    if (days > 31) {
      const cappedEnd = new Date(startMs + 30 * 86_400_000);
      const cap = nyCalendarDay(cappedEnd);
      return {
        date: null,
        rangeStart,
        rangeEnd: cap,
        start: `${rangeStart} 00:00:00`,
        end: `${cap} 23:59:59`,
        multiDay: true,
      };
    }
    const multiDay = rangeStart !== rangeEnd;
    return {
      date: multiDay ? null : rangeStart,
      rangeStart,
      rangeEnd,
      start: `${rangeStart} 00:00:00`,
      end: `${rangeEnd} 23:59:59`,
      multiDay,
    };
  }
  const single = dayBounds(opts.date);
  return {
    date: single.date,
    rangeStart: single.date,
    rangeEnd: single.date,
    start: single.start,
    end: single.end,
    multiDay: false,
  };
}

function eachIsoDay(start: string, end: string): string[] {
  const out: string[] = [];
  let ms = Date.parse(`${start}T12:00:00Z`);
  const endMs = Date.parse(`${end}T12:00:00Z`);
  while (ms <= endMs) {
    out.push(nyCalendarDay(new Date(ms)));
    ms += 86_400_000;
  }
  return out;
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
 * GET /api/garment/tally?start=YYYY-MM-DD&end=YYYY-MM-DD  (week rollup — one round-trip)
 * Pieces completed (America/New_York) by tailor — minutes + garment $ from complete chips.
 * workLocation is always null until a real complete-time field exists (SPEC 061 §0.3) — never invent Shop/Home.
 */
garmentRouter.get("/tally", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const bounds = tallyBounds({
    date: c.req.query("date"),
    start: c.req.query("start"),
    end: c.req.query("end"),
  });
  const { date, start, end, rangeStart, rangeEnd, multiDay } = bounds;
  const listLimit = multiDay ? 2000 : 500;

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
        limit: listLimit,
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
    /** day -> workerId -> bucket */
    const dayWorker = new Map<string, Map<string, Bucket>>();

    const touch = (map: Map<string, Bucket>, wid: string): Bucket => {
      let b = map.get(wid);
      if (!b) {
        b = {
          workerId: wid,
          workerName: wid === "unassigned" ? "Unassigned" : nameById.get(wid) || wid,
          pieces: 0,
          minutes: 0,
          revenue: 0,
          tickets: new Set(),
        };
        map.set(wid, b);
      }
      return b;
    };

    for (const r of rows) {
      const wid = (r.completed_by || "").trim() || "unassigned";
      const mins = Number(r.actual_minutes) || 0;
      const rev = Number(r.garment_total) || 0;

      const b = touch(byWorker, wid);
      b.pieces += 1;
      b.minutes += mins;
      b.revenue += rev;
      if (r.parent) b.tickets.add(r.parent);

      if (multiDay) {
        const day = nyDayFromStamp(r.completed_at) || rangeStart;
        let dm = dayWorker.get(day);
        if (!dm) {
          dm = new Map();
          dayWorker.set(day, dm);
        }
        const db = touch(dm, wid);
        db.pieces += 1;
        db.minutes += mins;
        db.revenue += rev;
        if (r.parent) db.tickets.add(r.parent);
      }
    }

    const serializeTailors = (map: Map<string, Bucket>) =>
      Array.from(map.values())
        .map((b) => ({
          workerId: b.workerId,
          workerName: b.workerName,
          pieces: b.pieces,
          minutes: b.minutes,
          hours: Math.round((b.minutes / 60) * 10) / 10,
          revenue: Math.round(b.revenue * 100) / 100,
          tickets: b.tickets.size,
          /** null until real work_location field — do not proxy from origin_location */
          workLocation: null as null,
        }))
        .sort((a, b) => b.minutes - a.minutes || b.pieces - a.pieces);

    const tailors = serializeTailors(byWorker);

    const totals = tailors.reduce(
      (acc, t) => {
        acc.pieces += t.pieces;
        acc.minutes += t.minutes;
        acc.revenue += t.revenue;
        return acc;
      },
      { pieces: 0, minutes: 0, revenue: 0 },
    );

    const byDay = multiDay
      ? eachIsoDay(rangeStart, rangeEnd).map((d) => {
          const dayTailors = serializeTailors(dayWorker.get(d) ?? new Map());
          const dayTotals = dayTailors.reduce(
            (acc, t) => {
              acc.pieces += t.pieces;
              acc.minutes += t.minutes;
              acc.revenue += t.revenue;
              return acc;
            },
            { pieces: 0, minutes: 0, revenue: 0 },
          );
          return {
            date: d,
            totals: {
              pieces: dayTotals.pieces,
              minutes: dayTotals.minutes,
              hours: Math.round((dayTotals.minutes / 60) * 10) / 10,
              revenue: Math.round(dayTotals.revenue * 100) / 100,
              workers: dayTailors.length,
            },
            tailors: dayTailors,
          };
        })
      : undefined;

    return c.json({
      data: {
        date,
        start: rangeStart,
        end: rangeEnd,
        timezone: TALLY_TZ,
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
          /** Always null until schema captures work location at complete */
          workLocation: null as null,
        })),
        ...(byDay ? { byDay } : {}),
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
