import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import LuxuryLayer from "@alts/components/LuxuryLayer";
import { clientInitials, syncLabel } from "@alts/lib/ticketDisplay";
import "@alts/styles/alts-pos.css";

type Tab = "custom" | "sales";

type CustomOrder = {
  id: string;
  customerId?: string;
  customer?: { id?: string; name?: string; phone?: string } | null;
  garmentType?: string;
  quotedPrice?: number;
  depositAmount?: number;
  status?: string;
  notes?: string | null;
  erpName?: string;
  createdAt?: string;
};

type SalesOrder = {
  name: string;
  id?: string;
  customer?: string;
  customer_name?: string;
  status?: string;
  make_type?: string;
  grand_total?: number;
  transaction_date?: string;
  delivery_date?: string;
  delivery_status?: string;
};

const STATUS_LABEL: Record<string, string> = {
  quote: "Quote",
  deposit_paid: "Deposit",
  in_production: "In work",
  ready: "Ready",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function money(n?: number) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function prettyStatus(s?: string) {
  if (!s) return "";
  return STATUS_LABEL[s] || s.replace(/_/g, " ");
}

function day(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function HouseFind() {
  const [tab, setTab] = useState<Tab>("custom");
  const [q, setQ] = useState("");
  const [go, setGo] = useState("");
  const [pickedCustom, setPickedCustom] = useState<CustomOrder | null>(null);
  const [pickedSo, setPickedSo] = useState<SalesOrder | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setGo(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q]);

  const custom = useQuery({
    queryKey: ["alts-custom-orders"],
    queryFn: () => api.get<CustomOrder[]>("/api/custom-orders?limit=80"),
    refetchInterval: 90_000,
  });

  const sales = useQuery({
    queryKey: ["alts-so-search", go],
    queryFn: () =>
      api.get<SalesOrder[]>(
        `/api/intake-alterations/sales-orders/search?q=${encodeURIComponent(go)}&limit=20`,
      ),
    refetchInterval: 90_000,
  });

  const customRows = useMemo(() => {
    const rows = custom.data ?? [];
    if (!go) return rows;
    const s = go.toLowerCase();
    return rows.filter((o) => {
      const blob = [o.id, o.erpName, o.customer?.name, o.customerId, o.garmentType, o.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(s);
    });
  }, [custom.data, go]);

  const soRows = sales.data ?? [];
  const live = syncLabel(
    tab === "custom" ? custom.dataUpdatedAt : sales.dataUpdatedAt,
    tab === "custom" ? custom.isFetching : sales.isFetching,
  );
  const err = tab === "custom" ? custom : sales;

  return (
    <div className="alts-root min-h-dvh flex flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-[28px] leading-none">House orders</div>
          <div className="caps mt-1">Custom · sales orders</div>
        </div>
        <div className="flex-1" />
        <div className={cn("sf-live", err.isFetching && "is-sync", err.isError && "is-down")}>
          <span className="dot" />
          {err.isError ? "ERPNext down" : live}
        </div>
      </header>

      <div className="px-4 sm:px-5 pt-3 space-y-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, SO, or order…"
          className="w-full rounded-full border border-brass/25 bg-black/30 px-4 py-3 text-base text-cream placeholder:text-cream-dim"
        />
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["custom", "Custom", customRows.length],
              ["sales", "Sales orders", soRows.length],
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]">
        {err.isError && (
          <QueryErrorPanel
            title="Could not load house orders"
            message={err.error instanceof Error ? err.error.message : "Retry — an empty book is not the same as an outage."}
            onRetry={() => err.refetch()}
          />
        )}

        {tab === "custom" &&
          customRows.map((o) => {
            const name = o.customer?.name || o.customerId || "Client";
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setPickedCustom(o)}
                className="og-row sf-card w-full text-left card-glass px-4 py-3.5 flex items-center gap-3 mb-2"
              >
                <span className="sf-avatar" aria-hidden>
                  {clientInitials(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="chip">{prettyStatus(o.status)}</span>
                    {o.garmentType && <span className="text-[11px] text-cream-dim">{o.garmentType}</span>}
                    {money(o.quotedPrice) && <span className="text-[11px] text-brass-light">{money(o.quotedPrice)}</span>}
                  </div>
                  <div className="display text-[22px] leading-none mt-1 truncate">{name}</div>
                  <div className="text-xs text-cream-dim mt-1 truncate">
                    {o.erpName || o.id}
                    {day(o.createdAt) ? ` · ${day(o.createdAt)}` : ""}
                  </div>
                </div>
                <div className="text-cream-dim">→</div>
              </button>
            );
          })}

        {tab === "sales" &&
          soRows.map((o) => (
            <button
              key={o.name}
              type="button"
              onClick={() => setPickedSo(o)}
              className="og-row sf-card w-full text-left card-glass px-4 py-3.5 flex items-center gap-3 mb-2"
            >
              <span className="sf-avatar" aria-hidden>
                {clientInitials(o.customer_name || o.customer)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="chip">{o.status || "Open"}</span>
                  {o.make_type && <span className="text-[11px] text-cream-dim">{o.make_type}</span>}
                  {money(o.grand_total) && <span className="text-[11px] text-brass-light">{money(o.grand_total)}</span>}
                </div>
                <div className="display text-[22px] leading-none mt-1 truncate">{o.customer_name || "Client"}</div>
                <div className="text-xs text-cream-dim mt-1 truncate">
                  {o.name}
                  {o.delivery_date ? ` · due ${day(o.delivery_date)}` : ""}
                </div>
              </div>
              <div className="text-cream-dim">→</div>
            </button>
          ))}

        {!err.isLoading &&
          ((tab === "custom" && !customRows.length) || (tab === "sales" && !soRows.length)) &&
          !err.isError && <div className="sf-empty">{go ? "Nothing matches." : "No open house orders."}</div>}
      </div>

      <LuxuryLayer open={!!pickedCustom} onClose={() => setPickedCustom(null)} variant="sheet" label="Custom order" z={70}>
        {pickedCustom && (
          <div
            className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
          >
            <div className="flex justify-center pb-2" aria-hidden>
              <i className="block w-10 h-1 rounded-full bg-brass/40" />
            </div>
            <div className="caps text-brass-light">{prettyStatus(pickedCustom.status)}</div>
            <h2 className="display text-[28px] leading-none mt-1">
              {pickedCustom.customer?.name || "Client"}
            </h2>
            <p className="text-sm text-cream-dim mt-2">
              {[pickedCustom.garmentType, money(pickedCustom.quotedPrice), pickedCustom.erpName || pickedCustom.id]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {pickedCustom.notes && <p className="text-sm text-cream mt-3">{pickedCustom.notes}</p>}
            <div className="flex flex-col gap-2 mt-5">
              {pickedCustom.customerId && (
                <Link
                  to={`/customers/${encodeURIComponent(pickedCustom.customerId)}`}
                  className="btn-brass h-12 text-xs inline-flex items-center justify-center"
                >
                  Open client
                </Link>
              )}
              <a
                href={`https://app.lstailors.com/orders/custom/${encodeURIComponent(pickedCustom.id)}`}
                target="_blank"
                rel="noreferrer"
                className="h-12 rounded-xl border border-brass/35 text-[11px] font-bold uppercase tracking-widest inline-flex items-center justify-center"
              >
                Full order on the desk
              </a>
              <button type="button" onClick={() => setPickedCustom(null)} className="btn-ghost h-12 text-xs">
                Close
              </button>
            </div>
          </div>
        )}
      </LuxuryLayer>

      <LuxuryLayer open={!!pickedSo} onClose={() => setPickedSo(null)} variant="sheet" label="Sales order" z={70}>
        {pickedSo && (
          <div
            className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
          >
            <div className="flex justify-center pb-2" aria-hidden>
              <i className="block w-10 h-1 rounded-full bg-brass/40" />
            </div>
            <div className="caps text-brass-light">{pickedSo.status || "Sales order"}</div>
            <h2 className="display text-[28px] leading-none mt-1">{pickedSo.customer_name || "Client"}</h2>
            <p className="text-sm text-cream-dim mt-2">
              {[pickedSo.name, money(pickedSo.grand_total), pickedSo.delivery_date ? `due ${day(pickedSo.delivery_date)}` : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="flex flex-col gap-2 mt-5">
              <Link
                to={`/qc/${encodeURIComponent(pickedSo.name)}`}
                className="btn-brass h-12 text-xs inline-flex items-center justify-center"
              >
                Open QC
              </Link>
              {pickedSo.customer && (
                <Link
                  to={`/customers/${encodeURIComponent(pickedSo.customer)}`}
                  className="h-12 rounded-xl border border-brass/35 text-[11px] font-bold uppercase tracking-widest inline-flex items-center justify-center"
                >
                  Open client
                </Link>
              )}
              <Link
                to={`/lookup?q=${encodeURIComponent(pickedSo.name)}`}
                className="h-12 rounded-xl border border-brass/35 text-[11px] font-bold uppercase tracking-widest inline-flex items-center justify-center"
              >
                Find related tickets
              </Link>
              <a
                href={`https://app.lstailors.com/sales-orders/${encodeURIComponent(pickedSo.name)}`}
                target="_blank"
                rel="noreferrer"
                className="h-12 rounded-xl border border-brass/25 text-[11px] font-bold uppercase tracking-widest inline-flex items-center justify-center text-cream-dim"
              >
                Full order on the desk
              </a>
              <button type="button" onClick={() => setPickedSo(null)} className="btn-ghost h-12 text-xs">
                Close
              </button>
            </div>
          </div>
        )}
      </LuxuryLayer>
    </div>
  );
}
