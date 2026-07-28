import { useMemo, useState } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
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
  origin_location?: string;
  assigned_tailor?: string;
  due_date?: string;
};

type Tailor = { name: string; full_name: string };

export default function Transfers() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dest, setDest] = useState<"NYC" | "HOU" | "Home">("Home");
  const [tailorId, setTailorId] = useState("");

  const tickets = useQuery({
    queryKey: ["xfer-tickets"],
    queryFn: () => api.get<Ticket[]>("/api/intake-alterations/tickets?limit=200"),
  });

  const tailors = useQuery({
    queryKey: ["tailors"],
    queryFn: () => api.get<Tailor[]>("/api/intake-alterations/tailors"),
  });

  const list = useMemo(() => {
    let rows = (tickets.data ?? []).filter(
      (t) => t.workflow_state !== "Picked Up" && t.workflow_state !== "Cancelled",
    );
    if (q.trim()) {
      const s = q.toLowerCase();
      rows = rows.filter(
        (t) => t.name.toLowerCase().includes(s) || t.customer_name?.toLowerCase().includes(s),
      );
    }
    return rows;
  }, [tickets.data, q]);

  const atHome = list.filter(
    (t) =>
      (t.origin_location || "").toLowerCase().includes("home") ||
      (t.assigned_tailor && (t.origin_location || "") !== "NYC" && (t.origin_location || "") !== "HOU"),
  );

  const transfer = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a ticket");
      return api.patch(`/api/intake-alterations/tickets/${selected}/transfer`, {
        location: dest,
        tailorId: dest === "Home" ? tailorId || null : tailorId || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Transfer saved");
      qc.invalidateQueries({ queryKey: ["xfer-tickets"] });
      setSelected(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sel = list.find((t) => t.name === selected);

  return (
    <div className="alts-root min-h-dvh flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <Link to="/" className="seal">
          LS
        </Link>
        <div>
          <div className="display text-xl">Transfers</div>
          <div className="caps">Shop · at-home · cross-location</div>
        </div>
        <div className="flex-1" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find ticket…"
          className="hidden md:block h-11 rounded-full bg-black/30 border border-brass/25 px-4 text-sm text-cream outline-none min-w-[220px]"
        />
      </header>

      {tickets.isError && (
        <QueryErrorPanel
          title="Could not load tickets"
          onRetry={() => tickets.refetch()}
          className="mx-5 mt-3"
        />
      )}

      <div className="flex-1 grid lg:grid-cols-[1fr_360px] min-h-0">
        <div className="overflow-y-auto p-4 space-y-2">
          <div className="caps px-1 mb-2">Open tickets · {list.length}</div>
          {list.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => setSelected(t.name)}
              className={cn(
                "w-full text-left card-glass p-3.5",
                selected === t.name && "border-brass ring-1 ring-brass/40",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-brass-light">{t.name}</span>
                <span className="chip">{t.workflow_state}</span>
                <span className="ml-auto text-xs text-cream-dim">{t.origin_location || "NYC"}</span>
              </div>
              <div className="font-semibold mt-1">{t.customer_name}</div>
              {t.assigned_tailor && (
                <div className="text-xs text-cream-dim mt-1">Tailor: {t.assigned_tailor}</div>
              )}
            </button>
          ))}
        </div>

        <aside className="border-l border-brass/15 p-5 overflow-y-auto">
          <div className="caps mb-3">Send to</div>
          {!selected && <p className="text-cream-dim text-sm">Select a ticket to transfer.</p>}
          {selected && sel && (
            <>
              <div className="display text-2xl mb-1">{sel.customer_name}</div>
              <div className="font-mono text-xs text-brass-light mb-4">{sel.name}</div>
              <div className="flex flex-col gap-2 mb-4">
                {(["NYC", "HOU", "Home"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDest(d)}
                    className={cn(
                      "h-12 rounded-xl border text-sm font-bold tracking-wide uppercase",
                      dest === d ? "bg-brass text-forest-deep border-brass" : "border-brass/30 text-cream-dim",
                    )}
                  >
                    {d === "Home" ? "At-home employee" : d}
                  </button>
                ))}
              </div>
              {(dest === "Home" || true) && (
                <label className="block mb-4">
                  <span className="caps">Assign tailor</span>
                  <select
                    value={tailorId}
                    onChange={(e) => setTailorId(e.target.value)}
                    className="mt-2 w-full h-12 rounded-xl bg-black/30 border border-brass/25 px-3 text-cream"
                  >
                    <option value="">— optional —</option>
                    {(tailors.data ?? []).map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.full_name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                disabled={transfer.isPending}
                onClick={() => transfer.mutate()}
                className="btn-brass w-full h-14 text-[12px]"
              >
                {transfer.isPending ? "Saving…" : "Confirm transfer"}
              </button>
              <button
                type="button"
                onClick={() => nav(`/orders/alterations/${selected}`)}
                className="btn-ghost w-full h-11 mt-2 text-[12px]"
              >
                Open ticket
              </button>
            </>
          )}

          <div className="mt-8">
            <div className="caps mb-2">At home now · {atHome.length}</div>
            <div className="space-y-2">
              {atHome.slice(0, 12).map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setSelected(t.name)}
                  className="w-full text-left text-sm card-glass px-3 py-2"
                >
                  <span className="font-mono text-[12px] text-brass-light">{t.name}</span>
                  <div className="font-semibold">{t.customer_name}</div>
                </button>
              ))}
              {!atHome.length && <p className="text-cream-dim text-xs italic">None flagged home</p>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
