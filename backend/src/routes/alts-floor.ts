/**
 * Alts FOH floor brief — Rocco owns this surface.
 * GET  /api/alts/floor-brief        → latest brief + live stats snapshot
 * POST /api/alts/floor-brief/sweep  → full floor sweep + AI brief (Rocco)
 */
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import { grokChat } from "../lib/grok";
import {
  insertAgentBrief,
  listAgentBriefsFiltered,
} from "../lib/erpnext/agents";

export const altsFloorRouter = new Hono();

type FloorStats = {
  open: number;
  ready: number;
  dueToday: number;
  overdue: number;
  outToTailors: number;
  parked: number;
  outForDelivery: number;
  deliveredToday: number;
  pendingBoard: number;
  openInvoices: number;
  openAr: number;
  dueTodayNames: string[];
  overdueNames: string[];
  readyNames: string[];
  deliveryNames: string[];
};

async function collectFloorStats(): Promise<FloorStats> {
  const today = new Date().toISOString().slice(0, 10);

  const [tickets, parked, deliveries, invoices] = await Promise.all([
    erpList<any>("Alteration Ticket", {
      filters: [["workflow_state", "!=", "Cancelled"]],
      fields: [
        "name",
        "customer_name",
        "workflow_state",
        "due_date",
        "origin_location",
        "assigned_tailor",
        "payment_status",
      ],
      limit: 300,
      order_by: "modified desc",
    }).catch(() => [] as any[]),
    erpList<any>("LSH Parked Cart", {
      fields: ["name"],
      limit: 100,
    }).catch(() => [] as any[]),
    erpList<any>("LSH Delivery", {
      filters: [["docstatus", "!=", 2]],
      fields: [
        "name",
        "lsh_status",
        "customer_name",
        "lsh_delivered_at",
        "lsh_scheduled_date",
      ],
      limit: 200,
      order_by: "modified desc",
    }).catch(() => [] as any[]),
    erpList<any>("Sales Invoice", {
      filters: [
        ["docstatus", "=", 1],
        ["outstanding_amount", ">", 0],
      ],
      fields: ["name", "customer_name", "outstanding_amount", "status"],
      limit: 200,
      order_by: "posting_date desc",
    }).catch(() => [] as any[]),
  ]);

  let open = 0;
  let ready = 0;
  let dueToday = 0;
  let overdue = 0;
  let outToTailors = 0;
  const dueTodayNames: string[] = [];
  const overdueNames: string[] = [];
  const readyNames: string[] = [];

  for (const t of tickets) {
    const st = String(t.workflow_state ?? "");
    if (st === "Picked Up" || st === "Cancelled") continue;
    open += 1;
    const label = `${t.customer_name || "Client"} · ${t.name}`;
    if (st === "Ready") {
      ready += 1;
      if (readyNames.length < 8) readyNames.push(label);
    }
    if (t.due_date) {
      if (t.due_date < today) {
        overdue += 1;
        if (overdueNames.length < 10) overdueNames.push(`${label} (due ${t.due_date})`);
      } else if (t.due_date === today) {
        dueToday += 1;
        if (dueTodayNames.length < 10) dueTodayNames.push(label);
      }
    }
    const ol = String(t.origin_location || "").toLowerCase();
    if (ol.includes("home") || (t.assigned_tailor && ol && ol !== "nyc")) {
      outToTailors += 1;
    }
  }

  let outForDelivery = 0;
  let deliveredToday = 0;
  let pendingBoard = 0;
  const deliveryNames: string[] = [];
  for (const d of deliveries) {
    const st = String(d.lsh_status || d.status || "").toLowerCase().replace(/\s+/g, "_");
    if (st === "out_for_delivery" || st === "out for delivery") {
      outForDelivery += 1;
      if (deliveryNames.length < 6) {
        deliveryNames.push(d.customer_name || d.name);
      }
    }
    if (
      st === "scheduled" ||
      st === "out_for_delivery" ||
      st === "out for delivery" ||
      st === "queued"
    ) {
      pendingBoard += 1;
    }
    const deliveredAt = d.lsh_delivered_at || d.delivered_at;
    if (
      (st === "delivered") &&
      deliveredAt &&
      String(deliveredAt).slice(0, 10) === today
    ) {
      deliveredToday += 1;
    }
  }

  const openAr = invoices.reduce(
    (s, i) => s + Number(i.outstanding_amount ?? 0),
    0,
  );

  return {
    open,
    ready,
    dueToday,
    overdue,
    outToTailors,
    parked: Array.isArray(parked) ? parked.length : 0,
    outForDelivery,
    deliveredToday,
    pendingBoard,
    openInvoices: invoices.length,
    openAr: Math.round(openAr * 100) / 100,
    dueTodayNames,
    overdueNames,
    readyNames,
    deliveryNames,
  };
}

function statsBlock(s: FloorStats, today: string): string {
  return [
    `Date (UTC day): ${today}`,
    `Open tickets: ${s.open}`,
    `Due today: ${s.dueToday}${s.dueTodayNames.length ? " — " + s.dueTodayNames.join("; ") : ""}`,
    `Overdue: ${s.overdue}${s.overdueNames.length ? " — " + s.overdueNames.join("; ") : ""}`,
    `Ready for pickup: ${s.ready}${s.readyNames.length ? " — " + s.readyNames.join("; ") : ""}`,
    `Out to tailors: ${s.outToTailors}`,
    `Parked intakes: ${s.parked}`,
    `Out for delivery: ${s.outForDelivery}${s.deliveryNames.length ? " — " + s.deliveryNames.join("; ") : ""}`,
    `Delivered today: ${s.deliveredToday}`,
    `Delivery board pending: ${s.pendingBoard}`,
    `Open invoices (AR count): ${s.openInvoices} · $${s.openAr.toLocaleString("en-US")}`,
  ].join("\n");
}

const ROCCO_SWEEP_SYSTEM = `You are Rocco — production and delivery manager at L&S Custom Tailors (alts FOH floor).
You own the shop floor from cradle to delivery. No-nonsense, floor-smart, direct.
Write a short floor briefing for counter staff (not the owner alone).

Rules:
- 4–7 short lines or tight sentences. No markdown headers. No asterisks.
- Lead with what hurts: overdue first, then due today, then ready/pickup, then deliveries.
- Name clients when listed. Call out empty lanes if calm.
- End with one clear "Do next" action for the floor.
- Sign: — Rocco`;

async function runRoccoSweep(force = false): Promise<{
  brief: { title: string; body: string; created_at: string; source: string };
  stats: FloorStats;
  generated: boolean;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const stats = await collectFloorStats();

  // Reuse a fresh brief (< 90 min) unless force
  if (!force) {
    const existing = await listAgentBriefsFiltered({
      source: "rocco",
      type: "floor_brief",
      limit: 1,
    }).catch(() => []);
    const row = existing[0];
    if (row?.body && row.creation) {
      const ageMs = Date.now() - new Date(row.creation).getTime();
      if (ageMs < 90 * 60 * 1000) {
        return {
          brief: {
            title: row.title || "Floor brief",
            body: row.body,
            created_at: row.creation,
            source: "rocco",
          },
          stats,
          generated: false,
        };
      }
    }
  }

  const block = statsBlock(stats, today);
  const nycTime = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  let body = await grokChat(
    [
      { role: "system", content: ROCCO_SWEEP_SYSTEM },
      {
        role: "user",
        content: `NYC now: ${nycTime}\n\nLive floor data:\n${block}\n\nWrite the floor briefing now.`,
      },
    ],
    { maxTokens: 350, temperature: 0.25 },
  );

  if (!body) {
    // Deterministic fallback — never blank the board
    const parts: string[] = [];
    if (stats.overdue > 0)
      parts.push(`${stats.overdue} overdue — work the late rack first.`);
    if (stats.dueToday > 0) parts.push(`${stats.dueToday} due today.`);
    if (stats.ready > 0) parts.push(`${stats.ready} ready for pickup.`);
    if (stats.outForDelivery > 0)
      parts.push(`${stats.outForDelivery} out for delivery.`);
    if (stats.openInvoices > 0)
      parts.push(
        `${stats.openInvoices} open invoices ($${stats.openAr.toLocaleString("en-US")} AR).`,
      );
    if (!parts.length) parts.push("Floor is calm — no overdue, nothing due today.");
    parts.push("Do next: clear overdue, then ready pickups.");
    parts.push("— Rocco");
    body = parts.join(" ");
  }

  const title = `Floor · ${nycTime}`;
  try {
    await insertAgentBrief({
      type: "floor_brief",
      title,
      body,
      severity: stats.overdue > 0 ? "warning" : "info",
      source: "rocco",
      metadata: JSON.stringify({
        channel: "alts_floor_sweep",
        stats: {
          open: stats.open,
          ready: stats.ready,
          dueToday: stats.dueToday,
          overdue: stats.overdue,
          outForDelivery: stats.outForDelivery,
          openInvoices: stats.openInvoices,
        },
        generated_at: new Date().toISOString(),
      }),
    });
  } catch (e: any) {
    console.error("[alts-floor] brief save:", e?.message);
  }

  return {
    brief: {
      title,
      body,
      created_at: new Date().toISOString(),
      source: "rocco",
    },
    stats,
    generated: true,
  };
}

// GET — latest brief + stats (regenerate if stale / ?refresh=1)
altsFloorRouter.get("/floor-brief", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const refresh = c.req.query("refresh") === "1" || c.req.query("refresh") === "true";
  try {
    const result = await runRoccoSweep(refresh);
    return c.json({
      data: {
        brief: result.brief,
        stats: {
          open: result.stats.open,
          ready: result.stats.ready,
          dueToday: result.stats.dueToday,
          overdue: result.stats.overdue,
          outToTailors: result.stats.outToTailors,
          parked: result.stats.parked,
          outForDelivery: result.stats.outForDelivery,
          deliveredToday: result.stats.deliveredToday,
          pendingBoard: result.stats.pendingBoard,
          openInvoices: result.stats.openInvoices,
          openAr: result.stats.openAr,
        },
        generated: result.generated,
      },
    });
  } catch (e: any) {
    console.error("[alts-floor] GET failed:", e?.message);
    return c.json({ error: { message: e?.message ?? "Floor brief failed" } }, 502);
  }
});

// POST — force full sweep (cron + manual)
altsFloorRouter.post("/floor-brief/sweep", async (c) => {
  // Allow service token OR authed staff
  const user = await getAuthedUser(c);
  const cronSecret = c.req.header("x-cron-secret") || c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const okCron =
    !!process.env.CRON_SECRET &&
    cronSecret === process.env.CRON_SECRET;
  if (!user && !okCron) {
    return c.json({ error: { message: "Unauthorized" } }, 401);
  }

  try {
    const result = await runRoccoSweep(true);
    return c.json({
      data: {
        brief: result.brief,
        stats: {
          open: result.stats.open,
          ready: result.stats.ready,
          dueToday: result.stats.dueToday,
          overdue: result.stats.overdue,
          outToTailors: result.stats.outToTailors,
          parked: result.stats.parked,
          outForDelivery: result.stats.outForDelivery,
          deliveredToday: result.stats.deliveredToday,
          pendingBoard: result.stats.pendingBoard,
          openInvoices: result.stats.openInvoices,
          openAr: result.stats.openAr,
        },
        generated: true,
      },
    });
  } catch (e: any) {
    console.error("[alts-floor] sweep failed:", e?.message);
    return c.json({ error: { message: e?.message ?? "Sweep failed" } }, 502);
  }
});
