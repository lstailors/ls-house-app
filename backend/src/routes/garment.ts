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
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD in America/New_York for "now". */
function nyToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TALLY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return `${get("year")}-${pad2(get("month"))}-${pad2(get("day"))}`;
}

/** Calendar day → Frappe datetime bounds (store-local wall clock, no TZ offset math). */
function dayBounds(dateStr?: string | null): { start: string; end: string; date: string } {
  const date = dateStr && ISO_DATE.test(dateStr) ? dateStr : nyToday();
  return {
    date,
    start: `${date} 00:00:00`,
    end: `${date} 23:59:59`,
  };
}

/** Inclusive date range for week rollup. Cap 31 days. */
function rangeBounds(
  startQ?: string | null,
  endQ?: string | null,
  dateQ?: string | null,
): { startDate: string; endDate: string; start: string; end: string; singleDay: boolean } {
  if (startQ && endQ && ISO_DATE.test(startQ) && ISO_DATE.test(endQ)) {
    let a = startQ;
    let b = endQ;
    if (a > b) [a, b] = [b, a];
    // Cap span at 31 calendar days via UTC date math on the YYYY-MM-DD labels
    const aMs = Date.parse(`${a}T12:00:00Z`);
    const bMs = Date.parse(`${b}T12:00:00Z`);
    const days = Math.floor((bMs - aMs) / 86_400_000) + 1;
    if (days > 31) {
      const capped = new Date(aMs + 30 * 86_400_000);
      b = `${capped.getUTCFullYear()}-${pad2(capped.getUTCMonth() + 1)}-${pad2(capped.getUTCDate())}`;
    }
    return {
      startDate: a,
      endDate: b,
      start: `${a} 00:00:00`,
      end: `${b} 23:59:59`,
      singleDay: a === b,
    };
  }
  const one = dayBounds(dateQ);
  return {
    startDate: one.date,
    endDate: one.date,
    start: one.start,
    end: one.end,
    singleDay: true,
  };
}

function eachDateInclusive(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let ms = Date.parse(`${startDate}T12:00:00Z`);
  const endMs = Date.parse(`${endDate}T12:00:00Z`);
  while (ms <= endMs) {
    const d = new Date(ms);
    out.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
    ms += 86_400_000;
  }
  return out;
}

function aggregateRows(
  rows: GarmentRow[],
  nameById: Map<string, string>,
): {
  totals: { pieces: number; minutes: number; hours: number; revenue: number; workers: number };
  tailors: Array<{
    workerId: string;
    workerName: string;
    pieces: number;
    minutes: number;
    hours: number;
    revenue: number;
    tickets: number;
    workLocation: null;
  }>;
} {
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
      // Real Shop/Home signal does not exist on completion yet — never invent.
      workLocation: null as null,
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

  return {
    totals: {
      pieces: totals.pieces,
      minutes: totals.minutes,
      hours: Math.round((totals.minutes / 60) * 10) / 10,
      revenue: Math.round(totals.revenue * 100) / 100,
      workers: tailors.length,
    },
    tailors,
  };
}

function mapGarments(rows: GarmentRow[], nameById: Map<string, string>) {
  return rows.map((r) => ({
    ticket: r.parent,
    garmentId: r.garment_id,
    type: r.garment_type,
    workerId: r.completed_by,
    workerName: r.completed_by ? nameById.get(r.completed_by) || r.completed_by : "Unassigned",
    completedAt: r.completed_at,
    minutes: Number(r.actual_minutes) || 0,
    revenue: Number(r.garment_total) || 0,
    status: r.garment_status,
    // Honest omission until complete-chip captures work_location
    workLocation: null as null,
  }));
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
 * GET /api/garment/tally?start=YYYY-MM-DD&end=YYYY-MM-DD  (week rollup, max 31d)
 * Pieces completed (NYC calendar) by tailor — minutes + garment Work $ from complete chips.
 * workLocation is always null until a real complete-time field exists (SPEC 061).
 */
garmentRouter.get("/tally", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const bounds = rangeBounds(c.req.query("start"), c.req.query("end"), c.req.query("date"));
  const multiDay = !bounds.singleDay;
  const limit = multiDay ? 2000 : 500;

  try {
    const [rows, employees] = await Promise.all([
      erpList<GarmentRow>("Alteration Ticket Garment", {
        parent: "Alteration Ticket",
        filters: [
          ["completed_at", ">=", bounds.start],
          ["completed_at", "<=", bounds.end],
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
        limit,
        order_by: "completed_at desc",
      }),
      erpList<{ name: string; employee_name: string }>("Employee", {
        filters: [["status", "=", "Active"]],
        fields: ["name", "employee_name"],
        limit: 200,
      }),
    ]);

    const nameById = new Map(employees.map((e) => [e.name, e.employee_name || e.name]));
    const { totals, tailors } = aggregateRows(rows, nameById);
    const garments = mapGarments(rows, nameById);

    let byDay:
      | Array<{
          date: string;
          totals: typeof totals;
          tailors: typeof tailors;
        }>
      | undefined;

    if (multiDay) {
      const dates = eachDateInclusive(bounds.startDate, bounds.endDate);
      byDay = dates.map((date) => {
        const dayRows = rows.filter((r) => (r.completed_at || "").slice(0, 10) === date);
        const agg = aggregateRows(dayRows, nameById);
        return { date, totals: agg.totals, tailors: agg.tailors };
      });
    }

    return c.json({
      data: {
        date: multiDay ? null : bounds.startDate,
        start: bounds.startDate,
        end: bounds.endDate,
        timezone: TALLY_TZ,
        totals,
        tailors,
        garments,
        ...(byDay ? { byDay } : {}),
      },
    });
  } catch (err) {
    console.error("garment.tally error:", err);
    return c.json({ error: { message: shortErpError(err) || "Tally failed" } }, 502);
  }
});

/**
 * GET /api/garment/board — pieces currently being altered (staging kanban).
 */
garmentRouter.get("/board", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  try {
    const [wip, ready] = await Promise.all([
      erpList<GarmentRow & { color?: string; notes?: string }>("Alteration Ticket Garment", {
        parent: "Alteration Ticket",
        filters: [["garment_status", "not in", ["Completed", "Picked Up", "Ready"]]],
        fields: ["name", "parent", "garment_id", "garment_type", "garment_status", "color", "notes"],
        limit: 400,
        order_by: "modified desc",
      }).catch(() => [] as GarmentRow[]),
      erpList<GarmentRow & { color?: string; notes?: string }>("Alteration Ticket Garment", {
        parent: "Alteration Ticket",
        filters: [["garment_status", "=", "Ready"]],
        fields: ["name", "parent", "garment_id", "garment_type", "garment_status", "color", "notes"],
        limit: 150,
        order_by: "modified desc",
      }).catch(() => [] as GarmentRow[]),
    ]);
    const all = [...wip, ...ready];
    const parents = [...new Set(all.map((r) => r.parent).filter(Boolean))];
    const tickets = parents.length
      ? await erpList<{
          name: string;
          customer_name: string;
          workflow_state: string;
          due_date: string;
          assigned_tailor: string;
          is_rush: number;
        }>("Alteration Ticket", {
          filters: [["name", "in", parents]],
          fields: ["name", "customer_name", "workflow_state", "due_date", "assigned_tailor", "is_rush"],
          limit: 400,
        }).catch(() => [])
      : [];
    const byTicket = new Map(tickets.map((t) => [t.name, t]));
    return c.json({
      data: all.map((g) => {
        const t = byTicket.get(g.parent);
        return {
          id: g.garment_id || g.name,
          rowName: g.name,
          ticket: g.parent,
          garmentType: g.garment_type || "Garment",
          color: (g as { color?: string }).color || null,
          notes: (g as { notes?: string }).notes || "",
          status: String(g.garment_status || "Pending").trim() || "Pending",
          customerName: t?.customer_name || "Client",
          dueDate: t?.due_date || null,
          tailor: t?.assigned_tailor || null,
          rush: Boolean(t?.is_rush),
        };
      }),
    });
  } catch (err) {
    console.error("garment.board error:", err);
    return c.json({ error: { message: shortErpError(err) || "Could not load board" } }, 502);
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
