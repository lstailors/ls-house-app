/**
 * Sofia Bridge — internal API for the Python voice/SMS Sofia on Mac Studio.
 * Provides unified customer context and ops summaries from all house app data sources.
 * Protected by SOFIA_BRIDGE_KEY header.
 */

import { Hono } from "hono";
import { erpList } from "../lib/erp";
import { findCustomerByPhone } from "../lib/erpnext/customers";
import { storeList, storeFindOne, storeInsert } from "../lib/erpnext/store";
import { DT } from "../lib/erpnext/doctypes";
import { listSmsMessagesFiltered, insertSmsMessage } from "../lib/erpnext/agents";

export const sofiaBridgeRouter = new Hono();

function authGuard(key: string | null): boolean {
  const expected = process.env.SOFIA_BRIDGE_KEY;
  if (!expected) return true;
  return key === expected;
}

function fmtNYC(iso: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function normalizePhone(p: string): string {
  const digits = String(p ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function mapClient(row: any) {
  return {
    id: row.name,
    first_name: row.first_name ?? row.customer_name?.split(" ")[0] ?? "",
    last_name: row.last_name ?? row.customer_name?.split(" ").slice(1).join(" ") ?? "",
    phone: row.mobile_no,
    email: row.email_id,
    is_vip: row.custom_vip_tier && row.custom_vip_tier !== "Standard",
    created_at: row.creation,
  };
}

async function findClientByPhone(phone: string, bare: string) {
  let row = await findCustomerByPhone(phone);
  if (!row) row = await findCustomerByPhone(`+1${bare}`);
  if (!row) {
    const rows = await erpList<any>("Customer", {
      filters: [["mobile_no", "like", `%${bare.slice(-10)}%`]],
      fields: ["name", "customer_name", "first_name", "last_name", "mobile_no", "email_id", "custom_vip_tier", "creation"],
      limit: 1,
    });
    row = rows[0] ?? null;
  }
  return row ? mapClient(row) : null;
}

sofiaBridgeRouter.get("/context", async (c) => {
  const key = c.req.header("x-sofia-bridge-key") ?? c.req.query("key") ?? null;
  if (!authGuard(key)) return c.json({ error: "Unauthorized" }, 401);

  const rawPhone = c.req.query("phone") ?? "";
  const phone = normalizePhone(rawPhone);
  if (!phone) return c.json({ error: "phone required" }, 400);

  const bare = phone.replace(/^\+1/, "");
  const client = await findClientByPhone(phone, bare);

  const [appts, sms, ordersRes] = await Promise.all([
    storeList<any>(DT.APPOINTMENT, {
      filters: [["client_phone", "in", [phone, bare, `+1${bare}`]]],
      fields: ["name", "event_type", "status", "start_time", "end_time", "assigned_tailor", "client_name", "notes"],
      orderBy: "start_time desc",
      limit: 10,
    }),
    listSmsMessagesFiltered({ phone, limit: 8 }),
    client
      ? storeList<any>(DT.GEELUS_TRANSACTION, {
          filters: [["customer", "=", client.id], ["customer_facing_stage", "not in", ["collected", "completed", "cancelled"]]],
          fields: ["name", "geelus_transaction_id", "total", "customer_facing_stage", "due_date", "line_items"],
          orderBy: "modified desc",
          limit: 5,
        })
      : Promise.resolve([]),
  ]);

  let dossier: any = null;
  let observations: any[] = [];
  if (client?.id) {
    dossier = await storeFindOne(DT.CUSTOMER_DOSSIER, "customer", client.id);
    observations = await storeList<any>(DT.DOSSIER_OBSERVATION, {
      filters: [["customer", "=", client.id]],
      fields: ["observation_type", "content", "importance", "creation"],
      orderBy: "importance desc",
      limit: 15,
    });
  }

  const sections: string[] = [];
  const now = new Date().toISOString();

  if (client) {
    const vip = client.is_vip ? " [VIP]" : "";
    sections.push(`HOUSE APP CUSTOMER: ${client.first_name} ${client.last_name}${vip} | ${client.email ?? ""} | Member since ${new Date(client.created_at).getFullYear()}`);
  } else {
    sections.push("HOUSE APP: No matching customer record in app.lstailors.com");
  }

  if (appts.length) {
    const upcoming = appts.filter((a) => a.start_time >= now).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const past = appts.filter((a) => a.start_time < now);
    if (upcoming.length) {
      sections.push("UPCOMING APPOINTMENTS:\n" + upcoming.map((a) => `  • ${fmtNYC(a.start_time)} — ${a.event_type} [${a.status}]${a.notes ? ` — "${a.notes}"` : ""}`).join("\n"));
    }
    if (past.length) {
      sections.push("PAST APPOINTMENTS:\n" + past.slice(0, 5).map((a) => `  • ${fmtNYC(a.start_time)} — ${a.event_type} [${a.status}]`).join("\n"));
    }
  }

  if (ordersRes.length) {
    sections.push("ACTIVE GEELUS ORDERS:\n" + ordersRes.map((o: any) => {
      const items = Array.isArray(o.line_items) ? o.line_items.map((i: any) => i.description ?? i.item_name ?? "").filter(Boolean).join(", ") : "";
      return `  • ${o.geelus_transaction_id ?? o.name} | Stage: ${o.customer_facing_stage} | Due: ${o.due_date ?? "TBD"} | $${Number(o.total ?? 0).toFixed(0)}${items ? ` | ${items}` : ""}`;
    }).join("\n"));
  }

  if (dossier) {
    const parts: string[] = [];
    if (dossier.fit_profile) parts.push(`Fit: ${dossier.fit_profile}`);
    if (dossier.style_notes) parts.push(`Style: ${dossier.style_notes}`);
    if (dossier.preferences) parts.push(`Preferences: ${dossier.preferences}`);
    if (parts.length) sections.push("CLIENT DOSSIER:\n" + parts.map((p) => `  ${p}`).join("\n"));
  }

  if (observations.length) {
    sections.push("DOSSIER OBSERVATIONS:\n" + observations.map((o) => `  [${o.observation_type}] ${o.content}`).join("\n"));
  }

  const smsSorted = [...sms].reverse();
  if (smsSorted.length) {
    sections.push("RECENT SMS THREAD (oldest first):\n" + smsSorted.map((m: any) => `  ${m.direction === "inbound" ? "CLIENT" : "SOFIA"}: ${String(m.content ?? "").slice(0, 120)}`).join("\n"));
  }

  return c.json({ data: { phone, customer: client ? { id: client.id, name: `${client.first_name} ${client.last_name}`, is_vip: client.is_vip } : null, context_block: sections.join("\n\n") } });
});

sofiaBridgeRouter.get("/summary", async (c) => {
  const key = c.req.header("x-sofia-bridge-key") ?? c.req.query("key") ?? null;
  if (!authGuard(key)) return c.json({ error: "Unauthorized" }, 401);

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const [apptsToday, smsData, altOpen, altReady, altOverdue, deliveries] = await Promise.all([
    storeList<any>(DT.APPOINTMENT, {
      filters: [["start_time", ">=", `${today}T00:00:00Z`], ["start_time", "<=", `${today}T23:59:59Z`], ["status", "in", ["confirmed", "pending"]]],
      fields: ["name", "event_type", "status", "start_time", "client_name", "client_phone", "assigned_tailor"],
      orderBy: "start_time asc",
      limit: 50,
    }),
    listSmsMessagesFiltered({ limit: 200 }),
    erpList<any>("Alteration Ticket", { filters: [["workflow_state", "in", ["Received", "In Progress"]]], fields: ["name", "workflow_state", "customer_name", "due_date"], limit: 50 }).catch(() => []),
    erpList<any>("Alteration Ticket", { filters: [["workflow_state", "=", "Ready"]], fields: ["name", "customer_name"], limit: 50 }).catch(() => []),
    erpList<any>("Alteration Ticket", { filters: [["workflow_state", "in", ["Received", "In Progress"]], ["due_date", "<", today]], fields: ["name", "customer_name", "due_date"], limit: 20 }).catch(() => []),
    erpList<any>("LSH Delivery", { filters: [["lsh_status", "in", ["Queued", "Out for Delivery", "Ready for Pickup"]]], fields: ["name", "customer_name", "lsh_status"], limit: 30 }).catch(() => []),
  ]);

  const lastByPhone = new Map<string, string>();
  for (const m of smsData) {
    if (!lastByPhone.has(m.client_phone)) lastByPhone.set(m.client_phone, m.direction);
  }
  const unansweredSms = Array.from(lastByPhone.values()).filter((d) => d === "inbound").length;

  const lines: string[] = [];
  if (apptsToday.length) {
    lines.push(`APPOINTMENTS TODAY (${apptsToday.length}):`);
    for (const a of apptsToday) lines.push(`  ${fmtNYC(a.start_time)} — ${a.client_name ?? "Unknown"} — ${a.event_type}${a.assigned_tailor ? ` w/ ${a.assigned_tailor}` : ""}`);
  } else {
    lines.push("APPOINTMENTS TODAY: None scheduled.");
  }

  if (altReady.length) {
    lines.push(`\nALTERATIONS READY FOR PICKUP (${altReady.length}):`);
    for (const t of altReady.slice(0, 8)) lines.push(`  ${t.name} — ${t.customer_name}`);
  }
  if (altOverdue.length) {
    lines.push(`\nOVERDUE ALTERATIONS (${altOverdue.length}):`);
    for (const t of altOverdue.slice(0, 8)) lines.push(`  ${t.name} — ${t.customer_name} (due ${t.due_date})`);
  }
  if (altOpen.length) {
    lines.push(`\nALTERATIONS IN PROGRESS: ${altOpen.length} tickets`);
  }

  const readyForPickup = deliveries.filter((d) => d.lsh_status === "Ready for Pickup");
  const outForDelivery = deliveries.filter((d) => d.lsh_status === "Out for Delivery");
  const queued = deliveries.filter((d) => d.lsh_status === "Queued");
  if (readyForPickup.length) {
    lines.push(`\nREADY FOR PICKUP — DELIVERIES (${readyForPickup.length}):`);
    for (const d of readyForPickup.slice(0, 8)) lines.push(`  ${d.name} — ${d.customer_name}`);
  }
  if (outForDelivery.length) lines.push(`\nOUT FOR DELIVERY: ${outForDelivery.length} deliveries`);
  if (queued.length) lines.push(`QUEUED FOR DELIVERY: ${queued.length} deliveries`);
  if (unansweredSms > 0) lines.push(`\nUNANSWERED SMS THREADS: ${unansweredSms} client threads awaiting reply`);

  return c.json({
    data: {
      as_of: now,
      appointments_today: apptsToday.length,
      alterations: { open: altOpen.length, ready: altReady.length, overdue: altOverdue.length },
      deliveries: { ready_for_pickup: readyForPickup.length, out_for_delivery: outForDelivery.length, queued: queued.length },
      unanswered_sms: unansweredSms,
      summary_text: lines.join("\n"),
    },
  });
});

sofiaBridgeRouter.post("/event", async (c) => {
  const key = c.req.header("x-sofia-bridge-key") ?? null;
  if (!authGuard(key)) return c.json({ error: "Unauthorized" }, 401);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }

  const { event_type, phone, customer_name, data: eventData } = body;

  if (phone) {
    try {
      await insertSmsMessage({
        client_phone: normalizePhone(phone),
        direction: "outbound",
        content: `[Sofia Voice Event: ${event_type}] ${JSON.stringify(eventData ?? {}).slice(0, 300)}`,
        timestamp: new Date().toISOString(),
        metadata: JSON.stringify({ source: "sofia_voice", event_type, customer_name }),
      });
    } catch { /* non-fatal */ }
  }

  if (event_type === "customer_note" && phone && eventData?.note) {
    const norm = normalizePhone(phone);
    const bare = norm.replace(/^\+1/, "");
    const client = await findClientByPhone(norm, bare);
    if (client?.id) {
      const dossier = await storeFindOne(DT.CUSTOMER_DOSSIER, "customer", client.id);
      if (dossier) {
        try {
          await storeInsert(DT.DOSSIER_OBSERVATION, {
            dossier: (dossier as any).name,
            customer: client.id,
            observation_type: eventData.observation_type ?? "context",
            content: String(eventData.note).slice(0, 500),
            source_channel: "voice",
            importance: eventData.importance ?? 5,
            is_significant: (eventData.importance ?? 5) >= 7 ? 1 : 0,
          });
        } catch { /* non-fatal */ }
      }
    }
  }

  return c.json({ data: { ok: true, event_type } });
});
