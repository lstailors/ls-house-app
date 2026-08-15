import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Plus, Star, Phone, Mail, Building2,
  Filter, ChevronRight, Users, Loader2,
} from "lucide-react";
import { SectionHeader } from "@ls/design";
import { EmptyState } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { api } from "@ls/api-client";
import { localFirstCustomerBookTotal, localFirstCustomers } from "@alts/offline/localFirst";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@ls/design/utils";
import TimedSpinner from "@alts/components/TimedSpinner";

// ── Types ────────────────────────────────────────────────────────────────────
interface Customer {
  id: string;
  customerNumber: number | string | null;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  titleRole: string | null;
  locationId: string | null;
  status: string;
  vipTier: string;
  vipFlag?: boolean;
  notes: string | null;
  tags: string[];
  casaTier: string | null;
  image?: string | null;
  createdAt: string;
  updatedAt: string;
}

const VIP_COLORS: Record<string, string> = {
  Platinum: "text-purple-300 border-purple-400/40 bg-purple-900/20",
  Gold:     "text-brass-shimmer border-brass/40 bg-brass/10",
  Silver:   "text-slate-300 border-slate-400/40 bg-slate-800/20",
  VIP:      "text-brass-shimmer border-brass/40 bg-brass/10",
  Standard: "text-cream-dim border-brass/10 bg-transparent",
};

const VIP_FILTERS = ["All", "VIP", "Standard"];
const STATUS_FILTERS = ["Active", "Inactive", "Archived", "all"];

function useDebounced<T>(value: T, ms = 280): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ── Customer Card ─────────────────────────────────────────────────────────────
function CustomerCard({ c, onClick }: { c: Customer; onClick: () => void }) {
  const isVip = c.vipFlag || (c.vipTier && c.vipTier !== "Standard");
  const vipLabel = isVip ? (c.vipTier === "Standard" ? "VIP" : c.vipTier) : "Standard";
  return (
    <button
      onClick={onClick}
      className="w-full text-left glass-panel p-4 rounded-xl border border-brass/10 hover:border-brass/40 transition-all group"
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          "w-10 h-10 rounded-full border flex items-center justify-center flex-shrink-0 text-sm font-semibold overflow-hidden",
          isVip ? VIP_COLORS[vipLabel] || VIP_COLORS.VIP : "bg-brass/10 border-brass/20 text-brass-shimmer"
        )}>
          {c.image ? (
            <img src={c.image} alt="" className="w-full h-full object-cover" />
          ) : (
            c.name.charAt(0).toUpperCase()
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-cream font-semibold text-sm truncate">{c.name}</span>
            {isVip && <Star className="w-3 h-3 text-brass fill-brass flex-shrink-0" />}
            {c.casaTier && (
              <span className="text-[9px] tracking-widest font-bold uppercase px-1.5 py-0.5 rounded border border-brass/30 text-brass-light bg-brass/5">
                CASA
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {c.phone && (
              <span className="flex items-center gap-1 text-xs text-cream-muted">
                <Phone className="w-2.5 h-2.5 text-brass-light/50" />{c.phone}
              </span>
            )}
            {c.email && (
              <span className="flex items-center gap-1 text-xs text-cream-dim truncate max-w-[200px]">
                <Mail className="w-2.5 h-2.5 text-brass-light/50 flex-shrink-0" />{c.email}
              </span>
            )}
            {c.company && (
              <span className="flex items-center gap-1 text-xs text-cream-dim">
                <Building2 className="w-2.5 h-2.5 text-brass-light/50" />{c.company}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={cn("text-[9px] tracking-wider font-bold uppercase px-1.5 py-0.5 rounded border", VIP_COLORS[vipLabel] ?? VIP_COLORS.Standard)}>
            {vipLabel}
          </span>
          <span className="text-[10px] text-cream-dim bg-brass/8 border border-brass/10 rounded px-1.5 py-0.5">
            {c.locationId ?? "—"}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-cream-dim group-hover:text-brass-light transition-colors" />
        </div>
      </div>
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Customers() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [vipFilter, setVipFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [showFilters, setShowFilters] = useState(false);
  const [browseLimit, setBrowseLimit] = useState(100);
  const debouncedQ = useDebounced(search.trim(), 300);
  const isSearching = debouncedQ.length >= 2;
  const pageSize = isSearching ? 40 : browseLimit;

  // Reset browse window when filters/search change
  useEffect(() => {
    setBrowseLimit(100);
  }, [debouncedQ, statusFilter, vipFilter]);

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (vipFilter !== "All") params.set("vip", vipFilter);
  if (isSearching) params.set("q", debouncedQ);
  params.set("limit", String(pageSize));
  params.set("offset", "0");

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["customers", statusFilter, vipFilter, debouncedQ, browseLimit],
    queryFn: async () =>
      localFirstCustomers<Customer>(async () => {
        const res = await api.raw(`/api/customers?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error?.message ?? `Customers failed (${res.status})`);
        }
        const rows: Customer[] = Array.isArray(json?.data) ? json.data : [];
        return {
          customers: rows,
          total: typeof json?.total === "number" ? json.total : rows.length,
          mode: (json?.mode as string) || (isSearching ? "search" : "browse"),
        };
      }, isSearching ? debouncedQ : ""),
    staleTime: isSearching ? 15_000 : 60_000,
    placeholderData: (prev) => prev,
  });

  const customers: Customer[] = data?.customers ?? [];
  const total: number = data?.total ?? customers.length;
  const mode: string = data?.mode ?? (isSearching ? "search" : "browse");

  // Book-wide count for KPI header
  const { data: bookMeta } = useQuery({
    queryKey: ["customers-book-kpis"],
    queryFn: async () => {
      const pull = async (qs: string) => {
        const res = await api.raw(`/api/customers?${qs}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error?.message ?? "Book count failed");
        return typeof json?.total === "number" ? json.total : 0;
      };
      try {
        const [total, vip, casa] = await Promise.all([
          pull("status=Active&limit=1"),
          pull("status=Active&vip=1&limit=1"),
          pull("status=Active&casa=1&limit=1"),
        ]);
        return { total, vip, casa };
      } catch {
        const offline = await localFirstCustomerBookTotal(async () => ({ total: 0 }));
        return { total: offline.total, vip: 0, casa: 0 };
      }
    },
    staleTime: 5 * 60_000,
  });
  const bookTotal: number = bookMeta?.total || total;

  const kpis = useMemo(() => ({
    total: bookTotal,
    vip: bookMeta?.vip ?? 0,
    casa: bookMeta?.casa ?? 0,
  }), [bookMeta, bookTotal]);

  const canLoadMore = !isSearching && mode === "browse" && customers.length < total && browseLimit < 500;

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="L&S House · Clients"
        title={<>Every <span className="text-brass-shimmer">gentleman</span> in the house.</>}
        description={`${bookTotal.toLocaleString()} clients in the book. Search the full ERP book — not just this page.`}
        actions={
          <Button className="btn-brass" onClick={() => navigate("/customers/new")}>
            <Plus className="w-4 h-4 mr-1.5" /> New Client
          </Button>
        }
      />

      {/* KPI bar */}
      {!isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Total Clients", value: kpis.total.toLocaleString() },
            { label: "VIP", value: bookMeta ? kpis.vip.toLocaleString() : "…", gold: true },
            { label: "Casa", value: bookMeta ? kpis.casa.toLocaleString() : "…", gold: kpis.casa > 0 },
          ].map(({ label, value, gold }) => (
            <div key={label} className="glass-panel p-4">
              <div className="ui-label mb-1">{label}</div>
              <div className={cn("kpi-number", gold ? "text-brass-shimmer" : "text-cream")}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search + filters */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 glass-panel px-3 py-2.5 rounded-xl border border-brass/15">
            {isFetching && isSearching ? (
              <Loader2 className="w-4 h-4 text-brass animate-spin flex-shrink-0" />
            ) : (
              <Search className="w-4 h-4 text-cream-muted flex-shrink-0" />
            )}
            <input
              className="flex-1 bg-transparent text-cream text-base sm:text-sm placeholder:text-cream-dim focus:outline-none"
              placeholder="Search full book — name, phone, email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-xs text-cream-dim hover:text-cream px-1"
              >
                Clear
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(f => !f)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm transition-all",
              showFilters ? "border-brass/40 bg-brass/10 text-cream" : "border-brass/15 text-cream-muted hover:border-brass/30"
            )}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>

        {showFilters && (
          <div className="glass-panel p-4 rounded-xl border border-brass/15 space-y-3">
            <div>
              <p className="ui-label mb-2">VIP Tier</p>
              <div className="flex flex-wrap gap-1.5">
                {VIP_FILTERS.map(v => (
                  <button
                    key={v}
                    onClick={() => setVipFilter(v)}
                    className={cn(
                      "px-3 py-1 rounded-full border text-xs font-medium transition-all",
                      vipFilter === v ? "bg-brass/20 border-brass/50 text-cream" : "border-brass/15 text-cream-muted hover:border-brass/30"
                    )}
                  >{v}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="ui-label mb-2">Status</p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "px-3 py-1 rounded-full border text-xs font-medium transition-all capitalize",
                      statusFilter === s ? "bg-brass/20 border-brass/50 text-cream" : "border-brass/15 text-cream-muted hover:border-brass/30"
                    )}
                  >{s === "all" ? "All" : s}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results count */}
      {isSearching ? (
        <p className="text-xs text-cream-dim">
          {isFetching && customers.length === 0
            ? `Searching full book for “${debouncedQ}”…`
            : `${total} result${total !== 1 ? "s" : ""} in the full book for “${debouncedQ}”`}
        </p>
      ) : (
        <p className="text-xs text-cream-dim">
          Showing {customers.length.toLocaleString()}
          {total > customers.length ? ` of ${total.toLocaleString()}` : ""} · type 2+ letters to search everyone
        </p>
      )}

      {/* List */}
      {isLoading && customers.length === 0 ? (
        <TimedSpinner label="Loading clients…" onRetry={() => void refetch()} />
      ) : customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients found"
          description={
            isSearching
              ? `No match for “${debouncedQ}” in the full book`
              : "Add the first client to get started."
          }
          action={<Button className="btn-brass" onClick={() => navigate("/customers/new")}>New Client</Button>}
        />
      ) : (
        <div className="space-y-2">
          {customers.map(c => (
            <CustomerCard key={c.id} c={c} onClick={() => navigate(`/customers/${c.id}`)} />
          ))}
          {canLoadMore && (
            <button
              type="button"
              disabled={isFetching}
              onClick={() => setBrowseLimit((n) => Math.min(500, n + 100))}
              className="w-full py-3 rounded-xl border border-brass/25 text-sm text-brass-light hover:border-brass/50 disabled:opacity-50"
            >
              {isFetching
                ? "Loading…"
                : `Load more (${Math.min(100, total - customers.length)} more · ${total.toLocaleString()} total)`}
            </button>
          )}
          {!isSearching && browseLimit >= 500 && total > customers.length && (
            <p className="text-center text-xs text-cream-dim py-2">
              Browse capped at 500 — search by name or phone to reach anyone in the book.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
