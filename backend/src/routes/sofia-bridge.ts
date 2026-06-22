/**
 * Sofia Bridge — internal API for the Python voice/SMS Sofia on Mac Studio.
 * Provides unified customer context and ops summaries from all house app data sources.
 * Protected by SOFIA_BRIDGE_KEY header.
 */

import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { erpList } from "../lib/erp";

export const sofiaBridgeRouter = new Hono();

function authGuard(key: string | null): boolean {
  const expected = process.env.SOFIA_BRIDGE_KEY;
  if (!expected) return true; // not configured = open (dev)
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

// ── GET /api/sofia-bridge/context?phone=+12125551234 ────────────────────────
// Returns a rich text block Sofia can inject into the caller memory section.
sofiaBridgeRouter.get("/context", async (c) => {
  const key = c.req.header("x-sofia-bridge-key") ?? c.req.query("key") ?? null;
  if (!authGuard(key)) return c.json({ error: "Unauthorized" }, 401);

  const rawPhone = c.req.query("phone") ?? "";
  const phone = normalizePhone(rawPhone);
  if (!phone) return c.json({ error: "phone required" }, 400);

  const sb = supabaseAdmin;
  if (!sb) return c.json({ error: "Supabase unavailable" }, 503);

  const bare = phone.replace(/^\+1/, "");

  // Run all lookups concurrently
  const [clientRes, apptRes, dossierRes, obsRes, smsRes, ordersRes] = await Promise.all([
    sb.from("clients").select("id,first_name,last_name,phone,email,is_vip,created_at").or(`phone.eq.${phone},phone.eq.${bare},phone.eq.+1${bare}`).limit(1),
    sb.from("appointments").select("id,event_type,status,start_time,end_time,assigned_tailor,client_name,notes").or(`client_phone.eq.${phone},client_phone.eq.${bare},client_phone.eq.+1${bare}`).order("start_time", { ascending: false }).limit(10),
    sb.from("customer_dossiers").select("id,fit_profile,style_notes,preferences,last_significant_update").eq("customer_id", "").maybeSingle(), // will re-run with real id
    Promise.resolve({ data: [] as any[] }),
    sb.from("sms_messages").select("direction,content,timestamp").or(`client_phone.eq.${phone},client_phone.eq.${bare},client_phone.eq.+1${bare}`).order("timestamp", { ascending: false }).limit(8),
    sb.from("geelus_transactions").select("geelus_transaction_id,total,customer_facing_stage,due_date,line_items").not("customer_facing_stage", "in", '("collected","completed","cancelled")').order("updated_at", { ascending: false }).limit(5),
  ]);

  const client = clientRes.data?.[0] ?? null;

  // Fetch dossier + observations with real customer id
  let dossier: any = null;
  let observations: any[] = [];
  if (client?.id) {
    const [dosRes, obsRes2] = await Promise.all([
      sb.from("customer_dossiers").select("id,fit_profile,style_notes,preferences,last_significant_update").eq("customer_id", client.id).maybeSingle(),
      sb.from("dossier_observations").select("observation_type,content,importance,created_at").eq("customer_id", client.id).order("importance", { ascending: false }).order("created_at", { ascending: false }).limit(15),
    ]);
    dossier = dosRes.data ?? null;
    observations = obsRes2.data ?? [];

    // Also filter geelus orders to this customer
    const { data: custOrders } = await sb
      .from("geelus_transactions")
      .select("geelus_transaction_id,total,customer_facing_stage,due_date,line_items")
      .eq("customer_id", client.id)
      .not("customer_facing_stage", "in", '("collected","completed","cancelled")')
      .order("updated_at", { ascending: false })
      .limit(5);
    if (custOrders?.length) (ordersRes as any).data = custOrders;
  }

  const sections: string[] = [];
  const now = new Date().toISOString();

  // ── Identity ──
  if (client) {
    const vip = client.is_vip ? " [VIP]" : "";
    sections.push(`HOUSE APP CUSTOMER: ${client.first_name} ${client.last_name}${vip} | ${client.email ?? ""} | Member since ${new Date(client.created_at).getFullYear()}`);
  } else {
    sections.push("HOUSE APP: No matching customer record in app.lstailors.com");
  }

  // ── Appointments (Frappe + Google Calendar) ──
  const appts = apptRes.data ?? [];
  if (appts.length) {
    const upcoming = appts.filter((a) => a.start_time >= now).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const past = appts.filter((a) => a.start_time < now);
    if (upcoming.length) {
      const lines = upcoming.map((a) => `  • ${fmtNYC(a.start_time)} — ${a.event_type} [${a.status}]${a.notes ? ` — "${a.notes}"` : ""}`);
      sections.push("UPCOMING APPOINTMENTS:\n" + lines.join("\n"));
    }
    if (past.length) {
      const lines = past.slice(0, 5).map((a) => `  • ${fmtNYC(a.start_time)} — ${a.event_type} [${a.status}]`);
      sections.push("PAST APPOINTMENTS:\n" + lines.join("\n"));
    }
  }

  // ── Geelus Orders ──
  const orders = (ordersRes as any).data ?? [];
  if (orders.length) {
    const lines = orders.map((o: any) => {
      const items = Array.isArray(o.line_items) ? o.line_items.map((i: any) => i.description ?? i.item_name ?? "").filter(Boolean).join(", ") : "";
      return `  • ${o.geelus_transaction_id} | Stage: ${o.customer_facing_stage} | Due: ${o.due_date ?? "TBD"} | $${Number(o.total ?? 0).toFixed(0)}${items ? ` | ${items}` : ""}`;
    });
    sections.push("ACTIVE GEELUS ORDERS:\n" + lines.join("\n"));
  }

  // ── Dossier ──
  if (dossier) {
    const parts: string[] = [];
    if (dossier.fit_profile) parts.push(`Fit: ${dossier.fit_profile}`);
    if (dossier.style_notes) parts.push(`Style: ${dossier.style_notes}`);
    if (dossier.preferences) parts.push(`Preferences: ${dossier.preferences}`);
    if (parts.length) sections.push("CLIENT DOSSIER:\n" + parts.map((p) => `  ${p}`).join("\n"));
  }

  if (observations.length) {
    const lines = observations.map((o) => `  [${o.observation_type}] ${o.content}`);
    sections.push("DOSSIER OBSERVATIONS:\n" + lines.join("\n"));
  }

  // ── Recent SMS history ──
  const sms = (smsRes.data ?? []).reverse(); // oldest first
  if (sms.length) {
    const lines = sms.map((m: any) => `  ${m.direction === "inbound" ? "CLIENT" : "SOFIA"}: ${String(m.content ?? "").slice(0, 120)}`);
    sections.push("RECENT SMS THREAD (oldest first):\n" + lines.join("\n"));
  }

  const text = sections.join("\n\n");
  return c.json({ data: { phone, customer: client ? { id: client.id, name: `${client.first_name} ${client.last_name}`, is_vip: client.is_vip } : null, context_block: text } });
});

// ── GET /api/sofia-bridge/summary ───────────────────────────────────────────
// Returns a structured ops snapshot for briefings and staff queries.
sofiaBridgeRouter.get("/summary", async (c) => {
  const key = c.req.header("x-sofia-bridge-key") ?? c.req.query("key") ?? null;
  if (!authGuard(key)) return c.json({ error: "Unauthorized" }, 401);

  const sb = supabaseAdmin;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // ── Supabase: appointments today ──
  const apptsTodayProm = sb
    ? sb.from("appointments").select("id,event_type,status,start_time,client_name,client_phone,assigned_tailor")
        .gte("start_time", `${today}T00:00:00Z`)
        .lte("start_time", `${today}T23:59:59Z`)
        .in("status", ["confirmed", "pending"])
        .order("start_time", { ascending: true })
    : Promise.resolve({ data: [] as any[] });

  // ── Supabase: unanswered SMS ──
  const smsProm = sb
    ? sb.from("sms_messages").select("client_phone,direction,timestamp").order("timestamp", { ascending: false }).limit(200)
    : Promise.resolve({ data: [] as any[] });

  // ── ERPNext: alteration board ──
  const altOpenProm = erpList<{ name: string; workflow_state: string; customer_name: string; due_date: string }>("Alteration Ticket", {
    filters: [["workflow_state", "in", ["Received", "In Progress"]]],
    fields: ["name", "workflow_state", "customer_name", "due_date"],
    limit: 50,
  }).catch(() => []);

  const altReadyProm = erpList<{ name: string; customer_name: string }>("Alteration Ticket", {
    filters: [["workflow_state", "=", "Ready"]],
    fields: ["name", "customer_name"],
    limit: 50,
  }).catch(() => []);

  const altOverdueProm = erpList<{ name: string; customer_name: string; due_date: string }>("Alteration Ticket", {
    filters: [["workflow_state", "in", ["Received", "In Progress"]], ["due_date", "<", today]],
    fields: ["name", "customer_name", "due_date"],
    limit: 20,
  }).catch(() => []);

  // ── ERPNext: deliveries ──
  const deliveriesProm = erpList<{ name: string; customer_name: string; lsh_status: string }>("LSH Delivery", {
    filters: [["lsh_status", "in", ["Queued", "Out for Delivery", "Ready for Pickup"]]],
    fields: ["name", "customer_name", "lsh_status"],
    limit: 30,
  }).catch(() => []);

  const [apptsToday, smsData, altOpen, altReady, altOverdue, deliveries] = await Promise.all([
    apptsTodayProm, smsProm, altOpenProm, altReadyProm, altOverdueProm, deliveriesProm,
  ]);

  // Count unanswered SMS threads
  const lastByPhone = new Map<string, string>();
  for (const m of (smsData as any).data ?? []) {
    if (!lastByPhone.has(m.client_phone)) lastByPhone.set(m.client_phone, m.direction);
  }
  const unansweredSms = Array.from(lastByPhone.values()).filter((d) => d === "inbound").length;

  // ── Build text summary ──
  const lines: string[] = [];

  // Appointments today
  const todayAppts = (apptsToday as any).data ?? [];
  if (todayAppts.length) {
    lines.push(`APPOINTMENTS TODAY (${todayAppts.length}):`);
    for (const a of todayAppts) {
      lines.push(`  ${fmtNYC(a.start_time)} — ${a.client_name ?? "Unknown"} — ${a.event_type}${a.assigned_tailor ? ` w/ ${a.assigned_tailor}` : ""}`);
    }
  } else {
    lines.push("APPOINTMENTS TODAY: None scheduled.");
  }

  // Alteration board
  if (altReady.length) {
    lines.push(`\nALTERATIONS READY FOR PICKUP (${altReady.length}):`);
    for (const t of altReady.slice(0, 8)) lines.push(`  ${t.name} — ${(t as any).customer_name}`);
  }
  if (altOverdue.length) {
    lines.push(`\nOVERDUE ALTERATIONS (${altOverdue.length}):`);
    for (const t of altOverdue.slice(0, 8)) lines.push(`  ${t.name} — ${(t as any).customer_name} (due ${(t as any).due_date})`);
  }
  if (altOpen.length) {
    lines.push(`\nALTERATIONS IN PROGRESS: ${altOpen.length} tickets (${altOpen.filter(t => (t as any).workflow_state === "Received").length} received, ${altOpen.filter(t => (t as any).workflow_state === "In Progress").length} in progress)`);
  }

  // Deliveries
  const readyForPickup = deliveries.filter((d) => (d as any).lsh_status === "Ready for Pickup");
  const outForDelivery = deliveries.filter((d) => (d as any).lsh_status === "Out for Delivery");
  const queued = deliveries.filter((d) => (d as any).lsh_status === "Queued");
  if (readyForPickup.length) {
    lines.push(`\nREADY FOR PICKUP — DELIVERIES (${readyForPickup.length}):`);
    for (const d of readyForPickup.slice(0, 8)) lines.push(`  ${d.name} — ${(d as any).customer_name}`);
  }
  if (outForDelivery.length) lines.push(`\nOUT FOR DELIVERY: ${outForDelivery.length} deliveries`);
  if (queued.length) lines.push(`QUEUED FOR DELIVERY: ${queued.length} deliveries`);

  // SMS
  if (unansweredSms > 0) {
    lines.push(`\nUNANSWERED SMS THREADS: ${unansweredSms} client threads awaiting reply`);
  }

  return c.json({
    data: {
      as_of: now,
      appointments_today: todayAppts.length,
      alterations: { open: altOpen.length, ready: altReady.length, overdue: altOverdue.length },
      deliveries: { ready_for_pickup: readyForPickup.length, out_for_delivery: outForDelivery.length, queued: queued.length },
      unanswered_sms: unansweredSms,
      summary_text: lines.join("\n"),
    },
  });
});

// ── POST /api/sofia-bridge/event ────────────────────────────────────────────
// Sofia voice posts events here so the house app stays in sync.
// e.g. new appointment booked via voice, cancellation, customer note
sofiaBridgeRouter.post("/event", async (c) => {
  const key = c.req.header("x-sofia-bridge-key") ?? null;
  if (!authGuard(key)) return c.json({ error: "Unauthorized" }, 401);

  const sb = supabaseAdmin;
  if (!sb) return c.json({ error: "Supabase unavailable" }, 503);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }

  const { event_type, phone, customer_name, data: eventData } = body;

  // Log every Sofia voice event to sms_messages as a system event
  if (phone) {
    try {
      await sb.from("sms_messages").insert({
        client_phone: normalizePhone(phone),
        direction: "outbound",
        content: `[Sofia Voice Event: ${event_type}] ${JSON.stringify(eventData ?? {}).slice(0, 300)}`,
        timestamp: new Date().toISOString(),
        metadata: { source: "sofia_voice", event_type, customer_name },
      });
    } catch { /* non-fatal */ }
  }

  // Specific event handling
  if (event_type === "appointment_booked" && eventData?.appointment_name) {
    // Could sync to appointments table in future
  }

  if (event_type === "customer_note" && phone && eventData?.note) {
    // Find customer and add dossier observation
    const norm = normalizePhone(phone);
    const bare = norm.replace(/^\+1/, "");
    const { data: clients } = await sb.from("clients").select("id").or(`phone.eq.${norm},phone.eq.${bare},phone.eq.+1${bare}`).limit(1);
    const custId = clients?.[0]?.id;
    if (custId) {
      const { data: dossier } = await sb.from("customer_dossiers").select("id").eq("customer_id", custId).maybeSingle();
      if (dossier) {
        try {
          await sb.from("dossier_observations").insert({
            dossier_id: dossier.id,
            customer_id: custId,
            observation_type: eventData.observation_type ?? "context",
            content: String(eventData.note).slice(0, 500),
            source_channel: "voice",
            importance: eventData.importance ?? 5,
            is_significant: (eventData.importance ?? 5) >= 7,
          });
        } catch { /* non-fatal */ }
      }
    }
  }

  return c.json({ data: { ok: true, event_type } });
});
