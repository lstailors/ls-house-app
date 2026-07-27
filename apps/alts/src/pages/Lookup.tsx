import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import "@alts/styles/alts-pos.css";

export default function Lookup() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [go, setGo] = useState("");

  const tickets = useQuery({
    queryKey: ["lookup-t", go],
    enabled: go.trim().length >= 2,
    queryFn: async () => {
      const rows = await api.get<any[]>(`/api/intake-alterations/tickets?limit=100`);
      const s = go.toLowerCase();
      return (rows ?? []).filter(
        (t) =>
          t.name?.toLowerCase().includes(s) ||
          t.customer_name?.toLowerCase().includes(s),
      );
    },
  });

  const customers = useQuery({
    queryKey: ["lookup-c", go],
    enabled: go.trim().length >= 2,
    queryFn: async () => {
      const rows = await api.get<any[]>(
        `/api/intake-alterations/customers/search?q=${encodeURIComponent(go)}`,
      );
      return rows ?? [];
    },
  });

  return (
    <div className="alts-root min-h-screen flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <Link to="/" className="seal">
          LS
        </Link>
        <div>
          <div className="display text-xl">Lookup</div>
          <div className="caps">Ticket · client · scan</div>
        </div>
        <div className="flex-1" />
        <Link to="/scanner" className="btn-ghost h-11 px-4 text-[11px] inline-flex items-center">
          Scanner
        </Link>
      </header>

      <div className="max-w-xl mx-auto w-full p-6 space-y-4">
        <h2 className="display text-3xl">Find anything</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setGo(q.trim());
            if (/^ALT-/i.test(q.trim())) nav(`/orders/alterations/${q.trim()}`);
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            placeholder="ALT-… · name · phone"
            className="flex-1 h-14 rounded-2xl bg-black/30 border border-brass/25 px-4 text-cream outline-none focus:border-brass/50"
          />
          <button type="submit" className="btn-brass h-14 px-6 text-[11px]">
            Search
          </button>
        </form>

        {go && (
          <>
            <div className="caps pt-2">Tickets</div>
            <div className="space-y-2">
              {(tickets.data ?? []).slice(0, 12).map((t: any) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => nav(`/orders/alterations/${t.name}`)}
                  className="w-full text-left card-glass px-4 py-3"
                >
                  <span className="font-mono text-[11px] text-brass-light">{t.name}</span>
                  <div className="font-semibold">{t.customer_name}</div>
                  <div className="text-xs text-cream-dim">{t.workflow_state}</div>
                </button>
              ))}
              {tickets.isFetched && !(tickets.data ?? []).length && (
                <p className="text-cream-dim text-sm">No tickets</p>
              )}
            </div>

            <div className="caps pt-4">Customers</div>
            <div className="space-y-2">
              {(customers.data ?? []).slice(0, 12).map((c: any) => (
                <button
                  key={c.name || c.id}
                  type="button"
                  onClick={() => nav(`/customers/${c.name || c.id}`)}
                  className="w-full text-left card-glass px-4 py-3"
                >
                  <div className="font-semibold">{c.customer_name || c.name}</div>
                  <div className="text-xs text-cream-dim">{c.mobile_no || c.phone || ""}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
