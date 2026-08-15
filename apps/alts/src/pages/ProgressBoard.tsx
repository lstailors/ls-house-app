import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { localFirstTickets } from "@alts/offline/localFirst";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import StatusBadge from "@alts/components/StatusBadge";
import { clientInitials } from "@alts/lib/ticketDisplay";
import type { StatusTone } from "@alts/lib/statusTone";
import "@alts/styles/alts-pos.css";

type Piece = {
  id: string;
  ticket: string;
  garmentType: string;
  color?: string | null;
  notes?: string;
  status: string;
  customerName: string;
  dueDate?: string | null;
  tailor?: string | null;
  rush?: boolean;
};

const COLS: Array<{ key: string; label: string; match: (s: string) => boolean; tone: StatusTone }> = [
  {
    key: "pending",
    label: "Pending",
    match: (s) => /pending|received|intake/i.test(s) || !s,
    tone: "shop",
  },
  {
    key: "progress",
    label: "In Progress",
    match: (s) => /progress/i.test(s),
    tone: "shop",
  },
  {
    key: "ready",
    label: "Ready",
    match: (s) => /ready|complete/i.test(s),
    tone: "pickup",
  },
];

const NEXT: Record<string, string> = {
  pending: "In Progress",
  progress: "Ready",
  ready: "Pending",
};

export default function ProgressBoard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const board = useQuery({
    queryKey: ["alts-progress-board"],
    queryFn: async () => {
      try {
        return await api.get<Piece[]>("/api/garment/board");
      } catch {
        const tickets = await localFirstTickets<Record<string, unknown>>(async () => {
          throw new Error("offline");
        });
        return tickets.map((t) => ({
          id: String(t.name ?? ""),
          ticket: String(t.name ?? ""),
          garmentType: "Ticket",
          status: String(t.workflow_state ?? ""),
          customerName: String(t.customer_name ?? ""),
          dueDate: t.due_date ? String(t.due_date) : null,
          tailor: t.assigned_tailor ? String(t.assigned_tailor) : null,
        })) as Piece[];
      }
    },
    refetchInterval: 45_000,
  });

  const move = useMutation({
    mutationFn: ({ ticket, id, status }: { ticket: string; id: string; status: string }) =>
      api.patch(`/api/alterations/${encodeURIComponent(ticket)}/garments/${encodeURIComponent(id)}/status`, {
        garment_status: status,
      }),
    onSuccess: () => {
      toast.success("Stage updated");
      void qc.invalidateQueries({ queryKey: ["alts-progress-board"] });
      void qc.invalidateQueries({ queryKey: ["shop-floor-tickets"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not move piece"),
  });

  const needle = q.trim().toLowerCase();
  const pieces = useMemo(() => {
    const rows = board.data ?? [];
    if (!needle) return rows;
    return rows.filter((p) =>
      [p.customerName, p.ticket, p.id, p.garmentType, p.status, p.tailor]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [board.data, needle]);

  const columns = COLS.map((col) => ({
    ...col,
    items: pieces.filter((p) => col.match(p.status)),
  }));

  return (
    <div className="alts-root min-h-dvh flex flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-[32px] leading-none">Mark Progress</div>
          <div className="caps mt-1">Staging · move by hand or scan</div>
        </div>
        <div className="flex-1" />
        <Link
          to="/scanner?mode=progress"
          className="h-11 px-4 rounded-full border border-brass/40 bg-brass/15 text-[12px] font-bold uppercase tracking-widest inline-flex items-center"
        >
          Scan hang tag
        </Link>
      </header>

      <div className="px-4 sm:px-5 pt-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Client, ticket, garment…"
          className="w-full h-[52px] rounded-xl bg-black/35 border border-brass/25 px-4 text-[16px] text-cream outline-none focus:border-brass"
        />
      </div>

      <div className="flex-1 overflow-x-auto px-4 sm:px-5 py-4 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]">
        {board.isError && (
          <QueryErrorPanel
            title="Could not load the rack"
            message={board.error instanceof Error ? board.error.message : "Retry."}
            onRetry={() => board.refetch()}
          />
        )}
        <div className="flex gap-3 min-w-max lg:min-w-0 lg:grid lg:grid-cols-3 h-full">
          {columns.map((col) => (
            <div
              key={col.key}
              className="w-[min(86vw,340px)] lg:w-auto flex flex-col rounded-2xl border border-brass/18 bg-black/20 min-h-[60vh]"
            >
              <div className="flex items-center justify-between px-3 py-3 border-b border-brass/15">
                <StatusBadge status={col.label} tone={col.tone} />
                <span className="font-mono text-brass-light text-sm tabular-nums">{col.items.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {col.items.map((p) => (
                  <div key={`${p.ticket}-${p.id}`} className="card-glass px-3 py-3">
                    <button
                      type="button"
                      onClick={() => nav(`/g/${encodeURIComponent(p.ticket)}/${encodeURIComponent(p.id)}`)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="sf-avatar">{clientInitials(p.customerName)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="display text-[22px] leading-none truncate">{p.customerName}</div>
                          <div className="text-xs text-cream-dim mt-1 truncate">
                            {p.garmentType}
                            {p.color ? ` · ${p.color}` : ""}
                            {p.rush ? " · rush" : ""}
                          </div>
                        </div>
                      </div>
                      <div className="font-mono text-[11px] text-brass-light mt-2 truncate">
                        {p.ticket} · {p.id}
                      </div>
                    </button>
                    <button
                      type="button"
                      disabled={move.isPending}
                      onClick={() =>
                        move.mutate({ ticket: p.ticket, id: p.id, status: NEXT[col.key] || "In Progress" })
                      }
                      className="mt-2 w-full h-11 rounded-lg border border-brass/30 text-[12px] font-bold tracking-widest uppercase text-brass-light"
                    >
                      Move to {NEXT[col.key]}
                    </button>
                  </div>
                ))}
                {!col.items.length && !board.isLoading && (
                  <p className="text-center text-cream-dim text-sm py-8">Empty</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
