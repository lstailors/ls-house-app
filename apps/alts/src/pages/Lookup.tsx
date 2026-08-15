import { useEffect, useMemo, useState } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { BrandSeal } from "@alts/components/BrandSeal";
import StatusBadge from "@alts/components/StatusBadge";
import { clientInitials } from "@alts/lib/ticketDisplay";
import "@alts/styles/alts-pos.css";
import { formatMoney } from "@alts/lib/money";

function money(n?: number | string | null) {
  return formatMoney(n);
}

function day(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Lookup() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const seed = (params.get("q") || "").trim();
  const [q, setQ] = useState(seed);
  const [go, setGo] = useState(seed);

  useEffect(() => {
    if (seed) {
      setQ(seed);
      setGo(seed);
    }
  }, [seed]);

  useEffect(() => {
    const t = window.setTimeout(() => setGo(q.trim()), 220);
    return () => window.clearTimeout(t);
  }, [q]);

  const enabled = go.length >= 2;

  const universal = useQuery({
    queryKey: ["lookup-universal", go],
    enabled,
    queryFn: async () => {
      const res = await api.get<any>(`/api/search?q=${encodeURIComponent(go)}`);
      const results = Array.isArray(res) ? res : res?.results ?? res?.data?.results ?? [];
      return results as any[];
    },
  });

  const tickets = useQuery({
    queryKey: ["lookup-t", go],
    enabled,
    queryFn: async () => {
      const rows = await api.get<any[]>(`/api/intake-alterations/tickets?limit=500`);
      const s = go.toLowerCase();
      return (rows ?? []).filter(
        (t) =>
          t.name?.toLowerCase().includes(s) ||
          t.customer_name?.toLowerCase().includes(s) ||
          (t.customer_phone || "").includes(s),
      );
    },
  });

  const customers = useQuery({
    queryKey: ["lookup-c", go],
    enabled,
    queryFn: async () => {
      const rows = await api.get<any[]>(
        `/api/intake-alterations/customers/search?q=${encodeURIComponent(go)}`,
      );
      return rows ?? [];
    },
  });

  const uni = universal.data ?? [];
  const uniTickets = uni.filter((r) => r.type === "alteration" || String(r.id || "").startsWith("ALT-"));
  const uniCust = uni.filter((r) => r.type === "customer");
  const uniSo = uni.filter((r) => r.type === "sales_order" || String(r.id || "").includes("SO-"));

  const ticketRows = useMemo(() => {
    const local = tickets.data ?? [];
    if (local.length) return local;
    return uniTickets.map((r) => ({
      name: r.id,
      customer_name: r.subtitle || r.title,
      workflow_state: r.status,
      href: r.href,
    }));
  }, [tickets.data, uniTickets]);

  return (
    <div className="alts-root min-h-dvh flex flex-col">
      <header className="flex items-center gap-2.5 sm:gap-3 px-4 sm:px-5 py-3 border-b border-brass/20">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-2xl leading-none">Find a ticket</div>
          <div className="caps mt-1">Live search · name · SO · scan</div>
        </div>
        <div className="flex-1" />
        <Link to="/scanner" className="btn-ghost h-11 px-3 text-[12px] inline-flex items-center shrink-0">
          Scan
        </Link>
      </header>

      <div className="max-w-3xl mx-auto w-full p-5 space-y-5">
        {(tickets.isError || customers.isError || universal.isError) && enabled && (
          <QueryErrorPanel
            title="Search failed"
            message="One lookup source did not respond. Retry — empty is not an outage."
            onRetry={() => {
              void tickets.refetch();
              void customers.refetch();
              void universal.refetch();
            }}
          />
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          placeholder="Start typing a name, ALT-…, or SO-…"
          className="w-full h-16 rounded-2xl bg-black/30 border border-brass/25 px-5 text-cream outline-none focus:border-brass/50 text-lg"
        />
        {q.trim().length > 0 && q.trim().length < 2 && (
          <p className="text-cream-dim text-sm">Keep typing — results appear after two characters.</p>
        )}
        {enabled && tickets.isFetching && !tickets.data && (
          <p className="text-cream-dim text-sm">Searching…</p>
        )}

        {enabled && (
          <>
            <section>
              <div className="caps mb-2">Tickets · {ticketRows.length}</div>
              <div className="space-y-2">
                {ticketRows.slice(0, 20).map((t: any) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => nav(t.href || `/orders/alterations/${t.name}`)}
                    className="w-full text-left card-glass px-4 py-3.5 flex items-center gap-3"
                  >
                    <span className="sf-avatar">{clientInitials(t.customer_name)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[13px] text-brass-light">{t.name}</span>
                        {t.workflow_state ? <StatusBadge status={t.workflow_state} size="sm" /> : null}
                      </div>
                      <div className="display text-[24px] leading-none mt-1 truncate">{t.customer_name}</div>
                      <div className="text-sm text-cream-dim mt-1">
                        {t.due_date ? day(t.due_date) : ""}
                        {t.payment_status ? ` · ${t.payment_status}` : ""}
                      </div>
                    </div>
                    <div className="text-brass-light font-semibold shrink-0">{money(t.ticket_total)}</div>
                  </button>
                ))}
                {tickets.isFetched && !ticketRows.length && (
                  <p className="text-cream-dim text-sm">No tickets match.</p>
                )}
              </div>
            </section>

            <section>
              <div className="caps mb-2">Customers</div>
              <div className="space-y-2">
                {(customers.data ?? uniCust).slice(0, 12).map((c: any) => (
                  <button
                    key={c.name || c.id}
                    type="button"
                    onClick={() => nav(c.href || `/customers/${c.name || c.id}`)}
                    className="w-full text-left card-glass px-4 py-3.5 flex items-center gap-3"
                  >
                    <span className="sf-avatar">{clientInitials(c.customer_name || c.name || c.title)}</span>
                    <div className="min-w-0">
                      <div className="display text-[22px] leading-none truncate">
                        {c.customer_name || c.name || c.title || c.full_name}
                      </div>
                      <div className="text-sm text-cream-dim mt-1">
                        {c.mobile_no || c.phone || c.subtitle || ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {!!uniSo.length && (
              <section>
                <div className="caps mb-2">Sales orders</div>
                <div className="space-y-2">
                  {uniSo.slice(0, 10).map((r: any) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() =>
                        nav(
                          `/intake/alterations?kind=on_order&so=${encodeURIComponent(r.id)}&customerName=${encodeURIComponent(r.subtitle || "")}`,
                        )
                      }
                      className="w-full text-left card-glass px-4 py-3.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] text-brass-light">{r.id || r.title}</span>
                        {r.status ? <StatusBadge status={r.status} size="sm" /> : null}
                      </div>
                      <div className="display text-[22px] leading-none mt-1">{r.subtitle || r.title}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
