import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Plus, Star, Phone, Mail, Building2,
  MapPin, Filter, ChevronRight, Users
} from "lucide-react";
import { SectionHeader } from "@ls/design";
import { StatusPill } from "@ls/design";
import { EmptyState } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { api } from "@ls/api-client";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@ls/design/utils";

// ── Types ────────────────────────────────────────────────────────────────────
interface Customer {
  id: string;
  customerNumber: number | null;
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
  notes: string | null;
  tags: string[];
  casaTier: string | null;
  createdAt: string;
  updatedAt: string;
}

const VIP_COLORS: Record<string, string> = {
  Platinum: "text-purple-300 border-purple-400/40 bg-purple-900/20",
  Gold:     "text-brass-shimmer border-brass/40 bg-brass/10",
  Silver:   "text-slate-300 border-slate-400/40 bg-slate-800/20",
  Standard: "text-cream-dim border-brass/10 bg-transparent",
};

const VIP_FILTERS = ["All", "Platinum", "Gold", "Silver", "Standard"];
const STATUS_FILTERS = ["Active", "Inactive", "Archived", "all"];

// ── Customer Card ─────────────────────────────────────────────────────────────
function CustomerCard({ c, onClick }: { c: Customer; onClick: () => void }) {
  const isVip = c.vipTier !== "Standard";
  return (
    <button
      onClick={onClick}
      className="w-full text-left glass-panel p-4 rounded-xl border border-brass/10 hover:border-brass/40 transition-all group"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={cn(
          "w-10 h-10 rounded-full border flex items-center justify-center flex-shrink-0 text-sm font-semibold",
          isVip ? VIP_COLORS[c.vipTier] : "bg-brass/10 border-brass/20 text-brass-shimmer"
        )}>
          {c.name.charAt(0).toUpperCase()}
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
          <span className={cn("text-[9px] tracking-wider font-bold uppercase px-1.5 py-0.5 rounded border", VIP_COLORS[c.vipTier] ?? VIP_COLORS.Standard)}>
            {c.vipTier}
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

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (vipFilter !== "All") params.set("vip", vipFilter);
  params.set("limit", "500");

  const { data, isLoading } = useQuery({
    queryKey: ["customers", statusFilter, vipFilter],
    queryFn: () => api.get<{ data: Customer[]; total: number }>(`/api/customers?${params}`).then((r: any) => r),
    staleTime: 60_000,
  });

  const customers: Customer[] = (data as any)?.data ?? (Array.isArray(data) ? data : []);
  const total: number = (data as any)?.total ?? customers.length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return customers;
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q)
    );
  }, [customers, search]);

  const kpis = useMemo(() => ({
    total: total,
    vip: customers.filter(c => c.vipTier !== "Standard").length,
    casa: customers.filter(c => !!c.casaTier).length,
  }), [customers, total]);

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="L&S House · Clients"
        title={<>Every <span className="text-brass-shimmer">gentleman</span> in the house.</>}
        description={`${total.toLocaleString()} clients in the book.`}
        actions={
          <Button className="btn-brass" onClick={() => navigate("/customers/new")}>
            <Plus className="w-4 h-4 mr-1.5" /> New Client
          </Button>
        }
      />

      {/* KPI bar */}
      {!isLoading && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Clients", value: kpis.total.toLocaleString() },
            { label: "VIP", value: kpis.vip.toLocaleString(), gold: true },
            { label: "Casa Members", value: kpis.casa.toLocaleString(), gold: kpis.casa > 0 },
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
            <Search className="w-4 h-4 text-cream-muted flex-shrink-0" />
            <input
              className="flex-1 bg-transparent text-cream text-sm placeholder:text-cream-dim focus:outline-none"
              placeholder="Search by name, phone, email, company…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
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
      {search && (
        <p className="text-xs text-cream-dim">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{search}"
        </p>
      )}

      {/* List */}
      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading clients…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients found"
          description={search ? `No match for "${search}"` : "Add the first client to get started."}
          action={<Button className="btn-brass" onClick={() => navigate("/customers/new")}>New Client</Button>}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <CustomerCard key={c.id} c={c} onClick={() => navigate(`/customers/${c.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
