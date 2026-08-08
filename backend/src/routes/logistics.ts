/**
 * Logistics analytics endpoints — Marco's TileOS data feed.
 * Serves real-time cycle-time data from LSH Logistics Tracker.
 */

import { Hono } from "hono";
import { erpList } from "../lib/erp";
import { getAuthedUser, canSeeFinancials } from "../lib/scope";

export const logisticsRouter = new Hono();

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Infer location from destination string. Returns "NYC" | "HOU" | null. */
function inferLocation(dest: string | null | undefined): "NYC" | "HOU" | null {
  if (!dest) return null;
  const d = dest.toUpperCase();
  if (d.includes("HOUSTON") || d.includes(" TX") || d.includes("LSTX") || d.includes("HOU")) {
    return "HOU";
  }
  if (
    d.includes("NEW YORK") ||
    d.includes(" NY ") ||
    d.includes(" NY,") ||
    d.includes("NYC") ||
    d.includes("61ST") ||
    d.includes("LSTNY")
  ) {
    return "NYC";
  }
  return null;
}

/** ISO week label "Wxx" for a date string. */
function isoWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `W${String(week).padStart(2, "0")}`;
}

/** YYYY-MM-DD for Monday of the ISO week containing dateStr. */
function weekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

// ─── GET /api/logistics/cycle-times ───────────────────────────────────────────
//
// Returns weekly average transit_days for Factory Inbound + Customer Delivery
// lanes, split by destination location (NYC / HOU).
//
// Shape:
//   { weeks: string[], nyc: (number|null)[], hou: (number|null)[], summary: {...} }
//
// Auth: store_manager+ (same as Mission Control tabs)

logisticsRouter.get("/cycle-times", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: "Forbidden" }, 403);
  try {
    const rows = await erpList<{
      name: string;
      lane: string;
      status: string;
      destination: string;
      ship_date: string;
      transit_days: number;
      delivered_date: string;
    }>("LSH Logistics Tracker", {
      filters: [
        ["status", "=", "Delivered"],
        ["transit_days", ">", 0],
        ["ship_date", "!=", ""],
      ],
      fields: ["name", "lane", "status", "destination", "ship_date", "transit_days", "delivered_date"],
      limit: 200,
      order_by: "ship_date asc",
    });

    // ── aggregate by week × location ──────────────────────────────────────────
    type WeekBucket = { nycSum: number; nycCnt: number; houSum: number; houCnt: number };
    const byWeek = new Map<string, WeekBucket>();

    for (const r of rows) {
      if (!r.ship_date || !r.transit_days) continue;
      const loc = inferLocation(r.destination);
      if (!loc) continue;

      const wk = weekStart(r.ship_date);
      if (!byWeek.has(wk)) {
        byWeek.set(wk, { nycSum: 0, nycCnt: 0, houSum: 0, houCnt: 0 });
      }
      const b = byWeek.get(wk)!;
      if (loc === "NYC") {
        b.nycSum += r.transit_days;
        b.nycCnt++;
      } else {
        b.houSum += r.transit_days;
        b.houCnt++;
      }
    }

    // Sort weeks ascending; take last 8 (rolling 2-month window)
    const sortedWeeks = [...byWeek.keys()].sort();
    const window = sortedWeeks.slice(-8);

    const weeks: string[] = [];
    const nyc: (number | null)[] = [];
    const hou: (number | null)[] = [];

    for (const wk of window) {
      const b = byWeek.get(wk);
      if (!b) continue;
      weeks.push(isoWeekLabel(wk));
      nyc.push(b.nycCnt > 0 ? Math.round((b.nycSum / b.nycCnt) * 10) / 10 : null);
      hou.push(b.houCnt > 0 ? Math.round((b.houSum / b.houCnt) * 10) / 10 : null);
    }

    // ── summary stats ─────────────────────────────────────────────────────────
    const nycVals = nyc.filter((v): v is number => v !== null);
    const houVals = hou.filter((v): v is number => v !== null);

    const avg = (arr: number[]): number | null =>
      arr.length ? Math.round((arr.reduce((acc: number, v: number) => acc + v, 0) / arr.length) * 10) / 10 : null;

    const trend = (arr: (number | null)[]) => {
      const vals = arr.filter((v): v is number => v !== null);
      if (vals.length < 2) return 0;
      return Math.round((vals[vals.length - 1] - vals[0]) * 10) / 10;
    };

    return c.json({
      data: {
        weeks,
        nyc,
        hou,
        summary: {
          nyc_avg: avg(nycVals),
          hou_avg: avg(houVals),
          nyc_trend: trend(nyc),
          hou_trend: trend(hou),
          total_shipments: rows.length,
          has_hou_data: houVals.length > 0,
        },
      },
    });
  } catch (err) {
    console.error("[logistics cycle-times]", err);
    return c.json(
      { data: { weeks: [], nyc: [], hou: [], summary: { nyc_avg: null, hou_avg: null, nyc_trend: 0, hou_trend: 0, total_shipments: 0, has_hou_data: false } } },
      200,
    );
  }
});

// ─── GET /api/logistics/summary ───────────────────────────────────────────────
//
// Live in-transit / exception / customs counts for Marco's tile KPIs.

logisticsRouter.get("/summary", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!canSeeFinancials(user.role)) return c.json({ error: "Forbidden" }, 403);
  try {
    const open = await erpList<{
      name: string;
      lane: string;
      status: string;
      exception_flag: number;
      customs_flag: number;
    }>("LSH Logistics Tracker", {
      filters: [["status", "not in", ["Delivered", "Lost-Claim", "Cancelled"]]],
      fields: ["name", "lane", "status", "exception_flag", "customs_flag"],
      limit: 200,
    });

    const inTransit = open.filter((r) => r.status === "In Transit").length;
    const exceptions = open.filter((r) => r.exception_flag).length;
    const customs = open.filter((r) => r.customs_flag).length;
    const total = open.length;

    return c.json({
      data: {
        total_open: total,
        in_transit: inTransit,
        exceptions,
        in_customs: customs,
      },
    });
  } catch {
    return c.json({ data: { total_open: 0, in_transit: 0, exceptions: 0, in_customs: 0 } }, 200);
  }
});
