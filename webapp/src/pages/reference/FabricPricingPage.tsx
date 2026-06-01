import { useMemo, useState } from "react";
import { Layers, Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { DataTable, type Column } from "@/components/glass/DataTable";
import { FilterBar } from "@/components/glass/FilterBar";
import { EmptyState } from "@/components/glass/EmptyState";
import { useFabrics } from "@/lib/queries";
import { formatUSD } from "@/lib/format";
import type { FabricPricing } from "@/lib/types";
import { cn } from "@/lib/utils";

const TIER_ACCENT: Record<string, { dot: string; text: string }> = {
  Standard: { dot: "bg-cream-dim", text: "text-cream-muted" },
  Premium: { dot: "bg-brass-light", text: "text-brass-light" },
  Signature: { dot: "bg-signal-emerald", text: "text-signal-emerald" },
  Bespoke: { dot: "bg-signal-amber", text: "text-signal-amber" },
};

export default function FabricPricingPage() {
  const { data: fabrics = [], isLoading } = useFabrics();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const tiers = useMemo(() => {
    const set = new Set<string>();
    for (const f of fabrics) if (f.tier) set.add(f.tier);
    return Array.from(set).sort();
  }, [fabrics]);

  const filterOptions = useMemo(
    () => [
      { value: "all", label: "All" },
      ...tiers.map((t) => ({ value: t, label: t })),
    ],
    [tiers],
  );

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return fabrics.filter((f) => {
      if (filter !== "all" && f.tier !== filter) return false;
      if (!s) return true;
      return (
        f.fabricName.toLowerCase().includes(s) ||
        (f.mill ?? "").toLowerCase().includes(s) ||
        (f.composition ?? "").toLowerCase().includes(s)
      );
    });
  }, [fabrics, search, filter]);

  const columns: Column<FabricPricing>[] = [
    {
      key: "name",
      header: "Fabric",
      cell: (f) => (
        <div className="min-w-0">
          <div className="text-cream font-medium truncate">{f.fabricName}</div>
          {f.mill ? (
            <div className="text-[11px] text-cream-dim italic truncate">{f.mill}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "composition",
      header: "Composition",
      cell: (f) => (
        <span className="text-cream-muted text-sm truncate">{f.composition ?? "—"}</span>
      ),
    },
    {
      key: "weight",
      header: "Weight",
      cell: (f) => (
        <span className="text-cream-dim text-xs font-mono">{f.weight ?? "—"}</span>
      ),
    },
    {
      key: "season",
      header: "Season",
      cell: (f) => (
        <span className="text-cream-dim text-xs">{f.season ?? "—"}</span>
      ),
    },
    {
      key: "tier",
      header: "Tier",
      cell: (f) => {
        const accent = TIER_ACCENT[f.tier ?? ""] ?? TIER_ACCENT.Standard;
        return (
          <div className={cn("inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider", accent.text)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", accent.dot)} />
            {f.tier ?? "—"}
          </div>
        );
      },
    },
    {
      key: "price",
      header: "Per yard",
      align: "right",
      cell: (f) => (
        <span className="font-display italic text-brass-shimmer text-base">
          {formatUSD(f.price)}
        </span>
      ),
    },
  ];

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of fabrics) {
      const t = f.tier ?? "Standard";
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [fabrics]);

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Reference · Fabric Pricing"
        title={
          <>
            The <span className="text-brass-shimmer">cloth</span> book.
          </>
        }
        description="Every bolt the house carries — mill, composition, and price per yard."
      />

      {tiers.length > 0 ? (
        <div className={`grid grid-cols-2 md:grid-cols-${Math.min(4, tiers.length)} gap-4`}>
          {tiers.map((t) => {
            const accent = TIER_ACCENT[t] ?? TIER_ACCENT.Standard;
            return (
              <GlassCard key={t} className="p-5">
                <div className={cn("ui-label mb-1 flex items-center gap-1.5", accent.text)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", accent.dot)} />
                  {t}
                </div>
                <div className="kpi-number">{tierCounts[t] ?? 0}</div>
              </GlassCard>
            );
          })}
        </div>
      ) : null}

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search fabric, mill, or composition"
        filterValue={filter}
        onFilterChange={setFilter}
        filterOptions={filterOptions}
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No fabrics"
          description="Stock the cloth book to begin pricing commissions."
        />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />
      )}

      <div className="text-[11px] text-cream-dim italic flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-brass-light/60" />
        Prices here feed the Custom Made POS — change a fabric, every fresh quote uses the new number.
      </div>
    </div>
  );
}
