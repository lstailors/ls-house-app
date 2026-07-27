import { useMemo, useState } from "react";
import { Scissors, Plus, Building2 } from "lucide-react";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { FilterBar } from "@ls/design";
import { StatusPill } from "@ls/design";
import { EmptyState } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { useTailors, useLocations } from "@/lib/queries";
import { initials, formatDate } from "@ls/design/format";

export default function AdminTailors() {
  const { data: tailors = [], isLoading } = useTailors();
  const { data: locations = [] } = useLocations();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const locationMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations) m.set(l.id, l.name);
    return m;
  }, [locations]);

  const filterOptions = useMemo(
    () => [
      { value: "all", label: "All" },
      ...locations.map((l) => ({ value: l.id, label: l.name })),
    ],
    [locations],
  );

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return tailors.filter((t) => {
      if (filter !== "all" && t.locationId !== filter) return false;
      if (!s) return true;
      return t.name.toLowerCase().includes(s);
    });
  }, [tailors, search, filter]);

  const activeCount = tailors.filter((t) => t.isActive).length;

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Admin · Tailors"
        title={
          <>
            The <span className="text-brass-shimmer">cutters</span> and <span className="text-brass-shimmer">finishers</span>.
          </>
        }
        description="Master tailors and alteration specialists, by storefront."
        actions={
          <Button className="btn-brass">
            <Plus className="h-4 w-4 mr-1.5" /> Add tailor
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <div className="glass-panel p-5">
          <div className="ui-label mb-1 flex items-center gap-1.5">
            <Scissors className="h-3 w-3 text-brass-light" /> Total
          </div>
          <div className="kpi-number">{tailors.length}</div>
        </div>
        <div className="glass-panel p-5">
          <div className="ui-label mb-1">On the floor</div>
          <div className="kpi-number text-signal-emerald">{activeCount}</div>
        </div>
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search tailor by name"
        filterValue={filter}
        onFilterChange={setFilter}
        filterOptions={filterOptions}
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title="No tailors yet"
          description="Hire a master cutter and add them to a location."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <GlassCard key={t.id} hover className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-12 w-12 rounded-full border-2 border-brass/30 bg-forest-raised flex items-center justify-center text-brass-light font-display italic text-lg shrink-0">
                  {initials(t.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-cream font-medium truncate">{t.name}</div>
                  <div className="text-[11px] text-cream-dim flex items-center gap-1 truncate">
                    <Building2 className="h-2.5 w-2.5 shrink-0" />
                    {locationMap.get(t.locationId) ?? "—"}
                  </div>
                </div>
                <StatusPill
                  status={t.isActive ? "active" : "inactive"}
                  variant={t.isActive ? "emerald" : "muted"}
                  label={t.isActive ? "On" : "Off"}
                />
              </div>
              <div className="text-[10px] text-cream-dim uppercase tracking-wider">
                Joined · <span className="text-cream-muted normal-case tracking-normal">{formatDate(t.createdAt)}</span>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
