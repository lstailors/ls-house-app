// One-call client snapshot for Sofia.
//
// Answering "where's my jacket?" used to cost her lookup_customer ->
// get_customer_tickets -> get_fitting_history -> check_invoice_status, four
// sequential model turns before she can say anything. Over SMS that is the
// difference between a reply that feels instant and one that feels broken.
//
// This gathers the same ground in a single round trip. Every section is
// independently guarded: a slow or broken subsystem degrades that one field to
// null instead of failing the whole answer, because a partial reply beats a
// timeout.

import { erpList } from "../erp";
import { DT } from "../erpnext/doctypes";

export type ClientSnapshot = {
  found: boolean;
  phone: string;
  customer: {
    id: string;
    name: string;
    preferred_name: string | null;
    first_name: string | null;
    group: string | null;
    vip: boolean;
    notes: string | null;
    preferred_contact: string | null;
  } | null;
  open_tickets: Array<{
    name: string;
    state: string | null;
    due_date: string | null;
    total: number | null;
  }>;
  next_appointment: {
    start_time: string | null;
    event_type: string | null;
    status: string | null;
  } | null;
  balance: { outstanding: number; invoices: number } | null;
  last_contact: { direction: string | null; at: string | null; preview: string | null } | null;
  /** Pre-rendered one-paragraph brief. Sofia can read from this alone. */
  summary: string;
};

function last10(phone: unknown): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-10);
}

function normalize(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Phone match on the last 10 digits.
 *
 * findCustomerByPhone() does an exact string compare on mobile_no, which misses
 * the same person constantly — ERP holds "6319260917" on one record and
 * "+13472911638" on another. Last-10 is the only comparison that reliably
 * finds a client from an inbound caller ID.
 */
async function findCustomerByPhoneLoose(phone: string): Promise<any | null> {
  const target = last10(phone);
  if (target.length !== 10) return null;

  const rows = await erpList<any>("Customer", {
    fields: [
      "name",
      "customer_name",
      "customer_type",
      "preferred_name",
      "first_name",
      "customer_group",
      "mobile_no",
      "vip_flag",
      "custom_client_notes",
      "preferred_contact",
      "modified",
    ],
    // ERP stores numbers as contiguous digit runs ("6319260917", "+13472911638"),
    // so a substring match narrows the set cheaply. The last-10 compare below is
    // what actually decides — this is only a prefilter.
    or_filters: [
      ["mobile_no", "like", `%${target}%`],
      ["mobile_no", "like", `%${target.slice(3)}%`],
    ],
    limit: 50,
  }).catch(() => [] as any[]);

  const matches = (rows ?? []).filter((r: any) => last10(r.mobile_no) === target);
  if (!matches.length) return null;

  // A number can sit on more than one record — Carl's 347 line is on both his
  // personal record and "L & S TAILORS". Answering a client as the company
  // account would be wrong every time, so prefer a real person, then the most
  // recently touched record.
  const people = matches.filter((r: any) => String(r.customer_type ?? "") === "Individual");
  const pool = people.length ? people : matches;
  return pool.sort((a: any, b: any) => String(b.modified ?? "").localeCompare(String(a.modified ?? "")))[0] ?? null;
}

async function openTicketsFor(phone: string, customerId: string | null) {
  const target = last10(phone);
  // grand_total is blocked by field-level permissions on Alteration Ticket —
  // including it makes Frappe reject the whole query ("Field not permitted in
  // query"), which is why the older ticket lookup returns nothing. Money for
  // the snapshot comes from Sales Invoice instead.
  const rows = await erpList<any>("Alteration Ticket", {
    fields: ["name", "customer", "customer_phone", "workflow_state", "due_date", "modified"],
    order_by: "modified desc",
    limit: 40,
  }).catch(() => [] as any[]);

  return (rows ?? [])
    .filter((t: any) => (customerId && t.customer === customerId) || last10(t.customer_phone) === target)
    .filter((t: any) => !/^(picked up|delivered|cancelled|closed)$/i.test(String(t.workflow_state ?? "")))
    .slice(0, 5)
    .map((t: any) => ({
      name: String(t.name),
      state: t.workflow_state ?? null,
      due_date: t.due_date ?? null,
      total: null,
    }));
}

/**
 * Appointments come from ERPNext's core `Appointment` doctype.
 *
 * Note this deliberately does NOT use DT.APPOINTMENT — that constant points at
 * "LSH Appointment", which does not exist on erp.lstailors.com. Every caller of
 * DT.APPOINTMENT is silently reading an empty list (see the report accompanying
 * this change); this function reads the doctype that actually holds the data.
 */
async function nextAppointmentFor(phone: string) {
  const target = last10(phone);
  const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");
  const rows = await erpList<any>("Appointment", {
    fields: ["name", "customer_phone_number", "scheduled_time", "status", "customer_name"],
    filters: [["scheduled_time", ">=", nowIso]],
    order_by: "scheduled_time asc",
    limit: 100,
  }).catch(() => [] as any[]);

  const hit = (rows ?? []).find(
    (a: any) =>
      last10(a.customer_phone_number) === target &&
      !/^(cancelled|closed)$/i.test(String(a.status ?? "")),
  );
  if (!hit) return null;
  return {
    start_time: hit.scheduled_time ?? null,
    event_type: null,
    status: hit.status ?? null,
  };
}

async function balanceFor(customerId: string | null) {
  if (!customerId) return null;
  const rows = await erpList<any>("Sales Invoice", {
    fields: ["name", "outstanding_amount"],
    filters: [
      ["customer", "=", customerId],
      ["docstatus", "=", 1],
      ["outstanding_amount", ">", 0],
    ],
    limit: 50,
  }).catch(() => null);
  if (!rows) return null;

  const outstanding = rows.reduce((sum: number, r: any) => sum + Number(r.outstanding_amount ?? 0), 0);
  return { outstanding: Math.round(outstanding * 100) / 100, invoices: rows.length };
}

async function lastContactFor(phone: string) {
  const normalized = normalize(phone);
  const rows = await erpList<any>(DT.SMS_MESSAGE, {
    fields: ["name", "client_phone", "direction", "content", "timestamp"],
    filters: [["client_phone", "=", normalized]],
    order_by: "timestamp desc",
    limit: 1,
  }).catch(() => [] as any[]);

  const hit = (rows ?? [])[0];
  if (!hit) return null;
  return {
    direction: hit.direction ?? null,
    at: hit.timestamp ?? null,
    preview: String(hit.content ?? "").slice(0, 120) || null,
  };
}

function buildSummary(s: Omit<ClientSnapshot, "summary">): string {
  if (!s.found || !s.customer) {
    return `No client record matches ${s.phone}. Treat as a new caller.`;
  }

  const c = s.customer;
  const who = c.preferred_name || c.first_name || c.name;
  const parts: string[] = [`${who}${c.vip ? " (VIP)" : ""}${c.group ? ` · ${c.group}` : ""}.`];

  if (s.open_tickets.length) {
    const t = s.open_tickets
      .map((x) => `${x.name} (${x.state ?? "unknown"}${x.due_date ? `, due ${x.due_date}` : ""})`)
      .join("; ");
    parts.push(`${s.open_tickets.length} open ticket${s.open_tickets.length > 1 ? "s" : ""}: ${t}.`);
  } else {
    parts.push("No open alteration tickets.");
  }

  if (s.next_appointment?.start_time) {
    parts.push(`Next appointment ${s.next_appointment.start_time}${s.next_appointment.event_type ? ` (${s.next_appointment.event_type})` : ""}.`);
  }

  if (s.balance && s.balance.outstanding > 0) {
    parts.push(`Outstanding balance $${s.balance.outstanding} across ${s.balance.invoices} invoice(s).`);
  }

  if (c.notes) parts.push(`Notes: ${c.notes}`);

  return parts.join(" ");
}

/**
 * Everything Sofia needs about a caller, in one call.
 * Sub-fetches run concurrently — the snapshot costs about as long as its
 * slowest section, not the sum of them.
 */
export async function getClientSnapshot(phone: string): Promise<ClientSnapshot> {
  const normalized = normalize(phone);
  const customer = await findCustomerByPhoneLoose(normalized);
  const customerId = customer?.name ? String(customer.name) : null;

  const [openTickets, nextAppointment, balance, lastContact] = await Promise.all([
    openTicketsFor(normalized, customerId).catch(() => []),
    nextAppointmentFor(normalized).catch(() => null),
    balanceFor(customerId).catch(() => null),
    lastContactFor(normalized).catch(() => null),
  ]);

  const base: Omit<ClientSnapshot, "summary"> = {
    found: Boolean(customer),
    phone: normalized,
    customer: customer
      ? {
          id: String(customer.name),
          name: String(customer.customer_name ?? customer.name),
          preferred_name: customer.preferred_name ?? null,
          first_name: customer.first_name ?? null,
          group: customer.customer_group ?? null,
          vip: Boolean(Number(customer.vip_flag ?? 0)),
          notes: customer.custom_client_notes || null,
          preferred_contact: customer.preferred_contact ?? null,
        }
      : null,
    open_tickets: openTickets,
    next_appointment: nextAppointment,
    balance,
    last_contact: lastContact,
  };

  return { ...base, summary: buildSummary(base) };
}
