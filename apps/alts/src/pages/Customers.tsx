import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Plus, Star, Phone, Mail, Building2,
  Filter, ChevronRight, Users, Loader2, AlertTriangle,
} from "lucide-react";
import { SectionHeader } from "@ls/design";
import { EmptyState } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { api } from "@ls/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@ls/design/utils";
import { useMe } from "@ls/auth/session";

type ReviewFlag = "track_or_pan" | "weird_name" | "marketing_email" | "missing_contact" | "duplicate_phone";

interface Customer {
  id: string;
  customerNumber: number | string | null;
  name: string;
  displayName?: string;
  reviewFlags?: ReviewFlag[];
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

interface QualityRow {
  id: string;
  name: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  flags: ReviewFlag[];
}

const VIP_COLORS: Record<string, string> = {
  Platinum: "text-purple-300 border-purple-400/40 bg-purple-900/20",
  Gold:     "text-brass-shimmer border-brass/40 bg-brass/10",
  Silver:   "text-slate-300 border-slate-400/40 bg-slate-800/20",
  VIP:      "text-brass-shimmer border-brass/40 bg-brass/10",
  Standard: "text-cream-dim border-brass/10 bg-transparent",
};

const FLAG_LABEL: Record<ReviewFlag, string> = {
  track_or_pan: "Card data",
  weird_name: "Odd name",
  marketing_email: "Marketing email",
  missing_contact: "No phone or email",
  duplicate_phone: "Shared phone",
};

const VIP_FILTERS = ["All", "VIP", "Standard"];
const STATUS_FILTERS = ["Active", "Inactive", "Archived", "all"];

function useDebounced<T>(value: T, ms = 280): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value]);
  return v;
}

function clientLabel(c: { name: string; displayName?: string; reviewFlags?: ReviewFlag[] }) {
  if (c.reviewFlags?.includes("track_or_pan")) return c.displayName || "Needs review";
  return c.displayName || c.name;
}

function FlagChips({ flags }: { flags?: ReviewFlag[] }) {
  if (!flags?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {flags.map((f) => (
        <span
          key={f}
          className={cn(
            "text-[9px] tracking-widest font-bold uppercase px-1.5 py-0.5 rounded border",
            f === "track_or_pan"
              ? "border-signal-rose/40 text-signal-rose bg-signal-rose/10"
              : "border-brass/30 text-brass-light bg-brass/5",
          )}
        >
          {FLAG_LABEL[f] ?? f}
        </span>
      ))}
    </div>
  );
}

function CustomerCard({ c, onClick }: { c: Customer; onClick: () => void }) {
  const isVip = c.vipFlag || (c.vipTier && c.vipTier !== "Standard");
  const vipLabel = isVip ? (c.vipTier === "Standard" ? "VIP" : c.vipTier) : "Standard";
  const flagged = (c.reviewFlags?.length ?? 0) > 0;
  const pan = c.reviewFlags?.includes("track_or_pan");
  const label = clientLabel(c);
  return (
    <button
      onClick={onClick}
      className={cn(
        "cust-row w-full text-left glass-panel p-3.5 rounded-xl border hover:border-brass/40 transition-all group",
        pan ? "border-signal-rose/35 bg-signal-rose/5" : flagged ? "border-brass/35 bg-brass/5" : "border-brass/15",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          "cust-avatar w-11 h-11 rounded-xl border flex items-center justify-center flex-shrink-0 text-sm font-semibold overflow-hidden",
          pan ? "bg-signal-rose/15 border-signal-rose/40 text-signal-rose" : isVip ? VIP_COLORS[vipLabel] || VIP_COLORS.VIP : "bg-brass/10 border-brass/25 text-brass-shimmer"
        )}>
          {c.image && !pan ? (
            <img src={c.image} alt="" className="w-full h-full object-cover" />
          ) : pan ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            label.charAt(0).toUpperCase()
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-cream font-semibold text-[15px] truncate display not-italic font-sans">{label}</span>
            {isVip && <Star className="w-3 h-3 text-brass fill-brass flex-shrink-0" />}
            {c.casaTier && (
              <span className="text-[9px] tracking-widest font-bold uppercase px-1.5 py-0.5 rounded border border-brass/30 text-brass-light bg-brass/5">
                CASA
              </span>
            )}
          </div>
          <FlagChips flags={c.reviewFlags} />

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
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

function NeedsReviewTab({ canMerge }: { canMerge: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);

  const report = useQuery({
    queryKey: ["customers-data-quality"],
    queryFn: () => api.get<{ rows: QualityRow[]; counts: Record<string, number> }>("/api/customers/data-quality"),
    staleTime: 60_000,
  });

  const merge = useMutation({
    mutationFn: () => {
      const [a, b] = picked;
      const primary = primaryId || a;
      const duplicate = primary === a ? b : a;
      return api.post("/api/customers/merge", { primaryId: primary, duplicateId: duplicate });
    },
    onSuccess: () => {
      toast.success("Records merged");
      setPicked([]);
      setPrimaryId(null);
      qc.invalidateQueries({ queryKey: ["customers-data-quality"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customers-book-total"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not merge"),
  });

  const rows = report.data?.rows ?? [];
  const counts = report.data?.counts ?? {};
  const toggle = (id: string) => {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 2) return [cur[1], id];
      return [...cur, id];
    });
    setPrimaryId(null);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Needs review", value: counts.total ?? rows.length },
          { label: "Card data", value: counts.track_or_pan ?? 0, alert: true },
          { label: "Odd names", value: counts.weird_name ?? 0 },
          { label: "No contact", value: counts.missing_contact ?? 0 },
          { label: "Shared phone", value: counts.duplicate_phone ?? 0 },
          { label: "Marketing email", value: counts.marketing_email ?? 0 },
        ].map(({ label, value, alert }) => (
          <div key={label} className="glass-panel p-3">
            <div className="ui-label mb-1">{label}</div>
            <div className={cn("kpi-number text-xl", alert && Number(value) > 0 ? "text-signal-rose" : "text-cream")}>
              {Number(value).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-cream-dim">
        Aim for zero. Flagged names never show a card number — open the record to fix it.
      </p>

      {canMerge && picked.length === 2 && (
        <div className="glass-panel p-4 rounded-xl border border-brass/30 space-y-3">
          <p className="text-sm text-cream">Merge these two. Tickets and invoices move to the one you keep.</p>
          <div className="flex flex-col gap-2">
            {picked.map((id) => {
              const row = rows.find((r) => r.id === id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPrimaryId(id)}
                  className={cn(
                    "text-left px-3 py-2 rounded-lg border text-sm",
                    (primaryId || picked[0]) === id ? "border-brass bg-brass/15 text-cream" : "border-brass/20 text-cream-muted",
                  )}
                >
                  Keep {(row?.displayName || row?.name || id)} as primary
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button className="btn-brass" disabled={merge.isPending} onClick={() => merge.mutate()}>
              {merge.isPending ? "Merging…" : "Merge now"}
            </Button>
            <Button variant="outline" className="border-brass/20 text-cream-muted" onClick={() => { setPicked([]); setPrimaryId(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {report.isLoading ? (
        <div className="text-cream-muted text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Scanning the book…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title="Nothing to review" description="The client book is clean." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const selected = picked.includes(r.id);
            return (
              <div key={r.id} className="flex items-stretch gap-2">
                {canMerge && (
                  <button
                    type="button"
                    onClick={() => toggle(r.id)}
                    className={cn(
                      "w-10 rounded-xl border flex items-center justify-center text-xs font-bold",
                      selected ? "border-brass bg-brass/20 text-cream" : "border-brass/20 text-cream-dim",
                    )}
                    aria-label="Select to merge"
                  >
                    {selected ? "✓" : ""}
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <CustomerCard
                    c={{
                      id: r.id,
                      customerNumber: r.id,
                      name: r.displayName,
                      displayName: r.displayName,
                      reviewFlags: r.flags,
                      firstName: null,
                      lastName: null,
                      phone: r.phone,
                      email: r.email,
                      company: null,
                      titleRole: null,
                      locationId: null,
                      status: "Active",
                      vipTier: "Standard",
                      notes: null,
                      tags: [],
                      casaTier: null,
                      createdAt: "",
                      updatedAt: "",
                    }}
                    onClick={() => navigate(`/customers/${encodeURIComponent(r.id)}`)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Customers() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const canMerge = me?.role === "super_admin" || me?.role === "store_manager";
  const [tab, setTab] = useState<"all" | "review">("all");
  const [search, setSearch] = useState("");
  const [vipFilter, setVipFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [showFilters, setShowFilters] = useState(false);
  const [browseLimit, setBrowseLimit] = useState(100);
  const debouncedQ = useDebounced(search.trim(), 300);
  const isSearching = debouncedQ.length >= 2;
  const pageSize = isSearching ? 40 : browseLimit;

  useEffect(() => {
    setBrowseLimit(100);
  }, [debouncedQ, statusFilter, vipFilter]);

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (vipFilter !== "All") params.set("vip", vipFilter);
  if (isSearching) params.set("q", debouncedQ);
  params.set("limit", String(pageSize));
  params.set("offset", "0");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["customers", statusFilter, vipFilter, debouncedQ, browseLimit],
    queryFn: async () => {
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
    },
    staleTime: isSearching ? 15_000 : 60_000,
    placeholderData: (prev) => prev,
    enabled: tab === "all",
  });

  const customers: Customer[] = data?.customers ?? [];
  const total: number = data?.total ?? customers.length;
  const mode: string = data?.mode ?? (isSearching ? "search" : "browse");

  const { data: bookMeta } = useQuery({
    queryKey: ["customers-book-total"],
    queryFn: async () => {
      const res = await api.raw(`/api/customers?status=Active&limit=1`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { total: 0 };
      return { total: typeof json?.total === "number" ? json.total : 0 };
    },
    staleTime: 5 * 60_000,
  });
  const bookTotal: number = bookMeta?.total || total;

  const { data: qualityMeta } = useQuery({
    queryKey: ["customers-data-quality"],
    queryFn: () => api.get<{ rows: QualityRow[]; counts: Record<string, number> }>("/api/customers/data-quality"),
    staleTime: 60_000,
  });
  const reviewCount = qualityMeta?.counts?.total ?? qualityMeta?.rows?.length ?? 0;

  const kpis = useMemo(() => ({
    total: bookTotal,
    vip: customers.filter(c => c.vipFlag || (c.vipTier && c.vipTier !== "Standard")).length,
    casa: customers.filter(c => !!c.casaTier).length,
    review: reviewCount,
  }), [customers, bookTotal, reviewCount]);

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

      {!isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Clients", value: kpis.total.toLocaleString() },
            { label: "VIP", value: kpis.vip.toLocaleString(), gold: true },
            { label: "Casa", value: kpis.casa.toLocaleString(), gold: kpis.casa > 0 },
            { label: "Needs review", value: kpis.review.toLocaleString(), alert: kpis.review > 0 },
          ].map(({ label, value, gold, alert }) => (
            <button
              key={label}
              type="button"
              onClick={() => label === "Needs review" && setTab("review")}
              className="glass-panel p-4 text-left"
            >
              <div className="ui-label mb-1">{label}</div>
              <div className={cn("kpi-number", alert ? "text-signal-rose" : gold ? "text-brass-shimmer" : "text-cream")}>{value}</div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {([
          ["all", "All clients"],
          ["review", `Needs review${reviewCount ? ` (${reviewCount})` : ""}`],
        ] as const).map(([k, lab]) => (
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
          </button>
        ))}
      </div>

      {tab === "review" ? (
        <NeedsReviewTab canMerge={!!canMerge} />
      ) : (
        <>
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

          {isLoading && customers.length === 0 ? (
            <div className="text-cream-muted text-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading clients…
            </div>
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
        </>
      )}
    </div>
  );
}
