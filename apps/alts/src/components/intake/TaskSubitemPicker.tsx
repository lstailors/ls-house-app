/**
 * SPEC 073 / 041-task-subitem-menu — Geelus 2-level task → sub-item picker.
 * Shared by GarmentOptionsDrawer, AddWork, EditTicketDrawer.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { cn } from "@ls/design/utils";

export type HierarchyPreset = {
  id: string;
  name?: string;
  preset_name: string;
  display_name?: string;
  garment_type?: string;
  garment_types?: string[];
  price: number;
  est_minutes?: number | null;
  is_group?: number | boolean;
  parent_preset?: string | null;
  item_code?: string | null;
  quick_pick?: number | boolean;
  sort_order?: number;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function labelOf(p: HierarchyPreset) {
  return (p.display_name || p.preset_name || p.id || "").trim();
}

export function isGroupPreset(p: HierarchyPreset) {
  return p.is_group === 1 || p.is_group === true;
}

export function isLeafPreset(p: HierarchyPreset) {
  return !isGroupPreset(p) && !!(p.item_code || p.id);
}

/** Map intake garment labels → ERP garment_type */
export function normalizeGarmentType(raw: string): string {
  const s = (raw || "").trim();
  const lower = s.toLowerCase();
  if (lower === "trousers" || lower === "pants" || lower === "trouser") return "Trouser";
  if (lower === "suit jacket" || lower === "sport coat" || lower === "blazer") return "Jacket";
  if (lower === "overcoat" || lower === "topcoat") return "Coat";
  if (lower === "blouse") return "Shirt";
  if (lower === "suit") return "Jacket"; // suit pieces usually jacket first; filter still soft-matches
  return s;
}

export function garmentMatchesPreset(preset: HierarchyPreset, garmentType: string): boolean {
  const want = normalizeGarmentType(garmentType);
  const types = (
    preset.garment_types?.length
      ? preset.garment_types
      : preset.garment_type
        ? [preset.garment_type]
        : ["All"]
  ).map((t) => normalizeGarmentType(t));
  if (types.some((t) => t === "All" || !t)) return true;
  const w = want.toLowerCase();
  return types.some((t) => {
    const tl = t.toLowerCase();
    return tl === w || tl.includes(w) || w.includes(tl);
  });
}

function priceLabel(p: HierarchyPreset, asFrom: boolean) {
  const n = Number(p.price) || 0;
  if (!asFrom && n === 0) return "Quote";
  if (asFrom) return `from ${money(n)}`;
  return money(n);
}

type Props = {
  presets: HierarchyPreset[];
  loading?: boolean;
  garmentType: string;
  /** preset ids currently on the garment cart */
  selectedIds: Set<string> | string[];
  onToggleLeaf: (p: HierarchyPreset) => void;
  className?: string;
  /** denser tiles for phone */
  compact?: boolean;
};

export default function TaskSubitemPicker({
  presets,
  loading,
  garmentType,
  selectedIds,
  onToggleLeaf,
  className,
  compact,
}: Props) {
  const selected = useMemo(() => {
    if (selectedIds instanceof Set) return selectedIds;
    return new Set(selectedIds);
  }, [selectedIds]);

  const [group, setGroup] = useState<HierarchyPreset | null>(null);
  const [q, setQ] = useState("");

  // reset drill-in when garment changes
  useEffect(() => {
    setGroup(null);
    setQ("");
  }, [garmentType]);

  const forGarment = useMemo(
    () => presets.filter((p) => garmentMatchesPreset(p, garmentType)),
    [presets, garmentType],
  );

  const quickPicks = useMemo(() => {
    return forGarment
      .filter((p) => isLeafPreset(p) && (p.quick_pick === 1 || p.quick_pick === true))
      .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || labelOf(a).localeCompare(labelOf(b)));
  }, [forGarment]);

  const rootTiles = useMemo(() => {
    // top level: no parent_preset
    return forGarment
      .filter((p) => !p.parent_preset)
      .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || labelOf(a).localeCompare(labelOf(b)));
  }, [forGarment]);

  const detailTiles = useMemo(() => {
    if (!group) return [];
    return forGarment
      .filter((p) => p.parent_preset === group.id || p.parent_preset === group.name || p.parent_preset === group.preset_name)
      .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || labelOf(a).localeCompare(labelOf(b)));
  }, [forGarment, group]);

  const levelTiles = group ? detailTiles : rootTiles;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return levelTiles;
    return levelTiles.filter((p) => labelOf(p).toLowerCase().includes(needle));
  }, [levelTiles, q]);

  const showSearch = levelTiles.length > 10;

  function onTile(p: HierarchyPreset) {
    if (isGroupPreset(p)) {
      setGroup(p);
      setQ("");
      return;
    }
    // leaf only
    if (!isLeafPreset(p)) return;
    onToggleLeaf(p);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* breadcrumb / back */}
      {group ? (
        <div className="flex items-center gap-2 min-h-11">
          <button
            type="button"
            onClick={() => {
              setGroup(null);
              setQ("");
            }}
            className="inline-flex items-center gap-1 min-h-11 px-2 rounded-lg border border-brass/30 text-brass-light text-[11px] font-bold tracking-widest uppercase hover:bg-brass/10"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="text-[12px] text-cream-dim truncate">
            <span className="text-cream/80">{normalizeGarmentType(garmentType)}</span>
            <span className="mx-1.5 text-brass/50">·</span>
            <span className="text-brass-light font-semibold">{labelOf(group)}</span>
          </div>
        </div>
      ) : (
        <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light">
          Select task
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-cream-dim text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading menu…
        </div>
      ) : (
        <>
          {/* Quick picks — root only */}
          {!group && quickPicks.length > 0 && (
            <div className="mb-1">
              <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass/80 mb-1.5">
                ★ Quick picks
              </div>
              <div className={cn("grid gap-1.5", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
                {quickPicks.map((p) => {
                  const on = selected.has(p.id);
                  return (
                    <button
                      key={`qp-${p.id}`}
                      type="button"
                      onClick={() => onToggleLeaf(p)}
                      className={cn(
                        "min-h-[52px] rounded-[12px] border px-2.5 py-2 text-left transition-colors",
                        on
                          ? "border-brass bg-brass/20"
                          : "border-brass/30 bg-brass/[0.07] hover:border-brass/55",
                      )}
                    >
                      <div className="text-[12px] font-semibold leading-snug line-clamp-2">{labelOf(p)}</div>
                      <div className="display text-[15px] text-brass-light mt-0.5">{priceLabel(p, false)}</div>
                    </button>
                  );
                })}
              </div>
              <div className="h-px bg-brass/20 my-2.5" />
              <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-cream-dim mb-1">
                Full library
              </div>
            </div>
          )}

          {group && (
            <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass-light">
              Select task detail
            </div>
          )}

          {showSearch && (
            <label className="relative block mb-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cream-dim" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search this list…"
                className="w-full h-11 rounded-xl bg-black/40 border border-brass/30 pl-9 pr-3 text-sm text-cream outline-none focus:border-brass placeholder:text-cream-dim !bg-black/40"
              />
            </label>
          )}

          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-cream-dim">No matches.</p>
              {q.trim() ? (
                <button
                  type="button"
                  className="mt-2 text-[11px] font-bold tracking-widest uppercase text-brass-light"
                  onClick={() => setQ("")}
                >
                  Clear search
                </button>
              ) : (
                <p className="text-xs text-cream-dim/80 mt-1">Use a custom line below.</p>
              )}
            </div>
          ) : (
            <div className={cn("grid gap-1.5", compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
              {filtered.map((p) => {
                const groupTile = isGroupPreset(p);
                const on = !groupTile && selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onTile(p)}
                    className={cn(
                      "w-full min-h-[56px] flex items-center gap-2.5 px-3 py-2.5 rounded-[14px] border text-left transition-colors",
                      on
                        ? "border-brass bg-brass/15 ring-1 ring-brass/40"
                        : groupTile
                          ? "border-brass/35 bg-white/[0.03] hover:border-brass/55 hover:bg-brass/[0.06]"
                          : "border-brass/25 bg-white/[0.02] hover:border-brass/45 hover:bg-brass/[0.06]",
                    )}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold leading-snug line-clamp-2">
                        {labelOf(p)}
                      </span>
                      <span className="text-[10.5px] text-cream-dim">
                        {groupTile
                          ? "Options"
                          : p.est_minutes
                            ? `${p.est_minutes} min`
                            : Number(p.price) === 0
                              ? "Set at till"
                              : "—"}
                      </span>
                    </span>
                    <span className="display text-lg text-brass-light flex-none tabular-nums">
                      {priceLabel(p, groupTile)}
                    </span>
                    {groupTile ? (
                      <ChevronRight className="w-4 h-4 text-brass-light flex-none opacity-80" />
                    ) : on ? (
                      <span className="w-[22px] h-[22px] rounded-full bg-brass text-forest-deep grid place-items-center text-[11px] font-bold flex-none">
                        ✓
                      </span>
                    ) : (
                      <span className="w-[22px] h-[22px] rounded-full border border-brass/35 flex-none" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
