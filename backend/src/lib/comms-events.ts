/**
 * Phase 1 — unified comms_events feed (ERP-backed).
 * One shape for hub UI, TileOS, and Sofia brain.
 */
import { erpGet, erpList } from "./erp";
import {
  listCallLogs,
  listPlaudCaptures,
  listSmsMessagesFiltered,
} from "./erpnext/agents";
import { normalizePhoneDigits } from "./identity-resolve";

export type CommsSourceType = "sms" | "call" | "plaud";

export type CommsEvent = {
  id: string;
  source_type: CommsSourceType;
  occurred_at: string;
  erpnext_customer_id: string | null;
  customer_name?: string | null;
  phone?: string | null;
  direction?: string | null;
  summary: string;
  /** Full body/transcript — may be stripped for non-manager roles */
  body?: string | null;
  status?: string | null;
  duration_sec?: number | null;
  has_recording?: boolean;
  match_method?: string | null;
  match_confidence?: number | null;
  raw_ref: { doctype: string; name: string };
};

export type CommsEventsResult = {
  customer: { id: string; name: string; mobile_no?: string | null } | null;
  events: CommsEvent[];
  counts: Record<CommsSourceType | "all", number>;
  sources: CommsSourceType[];
  sensitive_redacted: boolean;
};

const MANAGER_ROLES = new Set(["super_admin", "store_manager"]);

export function canViewSensitiveComms(role: string | undefined | null): boolean {
  return !!role && MANAGER_ROLES.has(role);
}

function clip(s: string | null | undefined, n = 160): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

async function loadCustomer(customerId: string) {
  try {
    const row = await erpGet<any>("Customer", customerId);
    if (!row) return null;
    return {
      id: row.name as string,
      name: (row.customer_name || row.name) as string,
      mobile_no: (row.mobile_no || null) as string | null,
    };
  } catch {
    return null;
  }
}

/** Resolve customer id from phone if only phone given. */
export async function resolveCustomerId(opts: {
  customer?: string | null;
  phone?: string | null;
}): Promise<string | null> {
  if (opts.customer) return opts.customer;
  const d = normalizePhoneDigits(opts.phone);
  if (!d) return null;
  const rows = await erpList<any>("Customer", {
    filters: [
      ["disabled", "=", 0],
      ["mobile_no", "like", `%${d}%`],
    ],
    fields: ["name", "mobile_no"],
    limit: 25,
  }).catch(() => []);
  const hit = (rows || []).find((r) => normalizePhoneDigits(r.mobile_no) === d);
  return hit?.name ?? null;
}

/**
 * Build unified events for one customer (and/or phone).
 * SMS: by customer link OR client_phone match on customer's mobile.
 * Calls: by customer link (Phase 0 backfill).
 * Plaud: by customer link when set.
 */
export async function getCommsEvents(opts: {
  customer?: string | null;
  phone?: string | null;
  source?: string | null; // sms|call|plaud|all
  limit?: number;
  since?: string | null;
  role?: string | null;
}): Promise<CommsEventsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  const sourcesAll: CommsSourceType[] = ["sms", "call", "plaud"];
  const want = String(opts.source || "all").toLowerCase();
  const sources = want === "all" || !want
    ? sourcesAll
    : sourcesAll.filter((s) => s === want || (want === "recording" && s === "plaud"));

  const customerId =
    opts.customer ||
    (await resolveCustomerId({ customer: opts.customer, phone: opts.phone }));
  const customer = customerId ? await loadCustomer(customerId) : null;
  const phoneDigits =
    normalizePhoneDigits(opts.phone) ||
    normalizePhoneDigits(customer?.mobile_no) ||
    null;

  const sensitiveOk = canViewSensitiveComms(opts.role);
  const per = Math.ceil(limit / Math.max(sources.length, 1)) + 20;

  const tasks: Promise<CommsEvent[]>[] = [];

  if (sources.includes("sms")) {
    tasks.push(
      (async () => {
        const byCust = customerId
          ? await listSmsMessagesFiltered({
              customer: customerId,
              limit: per,
              ascending: false,
            })
          : [];
        // Also phone path — many SMS rows lack customer link
        let byPhone: any[] = [];
        if (phoneDigits) {
          // client_phone formats vary — pull recent and filter digits
          const loose = await listSmsMessagesFiltered({ limit: Math.min(per * 3, 200) });
          byPhone = loose.filter(
            (m) => normalizePhoneDigits(m.client_phone) === phoneDigits,
          );
        } else if (opts.phone) {
          byPhone = await listSmsMessagesFiltered({ phone: opts.phone, limit: per });
        }
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const m of [...byCust, ...byPhone]) {
          if (!m?.name || seen.has(m.name)) continue;
          seen.add(m.name);
          merged.push(m);
        }
        return merged.map((m): CommsEvent => ({
          id: `sms:${m.name}`,
          source_type: "sms",
          occurred_at: m.timestamp || m.creation || m.modified,
          erpnext_customer_id: m.customer || customerId || null,
          customer_name: m.client_name || customer?.name || null,
          phone: m.client_phone || null,
          direction: m.direction || null,
          summary: clip(m.content || m.body, 200),
          body: sensitiveOk ? (m.content || m.body || null) : clip(m.content || m.body, 200),
          status: m.status || null,
          raw_ref: { doctype: "LSH SMS Message", name: m.name },
        }));
      })(),
    );
  }

  if (sources.includes("call")) {
    tasks.push(
      (async () => {
        const rows = customerId
          ? await listCallLogs({ customer: customerId, limit: per, since: opts.since || undefined })
          : phoneDigits
            ? (await listCallLogs({ limit: Math.min(per * 5, 250), since: opts.since || undefined })).filter(
                (c) =>
                  normalizePhoneDigits(c.from) === phoneDigits ||
                  normalizePhoneDigits(c.to) === phoneDigits,
              )
            : [];
        return rows.map((c): CommsEvent => {
          const body = c.transcript_whisper || c.transcript_raw || null;
          return {
            id: `call:${c.name}`,
            source_type: "call",
            occurred_at: c.time || c.creation,
            erpnext_customer_id: c.customer || customerId || null,
            customer_name: c.from_caller_name || customer?.name || null,
            phone: c.direction === "out" ? c.to : c.from,
            direction: c.direction || null,
            summary: clip(
              body ||
                `${c.direction || "call"} ${c.status || ""} ${c.from_caller_name || c.from || ""}`.trim(),
              200,
            ),
            body: sensitiveOk ? body : body ? clip(body, 120) : null,
            status: c.status || null,
            duration_sec: c.duration ?? null,
            has_recording: !!(c.recording && String(c.recording) !== "0"),
            match_method: c.match_method || null,
            match_confidence: c.match_confidence ?? null,
            raw_ref: { doctype: "LSH Call Log", name: c.name },
          };
        });
      })(),
    );
  }

  if (sources.includes("plaud")) {
    tasks.push(
      (async () => {
        const rows = customerId
          ? await listPlaudCaptures({ customer: customerId, limit: per, since: opts.since || undefined })
          : [];
        return rows.map((r): CommsEvent => {
          const body = r.summary || r.transcript || null;
          return {
            id: `plaud:${r.name}`,
            source_type: "plaud",
            occurred_at: r.recorded_at || r.creation,
            erpnext_customer_id: r.customer || customerId || null,
            customer_name: customer?.name || null,
            phone: null,
            direction: null,
            summary: clip(r.title || body, 200) || "Plaud capture",
            body: sensitiveOk ? body : body ? clip(body, 120) : null,
            status: r.status || null,
            duration_sec: r.duration_sec ?? null,
            has_recording: true,
            raw_ref: { doctype: "LSH Plaud Capture", name: r.name },
          };
        });
      })(),
    );
  }

  const parts = await Promise.all(tasks);
  let events = parts.flat().filter((e) => e.occurred_at);
  events.sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );
  if (opts.since) {
    const t0 = new Date(opts.since).getTime();
    if (!Number.isNaN(t0)) {
      events = events.filter((e) => new Date(e.occurred_at).getTime() >= t0);
    }
  }
  events = events.slice(0, limit);

  const counts = {
    sms: events.filter((e) => e.source_type === "sms").length,
    call: events.filter((e) => e.source_type === "call").length,
    plaud: events.filter((e) => e.source_type === "plaud").length,
    all: events.length,
  };

  return {
    customer,
    events,
    counts,
    sources,
    sensitive_redacted: !sensitiveOk,
  };
}
