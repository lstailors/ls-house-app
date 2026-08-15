import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import ErpStatusBanner from "@alts/components/ErpStatusBanner";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";
import { storeToday } from "@alts/lib/storeDate";
import {
  clientInitials,
  daysLate,
  fmtDue,
  fmtTime,
  hoursLeft,
  isRush,
  sortShopTickets,
  storeHour,
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
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function emptyCopy(tab: string) {
  if (tab === "due") return "Nothing due or late. The bench is clear.";
  if (tab === "ready") return "Nothing waiting at the counter.";
  if (tab === "unpaid") return "No released tickets still unpaid.";
  if (tab === "open") return "No open tickets.";
  return "No tickets came back from ERPNext.";
}

export default function OrdersGlass() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "due" | "ready" | "unpaid" | "open">(
    storeHour() < 12 ? "due" : "open",
  );
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const tickets = useQuery({
    queryKey: ["orders-glass"],
    queryFn: () => api.get<Ticket[]>("/api/intake-alterations/tickets?limit=500"),
    refetchInterval: 45_000,
  });

  const counts = useMemo(() => {
    const all = tickets.data ?? [];
    const today = storeToday();
    return {
      open: all.filter((t) => t.workflow_state !== "Picked Up" && t.workflow_state !== "Cancelled").length,
      due: all.filter((t) => t.due_date === today || daysLate(t.due_date) > 0).length,
      ready: all.filter((t) => t.workflow_state === "Ready").length,
      unpaid: all.filter(
        (t) =>
          t.payment_status &&
          t.payment_status !== "Paid" &&
          t.payment_status !== "N/A" &&
          t.workflow_state === "Picked Up",
      ).length,
      all: all.length,
    };
  }, [tickets.data]);

  const rows = useMemo(() => {
    let list = tickets.data ?? [];
    const today = storeToday();
    if (tab === "open")
      list = list.filter((t) => t.workflow_state !== "Picked Up" && t.workflow_state !== "Cancelled");
    if (tab === "due") list = list.filter((t) => t.due_date === today || daysLate(t.due_date) > 0);
    if (tab === "ready") list = list.filter((t) => t.workflow_state === "Ready");
    if (tab === "unpaid")
      list = list.filter(
        (t) =>
          t.payment_status &&
          t.payment_status !== "Paid" &&
          t.payment_status !== "N/A" &&
          t.workflow_state === "Picked Up",
      );
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(s) ||
          t.customer_name?.toLowerCase().includes(s) ||
          t.assigned_tailor?.toLowerCase().includes(s),
      );
    }
    return [...list].sort(sortShopTickets);
  }, [tickets.data, tab, q]);

  const live = syncLabel(tickets.dataUpdatedAt, tickets.isFetching);
  void nowTick;

  return (
    <div className="alts-root min-h-dvh flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div>
          <div className="display text-[28px] leading-none">Orders</div>
          <div className="caps mt-1">
            {storeHour() < 12 ? "Morning bench · due first" : "Tickets · due · unpaid"}
          </div>
        </div>
        <div className="flex-1" />
        <div
          className={cn("sf-live", tickets.isFetching && "is-sync", tickets.isError && "is-down")}
        >
          <span className="dot" />
          {tickets.isError ? "ERPNext down" : live}
        </div>
        <Link to="/intake/kind" className="btn-brass h-11 px-4 text-xs inline-flex items-center">
          New
        </Link>
      </header>

      <div className="px-5 py-3 flex flex-wrap gap-2 items-center">
        {(
          [
            ["open", "Open", counts.open],
            ["due", "Due / late", counts.due],
            ["ready", "Ready", counts.ready],
            ["unpaid", "Released unpaid", counts.unpaid],
            ["all", "All", counts.all],
          ] as const
        ).map(([k, lab, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border",
              tab === k ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
            <span className="og-count">{n}</span>
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ticket, name, tailor…"
          className="ml-auto h-11 rounded-full bg-black/30 border border-brass/25 px-4 text-sm text-cream outline-none min-w-[180px] w-full md:w-auto"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-2">
        <ErpStatusBanner onRetry={() => tickets.refetch()} />
        {tickets.isError && (
          <QueryErrorPanel
            title="Could not load orders"
            message={tickets.error instanceof Error ? tickets.error.message : "Ticket list failed. Retry — do not treat this as an empty filter."}
            onRetry={() => tickets.refetch()}
          />
        )}
        {tickets.isLoading && <p className="text-cream-dim p-4">Loading…</p>}
        {!tickets.isError &&
          rows.map((t) => {
            const due = fmtDue(t.due_date);
            const time = fmtTime(t.due_time);
            const left = hoursLeft(t.due_date, t.due_time);
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => nav(`/orders/alterations/${t.name}`)}
                className={cn(
                  "og-row sf-card w-full text-left card-glass px-4 py-3.5 flex items-center gap-3",
                  due.kind === "late" && "is-late border-l-2 border-l-signal-rose",
                  due.kind === "soon" && "border-l-2 border-l-signal-amber",
                  isRush(t) && due.kind === "ok" && "border-l-2 border-l-brass",
                )}
              >
                <span className="sf-avatar" aria-hidden>
                  {clientInitials(t.customer_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-brass-light">{t.name}</span>
                    <span className="chip">{t.workflow_state}</span>
                    {isRush(t) && <span className="badge-rush">Rush</span>}
                    {due.kind === "late" && <span className="badge-late">{due.text}</span>}
                    {due.kind === "soon" && <span className="badge-soon">{due.text}</span>}
                    {t.payment_status && t.payment_status !== "Paid" && t.payment_status !== "N/A" && (
                      <span className="text-xs text-signal-amber font-bold uppercase">{t.payment_status}</span>
                    )}
                  </div>
                  <div className="display text-[22px] leading-none mt-1 truncate flex items-center gap-2">
                    <span className="truncate">{t.customer_name || "—"}</span>
                    {t.customer && (
                      <span
                        role="link"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          nav(`/customers/${encodeURIComponent(t.customer!)}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation();
                            nav(`/customers/${encodeURIComponent(t.customer!)}`);
                          }
                        }}
                        className="text-[10px] uppercase tracking-widest text-brass-light font-bold shrink-0 hover:underline"
                      >
                        Profile
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-cream-dim mt-1">
                    {t.origin_location || "NYC"}
                    {t.assigned_tailor ? ` · ${t.assigned_tailor}` : ""}
                    {due.label !== "—" ? ` · ${due.label}` : ""}
                    {time ? ` · ${time}` : ""}
                    {left ? ` · ${left}` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="display text-xl text-brass-light">{money(Number(t.ticket_total) || 0)}</div>
                  <div className="text-xs text-cream-dim">→</div>
                </div>
              </button>
            );
          })}
        {!tickets.isLoading && !tickets.isError && !rows.length && (
          <div className="sf-empty">{emptyCopy(tab)}</div>
        )}
      </div>
    </div>
  );
}
