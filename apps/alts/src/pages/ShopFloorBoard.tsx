import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { billingStatusLabel } from "@alts/lib/billingLabels";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";
import { storeToday } from "@alts/lib/storeDate";

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
type ViewMode = "board" | "tailor" | "calendar" | "table";

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

function money(n?: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}

function TicketCard({
  t,
  col,
  next,
  onOpen,
  onAdvance,
  pending,
}: {
  t: Ticket;
  col: string;
  next: { status: string; label: string } | null;
  onOpen: () => void;
  onAdvance: () => void;
  pending: boolean;
}) {
  const due = fmtDue(t.due_date);
  const nonBill =
    t.billing_status === "Warranty" || t.billing_status === "Included in Custom Order";
  return (
    <div
      className={cn(
        "w-full text-left rounded-xl border border-brass/20 bg-black/25 p-3 transition-colors",
        due.kind === "late" && "border-l-2 border-l-signal-rose",
        due.kind === "soon" && "border-l-2 border-l-signal-amber",
        col === "Picked Up" && "opacity-55",
      )}
    >
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[12px] font-mono text-brass-light truncate">{t.name}</span>
          {due.kind === "late" && <span className="badge-late">{due.text}</span>}
          {due.kind === "soon" && <span className="badge-soon">{due.text}</span>}
        </div>
        <div className="font-semibold text-sm truncate">{t.customer_name || "—"}</div>
        <div className="flex items-center gap-2 mt-2 text-[12px] text-cream-dim">
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
          <div className="text-xs text-[var(--vi,#9B8BC4)] mt-1">
            {billingStatusLabel(t.billing_status)}
            {t.linked_sales_order ? ` · ${t.linked_sales_order}` : ""}
          </div>
        )}
        {t.payment_status &&
          t.payment_status !== "Paid" &&
          t.payment_status !== "N/A" &&
          col === "Ready" && (
            <div className="text-[12px] text-signal-amber mt-1">{t.payment_status}</div>
          )}
      </button>
      {next && (
        <button
          type="button"
          disabled={pending}
          onClick={(e) => {
            e.stopPropagation();
            onAdvance();
          }}
          className="mt-2 w-full h-9 rounded-lg border border-brass/30 text-[12px] font-bold tracking-widest uppercase text-brass-light hover:bg-brass/15 disabled:opacity-40"
        >
          {next.label} →
        </button>
      )}
    </div>
  );
}

export default function ShopFloorBoard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "today" | "unassigned" | "unpaid">("all");
  const [view, setView] = useState<ViewMode>("board");

  const tickets = useQuery({
    queryKey: ["shop-floor-tickets"],
    queryFn: () => api.get<Ticket[]>("/api/intake-alterations/tickets?limit=500"),
    refetchInterval: 60_000,
  });

  const advance = useMutation({
    mutationFn: async ({ name, status }: { name: string; status: string }) => {
      if (status === "Picked Up") {
        nav(`/pickup?ticket=${encodeURIComponent(name)}`);
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
      const today = storeToday();
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
  }, [tickets.data, q, filter]);

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

  const byTailor = useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const t of list.filter((x) => x.workflow_state !== "Picked Up" && x.workflow_state !== "Cancelled")) {
      const key = t.assigned_tailor?.trim() || "Unassigned";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return [...m.entries()].sort((a, b) => {
      if (a[0] === "Unassigned") return -1;
      if (b[0] === "Unassigned") return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [list]);

  const byDue = useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const t of list.filter((x) => x.workflow_state !== "Cancelled")) {
      const key = t.due_date || "No due date";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return [...m.entries()].sort((a, b) => {
      if (a[0] === "No due date") return 1;
      if (b[0] === "No due date") return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [list]);

  const kpis = useMemo(() => {
    const open = list.filter((t) => t.workflow_state !== "Picked Up" && t.workflow_state !== "Cancelled");
    const overdue = open.filter((t) => daysLate(t.due_date) > 0).length;
    const today = storeToday();
    const dueToday = open.filter((t) => t.due_date === today).length;
    const unassigned = open.filter((t) => !t.assigned_tailor).length;
    const ready = list.filter((t) => t.workflow_state === "Ready").length;
    return { overdue, dueToday, inShop: open.length, unassigned, ready };
  }, [list]);

  return (
    <div className="alts-root flex flex-col min-h-dvh">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <BrandSeal />
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
        <div className="flex items-center rounded-full border border-brass/20 bg-black/30 px-3 py-2 text-[12px] font-bold tracking-widest uppercase text-brass-light">
          NYC
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

      <div className="flex gap-2 px-5 pb-2 flex-wrap">
        {(
          [
            ["board", "Board"],
            ["tailor", "By tailor"],
            ["calendar", "Calendar"],
            ["table", "Table"],
          ] as const
        ).map(([k, lab]) => (
          <button
            key={k}
            type="button"
            onClick={() => setView(k)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border min-h-11",
              view === k ? "bg-brass text-forest-deep border-brass" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
          </button>
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
        <Link to="/pickup" className="ml-auto btn-brass h-10 px-4 text-[12px] inline-flex items-center">
          Pickup counter
        </Link>
        <Link to="/intake/kind" className="btn-ghost h-10 px-4 text-[12px] inline-flex items-center">
          + New ticket
        </Link>
      </div>

      <div className="flex-1 overflow-x-auto px-5 pb-6">
        {tickets.isError && (
          <div className="mb-3">
            <QueryErrorPanel
              title="Could not load shop floor"
              message="Ticket board failed to load. Retry — empty columns are not the same as an outage."
              onRetry={() => tickets.refetch()}
            />
          </div>
        )}

        {view === "board" && (
          <div className="shop-floor-board-cols flex gap-3 min-w-[900px] h-full min-h-[420px]">
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
                  {(byCol[col] ?? []).slice(0, 40).map((t) => (
                    <TicketCard
                      key={t.name}
                      t={t}
                      col={col}
                      next={NEXT[col]}
                      pending={advance.isPending}
                      onOpen={() => nav(`/orders/alterations/${t.name}`)}
                      onAdvance={() =>
                        advance.mutate({ name: t.name, status: NEXT[col]!.status })
                      }
                    />
                  ))}
                  {tickets.isLoading && <div className="text-cream-dim text-sm p-3">Loading…</div>}
                  {!tickets.isLoading && !(byCol[col]?.length) && (
                    <div className="text-cream-dim text-sm p-3 italic">Empty</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {view === "tailor" && (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {byTailor.map(([tailor, rows]) => (
              <div key={tailor} className="card-glass overflow-hidden flex flex-col min-h-[200px]">
                <div className="flex items-center gap-2 px-3 py-3 border-b border-brass/15">
                  <b className="text-sm font-semibold truncate">{tailor}</b>
                  <span className="ml-auto text-xs text-cream-dim">{rows.length}</span>
                </div>
                <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[420px]">
                  {rows.map((t) => (
                    <TicketCard
                      key={t.name}
                      t={t}
                      col={t.workflow_state || "Received"}
                      next={NEXT[t.workflow_state || "Received"] ?? null}
                      pending={advance.isPending}
                      onOpen={() => nav(`/orders/alterations/${t.name}`)}
                      onAdvance={() => {
                        const n = NEXT[t.workflow_state || "Received"];
                        if (n) advance.mutate({ name: t.name, status: n.status });
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
            {!byTailor.length && !tickets.isLoading && (
              <p className="text-cream-dim text-sm italic">No open tickets</p>
            )}
          </div>
        )}

        {view === "calendar" && (
          <div className="space-y-4 max-w-3xl">
            {byDue.map(([due, rows]) => {
              const dueMeta = due === "No due date" ? null : fmtDue(due);
              return (
                <div key={due} className="card-glass overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-brass/15">
                    <b className="text-sm font-semibold">
                      {due === "No due date" ? "No due date" : fmtDue(due).label}
                    </b>
                    {dueMeta?.kind === "late" && <span className="badge-late">{dueMeta.text}</span>}
                    {dueMeta?.kind === "soon" && <span className="badge-soon">{dueMeta.text}</span>}
                    <span className="ml-auto text-xs text-cream-dim">{rows.length}</span>
                  </div>
                  <div className="divide-y divide-brass/10">
                    {rows.map((t) => (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => nav(`/orders/alterations/${t.name}`)}
                        className="w-full text-left px-4 py-3 hover:bg-brass/10 flex items-center gap-3 min-h-11"
                      >
                        <span className="font-mono text-[12px] text-brass-light shrink-0">{t.name}</span>
                        <span className="font-semibold text-sm truncate flex-1">
                          {t.customer_name || "—"}
                        </span>
                        <span className="chip shrink-0">{t.workflow_state}</span>
                        <span className="text-[12px] text-cream-dim shrink-0 hidden sm:inline">
                          {t.assigned_tailor || "Unassigned"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === "table" && (
          <div className="card-glass overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-wider text-cream-dim border-b border-brass/15">
                  <th className="px-3 py-3 font-bold">Ticket</th>
                  <th className="px-3 py-3 font-bold">Client</th>
                  <th className="px-3 py-3 font-bold">Status</th>
                  <th className="px-3 py-3 font-bold">Tailor</th>
                  <th className="px-3 py-3 font-bold">Due</th>
                  <th className="px-3 py-3 font-bold text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => {
                  const due = fmtDue(t.due_date);
                  return (
                    <tr
                      key={t.name}
                      className="border-b border-brass/10 hover:bg-brass/10 cursor-pointer"
                      onClick={() => nav(`/orders/alterations/${t.name}`)}
                    >
                      <td className="px-3 py-3 font-mono text-[12px] text-brass-light">{t.name}</td>
                      <td className="px-3 py-3 font-semibold">{t.customer_name || "—"}</td>
                      <td className="px-3 py-3">
                        <span className="chip">{t.workflow_state || "—"}</span>
                      </td>
                      <td className="px-3 py-3 text-cream-dim">{t.assigned_tailor || "Unassigned"}</td>
                      <td
                        className={cn(
                          "px-3 py-3",
                          due.kind === "late" && "text-signal-rose",
                          due.kind === "soon" && "text-signal-amber",
                        )}
                      >
                        {due.label}
                        {due.kind !== "ok" ? ` · ${due.text}` : ""}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(t.ticket_total)}</td>
                    </tr>
                  );
                })}
                {!list.length && !tickets.isLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-cream-dim italic text-center">
                      No tickets match
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
