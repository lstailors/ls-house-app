import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { billingStatusLabel } from "@alts/lib/billingLabels";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import ErpStatusBanner from "@alts/components/ErpStatusBanner";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";
import { AltsSearchField } from "@alts/components/AltsSearchField";
import { KanbanSkeleton, ListSkeleton } from "@alts/components/skeletons";
import { storeToday } from "@alts/lib/storeDate";
import { formatMoney } from "@alts/lib/money";
import { TailorTallyStrip } from "@alts/components/TailorTallyStrip";
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
  customer_name?: string;
  customer_phone?: string;
  workflow_state?: string;
  due_date?: string;
  due_time?: string;
  is_rush?: number;
  ticket_total?: number;
  payment_status?: string;
  billing_status?: string;
  assigned_tailor?: string;
  origin_location?: string;
  linked_sales_order?: string;
  notified_ready_at?: string | null;
};

const COLS = ["Received", "In Progress", "Ready", "Picked Up"] as const;
type ViewMode = "board" | "tailor" | "calendar" | "table";

const NEXT: Record<string, { status: string; label: string } | null> = {
  Received: { status: "In Progress", label: "Start" },
  "In Progress": { status: "Ready", label: "Ready" },
  Ready: { status: "Picked Up", label: "Pickup" },
  "Picked Up": null,
};

function needsReadyText(t: Ticket) {
  return t.workflow_state === "Ready" && !String(t.notified_ready_at ?? "").trim();
}

function money(n?: number) {
  return formatMoney(n);
}

function TicketCard({
  t,
  col,
  next,
  onOpen,
  onAdvance,
  onTextReady,
  pending,
  texting,
}: {
  t: Ticket;
  col: string;
  next: { status: string; label: string } | null;
  onOpen: () => void;
  onAdvance: () => void;
  onTextReady?: () => void;
  pending: boolean;
  texting?: boolean;
}) {
  const due = fmtDue(t.due_date);
  const time = fmtTime(t.due_time);
  const left = hoursLeft(t.due_date, t.due_time);
  const nonBill =
    t.billing_status === "Warranty" || t.billing_status === "Included in Custom Order";
  const textReady = col === "Ready" && needsReadyText(t);
  return (
    <div
      className={cn(
        "sf-card w-full text-left rounded-xl border border-brass/20 bg-black/25 p-3",
        due.kind === "late" && "is-late border-l-2 border-l-signal-rose",
        due.kind === "soon" && "border-l-2 border-l-signal-amber",
        isRush(t) && due.kind === "ok" && "border-l-2 border-l-brass",
        !t.assigned_tailor && col !== "Picked Up" && "border-brass/35",
        col === "Picked Up" && "opacity-55",
      )}
    >
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="flex items-start gap-2.5">
          <span className="sf-avatar" aria-hidden>
            {clientInitials(t.customer_name)}
          </span>
          <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[12px] font-mono text-brass-light truncate">{t.name}</span>
          {isRush(t) && <span className="badge-rush">Rush</span>}
          {due.kind === "late" && <span className="badge-late">{due.text}</span>}
          {due.kind === "soon" && <span className="badge-soon">{due.text}</span>}
        </div>
        <div className="display text-[22px] leading-none truncate">{t.customer_name || "—"}</div>
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
          <span className="ml-auto">
            {due.label}
            {time ? ` · ${time}` : ""}
            {left ? ` · ${left}` : ""}
          </span>
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
        {textReady && (
          <div className="text-[12px] text-signal-amber mt-1">Ready — customer not texted</div>
        )}
          </div>
        </div>
      </button>
      {textReady && onTextReady && (
        <button
          type="button"
          disabled={texting}
          onClick={(e) => {
            e.stopPropagation();
            onTextReady();
          }}
          className="mt-2 w-full h-9 rounded-lg border border-signal-amber/40 text-[12px] font-bold tracking-widest uppercase text-signal-amber hover:bg-signal-amber/15 disabled:opacity-40"
        >
          {texting ? "Texting…" : "Text ready"}
        </button>
      )}
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

type FloorFilter = "all" | "overdue" | "morning" | "today" | "unassigned" | "unpaid" | "text" | "ready";

const FILTER_KEYS: FloorFilter[] = ["all", "overdue", "morning", "today", "unassigned", "unpaid", "text", "ready"];

function parseFloorFilter(raw: string | null, fallback: FloorFilter): FloorFilter {
  if (raw && FILTER_KEYS.includes(raw as FloorFilter)) return raw as FloorFilter;
  return fallback;
}

export default function ShopFloorBoard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FloorFilter>(() =>
    parseFloorFilter(params.get("filter"), storeHour() < 12 ? "morning" : "all"),
  );
  const [view, setView] = useState<ViewMode>("board");
  const [showPickedUp, setShowPickedUp] = useState(false);
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const next = parseFloorFilter(params.get("filter"), filter);
    if (next !== filter) setFilter(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function applyFilter(k: FloorFilter) {
    setFilter(k);
    const next = new URLSearchParams(params);
    if (k === "all") next.delete("filter");
    else next.set("filter", k);
    setParams(next, { replace: true });
  }

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

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

  const textReady = useMutation({
    mutationFn: (name: string) =>
      api.post(`/api/intake-alterations/tickets/${encodeURIComponent(name)}/notify-ready`, {}),
    onSuccess: (_d, name) => {
      toast.success(`${name} — ready text sent`);
      qc.invalidateQueries({ queryKey: ["shop-floor-tickets"] });
      qc.invalidateQueries({ queryKey: ["alts-home-stats"] });
    },
    onError: (e: Error) => toast.error(e.message || "Text failed"),
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
    if (filter === "overdue") {
      rows = rows.filter(
        (t) =>
          t.workflow_state !== "Picked Up" &&
          t.workflow_state !== "Cancelled" &&
          daysLate(t.due_date) > 0,
      );
    }
    if (filter === "today") {
      const today = storeToday();
      rows = rows.filter((t) => t.due_date === today);
    }
    if (filter === "morning") {
      const today = storeToday();
      rows = rows.filter(
        (t) =>
          t.workflow_state !== "Picked Up" &&
          (t.due_date === today || daysLate(t.due_date) > 0 || isRush(t)),
      );
    }
    if (filter === "ready") {
      rows = rows.filter((t) => t.workflow_state === "Ready");
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
    if (filter === "text") {
      rows = rows.filter((t) => needsReadyText(t));
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
    for (const c of COLS) m[c]!.sort(sortShopTickets);
    return m;
  }, [list]);

  const byTailor = useMemo(() => {
    const m = new Map<string, Ticket[]>();
    for (const t of list.filter((x) => x.workflow_state !== "Picked Up" && x.workflow_state !== "Cancelled")) {
      const key = t.assigned_tailor?.trim() || "Unassigned";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    for (const rows of m.values()) rows.sort(sortShopTickets);
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
    const needsText = list.filter((t) => needsReadyText(t)).length;
    const rush = open.filter((t) => isRush(t)).length;
    return { overdue, dueToday, inShop: open.length, unassigned, ready, needsText, rush };
  }, [list]);

  const eyes = useMemo(() => {
    const raw = (tickets.data ?? []).filter(
      (t) =>
        t.workflow_state !== "Picked Up" &&
        t.workflow_state !== "Cancelled" &&
        (daysLate(t.due_date) > 0 || isRush(t) || needsReadyText(t)),
    );
    return [...raw].sort(sortShopTickets).slice(0, 8);
  }, [tickets.data]);

  const live = syncLabel(tickets.dataUpdatedAt, tickets.isFetching);
  void nowTick;

  const visibleCols = showPickedUp ? COLS : (["Received", "In Progress", "Ready"] as const);

  return (
    <div className="alts-root flex flex-col min-h-dvh">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div>
          <div className="display text-[28px] leading-none">Shop Floor</div>
          <div className="caps mt-1">
            {storeHour() < 12 ? "Morning bench" : "Alterations workload"}
          </div>
        </div>
        <div className="flex-1" />
        <div
          className={cn("sf-live", tickets.isFetching && "is-sync", tickets.isError && "is-down")}
        >
          <span className="dot" />
          {tickets.isError ? "ERPNext down" : live}
        </div>
        <div className="flex items-center rounded-full border border-brass/20 bg-black/30 px-3 py-2 text-[12px] font-bold tracking-widest uppercase text-brass-light">
          NYC
        </div>
        <AltsSearchField
          value={q}
          onChange={setQ}
          scope="this board"
          className="w-full md:w-[280px]"
        />
      </header>

      {eyes.length > 0 && (
        <div className="px-5 pt-4">
          <div className="caps mb-2">Needs eyes</div>
          <div className="sf-eyes">
            {eyes.map((t) => {
              const late = daysLate(t.due_date) > 0;
              const kind = late ? "late" : needsReadyText(t) ? "text" : "rush";
              return (
                <button
                  key={t.name}
                  type="button"
                  className={cn("sf-eye", `is-${kind}`)}
                  onClick={() => nav(`/orders/alterations/${t.name}`)}
                >
                  <div className="font-mono text-[11px] text-brass-light">{t.name}</div>
                  <div className="display text-lg truncate">{t.customer_name || "—"}</div>
                  <div className="text-[11px] text-cream-dim mt-0.5">
                    {late ? `OVERDUE · ${daysLate(t.due_date)}d` : isRush(t) ? "Rush" : "Text ready"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 px-5 py-4">
        {(
          [
            { v: kpis.overdue, l: "Overdue", key: "overdue" as const, alert: true },
            { v: kpis.dueToday, l: "Due today", key: "today" as const, warn: true },
            { v: kpis.inShop, l: "In the shop", key: "all" as const },
            { v: kpis.unassigned, l: "Unassigned", key: "unassigned" as const, warn: true },
            { v: kpis.ready, l: "Ready", key: "ready" as const },
            { v: kpis.needsText, l: "Needs text", key: "text" as const, warn: true },
          ] as const
        ).map((k) => (
          <button
            key={k.l}
            type="button"
            onClick={() => applyFilter(k.key)}
            className={cn(
              "sf-kpi card-glass px-4 py-3",
              filter === k.key && "is-on",
              "alert" in k && k.alert && k.v > 0 && "border-signal-rose/40",
              "warn" in k && k.warn && k.v > 0 && "border-signal-amber/40",
            )}
          >
            <div
              className={cn(
                "display text-3xl",
                "alert" in k && k.alert && k.v > 0 && "text-signal-rose",
                "warn" in k && k.warn && k.v > 0 && "text-signal-amber",
              )}
            >
              {k.v}
            </div>
            <div className="caps mt-1">{k.l}</div>
          </button>
        ))}
      </div>

      <div className="px-5 pb-3">
        <TailorTallyStrip />
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
            ["overdue", "Overdue"],
            ["morning", "Morning"],
            ["all", "All work"],
            ["today", "Due today"],
            ["unassigned", "Unassigned"],
            ["ready", "Ready"],
            ["unpaid", "Ready unpaid"],
            ["text", "Needs text"],
          ] as const
        ).map(([k, lab]) => (
          <button
            key={k}
            type="button"
            onClick={() => applyFilter(k)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border",
              filter === k ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowPickedUp((v) => !v)}
          className={cn(
            "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border",
            showPickedUp ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
          )}
        >
          {showPickedUp ? "Hide picked up" : "Show picked up"}
        </button>
        <Link to="/pickup" className="ml-auto btn-brass h-10 px-4 text-[12px] inline-flex items-center">
          Pickup counter
        </Link>
        <Link to="/intake/kind" className="btn-ghost h-10 px-4 text-[12px] inline-flex items-center">
          + New ticket
        </Link>
      </div>

      <div className="flex-1 overflow-x-auto px-5 pb-6">
        <div className="mb-3 space-y-3">
          <ErpStatusBanner onRetry={() => tickets.refetch()} />
          {tickets.isError ? (
            <QueryErrorPanel
              title="Could not load shop floor"
              message={tickets.error instanceof Error ? tickets.error.message : "Ticket board failed to load. Retry — empty columns are not the same as an outage."}
              onRetry={() => tickets.refetch()}
            />
          ) : null}
        </div>

        {view === "board" && (
          tickets.isLoading ? (
            <KanbanSkeleton cols={3} />
          ) : (
          <div className="shop-floor-board-cols flex gap-3 min-w-[900px] h-full min-h-[420px]">
            {visibleCols.map((col) => (
              <div
                key={col}
                className={cn(
                  "sf-col flex-1 min-w-[210px] flex flex-col card-glass overflow-hidden",
                  col === "Received" && "is-received",
                  col === "In Progress" && "is-progress",
                  col === "Ready" && "is-ready",
                  col === "Picked Up" && "is-done",
                )}
              >
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
                  {(byCol[col] ?? []).map((t) => (
                    <TicketCard
                      key={t.name}
                      t={t}
                      col={col}
                      next={NEXT[col]}
                      pending={advance.isPending}
                      texting={textReady.isPending && textReady.variables === t.name}
                      onOpen={() => nav(`/orders/alterations/${t.name}`)}
                      onAdvance={() =>
                        advance.mutate({ name: t.name, status: NEXT[col]!.status })
                      }
                      onTextReady={() => textReady.mutate(t.name)}
                    />
                  ))}
                  {!tickets.isLoading && !(byCol[col]?.length) && (
                    <div className="sf-empty">
                      {col === "Ready" ? "Nothing waiting at the counter." : "Clear — nothing here."}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          )
        )}

        {view === "tailor" && (
          tickets.isLoading ? (
            <ListSkeleton rows={6} />
          ) : (
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
                      texting={textReady.isPending && textReady.variables === t.name}
                      onTextReady={() => textReady.mutate(t.name)}
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
          )
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
                        <span className="display text-lg truncate flex-1">
                          {t.customer_name || "—"}
                        </span>
                        {isRush(t) && <span className="badge-rush">Rush</span>}
                        <span className="chip shrink-0">{t.workflow_state}</span>
                        <span className="text-[12px] text-cream-dim shrink-0 hidden sm:inline">
                          {fmtTime(t.due_time) || t.assigned_tailor || "Unassigned"}
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
