import { useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Star, Phone, MapPin,
  Edit2, Save, X, Trash2, Plus, Tag, Calendar,
  FileText, Heart, Ruler, AlertCircle, ShoppingBag,
  Scissors, Receipt, ExternalLink, DollarSign, Camera, Users, Mail,
  TrendingUp, History,
} from "lucide-react";
import { api } from "@ls/api-client";
import { Button } from "@ls/design/ui/button";
import { cn } from "@ls/design/utils";
import { toast } from "sonner";
import { CustomerEditSheet } from "@alts/components/CustomerEditSheet";
import { formatMoney } from "@alts/lib/money";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AddressRow {
  id?: string;
  title?: string;
  type?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  isBilling?: boolean;
  isShipping?: boolean;
}

interface Customer {
  id: string;
  customerNumber: number | string | null;
  name: string;
  preferredName?: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  titleRole: string | null;
  profession?: string | null;
  pronouns?: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  primaryAddressText?: string | null;
  locationId: string | null;
  status: string;
  vipTier: string;
  vipFlag?: boolean;
  stylePreferences: string | null;
  fitNotes: string | null;
  lifestyleNotes?: string | null;
  notes: string | null;
  birthday: string | null;
  anniversary: string | null;
  tags: string[];
  casaTier: string | null;
  communicationPref: string | null;
  preferredContact: string;
  smsOptedOut: boolean;
  smsOptIn?: boolean;
  paymentPreference: string | null;
  creditTerms: string | null;
  referralCode: string | null;
  referralCredits: number;
  lifetimeValue?: number;
  totalGarmentsOwned?: number;
  image?: string | null;
  measurements?: Record<string, number | null> | null;
  phones?: Array<{ number: string; label?: string; isPrimary?: boolean }>;
  emails?: Array<{ email: string; isPrimary?: boolean }>;
  addresses?: AddressRow[];
  people?: Array<{ id?: string; name: string; role?: string; phone?: string; email?: string; isPrimary?: boolean }>;
  erpnextCustomerId: string | null;
  dossier: any | null;
  createdAt: string;
  updatedAt: string;
}

const INPUT = "w-full bg-forest-deep border border-brass/20 rounded-lg px-3 py-2 text-cream text-sm focus:border-brass/50 focus:outline-none";
const LABEL = "ui-label text-cream-muted mb-1 block text-[10px]";

function Field({ label, value, editing, field, draft, onChange }: {
  label: string; value: string | null; editing: boolean;
  field: string; draft: any; onChange: (f: string, v: string) => void;
}) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {editing ? (
        <input
          className={INPUT}
          value={draft[field] ?? ""}
          onChange={e => onChange(field, e.target.value)}
          placeholder={label}
        />
      ) : (
        <p className="text-cream text-sm">{value || <span className="text-cream-dim italic">—</span>}</p>
      )}
    </div>
  );
}

function TextArea({ label, value, editing, field, draft, onChange }: {
  label: string; value: string | null; editing: boolean;
  field: string; draft: any; onChange: (f: string, v: string) => void;
}) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {editing ? (
        <textarea
          rows={3}
          className={cn(INPUT, "resize-none")}
          value={draft[field] ?? ""}
          onChange={e => onChange(field, e.target.value)}
          placeholder={label}
        />
      ) : (
        <p className="text-cream text-sm whitespace-pre-wrap">{value || <span className="text-cream-dim italic">—</span>}</p>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children, action }: {
  title: string; icon: any; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="glass-panel rounded-2xl p-5 border border-brass/10">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-brass-light" />
        <h3 className="ui-label text-brass-light tracking-wider flex-1">{title}</h3>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    quote: "border-cream-dim/30 text-cream-dim bg-cream-dim/5",
    deposit_paid: "border-brass/40 text-brass-light bg-brass/10",
    in_production: "border-signal-amber/40 text-signal-amber bg-signal-amber/10",
    ready: "border-signal-green/40 text-signal-green bg-signal-green/10",
    delivered: "border-forest-mid/40 text-cream-muted bg-forest-mid/20",
    cancelled: "border-signal-rose/30 text-signal-rose bg-signal-rose/10",
    intake: "border-cream-dim/30 text-cream-dim bg-cream-dim/5",
    in_progress: "border-signal-amber/40 text-signal-amber bg-signal-amber/10",
    picked_up: "border-forest-mid/40 text-cream-muted bg-forest-mid/20",
    paid: "border-signal-green/40 text-signal-green bg-signal-green/10",
    unpaid: "border-signal-rose/30 text-signal-rose bg-signal-rose/10",
    partly_paid: "border-signal-amber/40 text-signal-amber bg-signal-amber/10",
    overdue: "border-signal-rose/40 text-signal-rose bg-signal-rose/15",
    draft: "border-cream-dim/30 text-cream-dim bg-cream-dim/5",
  };
  const label: Record<string, string> = {
    quote: "Quote", deposit_paid: "Deposit Paid", in_production: "In Production",
    ready: "Ready", delivered: "Delivered", cancelled: "Cancelled",
    intake: "Intake", in_progress: "In Progress", picked_up: "Picked Up",
    paid: "Paid", unpaid: "Unpaid", partly_paid: "Partly Paid", overdue: "Overdue", draft: "Draft",
  };
  return (
    <span className={cn("text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border", map[status] ?? "border-brass/15 text-cream-dim")}>
      {label[status] ?? status}
    </span>
  );
}

/** Alts ticket routes live under /orders/alterations; app.lstailors may use /alterations. */
function altTicketPath(id: string) {
  if (typeof window !== "undefined" && /alts\.lstailors\.com/i.test(window.location.hostname)) {
    return `/orders/alterations/${encodeURIComponent(id)}`;
  }
  // Prefer alts path when present in current app shell routes
  return `/orders/alterations/${encodeURIComponent(id)}`;
}

// ── Orders Tab ───────────────────────────────────────────────────────────────
function OrdersTab({ customerId, erpnextCustomerId }: { customerId: string; erpnextCustomerId: string | null }) {
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ["customer-orders", customerId],
    queryFn: () => api.get<any[]>(`/api/custom-orders?customerId=${encodeURIComponent(customerId)}&limit=10`),
    enabled: !!customerId,
  });

  const { data: alterations, isLoading: altsLoading } = useQuery({
    queryKey: ["customer-alterations", erpnextCustomerId],
    queryFn: () => api.get<any[]>(`/api/alterations?customer=${encodeURIComponent(erpnextCustomerId!)}&limit=20`),
    enabled: !!erpnextCustomerId,
  });

  const loading = ordersLoading || altsLoading;
  const hasOrders = (orders?.length ?? 0) > 0;
  const hasAlts = (alterations?.length ?? 0) > 0;

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-brass/5 border border-brass/10" />)}
      </div>
    );
  }

  if (!hasOrders && !hasAlts) {
    return (
      <div className="glass-panel rounded-2xl p-8 border border-brass/10 text-center">
        <ShoppingBag className="w-8 h-8 text-brass/30 mx-auto mb-3" />
        <p className="text-cream-muted text-sm">No orders on record.</p>
        <p className="text-cream-dim text-xs mt-1">Custom orders and alteration tickets will appear here.</p>
        <Link
          to={`/intake/alterations?customer=${encodeURIComponent(erpnextCustomerId || customerId)}`}
          className="inline-block mt-4 text-brass-light text-xs uppercase tracking-widest font-bold"
        >
          New alteration ticket →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasOrders && (
        <div className="glass-panel rounded-2xl border border-brass/10 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-brass/10">
            <ShoppingBag className="w-3.5 h-3.5 text-brass-light" />
            <span className="ui-label text-brass-light text-[10px] tracking-wider">Custom Orders</span>
          </div>
          <div className="divide-y divide-brass/8">
            {(orders ?? []).map((order: any) => (
              <a
                key={order.id}
                href={`https://app.lstailors.com/orders/custom/${encodeURIComponent(order.id)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-4 py-3 hover:bg-brass/5 transition-colors group"
              >
                <div>
                  <p className="text-cream text-sm font-medium capitalize">{order.garmentType?.replace(/_/g, " ") ?? "Order"}</p>
                  <p className="text-cream-dim text-[10px] font-mono mt-0.5">#{order.id?.slice(-8)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={order.status} />
                  <p className="text-brass-shimmer text-sm font-display italic">${Number(order.quotedPrice ?? 0).toFixed(0)}</p>
                  <ExternalLink className="w-3 h-3 text-cream-dim group-hover:text-brass transition-colors" />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {hasAlts && (
        <div className="glass-panel rounded-2xl border border-brass/10 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-brass/10">
            <Scissors className="w-3.5 h-3.5 text-brass-light" />
            <span className="ui-label text-brass-light text-[10px] tracking-wider">Alteration Tickets</span>
          </div>
          <div className="divide-y divide-brass/8">
            {(alterations ?? []).map((alt: any) => {
              const altId = alt.id || alt.name;
              return (
                <Link key={altId} to={altTicketPath(altId)}
                  className="flex items-center justify-between px-4 py-3 hover:bg-brass/5 transition-colors group">
                  <div>
                    <p className="text-cream text-sm font-mono">{altId}</p>
                    <p className="text-cream-dim text-[10px] mt-0.5">
                      Due: {alt.dueDate || alt.due_date ? new Date(alt.dueDate || alt.due_date).toLocaleDateString() : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={alt.status || alt.workflow_state || ""} />
                    <p className="text-brass-shimmer text-sm font-display italic">
                      ${Number(alt.price ?? alt.ticket_total ?? 0).toFixed(0)}
                    </p>
                    <ExternalLink className="w-3 h-3 text-cream-dim group-hover:text-brass transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Measurements Tab ──────────────────────────────────────────────────────────
function MeasurementsTab({ customer }: { customer: any }) {
  const measurementFields = [
    { key: "chest", label: "Chest" },
    { key: "waist", label: "Waist" },
    { key: "hips", label: "Hips / Seat" },
    { key: "inseam", label: "Inseam" },
    { key: "outseam", label: "Outseam" },
    { key: "shoulder", label: "Shoulder" },
    { key: "sleeve", label: "Sleeve" },
    { key: "neck", label: "Neck" },
    { key: "thigh", label: "Thigh" },
    { key: "rise", label: "Rise" },
    { key: "back_length", label: "Back Length" },
    { key: "jacket_length", label: "Jacket Length" },
    { key: "trouser_length", label: "Trouser Length" },
  ];

  const measurements =
    customer?.measurements ??
    customer?.dossier?.body_measurement_set ??
    customer?.dossier?.measurements ??
    null;
  const fitNotesStructured = customer?.dossier?.fit_notes_structured ?? null;

  const hasMeasurements = measurements && typeof measurements === "object" && Object.keys(measurements).length > 0;

  if (!hasMeasurements && !fitNotesStructured && !customer?.fitNotes) {
    return (
      <div className="glass-panel rounded-2xl p-8 border border-brass/10 text-center">
        <Ruler className="w-8 h-8 text-brass/30 mx-auto mb-3" />
        <p className="text-cream-muted text-sm">No measurements on file.</p>
        <p className="text-cream-dim text-xs mt-1 max-w-xs mx-auto">
          ERPNext customer: <span className="font-mono text-brass-light">{customer?.erpnextCustomerId ?? "—"}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasMeasurements && (
        <div className="glass-panel rounded-2xl p-5 border border-brass/10">
          <div className="flex items-center gap-2 mb-4">
            <Ruler className="w-4 h-4 text-brass-light" />
            <h3 className="ui-label text-brass-light tracking-wider">Body Measurements</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {measurementFields.map(({ key, label }) => {
              const val = measurements[key];
              if (val == null || val === "") return null;
              return (
                <div key={key} className="bg-forest-deep/50 rounded-lg px-3 py-2.5 border border-brass/10">
                  <p className="text-cream-dim text-[9px] uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="text-cream text-sm font-display italic">{val}<span className="text-cream-dim text-[10px] ml-0.5">″</span></p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {customer?.fitNotes && (
        <div className="glass-panel rounded-2xl p-5 border border-brass/10">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-brass-light" />
            <h3 className="ui-label text-brass-light tracking-wider">Fit Notes</h3>
          </div>
          <p className="text-cream text-sm whitespace-pre-wrap">{customer.fitNotes}</p>
        </div>
      )}

      {fitNotesStructured && typeof fitNotesStructured === "object" && (
        <div className="glass-panel rounded-2xl p-5 border border-brass/10">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-brass-light" />
            <h3 className="ui-label text-brass-light tracking-wider">Structured Fit</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(fitNotesStructured).map(([key, val]) => (
              <div key={key}>
                <p className="text-cream-dim text-[9px] uppercase tracking-wider mb-0.5">{key.replace(/_/g, " ")}</p>
                <p className="text-cream text-xs">{String(val)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Money helpers ─────────────────────────────────────────────────────────────
function money(n?: number | string | null, _cents?: boolean) {
  return formatMoney(n);
}

interface SpendStats {
  customerId: string;
  lifetimeSpend: number;
  lifetimeBilled: number;
  outstanding: number;
  avgOrder: number;
  invoiceCount: number;
  openInvoiceCount: number;
  lastInvoiceDate: string | null;
  firstInvoiceDate?: string | null;
  erpLifetimeValue: number;
  ticketCount?: number;
  history: Array<{
    id: string;
    status: string;
    /** API shape */
    total?: number;
    grandTotal?: number;
    outstandingAmount?: number;
    outstanding?: number;
    paidAmount?: number;
    paid?: number;
    postingDate: string | null;
    dueDate: string | null;
  }>;
}

function invTotal(i: SpendStats["history"][0]) {
  return Number(i.grandTotal ?? i.total ?? 0);
}
function invOut(i: SpendStats["history"][0]) {
  return Number(i.outstanding ?? i.outstandingAmount ?? 0);
}
function invPaid(i: SpendStats["history"][0]) {
  return Number(i.paid ?? i.paidAmount ?? 0);
}

function useCustomerSpend(customerId: string | undefined) {
  return useQuery({
    queryKey: ["customer-spend", customerId],
    queryFn: async () => {
      const res = await api.raw(`/api/customers/${encodeURIComponent(customerId!)}/spend`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) return null; // role can't see financials
      if (!res.ok) throw new Error(json?.error?.message ?? "Spend load failed");
      return (json?.data ?? json) as SpendStats;
    },
    enabled: !!customerId,
    staleTime: 60_000,
  });
}

/** Top-of-profile spend KPIs from live Sales Invoices. */
function SpendStrip({ customerId }: { customerId: string }) {
  const { data, isLoading, isError } = useCustomerSpend(customerId);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-brass/5 border border-brass/10" />
        ))}
      </div>
    );
  }
  if (isError || data === null) return null; // hidden if no financial access
  if (!data) return null;

  const tiles = [
    {
      label: "Lifetime spend",
      value: money(data.lifetimeSpend, false),
      sub: data.invoiceCount ? `${data.invoiceCount} invoice${data.invoiceCount === 1 ? "" : "s"}` : "No invoices yet",
      gold: true,
    },
    {
      label: "Outstanding",
      value: money(data.outstanding),
      sub: data.openInvoiceCount
        ? `${data.openInvoiceCount} open`
        : "Account clear",
      danger: data.outstanding > 0.005,
      ok: data.outstanding <= 0.005,
    },
    {
      label: "Avg order",
      value: money(data.avgOrder, false),
      sub: data.lifetimeBilled > 0 ? `Billed ${money(data.lifetimeBilled, false)}` : "—",
    },
    {
      label: "Last invoice",
      value: data.lastInvoiceDate
        ? new Date(data.lastInvoiceDate + "T12:00:00").toLocaleDateString()
        : "—",
      sub: data.firstInvoiceDate
        ? `Client since ${new Date(data.firstInvoiceDate + "T12:00:00").toLocaleDateString()}`
        : "No history",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <TrendingUp className="w-3.5 h-3.5 text-brass-light" />
        <span className="ui-label text-brass-light text-[10px] tracking-wider">Spend & orders</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={cn(
              "glass-panel rounded-xl p-3 border",
              t.danger ? "border-signal-rose/25 bg-signal-rose/5" :
              t.ok ? "border-signal-green/20 bg-signal-green/5" :
              "border-brass/10",
            )}
          >
            <p className="ui-label text-[9px] tracking-wider text-cream-muted mb-1">{t.label}</p>
            <p className={cn(
              "font-display italic text-xl leading-tight",
              t.gold ? "text-brass-shimmer" :
              t.danger ? "text-signal-rose" :
              t.ok ? "text-signal-green" :
              "text-cream",
            )}>
              {t.value}
            </p>
            <p className="text-[10px] text-cream-dim mt-1 truncate">{t.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Billing section with live SI stats + editable prefs. */
function BillingLive({
  customerId,
  fallbackLtv,
  garments,
  editing,
  draft,
  onChange,
  c,
  onOpenBalance,
}: {
  customerId: string;
  fallbackLtv?: number;
  garments?: number | null;
  editing: boolean;
  draft: Record<string, any>;
  onChange: (k: string, v: any) => void;
  c: Customer;
  onOpenBalance?: () => void;
}) {
  const { data: spend } = useCustomerSpend(customerId);
  const ltv = spend?.lifetimeSpend ?? fallbackLtv ?? 0;
  const outstanding = spend?.outstanding ?? 0;
  const avg = spend?.avgOrder ?? 0;
  const invCount = spend?.invoiceCount ?? 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Lifetime spend</label>
          <p className="text-brass-shimmer font-display italic">{money(ltv, false)}</p>
          {invCount > 0 && (
            <p className="text-[10px] text-cream-dim mt-0.5">{invCount} invoices · avg {money(avg, false)}</p>
          )}
        </div>
        <div>
          <label className={LABEL}>Outstanding</label>
          <p className={cn(
            "font-display italic",
            outstanding > 0.005 ? "text-signal-rose" : "text-signal-green",
          )}>
            {money(outstanding)}
          </p>
          {spend && (
            <p className="text-[10px] text-cream-dim mt-0.5">
              {spend.openInvoiceCount} open · billed {money(spend.lifetimeBilled, false)}
            </p>
          )}
        </div>
        <div>
          <label className={LABEL}>Garments owned</label>
          <p className="text-cream text-sm">{garments ?? 0}</p>
        </div>
        <div>
          <label className={LABEL}>Referral Code</label>
          <p className="text-cream text-sm font-mono">{c.referralCode ?? "—"}</p>
        </div>
        <Field label="Payment Preference" value={c.paymentPreference} editing={editing} field="payment_preference" draft={draft} onChange={onChange} />
        <Field label="Casa" value={c.casaTier} editing={editing} field="casa_tier" draft={draft} onChange={onChange} />
      </div>
      {spend && spend.history.length > 0 && onOpenBalance && (
        <button
          type="button"
          onClick={onOpenBalance}
          className="text-[10px] text-brass-light uppercase tracking-widest font-bold"
        >
          See full history in Balance tab →
        </button>
      )}
    </div>
  );
}

// ── Balance Tab ───────────────────────────────────────────────────────────────
function BalanceTab({ customerId, erpnextCustomerId }: { customerId: string; erpnextCustomerId: string | null }) {
  const { data: spend, isLoading } = useCustomerSpend(customerId || erpnextCustomerId || undefined);

  if (!erpnextCustomerId && !customerId) {
    return (
      <div className="glass-panel rounded-2xl p-8 border border-brass/10 text-center">
        <Receipt className="w-8 h-8 text-brass/30 mx-auto mb-3" />
        <p className="text-cream-muted text-sm">No ERPNext account linked.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-brass/5 border border-brass/10" />)}
      </div>
    );
  }

  if (spend === null) {
    return (
      <div className="glass-panel rounded-2xl p-8 border border-brass/10 text-center">
        <Receipt className="w-8 h-8 text-brass/30 mx-auto mb-3" />
        <p className="text-cream-muted text-sm">Financials restricted for your role.</p>
      </div>
    );
  }

  const invoices = spend?.history ?? [];
  const totalOutstanding = spend?.outstanding ?? 0;
  const open = invoices.filter((i) => invOut(i) > 0.005);
  const paid = invoices.filter((i) => invOut(i) <= 0.005);

  return (
    <div className="space-y-4">
      <div className={cn(
        "glass-panel rounded-2xl p-5 border",
        totalOutstanding > 0 ? "border-signal-rose/20 bg-signal-rose/5" : "border-signal-green/20 bg-signal-green/5"
      )}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="ui-label text-[10px] tracking-wider text-cream-muted mb-1">Total Outstanding</p>
            <p className={cn("font-display italic text-3xl", totalOutstanding > 0 ? "text-signal-rose" : "text-signal-green")}>
              {money(totalOutstanding)}
            </p>
            <p className="text-cream-dim text-xs mt-2">
              Paid lifetime {money(spend?.lifetimeSpend ?? 0, false)} · Avg {money(spend?.avgOrder ?? 0, false)} · {spend?.invoiceCount ?? 0} invoices
            </p>
          </div>
          <DollarSign className={cn("w-8 h-8 shrink-0", totalOutstanding > 0 ? "text-signal-rose/40" : "text-signal-green/40")} />
        </div>
        {open.length === 0 && <p className="text-cream-dim text-xs mt-2">No unpaid invoices — account is clear.</p>}
      </div>

      {open.length > 0 && (
        <div className="glass-panel rounded-2xl border border-brass/10 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-brass/10">
            <Receipt className="w-3.5 h-3.5 text-brass-light" />
            <span className="ui-label text-brass-light text-[10px] tracking-wider">Open balance</span>
          </div>
          <div className="divide-y divide-brass/8">
            {open.map((inv) => {
              const isOverdue = inv.status === "overdue" ||
                (inv.dueDate && new Date(inv.dueDate) < new Date() && inv.status !== "paid");
              return (
                <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-cream text-sm font-mono">{inv.id}</p>
                    <p className="text-cream-dim text-[10px] mt-0.5">
                      {inv.postingDate ? new Date(inv.postingDate + "T12:00:00").toLocaleDateString() : "—"}
                      {inv.dueDate && <> · Due {new Date(inv.dueDate + "T12:00:00").toLocaleDateString()}</>}
                      {isOverdue && <span className="text-signal-rose ml-2 font-bold">OVERDUE</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={inv.status} />
                    <p className="text-signal-rose font-display italic">{money(invOut(inv))}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="glass-panel rounded-2xl border border-brass/10 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-brass/10">
            <History className="w-3.5 h-3.5 text-brass-light" />
            <span className="ui-label text-brass-light text-[10px] tracking-wider">Spend history</span>
            <span className="text-[10px] text-cream-dim ml-auto">{invoices.length} shown</span>
          </div>
          <div className="divide-y divide-brass/8 max-h-[28rem] overflow-y-auto">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-cream text-sm font-mono truncate">{inv.id}</p>
                  <p className="text-cream-dim text-[10px] mt-0.5">
                    {inv.postingDate ? new Date(inv.postingDate + "T12:00:00").toLocaleDateString() : "—"}
                    {invPaid(inv) > 0 && invOut(inv) > 0.005 && (
                      <span className="ml-2">paid {money(invPaid(inv), false)}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <StatusBadge status={inv.status} />
                  <p className={cn(
                    "font-display italic text-sm tabular-nums",
                    invOut(inv) > 0.005 ? "text-signal-rose" : "text-brass-shimmer",
                  )}>
                    {money(invTotal(inv), false)}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {paid.length > 0 && open.length > 0 && (
            <p className="text-[10px] text-cream-dim px-4 py-2 border-t border-brass/10">
              {paid.length} settled · {open.length} open
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type TabKey = "orders" | "measurements" | "balance";

function TabSwitcher({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: "orders", label: "Orders", icon: ShoppingBag },
    { key: "measurements", label: "Measurements", icon: Ruler },
    { key: "balance", label: "Balance", icon: Receipt },
  ];
  return (
    <div className="flex items-center gap-1.5 p-1 bg-forest-deep/60 border border-brass/15 rounded-xl w-fit">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all",
            active === key
              ? "bg-brass/20 text-brass-shimmer border border-brass/30 shadow-sm"
              : "text-cream-muted hover:text-cream hover:bg-brass/8"
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── New client form ( /customers/new ) ────────────────────────────────────────
function NewCustomerForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!fullName.trim()) throw new Error("Name is required");
      if (!phone.trim()) throw new Error("Mobile number is required");
      const body: Record<string, unknown> = {
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
      };
      if (line1.trim() || city.trim()) {
        body.address = line1.trim();
        if (line2.trim()) body.address_line2 = line2.trim();
        body.city = city.trim() || undefined;
        body.state = state.trim() || undefined;
        body.zip_code = zip.trim() || undefined;
      }
      return api.post<any>("/api/customers", body);
    },
    onSuccess: (created) => {
      const newId = created?.id || created?.name || created?.erpnextCustomerId;
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Client created");
      if (newId) navigate(`/customers/${encodeURIComponent(newId)}`, { replace: true });
      else navigate("/customers", { replace: true });
    },
    onError: (e: Error) => toast.error(e.message || "Could not create client"),
  });

  return (
    <div className="p-5 max-w-lg mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/customers")}
          className="text-cream-dim p-1.5 hover:text-cream"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-brass-shimmer font-display text-xl">New client</h1>
          <p className="text-cream-dim text-xs mt-0.5">Saved to ERPNext — then open their profile</p>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-brass/15 bg-forest-raised/60 p-4">
        <div>
          <label className={LABEL}>Full name *</label>
          <input className={INPUT} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Client" autoFocus />
        </div>
        <div>
          <label className={LABEL}>Mobile *</label>
          <input className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1…" inputMode="tel" />
        </div>
        <div>
          <label className={LABEL}>Email</label>
          <input className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" inputMode="email" />
        </div>
        <div>
          <label className={LABEL}>Address</label>
          <input className={INPUT} value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street" />
        </div>
        <input className={INPUT} value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Apt / suite" />
        <div className="grid grid-cols-3 gap-2">
          <input className={INPUT} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
          <input className={INPUT} value={state} onChange={(e) => setState(e.target.value)} placeholder="ST" />
          <input className={INPUT} value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP" />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          className="btn-brass flex-1"
          disabled={!fullName.trim() || !phone.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Saving…" : "Create client"}
        </Button>
        <Button
          variant="outline"
          className="border-brass/20 text-cream-muted flex-1"
          onClick={() => navigate("/intake/kind")}
        >
          Or start a ticket
        </Button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [newTag, setNewTag] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("orders");
  const [contactEditOpen, setContactEditOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const { data: customer, isLoading, error } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api.get<Customer>(`/api/customers/${encodeURIComponent(id!)}`),
    enabled: !!id && id !== "new",
  });

  const updateMutation = useMutation({
    mutationFn: (body: any) => api.patch(`/api/customers/${encodeURIComponent(id!)}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer", id] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      setEditing(false);
      toast.success("Client updated.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/customers/${encodeURIComponent(id!)}`),
    onSuccess: () => { navigate("/customers"); toast.success("Client archived."); },
    onError: (e: any) => toast.error(e?.message ?? "Archive failed"),
  });

  if (!id || id === "new") {
    return <NewCustomerForm />;
  }

  if (isLoading) return <div className="text-cream-muted text-sm p-8">Loading…</div>;
  if (error || !customer) return (
    <div className="text-signal-rose text-sm p-8 flex items-center gap-2">
      <AlertCircle className="w-4 h-4" /> Client not found.
    </div>
  );

  const c = customer as Customer;
  const initials = (c.name || "?")
    .split(" ")
    .map(p => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const startEdit = () => {
    setDraft({
      full_name: c.name,
      preferred_name: c.preferredName,
      first_name: c.firstName,
      last_name: c.lastName,
      phone: c.phone,
      email: c.email,
      company: c.company,
      title_role: c.titleRole || c.profession,
      profession: c.profession || c.titleRole,
      pronouns: c.pronouns,
      address: c.address,
      city: c.city,
      state: c.state,
      zip_code: c.zipCode,
      vip_tier: c.vipTier,
      vip_flag: c.vipFlag ?? c.vipTier !== "Standard",
      status: c.status,
      style_preferences: c.stylePreferences,
      fit_notes: c.fitNotes,
      lifestyle_notes: c.lifestyleNotes,
      notes: c.notes,
      birthday: c.birthday,
      anniversary: c.anniversary,
      tags: [...(c.tags ?? [])],
      preferred_contact: c.preferredContact,
      payment_preference: c.paymentPreference,
      sms_opted_out: c.smsOptedOut,
      casa_tier: c.casaTier,
    });
    setEditing(true);
  };

  const onChange = (field: string, value: string) => setDraft((d: any) => ({ ...d, [field]: value }));

  const saveEdits = () => {
    const body = { ...draft };
    if (body.vip_tier !== undefined) {
      body.vip_flag = body.vip_tier !== "Standard";
    }
    updateMutation.mutate(body);
  };

  const addTag = () => {
    if (!newTag.trim()) return;
    const tags = [...(draft.tags ?? c.tags ?? []), newTag.trim()];
    setDraft((d: any) => ({ ...d, tags }));
    setNewTag("");
  };

  const removeTag = (tag: string) => {
    const tags = (draft.tags ?? c.tags ?? []).filter((t: string) => t !== tag);
    setDraft((d: any) => ({ ...d, tags }));
  };

  const uploadImage = async (file: File) => {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.raw(`/api/customers/${encodeURIComponent(id!)}/image`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message || "Upload failed");
      }
      qc.invalidateQueries({ queryKey: ["customer", id] });
      toast.success("Profile photo updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Photo upload failed");
    } finally {
      setUploadingImage(false);
    }
  };

  const currentTags = editing ? (draft.tags ?? []) : (c.tags ?? []);
  const isVip = c.vipFlag || (c.vipTier && c.vipTier !== "Standard");
  const addresses = c.addresses?.length
    ? c.addresses
    : c.address
      ? [{ line1: c.address, city: c.city || "", state: c.state || "", zip: c.zipCode || "", title: "Primary", isBilling: true, isShipping: true }]
      : [];
  const phones = c.phones?.length
    ? c.phones
    : c.phone
      ? [{ number: c.phone, label: "Mobile", isPrimary: true }]
      : [];
  const emails = c.emails?.length
    ? c.emails
    : c.email
      ? [{ email: c.email, isPrimary: true }]
      : [];
  const people = (c.people || []).filter(p => !p.isPrimary || /assistant|spouse|family/i.test(p.role || ""));

  return (
    <div className="space-y-6 animate-fade-up max-w-4xl p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-4 min-w-0">
          <button onClick={() => navigate("/customers")} className="mt-1 p-1.5 rounded-lg hover:bg-brass/10 text-cream-dim hover:text-cream transition-colors shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </button>

          {/* Profile image */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadingImage}
            className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-brass/40 overflow-hidden shrink-0 bg-brass/10 grid place-items-center group"
            title="Change profile photo"
          >
            {c.image ? (
              <img src={c.image} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="font-display italic text-2xl text-brass-light">{initials}</span>
            )}
            <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
              <Camera className="w-5 h-5 text-cream" />
            </span>
            {uploadingImage && (
              <span className="absolute inset-0 bg-black/60 grid place-items-center text-[10px] text-cream uppercase tracking-wider">…</span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadImage(f);
              e.target.value = "";
            }}
          />

          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h1 className="font-display italic text-3xl text-cream truncate">{c.name}</h1>
              {isVip && <Star className="w-4 h-4 text-brass fill-brass shrink-0" />}
              {c.casaTier && (
                <span className="text-[9px] tracking-widest font-bold uppercase px-2 py-1 rounded border border-brass/30 text-brass-light bg-brass/5">
                  CASA {c.casaTier}
                </span>
              )}
            </div>
            {c.preferredName && (
              <p className="text-cream-muted text-sm mb-1">Goes by {c.preferredName}</p>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="ui-label text-[10px]">#{c.customerNumber ?? "—"}</span>
              <span className={cn(
                "text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border",
                isVip ? "border-brass/40 text-brass-shimmer bg-brass/10" : "border-brass/15 text-cream-dim"
              )}>
                {isVip ? (c.vipTier === "Standard" ? "VIP" : c.vipTier) : "Standard"}
              </span>
              {c.status !== "Active" && (
                <span className="text-[10px] text-signal-rose border border-signal-rose/30 bg-signal-rose/10 rounded px-2 py-0.5">{c.status}</span>
              )}
              {(c.lifetimeValue ?? 0) > 0 && (
                <span className="text-[10px] text-cream-dim">LTV ${Number(c.lifetimeValue).toFixed(0)}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)} className="border-brass/20 text-cream-muted">
                <X className="w-3.5 h-3.5 mr-1" /> Cancel
              </Button>
              <Button className="btn-brass" onClick={saveEdits} disabled={updateMutation.isPending}>
                <Save className="w-3.5 h-3.5 mr-1" /> {updateMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setContactEditOpen(true)}
                className="border-brass/30 text-brass-light hover:bg-brass/10"
              >
                <Phone className="w-3.5 h-3.5 mr-1" /> Contacts & addresses
              </Button>
              <Button variant="outline" onClick={startEdit} className="border-brass/20 text-cream-muted hover:bg-brass/10">
                <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit profile
              </Button>
              <Button
                variant="outline"
                onClick={() => { if (confirm("Archive this client?")) deleteMutation.mutate(); }}
                className="border-signal-rose/30 text-signal-rose hover:bg-signal-rose/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Live spend KPIs from ERP Sales Invoices */}
      <SpendStrip customerId={c.id} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Contact summary */}
        <Section
          title="Contact"
          icon={Phone}
          action={
            !editing ? (
              <button
                type="button"
                onClick={() => setContactEditOpen(true)}
                className="text-[10px] uppercase tracking-widest text-brass-light font-bold"
              >
                Edit multi
              </button>
            ) : null
          }
        >
          {editing ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="First Name" value={c.firstName} editing={editing} field="first_name" draft={draft} onChange={onChange} />
                <Field label="Last Name" value={c.lastName} editing={editing} field="last_name" draft={draft} onChange={onChange} />
              </div>
              <Field label="Preferred name" value={c.preferredName ?? null} editing={editing} field="preferred_name" draft={draft} onChange={onChange} />
              <Field label="Phone" value={c.phone} editing={editing} field="phone" draft={draft} onChange={onChange} />
              <Field label="Email" value={c.email} editing={editing} field="email" draft={draft} onChange={onChange} />
              <Field label="Profession" value={c.profession || c.titleRole} editing={editing} field="profession" draft={draft} onChange={onChange} />
            </>
          ) : (
            <>
              <div className="space-y-2">
                {phones.length === 0 && emails.length === 0 && (
                  <p className="text-cream-dim text-sm italic">No phone or email on file.</p>
                )}
                {phones.map((p, i) => (
                  <div key={`${p.number}-${i}`} className="flex items-center gap-2 text-sm">
                    <Phone className="w-3.5 h-3.5 text-brass-light/60 shrink-0" />
                    <span className="text-cream">{p.number}</span>
                    {p.label && <span className="text-cream-dim text-[10px] uppercase">{p.label}</span>}
                    {p.isPrimary && <span className="text-[9px] text-brass-light border border-brass/30 rounded px-1.5">Primary</span>}
                  </div>
                ))}
                {emails.map((e, i) => (
                  <div key={`${e.email}-${i}`} className="flex items-center gap-2 text-sm">
                    <Mail className="w-3.5 h-3.5 text-brass-light/60 shrink-0" />
                    <span className="text-cream truncate">{e.email}</span>
                    {e.isPrimary && <span className="text-[9px] text-brass-light border border-brass/30 rounded px-1.5">Primary</span>}
                  </div>
                ))}
              </div>
              {(c.profession || c.titleRole) && (
                <p className="text-cream-muted text-sm pt-1">{c.profession || c.titleRole}</p>
              )}
              {c.pronouns && <p className="text-cream-dim text-xs">Pronouns: {c.pronouns}</p>}
            </>
          )}
        </Section>

        {/* Addresses — multi */}
        <Section
          title="Addresses"
          icon={MapPin}
          action={
            !editing ? (
              <button
                type="button"
                onClick={() => setContactEditOpen(true)}
                className="text-[10px] uppercase tracking-widest text-brass-light font-bold"
              >
                Manage
              </button>
            ) : null
          }
        >
          {editing ? (
            <>
              <Field label="Street" value={c.address} editing={editing} field="address" draft={draft} onChange={onChange} />
              <div className="grid grid-cols-3 gap-3">
                <Field label="City" value={c.city} editing={editing} field="city" draft={draft} onChange={onChange} />
                <Field label="State" value={c.state} editing={editing} field="state" draft={draft} onChange={onChange} />
                <Field label="ZIP" value={c.zipCode} editing={editing} field="zip_code" draft={draft} onChange={onChange} />
              </div>
              <p className="text-[11px] text-cream-dim">For multiple residences use Contacts & addresses.</p>
            </>
          ) : addresses.length === 0 ? (
            <p className="text-cream-dim text-sm italic">No addresses yet — add home, office, or shipping.</p>
          ) : (
            <div className="space-y-3">
              {addresses.map((a, i) => (
                <div key={a.id || i} className="rounded-xl border border-brass/15 bg-forest-deep/40 p-3">
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brass-light">
                      {a.title || a.type || "Address"}
                    </span>
                    {a.isBilling && (
                      <span className="text-[9px] uppercase border border-brass/30 text-brass-light rounded px-1.5">Billing</span>
                    )}
                    {a.isShipping && (
                      <span className="text-[9px] uppercase border border-brass/30 text-brass-light rounded px-1.5">Shipping</span>
                    )}
                  </div>
                  <p className="text-cream text-sm">
                    {[a.line1, a.line2].filter(Boolean).join(", ")}
                  </p>
                  <p className="text-cream-muted text-xs mt-0.5">
                    {[a.city, a.state, a.zip].filter(Boolean).join(", ")}
                    {a.country && a.country !== "United States" ? ` · ${a.country}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Assistants / people */}
        {(people.length > 0 || !editing) && (
          <Section
            title="People & assistants"
            icon={Users}
            action={
              <button
                type="button"
                onClick={() => setContactEditOpen(true)}
                className="text-[10px] uppercase tracking-widest text-brass-light font-bold"
              >
                Manage
              </button>
            }
          >
            {people.length === 0 ? (
              <p className="text-cream-dim text-sm italic">No assistants on file.</p>
            ) : (
              <div className="space-y-2">
                {people.map((p, i) => (
                  <div key={p.id || i} className="rounded-xl border border-brass/10 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-cream text-sm font-medium">{p.name}</span>
                      <span className="text-[9px] uppercase tracking-wider text-brass-light border border-brass/25 rounded px-1.5">
                        {p.role || "Other"}
                      </span>
                    </div>
                    <p className="text-cream-dim text-xs mt-0.5">
                      {[p.phone, p.email].filter(Boolean).join(" · ") || "No contact"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Profile */}
        <Section title="Profile" icon={Star}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>VIP</label>
              {editing ? (
                <select
                  className={INPUT}
                  value={draft.vip_tier ?? c.vipTier}
                  onChange={e => onChange("vip_tier", e.target.value)}
                >
                  {["Standard", "VIP", "Silver", "Gold", "Platinum"].map(t => <option key={t}>{t}</option>)}
                </select>
              ) : (
                <p className="text-cream text-sm">{isVip ? (c.vipTier === "Standard" ? "VIP" : c.vipTier) : "Standard"}</p>
              )}
            </div>
            <div>
              <label className={LABEL}>Status</label>
              {editing ? (
                <select className={INPUT} value={draft.status ?? c.status} onChange={e => onChange("status", e.target.value)}>
                  {["Active", "Inactive", "Archived"].map(s => <option key={s}>{s}</option>)}
                </select>
              ) : <p className="text-cream text-sm">{c.status}</p>}
            </div>
            <Field label="Birthday" value={c.birthday} editing={editing} field="birthday" draft={draft} onChange={onChange} />
            <Field label="Anniversary" value={c.anniversary} editing={editing} field="anniversary" draft={draft} onChange={onChange} />
          </div>
          <div>
            <label className={LABEL}>Preferred Contact</label>
            {editing ? (
              <select
                className={INPUT}
                value={draft.preferred_contact ?? c.preferredContact}
                onChange={e => onChange("preferred_contact", e.target.value)}
              >
                {["email", "phone", "sms", "Mobile", "Email", "Either"].map(p => <option key={p}>{p}</option>)}
              </select>
            ) : <p className="text-cream text-sm capitalize">{c.preferredContact}</p>}
          </div>
          <p className="text-cream-dim text-xs">
            SMS: {c.smsOptIn !== false && !c.smsOptedOut ? "opted in" : "opted out"}
          </p>
        </Section>

        {/* Tags */}
        <Section title="Tags" icon={Tag}>
          <div className="flex flex-wrap gap-1.5 min-h-[32px]">
            {currentTags.map((tag: string) => (
              <span key={tag} className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-brass/25 bg-brass/8 text-cream-muted text-xs">
                {tag}
                {editing && (
                  <button onClick={() => removeTag(tag)} className="text-cream-dim hover:text-signal-rose ml-1">
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </span>
            ))}
            {currentTags.length === 0 && !editing && <span className="text-cream-dim text-xs italic">No tags</span>}
          </div>
          {editing && (
            <div className="flex gap-2 mt-2">
              <input
                className={cn(INPUT, "flex-1")}
                placeholder="Add tag…"
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addTag()}
              />
              <Button onClick={addTag} variant="outline" size="sm" className="border-brass/20 text-cream-muted px-2">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </Section>

        {/* Style & Fit */}
        <Section title="Style & Fit" icon={Ruler}>
          <TextArea label="Style Preferences" value={c.stylePreferences} editing={editing} field="style_preferences" draft={draft} onChange={onChange} />
          <TextArea label="Fit Notes" value={c.fitNotes} editing={editing} field="fit_notes" draft={draft} onChange={onChange} />
          <TextArea label="Lifestyle" value={c.lifestyleNotes ?? null} editing={editing} field="lifestyle_notes" draft={draft} onChange={onChange} />
        </Section>

        {/* Notes */}
        <Section title="Notes & Dossier" icon={FileText}>
          <TextArea label="Internal Notes" value={c.notes} editing={editing} field="notes" draft={draft} onChange={onChange} />
          {c.dossier && (
            <div className="space-y-2 pt-2 border-t border-brass/10">
              {c.dossier.family_context && (
                <div>
                  <label className={LABEL}>Family Context</label>
                  <p className="text-cream-muted text-xs">{c.dossier.family_context}</p>
                </div>
              )}
              {c.dossier.professional_context && (
                <div>
                  <label className={LABEL}>Professional</label>
                  <p className="text-cream-muted text-xs">{c.dossier.professional_context}</p>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* Billing */}
        <Section title="Billing" icon={Heart}>
          <BillingLive
            customerId={c.id}
            fallbackLtv={c.lifetimeValue}
            garments={c.totalGarmentsOwned}
            editing={editing}
            draft={draft}
            onChange={onChange}
            c={c}
            onOpenBalance={() => setActiveTab("balance")}
          />
        </Section>

        {/* System */}
        <Section title="System" icon={Calendar}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className={LABEL}>ERPNext ID</label>
              <p className="text-cream-dim font-mono break-all">{c.erpnextCustomerId ?? "—"}</p>
            </div>
            <div>
              <label className={LABEL}>Created</label>
              <p className="text-cream-dim">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</p>
            </div>
            <div>
              <label className={LABEL}>Last Updated</label>
              <p className="text-cream-dim">{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : "—"}</p>
            </div>
          </div>
        </Section>
      </div>

      {/* Activity Tabs */}
      <div className="space-y-4">
        <TabSwitcher active={activeTab} onChange={setActiveTab} />
        {activeTab === "orders" && (
          <OrdersTab customerId={c.id} erpnextCustomerId={c.erpnextCustomerId} />
        )}
        {activeTab === "measurements" && <MeasurementsTab customer={c} />}
        {activeTab === "balance" && (
          <BalanceTab customerId={c.id} erpnextCustomerId={c.erpnextCustomerId} />
        )}
      </div>

      <CustomerEditSheet
          open={contactEditOpen}
          customerId={c.id}
          customerName={c.name}
          onClose={() => setContactEditOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["customer", id] });
            setContactEditOpen(false);
          }}
        />
    </div>
  );
}
