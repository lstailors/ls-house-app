import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { localFirstTickets, localFirstInvoiceBook } from "@alts/offline/localFirst";
import { cn } from "@ls/design/utils";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import ErpStatusBanner from "@alts/components/ErpStatusBanner";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";
import { AltsSearchField } from "@alts/components/AltsSearchField";
import { ListSkeleton } from "@alts/components/skeletons";
import { FulfillmentChip } from "@alts/components/FulfillmentChip";
import { computeFulfillment } from "@alts/lib/fulfillment";
import { formatMoney } from "@alts/lib/money";
import { storeToday } from "@alts/lib/storeDate";
import {
  clientInitials,
  daysLate,
  fmtDue,
  isRush,
  syncLabel,
} from "@alts/lib/ticketDisplay";

type Ticket = {
  name: string;
  customer?: string;
  customer_name?: string;
  workflow_state?: string;
  due_date?: string;
  due_time?: string;
  ticket_total?: number;
  payment_status?: string;
  is_rush?: number;
  origin_location?: string;
  assigned_tailor?: string;
  delivery_method?: string | null;
  sales_invoice?: string | null;
};

type InvoiceRow = {
  id: string;
  customerName?: string | null;
  customer?: { id: string; name: string } | null;
  status: string;
  kind?: "alteration" | "custom" | "other";
  grandTotal: number;
  outstandingAmount: number;
  postingDate?: string | null;
  alterationTicketRef?: string | null;
  salesOrder?: string | null;
  fulfillment?: string | null;
  shop?: string | null;
  whereDetail?: string | null;
};

type OrderRow = {
  key: string;
  kind: "alteration" | "custom" | "invoice";
  id: string;
  customerName: string;
  customerId?: string | null;
  payLabel: string;
  payTone: "green" | "amber" | "rose" | "dim";
  total: number;
  outstanding: number;
  date?: string | null;
  ticketRef?: string | null;
  invoiceRef?: string | null;
  fulfillment: {
    workflow_state?: string | null;
    assigned_tailor?: string | null;
    delivery_method?: string | null;
    origin_location?: string | null;
    lsh_fulfillment?: string | null;
    lsh_where_detail?: string | null;
    lsh_origin_location?: string | null;
  };
  rush?: boolean;
  href: string;
};

function money(n: number) {
  return formatMoney(n);
}

function payFromTicket(t: Ticket): { label: string; tone: OrderRow["payTone"] } {
  const p = String(t.payment_status || "");
  if (p === "Paid" || p === "N/A") return { label: p === "N/A" ? "N/A" : "Paid", tone: "green" };
  if (p === "Partly Paid") return { label: "Partly paid", tone: "amber" };
  if (p) return { label: p, tone: "amber" };
  return { label: "—", tone: "dim" };
}

function payFromInvoice(st: string, outstanding: number): { label: string; tone: OrderRow["payTone"] } {
  const s = st.toLowerCase();
  if (s === "paid" || outstanding <= 0.02) return { label: "Paid", tone: "green" };
  if (s === "overdue") return { label: "Overdue", tone: "rose" };
  if (s === "partly_paid") return { label: "Partly paid", tone: "amber" };
  if (s === "cancelled" || s === "void") return { label: "Cancelled", tone: "dim" };
  if (s === "unpaid") return { label: "Unpaid", tone: "amber" };
  return { label: st.replace(/_/g, " ") || "—", tone: "dim" };
}

function payChipClass(tone: OrderRow["payTone"]) {
  if (tone === "green") return "border-signal-emerald/35 bg-signal-emerald/12 text-signal-emerald";
  if (tone === "rose") return "border-signal-rose/35 bg-signal-rose/12 text-signal-rose";
  if (tone === "amber") return "border-signal-amber/35 bg-signal-amber/12 text-signal-amber";
  return "border-cream/15 bg-white/5 text-cream-dim";
}

/**
 * Desk-style All Orders list — alts tickets + invoices (MTM/custom),
 * with the same fulfillment traffic lights as ERP SI list.
 */
export default function OrdersGlass() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<
    "all" | "alts" | "custom" | "open_money" | "in_work" | "ready" | "done"
  >("all");
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 20_000);
    return () => window.clearInterval(id);
  }, []);

  const tickets = useQuery({
    queryKey: ["orders-glass-tickets"],
    queryFn: () =>
      localFirstTickets(() =>
        api.get<Ticket[]>("/api/intake-alterations/tickets?limit=500&origin=ALL"),
      ),
    refetchInterval: 45_000,
  });

  const invoices = useQuery({
    queryKey: ["orders-glass-invoices"],
    queryFn: async () =>
      localFirstInvoiceBook<InvoiceRow>(async () => {
        const params = new URLSearchParams({ limit: "400", status: "all" });
        const res = await api.raw(`/api/invoices?${params}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error?.message ?? `Invoices failed (${res.status})`);
        const rows: InvoiceRow[] = Array.isArray(json?.data) ? json.data : [];
        const summary = json?.summary ?? {
          paid: 0,
          outstanding: rows.reduce((s, r) => s + (Number(r.outstandingAmount) || 0), 0),
          openCount: rows.filter((r) => (Number(r.outstandingAmount) || 0) > 0.02).length,
          count: rows.length,
        };
        return { rows, summary };
      }),
    refetchInterval: 60_000,
  });

  const invoiceRows = invoices.data?.rows ?? [];
  const ticketRows = tickets.data ?? [];

  const unified = useMemo(() => {
    const rows: OrderRow[] = [];
    const ticketSi = new Set<string>();
    const ticketNames = new Set<string>();

    for (const t of ticketRows) {
      ticketNames.add(t.name);
      const si = (t.sales_invoice || "").trim();
      if (si) ticketSi.add(si);
      const pay = payFromTicket(t);
      rows.push({
        key: `t:${t.name}`,
        kind: "alteration",
        id: t.name,
        customerName: t.customer_name || "—",
        customerId: t.customer,
        payLabel: pay.label,
        payTone: pay.tone,
        total: Number(t.ticket_total) || 0,
        outstanding: pay.label === "Paid" || pay.label === "N/A" ? 0 : Number(t.ticket_total) || 0,
        date: t.due_date || null,
        ticketRef: t.name,
        invoiceRef: si || null,
        rush: !!isRush(t),
        fulfillment: {
          workflow_state: t.workflow_state,
          assigned_tailor: t.assigned_tailor,
          delivery_method: t.delivery_method,
          origin_location: t.origin_location,
        },
        href: `/orders/alterations/${encodeURIComponent(t.name)}`,
      });
    }

    for (const inv of invoiceRows) {
      const id = inv.id;
      if (!id) continue;
      // Skip open SI already represented by its Ready/open alt ticket
      if (ticketSi.has(id)) continue;
      const alt = (inv.alterationTicketRef || "").trim();
      if (alt && ticketNames.has(alt)) continue;

      const out = Number(inv.outstandingAmount) || 0;
      const pay = payFromInvoice(inv.status, out);
      const kind =
        inv.kind === "alteration" || alt
          ? "alteration"
          : inv.kind === "custom"
            ? "custom"
            : "invoice";

      rows.push({
        key: `i:${id}`,
        kind: kind === "alteration" ? "alteration" : "custom",
        id,
        customerName: inv.customerName || inv.customer?.name || "—",
        customerId: inv.customer?.id,
        payLabel: pay.label,
        payTone: pay.tone,
        total: Number(inv.grandTotal) || 0,
        outstanding: out,
        date: inv.postingDate || null,
        ticketRef: alt || null,
        invoiceRef: id,
        fulfillment: {
          lsh_fulfillment: inv.fulfillment,
          lsh_origin_location: inv.shop,
          lsh_where_detail: inv.whereDetail,
          origin_location: inv.shop,
          workflow_state: inv.fulfillment || undefined,
        },
        href: alt
          ? `/orders/alterations/${encodeURIComponent(alt)}`
          : `/invoices/${encodeURIComponent(id)}`,
      });
    }

    // Newest / most actionable first: unpaid & overdue, then in-work, then by date
    rows.sort((a, b) => {
      const score = (r: OrderRow) => {
        let s = 0;
        if (r.payTone === "rose") s += 100;
        if (r.outstanding > 0.02) s += 40;
        const f = computeFulfillment(r.fulfillment).key;
        if (f === "Ready Rack" || f === "Out for Delivery") s += 30;
        if (f === "At Store" || f === "At Home Tailor" || f === "In Production") s += 15;
        if (r.rush) s += 10;
        return s;
      };
      const d = score(b) - score(a);
      if (d) return d;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });

    return rows;
  }, [ticketRows, invoiceRows]);

  const counts = useMemo(() => {
    const all = unified;
    return {
      all: all.length,
      alts: all.filter((r) => r.kind === "alteration").length,
      custom: all.filter((r) => r.kind === "custom").length,
      open_money: all.filter((r) => r.outstanding > 0.02).length,
      in_work: all.filter((r) => {
        const k = computeFulfillment(r.fulfillment).key;
        return k === "At Store" || k === "At Home Tailor" || k === "In Production";
      }).length,
      ready: all.filter((r) => {
        const k = computeFulfillment(r.fulfillment).key;
        return k === "Ready Rack" || k === "Out for Delivery";
      }).length,
      done: all.filter((r) => {
        const k = computeFulfillment(r.fulfillment).key;
        return k === "Picked Up" || k === "Delivered";
      }).length,
    };
  }, [unified]);

  const rows = useMemo(() => {
    let list = unified;
    if (tab === "alts") list = list.filter((r) => r.kind === "alteration");
    if (tab === "custom") list = list.filter((r) => r.kind === "custom");
    if (tab === "open_money") list = list.filter((r) => r.outstanding > 0.02);
    if (tab === "in_work")
      list = list.filter((r) => {
        const k = computeFulfillment(r.fulfillment).key;
        return k === "At Store" || k === "At Home Tailor" || k === "In Production";
      });
    if (tab === "ready")
      list = list.filter((r) => {
        const k = computeFulfillment(r.fulfillment).key;
        return k === "Ready Rack" || k === "Out for Delivery";
      });
    if (tab === "done")
      list = list.filter((r) => {
        const k = computeFulfillment(r.fulfillment).key;
        return k === "Picked Up" || k === "Delivered";
      });

    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter(
        (r) =>
          r.id.toLowerCase().includes(s) ||
          r.customerName.toLowerCase().includes(s) ||
          (r.ticketRef || "").toLowerCase().includes(s) ||
          (r.invoiceRef || "").toLowerCase().includes(s) ||
          (r.fulfillment.lsh_where_detail || "").toLowerCase().includes(s) ||
          (r.fulfillment.assigned_tailor || "").toLowerCase().includes(s),
      );
    }
    return list;
  }, [unified, tab, q]);

  const loading = tickets.isLoading || invoices.isLoading;
  const err = tickets.isError || invoices.isError;
  const live = syncLabel(
    Math.max(tickets.dataUpdatedAt || 0, invoices.dataUpdatedAt || 0),
    tickets.isFetching || invoices.isFetching,
  );
  void nowTick;
  void storeToday;

  return (
    <div className="alts-root min-h-dvh flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div>
          <div className="display text-[28px] leading-none">All orders</div>
          <div className="caps mt-1">Alts · MTM · invoices · fulfillment lights</div>
        </div>
        <div className="flex-1" />
        <div
          className={cn(
            "sf-live",
            (tickets.isFetching || invoices.isFetching) && "is-sync",
            err && "is-down",
          )}
        >
          <span className="dot" />
          {err ? "ERPNext issue" : live}
        </div>
        <Link to="/invoices" className="h-11 px-3 rounded-full border border-brass/30 text-[11px] font-bold uppercase tracking-wide text-cream-dim inline-flex items-center">
          Invoices
        </Link>
        <Link to="/intake/kind" className="btn-brass h-11 px-4 text-xs inline-flex items-center">
          New
        </Link>
      </header>

      {/* Legend */}
      <div className="px-5 pt-3 flex flex-wrap gap-3 text-[10px] text-cream-dim uppercase tracking-wider font-bold">
        <span className="inline-flex items-center gap-1.5">
          <i className="w-2 h-2 rounded-full bg-signal-rose" /> In work
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="w-2 h-2 rounded-full bg-signal-amber" /> Ready / out
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="w-2 h-2 rounded-full bg-signal-emerald" /> Done
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="w-2 h-2 rounded-full bg-brass" /> Custom / other
        </span>
      </div>

      <div className="px-5 py-3 flex flex-wrap gap-2 items-center">
        {(
          [
            ["all", "All", counts.all],
            ["alts", "Alterations", counts.alts],
            ["custom", "MTM / custom", counts.custom],
            ["open_money", "Money open", counts.open_money],
            ["in_work", "In work", counts.in_work],
            ["ready", "Ready", counts.ready],
            ["done", "Done", counts.done],
          ] as const
        ).map(([k, lab, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "px-3.5 py-2 rounded-full text-[11px] font-bold uppercase tracking-wide border",
              tab === k ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
            <span className="og-count ml-1.5 tabular-nums">{n}</span>
          </button>
        ))}
        <AltsSearchField
          value={q}
          onChange={setQ}
          scope="orders"
          className="ml-auto w-full md:w-[280px]"
        />
      </div>

      {/* Desktop column headers — mirrors Desk SI list */}
      <div className="hidden md:grid px-5 pb-2 grid-cols-[minmax(0,1.4fr)_100px_minmax(0,1.1fr)_64px_88px_minmax(0,0.9fr)] gap-2 text-[9px] font-bold tracking-[0.14em] uppercase text-brass-light border-b border-brass/15">
        <span>Customer</span>
        <span>Pay</span>
        <span>Fulfillment</span>
        <span>Shop</span>
        <span className="text-right">Total</span>
        <span className="text-right">ID</span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-1.5 pt-2">
        <ErpStatusBanner
          onRetry={() => {
            tickets.refetch();
            invoices.refetch();
          }}
        />
        {err && (
          <QueryErrorPanel
            title="Could not load orders"
            message={
              (tickets.error instanceof Error && tickets.error.message) ||
              (invoices.error instanceof Error && invoices.error.message) ||
              "List failed. Retry."
            }
            onRetry={() => {
              tickets.refetch();
              invoices.refetch();
            }}
          />
        )}
        {loading && <ListSkeleton rows={8} />}

        {!err &&
          rows.map((r) => {
            const f = computeFulfillment(r.fulfillment);
            const due =
              r.kind === "alteration" && r.date
                ? fmtDue(r.date)
                : { kind: "ok" as const, text: "", label: r.date || "—" };
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => nav(r.href)}
                className={cn(
                  "og-row sf-card w-full text-left card-glass",
                  "md:grid md:grid-cols-[minmax(0,1.4fr)_100px_minmax(0,1.1fr)_64px_88px_minmax(0,0.9fr)] md:gap-2 md:items-center",
                  "flex flex-col gap-2 md:flex-row",
                  due.kind === "late" && "border-l-2 border-l-signal-rose",
                  r.payTone === "rose" && "border-l-2 border-l-signal-rose",
                )}
              >
                {/* Customer */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="sf-avatar shrink-0" aria-hidden>
                    {clientInitials(r.customerName)}
                  </span>
                  <div className="min-w-0">
                    <div className="display text-[18px] md:text-[20px] leading-none truncate">
                      {r.customerName}
                    </div>
                    <div className="text-[10px] text-cream-dim mt-1 flex flex-wrap gap-1.5 items-center">
                      <span
                        className={cn(
                          "text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border",
                          r.kind === "alteration"
                            ? "border-emerald-500/30 text-emerald-400"
                            : "border-brass/30 text-brass-light",
                        )}
                      >
                        {r.kind === "alteration" ? "Alts" : "MTM / custom"}
                      </span>
                      {r.rush && <span className="badge-rush">Rush</span>}
                      {r.fulfillment.lsh_where_detail && (
                        <span className="truncate max-w-[200px]">{r.fulfillment.lsh_where_detail}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Pay */}
                <div>
                  <span
                    className={cn(
                      "inline-flex text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border",
                      payChipClass(r.payTone),
                    )}
                  >
                    {r.payLabel}
                  </span>
                  {r.outstanding > 0.02 && r.payLabel !== "Unpaid" && r.payLabel !== "Overdue" && (
                    <div className="text-[10px] text-signal-amber mt-1 tabular-nums">
                      due {money(r.outstanding)}
                    </div>
                  )}
                </div>

                {/* Fulfillment */}
                <div className="min-w-0">
                  <FulfillmentChip ticket={r.fulfillment} compact showDetail={false} />
                  {f.detail && (
                    <div className="text-[10px] text-cream-dim mt-1 truncate md:hidden">{f.detail}</div>
                  )}
                </div>

                {/* Shop */}
                <div className="text-[12px] font-bold tracking-wide text-brass-light hidden md:block">
                  {f.shop}
                </div>

                {/* Total */}
                <div className="text-right">
                  <div className="og-money text-[15px]">{money(r.total)}</div>
                  {r.outstanding > 0.02 && (
                    <div className="text-[10px] text-signal-amber tabular-nums">
                      {money(r.outstanding)} open
                    </div>
                  )}
                </div>

                {/* ID */}
                <div className="text-right min-w-0">
                  <div className="font-mono text-[11px] text-brass-light truncate">{r.id}</div>
                  {r.ticketRef && r.invoiceRef && r.ticketRef !== r.id && (
                    <div className="font-mono text-[9px] text-cream-dim truncate">{r.invoiceRef}</div>
                  )}
                  <div className="og-chev text-[10px] mt-0.5">Open →</div>
                </div>
              </button>
            );
          })}

        {!loading && !err && !rows.length && (
          <div className="sf-empty">No orders match this filter.</div>
        )}
      </div>
    </div>
  );
}
