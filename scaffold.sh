#!/usr/bin/env bash
# scaffold.sh — run from the root of the ls-house repo:  bash scaffold.sh
set -euo pipefail
echo "Placing L&S House files..."

mkdir -p "$(dirname "lib/erpnext/customer.ts")"
cat > "lib/erpnext/customer.ts" <<'LSHOUSE_EOF'
// lib/erpnext/customer.ts
// Fixes the "Request failed with status 500" on customer create/update.
// Customer + Address are two separate ERPNext doctypes with different field
// names (address_line1, pincode) and a Dynamic Link. Write them as two calls.

const ERP_URL = process.env.ERP_URL ?? "https://erp.lstailors.com";
const ERP_KEY = process.env.ERP_API_KEY!;
const ERP_SECRET = process.env.ERP_API_SECRET!;

const authHeaders = {
  Authorization: `token ${ERP_KEY}:${ERP_SECRET}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

async function erpFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ERP_URL}${path}`, { ...init, headers: authHeaders });
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    let msg = body?.exception || body?.message || `ERPNext ${res.status}`;
    try {
      const sm = body?._server_messages ? JSON.parse(body._server_messages) : [];
      if (sm.length) msg = JSON.parse(sm[0])?.message ?? msg;
    } catch {}
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body.data as T;
}

export interface CustomerInput {
  name?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  customerGroup?: string;
  territory?: string;
  address?: { line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string; };
}

function customerPayload(c: CustomerInput) {
  return {
    customer_name: c.fullName,
    customer_type: "Individual",
    customer_group: c.customerGroup ?? "MTM",
    territory: c.territory ?? "United States",
    first_name: c.firstName ?? "",
    last_name: c.lastName ?? "",
    mobile_no: c.phone ?? "",
    email_id: c.email ?? "",
    custom_client_notes: c.notes ?? "",
  };
}

function hasAddress(a?: CustomerInput["address"]) {
  return !!a && !!(a.line1 || a.city || a.state || a.zip);
}

async function findCustomerAddress(customerName: string): Promise<string | null> {
  const filters = encodeURIComponent(JSON.stringify([
    ["Dynamic Link", "link_doctype", "=", "Customer"],
    ["Dynamic Link", "link_name", "=", customerName],
  ]));
  const rows = await erpFetch<Array<{ name: string }>>(
    `/api/resource/Address?filters=${filters}&fields=["name"]&limit_page_length=1`
  );
  return rows?.[0]?.name ?? null;
}

async function upsertAddress(customerName: string, a: NonNullable<CustomerInput["address"]>) {
  const payload = {
    address_title: customerName,
    address_type: "Billing",
    address_line1: a.line1 ?? "",
    address_line2: a.line2 ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
    pincode: a.zip ?? "",
    country: a.country ?? "United States",
    links: [{ link_doctype: "Customer", link_name: customerName }],
  };
  const existing = await findCustomerAddress(customerName);
  if (existing) {
    await erpFetch(`/api/resource/Address/${encodeURIComponent(existing)}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await erpFetch(`/api/resource/Address`, { method: "POST", body: JSON.stringify(payload) });
  }
}

export async function upsertCustomerWithAddress(c: CustomerInput) {
  let customerName = c.name;
  if (customerName) {
    await erpFetch(`/api/resource/Customer/${encodeURIComponent(customerName)}`, { method: "PUT", body: JSON.stringify(customerPayload(c)) });
  } else {
    const created = await erpFetch<{ name: string }>(`/api/resource/Customer`, { method: "POST", body: JSON.stringify(customerPayload(c)) });
    customerName = created.name;
  }
  if (hasAddress(c.address)) { await upsertAddress(customerName!, c.address!); }
  return { name: customerName! };
}
LSHOUSE_EOF
echo "  wrote lib/erpnext/customer.ts"

mkdir -p "$(dirname "app/api/customers/route.ts")"
cat > "app/api/customers/route.ts" <<'LSHOUSE_EOF'
// app/api/customers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { upsertCustomerWithAddress, type CustomerInput } from "@/lib/erpnext/customer";

function parseBody(raw: any): CustomerInput {
  return {
    name: raw.name ?? raw.erpnextName ?? undefined,
    fullName: raw.fullName ?? raw.customerName ?? raw.name_display ?? "",
    firstName: raw.firstName,
    lastName: raw.lastName,
    phone: raw.phone ?? raw.mobile,
    email: raw.email,
    notes: raw.notes,
    customerGroup: raw.customerGroup,
    territory: raw.territory,
    address: raw.address ?? {
      line1: raw.streetLine1, line2: raw.streetLine2, city: raw.city,
      state: raw.state, zip: raw.zip, country: raw.country,
    },
  };
}

async function handle(req: NextRequest) {
  let input: CustomerInput;
  try { input = parseBody(await req.json()); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!input.fullName?.trim()) return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
  try {
    const result = await upsertCustomerWithAddress(input);
    return NextResponse.json({ ok: true, customer: result.name });
  } catch (e: any) {
    const status = e?.status && e.status >= 400 && e.status < 500 ? 422 : 500;
    console.error("[customers] upsert failed:", e?.message, e);
    return NextResponse.json({ error: e?.message ?? "Failed to save customer" }, { status });
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function PUT(req: NextRequest) { return handle(req); }
LSHOUSE_EOF
echo "  wrote app/api/customers/route.ts"

mkdir -p "$(dirname "lib/cart/totals.ts")"
cat > "lib/cart/totals.ts" <<'LSHOUSE_EOF'
// lib/cart/totals.ts  — alterations are $0 tax. Use Fix B (mirror ERPNext invoice).
const TAX_EXEMPT_ITEM_GROUPS = new Set(["Alteration Services"]);
export interface CartLine { itemCode: string; itemGroup: string; rate: number; qty: number; }

export function computeCartTotals(lines: CartLine[], taxRate = 0.08875) {
  let taxableBase = 0, exemptBase = 0;
  for (const l of lines) {
    const amount = l.rate * l.qty;
    if (TAX_EXEMPT_ITEM_GROUPS.has(l.itemGroup)) exemptBase += amount; else taxableBase += amount;
  }
  const subtotal = taxableBase + exemptBase;
  const tax = round2(taxableBase * taxRate);
  return { subtotal: round2(subtotal), tax, total: round2(subtotal + tax), taxableBase, exemptBase };
}

export async function totalsFromErpInvoice(invoiceName: string) {
  const ERP_URL = process.env.ERP_URL ?? "https://erp.lstailors.com";
  const res = await fetch(
    `${ERP_URL}/api/resource/Sales Invoice/${encodeURIComponent(invoiceName)}?fields=["net_total","total_taxes_and_charges","grand_total"]`,
    { headers: { Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`, Accept: "application/json" } }
  );
  const { data } = await res.json();
  return { subtotal: data.net_total, tax: data.total_taxes_and_charges, total: data.grand_total };
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
LSHOUSE_EOF
echo "  wrote lib/cart/totals.ts"

mkdir -p "$(dirname "lib/erpnext/alterations-data.ts")"
cat > "lib/erpnext/alterations-data.ts" <<'LSHOUSE_EOF'
// lib/erpnext/alterations-data.ts — enriched board rows in 3 batched calls. Server-only.
const ERP_URL = process.env.ERP_URL ?? "https://erp.lstailors.com";
const authHeaders = { Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`, Accept: "application/json" };

export type BoardFilter = "all" | "in_progress" | "complete" | "delivered";
const STATE_GROUPS: Record<Exclude<BoardFilter, "all">, string[]> = {
  in_progress: ["Received", "In Progress"],
  complete: ["Ready", "Complete"],
  delivered: ["Delivered"],
};

export interface AlterationRow {
  name: string; customerName: string; location: string; garmentCount: number; garmentSummary: string;
  tailor: string | null; dueDate: string | null; isRush: boolean; status: string;
  paymentStatus: string; price: number; invoice: string | null; deliveryMethod: string | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${ERP_URL}${path}`, { headers: authHeaders, cache: "no-store" });
  if (!res.ok) throw new Error(`ERPNext ${res.status} on ${path}`);
  return (await res.json()).data as T;
}

export async function loadAlterationRows(filter: BoardFilter = "all", location?: string): Promise<AlterationRow[]> {
  const filters: any[] = [];
  if (filter !== "all") filters.push(["workflow_state", "in", STATE_GROUPS[filter]]);
  if (location) filters.push(["origin_location", "=", location]);
  const q = new URLSearchParams({
    fields: JSON.stringify(["name","customer_name","origin_location","due_date","is_rush","workflow_state","payment_status","ticket_total","sales_invoice","delivery_method","assigned_tailor"]),
    filters: JSON.stringify(filters), order_by: "due_date asc", limit_page_length: "0",
  });
  const tickets = await get<any[]>(`/api/resource/Alteration Ticket?${q}`);
  if (!tickets.length) return [];
  const names = tickets.map((t) => t.name);

  const gq = new URLSearchParams({
    parent: "Alteration Ticket", fields: JSON.stringify(["parent","garment_type"]),
    filters: JSON.stringify([["parent","in",names]]), limit_page_length: "0",
  });
  const garments = await get<any[]>(`/api/resource/Alteration Ticket Garment?${gq}`);
  const byTicket = new Map<string, string[]>();
  for (const g of garments) {
    const arr = byTicket.get(g.parent) ?? [];
    if (g.garment_type) arr.push(g.garment_type);
    byTicket.set(g.parent, arr);
  }

  const tailorIds = [...new Set(tickets.map((t) => t.assigned_tailor).filter(Boolean))];
  const tailorMap = new Map<string, string>();
  if (tailorIds.length) {
    const eq = new URLSearchParams({ fields: JSON.stringify(["name","employee_name"]), filters: JSON.stringify([["name","in",tailorIds]]), limit_page_length: "0" });
    const emps = await get<any[]>(`/api/resource/Employee?${eq}`);
    emps.forEach((e) => tailorMap.set(e.name, e.employee_name));
  }

  return tickets.map((t): AlterationRow => {
    const types = byTicket.get(t.name) ?? [];
    return {
      name: t.name, customerName: t.customer_name, location: t.origin_location,
      garmentCount: types.length, garmentSummary: summarizeTypes(types),
      tailor: t.assigned_tailor ? tailorMap.get(t.assigned_tailor) ?? t.assigned_tailor : null,
      dueDate: t.due_date, isRush: !!t.is_rush, status: t.workflow_state,
      paymentStatus: t.payment_status, price: t.ticket_total ?? 0,
      invoice: t.sales_invoice ?? null, deliveryMethod: t.delivery_method ?? null,
    };
  });
}

function summarizeTypes(types: string[]): string {
  if (!types.length) return "";
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([type, n]) => (n > 1 ? `${n} ${type.toLowerCase()}s` : type)).join(", ");
}
LSHOUSE_EOF
echo "  wrote lib/erpnext/alterations-data.ts"

mkdir -p "$(dirname "components/alterations/AlterationsBoard.tsx")"
cat > "components/alterations/AlterationsBoard.tsx" <<'LSHOUSE_EOF'
"use client";
// components/alterations/AlterationsBoard.tsx — summary strip + pickup-blocker flag + sorting
import { useMemo, useState } from "react";
import type { AlterationRow } from "@/lib/erpnext/alterations-data";

const CREAM = "#F1E9D6", CREAM_DIM = "rgba(241,233,214,0.45)", BRASS = "#B08D57", SAGE = "#8FA98C", RED = "#E89494", GREEN = "#7FD4B5";
type SortKey = "customerName" | "dueDate" | "price" | "status";
type SortDir = "asc" | "desc";
const isReady = (s: string) => /ready|complete|delivered/i.test(s);
const isDelivered = (s: string) => /delivered/i.test(s);
function isPickupBlocked(r: AlterationRow) { return isReady(r.status) && !isDelivered(r.status) && r.paymentStatus !== "Paid"; }
function daysUntil(d: string | null) {
  if (!d) return null;
  const ms = new Date(d + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime();
  return Math.round(ms / 86400000);
}

export function AlterationsBoard({ rows }: { rows: AlterationRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const stats = useMemo(() => {
    let rush = 0, overdue = 0, ready = 0, blocked = 0, unpaid = 0;
    for (const r of rows) {
      if (r.isRush && !isDelivered(r.status)) rush++;
      const n = daysUntil(r.dueDate);
      if (n !== null && n < 0 && !isDelivered(r.status)) overdue++;
      if (isReady(r.status) && !isDelivered(r.status)) ready++;
      if (isPickupBlocked(r)) blocked++;
      if (r.paymentStatus !== "Paid" && !isDelivered(r.status)) unpaid += r.price;
    }
    return { rush, overdue, ready, blocked, unpaid };
  }, [rows]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let av: any = a[sortKey], bv: any = b[sortKey];
      if (sortKey === "dueDate") { av = av ?? ""; bv = bv ?? ""; }
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "price" ? "desc" : "asc"); }
  }

  const Th = ({ k, label, align = "left" }: { k?: SortKey; label: string; align?: "left" | "right" }) => (
    <button onClick={k ? () => toggleSort(k) : undefined} disabled={!k}
      style={{ background: "none", border: "none", padding: 0, cursor: k ? "pointer" : "default", font: "inherit",
        fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: k === sortKey ? BRASS : CREAM_DIM,
        display: "flex", gap: 4, alignItems: "center", justifyContent: align === "right" ? "flex-end" : "flex-start", width: "100%" }}>
      {label}{k === sortKey && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );

  return (
    <div style={{ color: CREAM }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Metric label="Pickup blocked" value={stats.blocked} tone={stats.blocked ? "red" : "dim"} />
        <Metric label="Overdue" value={stats.overdue} tone={stats.overdue ? "red" : "dim"} />
        <Metric label="Rush" value={stats.rush} tone={stats.rush ? "amber" : "dim"} />
        <Metric label="Ready" value={stats.ready} tone="green" />
        <Metric label="Unpaid" value={`$${Math.round(stats.unpaid).toLocaleString()}`} tone="brass" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "0 4px 12px", borderBottom: "0.5px solid rgba(241,233,214,0.12)" }}>
        <Th k="customerName" label="Customer" />
        <span style={hLabel}>Garments</span>
        <span style={hLabel}>Tailor</span>
        <Th k="dueDate" label="Due" />
        <Th k="status" label="Status" />
        <span style={hLabel}>Pay</span>
        <Th k="price" label="Price" align="right" />
      </div>
      {sorted.map((r) => {
        const blocked = isPickupBlocked(r);
        return (
          <div key={r.name} title={blocked ? "Ready but unpaid — collect payment before pickup" : undefined}
            style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center", padding: "14px 4px 14px 8px",
              borderBottom: "0.5px solid rgba(241,233,214,0.07)", borderLeft: blocked ? `2px solid ${RED}` : "2px solid transparent" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", background: "rgba(176,141,87,0.18)", color: BRASS, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{initials(r.customerName)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15 }}>{r.customerName}</div>
                <div style={ellipsis}>{r.name} · <span style={{ color: SAGE }}>{r.location}</span></div>
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>{r.garmentCount} {r.garmentCount === 1 ? "garment" : "garments"}</div>
              <div style={ellipsis}>{r.garmentSummary || "—"}</div>
            </div>
            <div style={{ fontSize: 13, color: r.tailor ? CREAM : "rgba(241,233,214,0.5)", fontStyle: r.tailor ? "normal" : "italic" }}>{r.tailor ?? "Unassigned"}</div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13 }}>{fmtDate(r.dueDate)}</span>
                {r.isRush && <span style={pill("rgba(239,159,39,0.18)", "#EFB45C")}>RUSH</span>}
              </div>
              <div style={{ fontSize: 11, color: dueColor(r.dueDate) }}>{relDue(r.dueDate)}</div>
            </div>
            <div><span style={statusPill(r.status)}>{r.status}</span></div>
            <div><span style={r.paymentStatus === "Paid" ? pill("rgba(93,202,165,0.14)", GREEN) : pill("rgba(226,75,74,0.14)", RED)}>{r.paymentStatus}</span></div>
            <div style={{ fontSize: 14, textAlign: "right" }}>${r.price.toFixed(0)}</div>
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: "red" | "amber" | "green" | "brass" | "dim" }) {
  const color = { red: RED, amber: "#EFB45C", green: GREEN, brass: BRASS, dim: CREAM_DIM }[tone];
  return (
    <div style={{ background: "rgba(241,233,214,0.04)", border: "0.5px solid rgba(241,233,214,0.1)", borderRadius: 10, padding: "8px 14px", minWidth: 96 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: CREAM_DIM }}>{label}</div>
      <div style={{ fontSize: 20, color }}>{value}</div>
    </div>
  );
}

const GRID = "1.6fr 1fr 0.9fr 1.1fr 0.9fr 0.7fr 0.6fr";
const hLabel: React.CSSProperties = { fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: CREAM_DIM };
const ellipsis: React.CSSProperties = { fontSize: 11, color: CREAM_DIM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
function pill(bg: string, color: string): React.CSSProperties { return { fontSize: 11, padding: "3px 9px", borderRadius: 20, background: bg, color, border: `0.5px solid ${color}55` }; }
function statusPill(status: string): React.CSSProperties { return isReady(status) ? pill("rgba(176,141,87,0.16)", "#D8B985") : pill("rgba(93,202,165,0.14)", GREEN); }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join(""); }
function fmtDate(d: string | null) { return d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"; }
function relDue(d: string | null) {
  const n = daysUntil(d);
  if (n === null) return "";
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return "due today";
  return `in ${n} day${n === 1 ? "" : "s"}`;
}
function dueColor(d: string | null) { const n = daysUntil(d); return n !== null && n <= 2 ? RED : CREAM_DIM; }
LSHOUSE_EOF
echo "  wrote components/alterations/AlterationsBoard.tsx"

mkdir -p "$(dirname "lib/cart/parked.ts")"
cat > "lib/cart/parked.ts" <<'LSHOUSE_EOF'
// lib/cart/parked.ts — Save Cart (Supabase) -> Resume -> Commit (ERPNext ticket).
import { createClient } from "@/lib/supabase/server";
import { upsertCustomerWithAddress, type CustomerInput } from "@/lib/erpnext/customer";

export interface CartGarment { garmentId: string; garmentType: string; color?: string; total: number; }
export interface CartLine { garmentRef: string; preset: string; description: string; price: number; }
export interface CartPayload { garments: CartGarment[]; lines: CartLine[]; deliveryMethod?: "Pickup" | "Delivery"; isRush?: boolean; dueDate?: string | null; }
export interface ParkedCart { id: string; location: string; label: string | null; customer_ref: string | null; customer_snapshot: Partial<CustomerInput>; cart: CartPayload; status: "parked" | "committed" | "abandoned"; updated_at: string; }

export async function saveCart(input: { id?: string; createdBy: string; location: string; customer: Partial<CustomerInput>; customerRef?: string | null; cart: CartPayload; }) {
  const supabase = createClient();
  const row = { created_by: input.createdBy, location: input.location, label: input.customer.fullName ?? "Walk-in", customer_ref: input.customerRef ?? null, customer_snapshot: input.customer, cart: input.cart, status: "parked" as const };
  const q = input.id ? supabase.from("parked_carts").update(row).eq("id", input.id).select().single() : supabase.from("parked_carts").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as ParkedCart;
}

export async function listParkedCarts(location?: string) {
  const supabase = createClient();
  let q = supabase.from("parked_carts").select("*").eq("status", "parked").order("updated_at", { ascending: false });
  if (location) q = q.eq("location", location);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as ParkedCart[];
}

export async function getParkedCart(id: string) {
  const supabase = createClient();
  const { data, error } = await supabase.from("parked_carts").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as ParkedCart;
}

export async function deleteParkedCart(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("parked_carts").update({ status: "abandoned" }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function commitParkedCart(id: string) {
  const cart = await getParkedCart(id);
  let customerName = cart.customer_ref;
  if (!customerName) { const res = await upsertCustomerWithAddress(cart.customer_snapshot as CustomerInput); customerName = res.name; }
  const ERP_URL = process.env.ERP_URL ?? "https://erp.lstailors.com";
  const today = new Date().toISOString().slice(0, 10);
  const ticketDoc = {
    customer: customerName, customer_name: cart.customer_snapshot.fullName ?? customerName,
    origin_location: cart.location, ticket_date: today, due_date: cart.cart.dueDate ?? null,
    is_rush: cart.cart.isRush ? 1 : 0, workflow_state: "Received", delivery_method: cart.cart.deliveryMethod ?? "Pickup",
    garments: cart.cart.garments.map((g) => ({ garment_id: g.garmentId, garment_type: g.garmentType, color: g.color ?? "", garment_total: g.total, garment_status: "Received" })),
    lines: cart.cart.lines.map((l) => ({ garment_ref: l.garmentRef, preset: l.preset, description: l.description, price: l.price, line_status: "Pending" })),
  };
  const res = await fetch(`${ERP_URL}/api/resource/Alteration Ticket`, {
    method: "POST",
    headers: { Authorization: `token ${process.env.ERP_API_KEY}:${process.env.ERP_API_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify(ticketDoc),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.exception || body?.message || `ERPNext ${res.status}`);
  const ticketName = body.data.name as string;
  const supabase = createClient();
  await supabase.from("parked_carts").update({ status: "committed", committed_ticket: ticketName }).eq("id", id);
  return { ticket: ticketName, customer: customerName };
}
LSHOUSE_EOF
echo "  wrote lib/cart/parked.ts"

mkdir -p "$(dirname "lib/cart/cart-actions.ts")"
cat > "lib/cart/cart-actions.ts" <<'LSHOUSE_EOF'
"use server";
// lib/cart/cart-actions.ts
import { saveCart, listParkedCarts, getParkedCart, deleteParkedCart, commitParkedCart, type CartPayload, type ParkedCart } from "@/lib/cart/parked";
import type { CustomerInput } from "@/lib/erpnext/customer";

export async function saveCartAction(input: { id?: string; createdBy: string; location: string; customer: Partial<CustomerInput>; customerRef?: string | null; cart: CartPayload; }): Promise<ParkedCart> { return saveCart(input); }
export async function listParkedCartsAction(location?: string): Promise<ParkedCart[]> { return listParkedCarts(location); }
export async function resumeCartAction(id: string): Promise<ParkedCart> { return getParkedCart(id); }
export async function commitCartAction(id: string): Promise<{ ticket: string; customer: string }> { return commitParkedCart(id); }
export async function abandonCartAction(id: string): Promise<void> { return deleteParkedCart(id); }
LSHOUSE_EOF
echo "  wrote lib/cart/cart-actions.ts"

mkdir -p "$(dirname "components/alterations/SaveCartControls.tsx")"
cat > "components/alterations/SaveCartControls.tsx" <<'LSHOUSE_EOF'
"use client";
// components/alterations/SaveCartControls.tsx
import { useState, useTransition } from "react";
import { saveCartAction, listParkedCartsAction, resumeCartAction, commitCartAction, abandonCartAction } from "@/lib/cart/cart-actions";
import type { ParkedCart, CartPayload } from "@/lib/cart/parked";
import type { CustomerInput } from "@/lib/erpnext/customer";

const CREAM = "#F1E9D6", DIM = "rgba(241,233,214,0.5)", BRASS = "#B08D57", PANEL = "#14271C";
interface Snapshot { customer: Partial<CustomerInput>; customerRef?: string | null; cart: CartPayload; }

export function SaveCartControls(props: {
  createdBy: string; location: string; activeCartId?: string;
  snapshot: () => Snapshot; onSaved?: (c: ParkedCart) => void; onResume: (c: ParkedCart) => void; onCommitted: (ticket: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [carts, setCarts] = useState<ParkedCart[]>([]);
  const [busy, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  function handleSave() {
    const snap = props.snapshot();
    startTransition(async () => {
      try { const saved = await saveCartAction({ id: props.activeCartId, createdBy: props.createdBy, location: props.location, customer: snap.customer, customerRef: snap.customerRef, cart: snap.cart }); props.onSaved?.(saved); flash("Cart saved"); }
      catch (e: any) { flash(e?.message ?? "Save failed"); }
    });
  }
  function openDrawer() {
    setOpen(true);
    startTransition(async () => { try { setCarts(await listParkedCartsAction(props.location)); } catch (e: any) { flash(e?.message ?? "Could not load saved carts"); } });
  }
  function handleResume(id: string) { startTransition(async () => { try { props.onResume(await resumeCartAction(id)); setOpen(false); } catch (e: any) { flash(e?.message ?? "Resume failed"); } }); }
  function handleCheckout(id: string) { startTransition(async () => { try { const { ticket } = await commitCartAction(id); props.onCommitted(ticket); setOpen(false); flash(`Created ${ticket}`); } catch (e: any) { flash(e?.message ?? "Checkout failed"); } }); }
  function handleRemove(id: string) { startTransition(async () => { try { await abandonCartAction(id); setCarts((c) => c.filter((x) => x.id !== id)); } catch (e: any) { flash(e?.message ?? "Remove failed"); } }); }

  return (
    <>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={handleSave} disabled={busy} style={btn}>Save cart</button>
        <button onClick={openDrawer} disabled={busy} style={btnGhost}>Saved carts</button>
      </div>
      {toast && (<div style={{ position: "fixed", bottom: 24, right: 24, background: PANEL, color: CREAM, border: `0.5px solid ${BRASS}55`, borderRadius: 10, padding: "10px 16px", fontSize: 13, zIndex: 60 }}>{toast}</div>)}
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 0, right: 0, height: "100%", width: 420, maxWidth: "90vw", background: PANEL, borderLeft: `0.5px solid ${BRASS}40`, padding: 24, overflowY: "auto", color: CREAM }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <span style={{ fontSize: 18 }}>Saved carts · {props.location}</span>
              <button onClick={() => setOpen(false)} style={{ ...btnGhost, padding: "4px 10px" }}>Close</button>
            </div>
            {carts.length === 0 && <p style={{ color: DIM, fontSize: 14 }}>No parked carts.</p>}
            {carts.map((c) => (
              <div key={c.id} style={{ border: "0.5px solid rgba(241,233,214,0.12)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 15 }}>{c.label ?? "Walk-in"}</div>
                <div style={{ fontSize: 12, color: DIM, marginBottom: 10 }}>{c.cart?.garments?.length ?? 0} garments · {c.cart?.lines?.length ?? 0} alterations · saved {timeAgo(c.updated_at)}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleResume(c.id)} disabled={busy} style={{ ...btnGhost, flex: 1 }}>Resume</button>
                  <button onClick={() => handleCheckout(c.id)} disabled={busy} style={{ ...btn, flex: 1 }}>Checkout</button>
                  <button onClick={() => handleRemove(c.id)} disabled={busy} aria-label="Remove" style={{ ...btnGhost, padding: "8px 12px" }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const btn: React.CSSProperties = { background: BRASS, color: "#0D1A10", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 14, cursor: "pointer", minHeight: 44 };
const btnGhost: React.CSSProperties = { background: "transparent", color: CREAM, border: `0.5px solid ${BRASS}66`, borderRadius: 10, padding: "10px 18px", fontSize: 14, cursor: "pointer", minHeight: 44 };
function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
LSHOUSE_EOF
echo "  wrote components/alterations/SaveCartControls.tsx"

echo "Done. 8 files placed."
