import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@ls/design/utils";
import "@alts/styles/alts-pos.css";

type Ticket = {
  name: string;
  customer_name?: string;
  workflow_state?: string;
  due_date?: string;
  is_rush?: number;
  ticket_total?: number;
  payment_status?: string;
  billing_status?: string;
  assigned_tailor?: string;
  origin_location?: string;
  linked_sales_order?: string;
};

const COLS = ["Received", "In Progress", "Ready", "Picked Up"] as const;

const NEXT: Record<string, { status: string; label: string } | null> = {
  Received: { status: "In Progress", label: "Start" },
  "In Progress": { status: "Ready", label: "Ready" },
  Ready: { status: "Picked Up", label: "Pickup" },
  "Picked Up": null,
};

function daysLate(due?: string) {
  if (!due) return 0;
  const d = new Date(due + "T12:00:00");
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.floor((today.getTime() - d.getTime()) / 86400000);
}

function fmtDue(due?: string): { text: string; kind: "late" | "soon" | "ok"; label: string } {
  if (!due) return { text: "—", kind: "ok", label: "—" };
  const late = daysLate(due);
  const d = new Date(due + "T12:00:00");
  const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (late > 0) return { text: `${late}d late`, kind: "late", label };
  if (late === 0) return { text: "Due today", kind: "soon", label };
  return { text: `Due ${label}`, kind: "ok", label };
}

export default function ShopFloorBoard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "today" | "unassigned" | "unpaid">("all");
  const [loc, setLoc] = useState<"NYC" | "HOU" | "All">("All");

  const tickets = useQuery({
    queryKey: ["shop-floor-tickets"],
    queryFn: () => api.get<Ticket[]>("/api/intake-alterations/tickets?limit=200"),
    refetchInterval: 60_000,
  });

  const advance = useMutation({
    mutationFn: async ({ name, status }: { name: string; status: string }) => {
      if (status === "Picked Up") {
        nav("/pickup");
        return null;
      }
      return api.patch(`/api/intake-alterations/tickets/${encodeURIComponent(name)}/status`, { status });
    },
    onSuccess: (_d, vars) => {
      if (vars.status !== "Picked Up") {
        toast.success(`${vars.name} → ${vars.status}`);
        qc.invalidateQueries({ queryKey: ["shop-floor-tickets"] });
        qc.invalidateQueries({ queryKey: ["alts-home-stats"] });
      }
    },
    onError: (e: Error) => toast.error(e.message || "Status update failed"),
  });

  const list = useMemo(() => {
    let rows = tickets.data ?? [];
    if (loc !== "All") rows = rows.filter((t) => (t.origin_location || "NYC") === loc);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      rows = rows.filter(
        (t) =>
          t.name?.toLowerCase().includes(s) ||
          t.customer_name?.toLowerCase().includes(s) ||
          t.assigned_tailor?.toLowerCase().includes(s) ||
          t.linked_sales_order?.toLowerCase().includes(s),
      );
    }
    if (filter === "today") {
      const today = new Date().toISOString().slice(0, 10);
      rows = rows.filter((t) => t.due_date === today);
    }
    if (filter === "unassigned") {
      rows = rows.filter((t) => !t.assigned_tailor && t.workflow_state !== "Picked Up");
    }
    if (filter === "unpaid") {
      rows = rows.filter(
        (t) =>
          t.workflow_state === "Ready" &&
          t.payment_status !== "Paid" &&
          t.payment_status !== "N/A" &&
          (Number(t.ticket_total) || 0) > 0,
      );
    }
    return rows;
  }, [tickets.data, q, filter, loc]);

  const byCol = useMemo(() => {
    const m: Record<string, Ticket[]> = {};
    for (const c of COLS) m[c] = [];
    for (const t of list) {
      const st = t.workflow_state || "Received";
      if (m[st]) m[st].push(t);
      else m["Received"].push(t);
    }
    return m;
  }, [list]);

  const kpis = useMemo(() => {
    const open = list.filter((t) => t.workflow_state !== "Picked Up" && t.workflow_state !== "Cancelled");
    const overdue = open.filter((t) => daysLate(t.due_date) > 0).length;
    const today = new Date().toISOString().slice(0, 10);
    const dueToday = open.filter((t) => t.due_date === today).length;
    const unassigned = open.filter((t) => !t.assigned_tailor).length;
    const ready = list.filter((t) => t.workflow_state === "Ready").length;
    return { overdue, dueToday, inShop: open.length, unassigned, ready };
  }, [list]);

  return (
    <div className="alts-root flex flex-col min-h-screen">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <Link to="/" className="seal">
          LS
        </Link>
        <div>
          <div className="display text-xl">Shop Floor</div>
          <div className="caps">Alterations workload</div>
        </div>
        <div className="flex-1" />
        <div className="hidden md:flex items-center gap-2 rounded-full border border-brass/20 bg-black/30 px-3 h-11 min-w-[220px]">
          <span className="text-cream-dim">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ticket, name, tailor, SO…"
            className="bg-transparent outline-none text-sm flex-1 text-cream placeholder:text-cream-dim"
          />
        </div>
        <div className="flex gap-1 rounded-full border border-brass/20 bg-black/30 p-1">
          {(["NYC", "HOU", "All"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLoc(l)}
              className={cn(
                "px-3 py-2 rounded-full text-[11px] font-bold tracking-widest uppercase",
                loc === l ? "bg-brass text-forest-deep" : "text-cream-dim",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 px-5 py-4">
        {[
          { v: kpis.overdue, l: "Overdue", alert: true },
          { v: kpis.dueToday, l: "Due today", warn: true },
          { v: kpis.inShop, l: "In the shop" },
          { v: kpis.unassigned, l: "Unassigned", warn: true },
          { v: kpis.ready, l: "Ready" },
        ].map((k) => (
          <div
            key={k.l}
            className={cn(
              "card-glass px-4 py-3",
              k.alert && k.v > 0 && "border-signal-rose/40",
              k.warn && k.v > 0 && "border-signal-amber/40",
            )}
          >
            <div
              className={cn(
                "display text-3xl",
                k.alert && k.v > 0 && "text-signal-rose",
                k.warn && k.v > 0 && "text-signal-amber",
              )}
            >
              {k.v}
            </div>
            <div className="caps mt-1">{k.l}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 px-5 pb-3 flex-wrap">
        {(
          [
            ["all", "All work"],
            ["today", "Due today"],
            ["unassigned", "Unassigned"],
            ["unpaid", "Ready unpaid"],
          ] as const
        ).map(([k, lab]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border",
              filter === k ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
          </button>
        ))}
        <Link to="/pickup" className="ml-auto btn-brass h-10 px-4 text-[11px] inline-flex items-center">
          Pickup counter
        </Link>
        <Link to="/intake/kind" className="btn-ghost h-10 px-4 text-[11px] inline-flex items-center">
          + New ticket
        </Link>
      </div>

      <div className="flex-1 overflow-x-auto px-5 pb-6">
        <div className="flex gap-3 min-w-[900px] h-full min-h-[420px]">
          {COLS.map((col) => (
            <div key={col} className="flex-1 min-w-[210px] flex flex-col card-glass overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-3 border-b border-brass/15">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full",
                    col === "Received" && "bg-cream-dim",
                    col === "In Progress" && "bg-signal-amber",
                    col === "Ready" && "bg-signal-emerald",
                    col === "Picked Up" && "bg-brass/50",
                  )}
                />
                <b className="text-sm font-semibold">{col}</b>
                <span className="ml-auto text-xs text-cream-dim">{byCol[col]?.length ?? 0}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {(byCol[col] ?? []).slice(0, 40).map((t) => {
                  const due = fmtDue(t.due_date);
                  const next = NEXT[col];
                  const nonBill =
                    t.billing_status === "Warranty" || t.billing_status === "Included in Custom Order";
                  return (
                    <div
                      key={t.name}
                      className={cn(
                        "w-full text-left rounded-xl border border-brass/20 bg-black/25 p-3 transition-colors",
                        due.kind === "late" && "border-l-2 border-l-signal-rose",
                        due.kind === "soon" && "border-l-2 border-l-signal-amber",
                        col === "Picked Up" && "opacity-55",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => nav(`/orders/alterations/${t.name}`)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-mono text-brass-light truncate">{t.name}</span>
                          {due.kind === "late" && <span className="badge-late">{due.text}</span>}
                          {due.kind === "soon" && <span className="badge-soon">{due.text}</span>}
                        </div>
                        <div className="font-semibold text-sm truncate">{t.customer_name || "—"}</div>
                        <div className="flex items-center gap-2 mt-2 text-[11px] text-cream-dim">
                          <span>
                            {t.assigned_tailor ? (
                              t.assigned_tailor
                            ) : col !== "Picked Up" ? (
                              <span className="text-brass-light">Assign tailor</span>
                            ) : (
                              "—"
                            )}
                          </span>
                          <span className="ml-auto">{due.label}</span>
                        </div>
                        {nonBill && (
                          <div className="text-[10px] text-[var(--vi,#9B8BC4)] mt-1">
                            {t.billing_status}
                            {t.linked_sales_order ? ` · ${t.linked_sales_order}` : ""}
                          </div>
                        )}
                        {t.payment_status && t.payment_status !== "Paid" && t.payment_status !== "N/A" && col === "Ready" && (
                          <div className="text-[10px] text-signal-amber mt-1">{t.payment_status}</div>
                        )}
                      </button>
                      {next && (
                        <button
                          type="button"
                          disabled={advance.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            advance.mutate({ name: t.name, status: next.status });
                          }}
                          className="mt-2 w-full h-9 rounded-lg border border-brass/30 text-[10px] font-bold tracking-widest uppercase text-brass-light hover:bg-brass/15 disabled:opacity-40"
                        >
                          {next.label} →
                        </button>
                      )}
                    </div>
                  );
                })}
                {tickets.isLoading && <div className="text-cream-dim text-sm p-3">Loading…</div>}
                {!tickets.isLoading && !(byCol[col]?.length) && (
                  <div className="text-cream-dim text-sm p-3 italic">Empty</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
