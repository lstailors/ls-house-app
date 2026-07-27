import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@ls/design/utils";
import "@alts/styles/alts-pos.css";

type Ticket = {
  name: string;
  customer_name?: string;
  workflow_state?: string;
  due_date?: string;
  ticket_total?: number;
  payment_status?: string;
  is_rush?: number;
  origin_location?: string;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function daysLate(due?: string) {
  if (!due) return 0;
  const d = new Date(due + "T12:00:00");
  const t = new Date();
  t.setHours(12, 0, 0, 0);
  return Math.floor((t.getTime() - d.getTime()) / 86400000);
}

export default function OrdersGlass() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "due" | "ready" | "unpaid" | "open">("open");

  const tickets = useQuery({
    queryKey: ["orders-glass"],
    queryFn: () => api.get<Ticket[]>("/api/intake-alterations/tickets?limit=200"),
    refetchInterval: 45_000,
  });

  const rows = useMemo(() => {
    let list = tickets.data ?? [];
    const today = new Date().toISOString().slice(0, 10);
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
          (t.workflow_state === "Ready" || t.workflow_state === "Picked Up"),
      );
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter(
        (t) => t.name.toLowerCase().includes(s) || t.customer_name?.toLowerCase().includes(s),
      );
    }
    return list;
  }, [tickets.data, tab, q]);

  return (
    <div className="alts-root min-h-screen flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <Link to="/" className="seal">
          LS
        </Link>
        <div>
          <div className="display text-xl">Orders</div>
          <div className="caps">Tickets · due · unpaid</div>
        </div>
        <div className="flex-1" />
        <Link to="/intake/kind" className="btn-brass h-11 px-4 text-[11px] inline-flex items-center">
          New
        </Link>
      </header>

      <div className="px-5 py-3 flex flex-wrap gap-2 items-center">
        {(
          [
            ["open", "Open"],
            ["due", "Due / late"],
            ["ready", "Ready"],
            ["unpaid", "Released unpaid"],
            ["all", "All"],
          ] as const
        ).map(([k, lab]) => (
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
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="ml-auto h-10 rounded-full bg-black/30 border border-brass/25 px-4 text-sm text-cream outline-none min-w-[180px]"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-2">
        {rows.map((t) => {
          const late = daysLate(t.due_date);
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => nav(`/orders/alterations/${t.name}`)}
              className={cn(
                "w-full text-left card-glass px-4 py-3.5 flex items-center gap-3",
                late > 0 && "border-l-2 border-l-signal-rose",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] text-brass-light">{t.name}</span>
                  <span className="chip">{t.workflow_state}</span>
                  {late > 0 && <span className="badge-late">{late}d late</span>}
                  {t.payment_status && t.payment_status !== "Paid" && t.payment_status !== "N/A" && (
                    <span className="text-[10px] text-signal-amber font-bold uppercase">{t.payment_status}</span>
                  )}
                </div>
                <div className="font-semibold mt-0.5 truncate">{t.customer_name}</div>
                <div className="text-xs text-cream-dim mt-0.5">
                  {t.origin_location || "NYC"}
                  {t.due_date ? ` · due ${t.due_date}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="display text-xl text-brass-light">{money(Number(t.ticket_total) || 0)}</div>
                <div className="text-[10px] text-cream-dim">→</div>
              </div>
            </button>
          );
        })}
        {tickets.isLoading && <p className="text-cream-dim p-4">Loading…</p>}
        {!tickets.isLoading && !rows.length && (
          <p className="text-cream-dim p-8 text-center italic">No tickets in this filter</p>
        )}
      </div>
    </div>
  );
}
