import { useState } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";

function money(n?: number) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function Lookup() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [go, setGo] = useState("");

  const universal = useQuery({
    queryKey: ["lookup-universal", go],
    enabled: go.trim().length >= 2,
    queryFn: async () => {
      const res = await api.get<any>(`/api/search?q=${encodeURIComponent(go.trim())}`);
      const results = Array.isArray(res) ? res : res?.results ?? res?.data?.results ?? [];
      return results as any[];
    },
  });

  const tickets = useQuery({
    queryKey: ["lookup-t", go],
    enabled: go.trim().length >= 2,
    queryFn: async () => {
      const rows = await api.get<any[]>(`/api/intake-alterations/tickets?limit=150`);
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
    enabled: go.trim().length >= 2,
    queryFn: async () => {
      const rows = await api.get<any[]>(
        `/api/intake-alterations/customers/search?q=${encodeURIComponent(go)}`,
      );
      return rows ?? [];
    },
  });

  const run = (raw?: string) => {
    const v = (raw ?? q).trim();
    setGo(v);
    if (/^ALT-/i.test(v)) nav(`/orders/alterations/${v}`);
    if (/^G\d+$/i.test(v) || v.includes("/g/")) {
      // garment tag deep link patterns handled by routes
    }
  };

  const uni = universal.data ?? [];
  const uniTickets = uni.filter((r) => r.type === "alteration" || String(r.id || "").startsWith("ALT-"));
  const uniCust = uni.filter((r) => r.type === "customer");
  const uniSo = uni.filter((r) => r.type === "sales_order" || String(r.id || "").includes("SO-"));

  return (
    <div className="alts-root min-h-dvh flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <BrandSeal />
        <div>
          <div className="display text-xl">Lookup</div>
          <div className="caps">Ticket · client · SO · scan</div>
        </div>
        <div className="flex-1" />
        <Link to="/scanner" className="btn-ghost h-11 px-4 text-[12px] inline-flex items-center">
          Scanner
        </Link>
        <Link to="/pickup" className="btn-brass h-11 px-4 text-[12px] inline-flex items-center">
          Pickup
        </Link>
      </header>

      <div className="max-w-2xl mx-auto w-full p-6 space-y-5">
        <h2 className="display text-3xl">Find anything</h2>
        {(tickets.isError || customers.isError || universal.isError) && go.trim().length >= 2 && (
          <QueryErrorPanel
            title="Search failed"
            message="One or more lookup sources did not respond. Retry — empty results are not the same as a down API."
            onRetry={() => {
              void tickets.refetch();
              void customers.refetch();
              void universal.refetch();
            }}
          />
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            placeholder="ALT-… · name · phone · SO-"
            className="flex-1 h-14 rounded-2xl bg-black/30 border border-brass/25 px-4 text-cream outline-none focus:border-brass/50 text-base"
          />
          <button type="submit" className="btn-brass h-14 px-6 text-[12px]">
            Search
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {["Ready", "unpaid", "smith"].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => {
                setQ(chip === "Ready" ? "ALT-" : chip);
                run(chip === "Ready" ? "ALT-" : chip);
              }}
              className="px-3 py-1.5 rounded-full border border-brass/25 text-[12px] font-bold tracking-wide uppercase text-cream-dim"
            >
              {chip}
            </button>
          ))}
        </div>

        {go && (
          <>
            <section>
              <div className="caps mb-2">Tickets · {(tickets.data ?? uniTickets).length}</div>
              <div className="space-y-2">
                {(tickets.data ?? []).slice(0, 15).map((t: any) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => nav(`/orders/alterations/${t.name}`)}
                    className="w-full text-left card-glass px-4 py-3 flex items-center gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[12px] text-brass-light">{t.name}</span>
                      <div className="font-semibold truncate">{t.customer_name}</div>
                      <div className="text-xs text-cream-dim flex gap-2 flex-wrap">
                        <span>{t.workflow_state}</span>
                        <span>{t.payment_status}</span>
                        {t.due_date && <span>Due {t.due_date}</span>}
                      </div>
                    </div>
                    <div className="text-brass-light font-semibold shrink-0">{money(t.ticket_total)}</div>
                  </button>
                ))}
                {!tickets.data?.length &&
                  uniTickets.slice(0, 8).map((r: any) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => nav(r.href || `/orders/alterations/${r.id}`)}
                      className="w-full text-left card-glass px-4 py-3"
                    >
                      <span className="font-mono text-[12px] text-brass-light">{r.id || r.title}</span>
                      <div className="font-semibold">{r.subtitle || r.title}</div>
                    </button>
                  ))}
                {tickets.isFetched && !(tickets.data ?? []).length && !uniTickets.length && (
                  <p className="text-cream-dim text-sm">No tickets</p>
                )}
              </div>
            </section>

            <section>
              <div className="caps mb-2">Customers</div>
              <div className="space-y-2">
                {(customers.data ?? []).slice(0, 12).map((c: any) => (
                  <button
                    key={c.name || c.id}
                    type="button"
                    onClick={() => nav(`/customers/${c.name || c.id}`)}
                    className="w-full text-left card-glass px-4 py-3"
                  >
                    <div className="font-semibold">{c.customer_name || c.name || c.full_name}</div>
                    <div className="text-xs text-cream-dim">
                      {c.mobile_no || c.phone || ""}
                      {c.email_id || c.email ? ` · ${c.email_id || c.email}` : ""}
                    </div>
                  </button>
                ))}
                {!customers.data?.length &&
                  uniCust.slice(0, 8).map((r: any) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => nav(r.href || `/customers/${r.id}`)}
                      className="w-full text-left card-glass px-4 py-3"
                    >
                      <div className="font-semibold">{r.title}</div>
                      <div className="text-xs text-cream-dim">{r.subtitle}</div>
                    </button>
                  ))}
              </div>
            </section>

            {!!uniSo.length && (
              <section>
                <div className="caps mb-2">Sales orders</div>
                <div className="space-y-2">
                  {uniSo.slice(0, 8).map((r: any) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() =>
                        nav(`/intake/alterations?kind=on_order&so=${encodeURIComponent(r.id)}&customerName=${encodeURIComponent(r.subtitle || "")}`)
                      }
                      className={cn("w-full text-left card-glass px-4 py-3")}
                    >
                      <span className="font-mono text-[12px] text-[var(--vi,#9B8BC4)]">{r.id || r.title}</span>
                      <div className="font-semibold">{r.subtitle || r.title}</div>
                      <div className="text-xs text-cream-dim">Tap to start custom-order ticket</div>
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
