/**
 * SPEC 073b + redesign v2 — body-zone home + Geelus folder drill-in.
 * Home: Where on the garment (zones with jacket/trouser map) · Most used · search
 * Zone → leaves (flattened from matching ERP groups) · groups still openable
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Folder,
  GripVertical,
  Loader2,
  Search,
} from "lucide-react";
import { cn } from "@ls/design/utils";
import { GarmentZoneIcon, type BodyZoneId } from "@alts/components/intake/GarmentZoneIcon";
import {
  isGroup as isGroupFn,
  labelOfPreset,
  matchZone,
  zonesForGarment,
  type BodyZoneDef,
} from "@alts/components/intake/bodyZones";

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
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function labelOf(p: HierarchyPreset) {
  return labelOfPreset(p);
}

export function isGroupPreset(p: HierarchyPreset) {
  return isGroupFn(p);
}

export function isLeafPreset(p: HierarchyPreset) {
  return !isGroupPreset(p);
}

export function normalizeGarmentType(raw: string): string {
  const s = (raw || "").trim();
  const lower = s.toLowerCase();
  if (lower === "trousers" || lower === "pants" || lower === "trouser") return "Trouser";
  if (lower === "suit jacket" || lower === "sport coat" || lower === "blazer") return "Jacket";
  if (lower === "overcoat" || lower === "topcoat") return "Coat";
  if (lower === "blouse") return "Shirt";
  if (lower.startsWith("suit")) return "Jacket";
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

function priceText(p: HierarchyPreset, asFrom: boolean) {
  const n = Number(p.price) || 0;
  if (!asFrom && n === 0) return "Quote";
  if (asFrom) return n === 0 ? "Options" : `from ${money(n)}`;
  return money(n);
}

function orderKey(garmentType: string) {
  return `alts-folder-order:v2:${normalizeGarmentType(garmentType)}`;
}

function readOrder(garmentType: string): string[] {
  try {
    const raw = localStorage.getItem(orderKey(garmentType));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function writeOrder(garmentType: string, ids: string[]) {
  try {
    localStorage.setItem(orderKey(garmentType), JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ra = rank.has(a.id) ? (rank.get(a.id) as number) : 10_000;
    const rb = rank.has(b.id) ? (rank.get(b.id) as number) : 10_000;
    return ra - rb;
  });
}

type Props = {
  presets: HierarchyPreset[];
  loading?: boolean;
  garmentType: string;
  selectedIds: Set<string> | string[];
  onToggleLeaf: (p: HierarchyPreset) => void;
  className?: string;
  compact?: boolean;
};

type View =
  | { kind: "home" }
  | { kind: "zone"; zone: BodyZoneDef }
  | { kind: "group"; group: HierarchyPreset; zone?: BodyZoneDef | null };

export default function TaskSubitemPicker({
  presets,
  loading,
  garmentType,
  selectedIds,
  onToggleLeaf,
  className,
}: Props) {
  const selected = useMemo(() => {
    if (selectedIds instanceof Set) return selectedIds;
    return new Set(selectedIds);
  }, [selectedIds]);

  const [view, setView] = useState<View>({ kind: "home" });
  const [q, setQ] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    setView({ kind: "home" });
    setQ("");
    setEditMode(false);
    setOrder(readOrder(garmentType));
  }, [garmentType]);

  const forGarment = useMemo(
    () => presets.filter((p) => garmentMatchesPreset(p, garmentType)),
    [presets, garmentType],
  );

  const zones = useMemo(() => zonesForGarment(garmentType), [garmentType]);

  const childrenOf = useCallback(
    (parent: HierarchyPreset | null) => {
      if (!parent) return forGarment.filter((p) => !p.parent_preset);
      const keys = new Set(
        [parent.id, parent.name, parent.preset_name].filter(Boolean) as string[],
      );
      return forGarment.filter((p) => p.parent_preset && keys.has(p.parent_preset));
    },
    [forGarment],
  );

  const rootItems = useMemo(() => forGarment.filter((p) => !p.parent_preset), [forGarment]);

  const quickPicks = useMemo(() => {
    return forGarment
      .filter((p) => isLeafPreset(p) && (p.quick_pick === 1 || p.quick_pick === true))
      .sort(
        (a, b) =>
          (a.sort_order ?? 100) - (b.sort_order ?? 100) ||
          labelOf(a).localeCompare(labelOf(b)),
      );
  }, [forGarment]);

  /** Zone stats: option count + from $ across matching groups' leaves */
  const zoneStats = useMemo(() => {
    return zones.map((z) => {
      const matchedRoots = rootItems.filter((p) => matchZone(p, [z]) === z.id);
      const leaves: HierarchyPreset[] = [];
      for (const r of matchedRoots) {
        if (isGroupPreset(r)) {
          leaves.push(...childrenOf(r).filter((c) => !isGroupPreset(c)));
        } else {
          leaves.push(r);
        }
      }
      // also nested group children (rare)
      const prices = leaves.map((l) => Number(l.price) || 0).filter((n) => n > 0);
      const from = prices.length ? Math.min(...prices) : 0;
      const selectedCount = leaves.filter((l) => selected.has(l.id)).length;
      return {
        zone: z,
        roots: matchedRoots,
        leaves,
        from,
        count: leaves.length || matchedRoots.length,
        selectedCount,
      };
    });
  }, [zones, rootItems, childrenOf, selected]);

  const unmatchedRoots = useMemo(() => {
    return rootItems.filter((p) => matchZone(p, zones) == null);
  }, [rootItems, zones]);

  // --- list for current non-home view ---
  const listTiles = useMemo(() => {
    if (view.kind === "home") return [];
    if (view.kind === "group") {
      return childrenOf(view.group).sort(
        (a, b) =>
          (a.sort_order ?? 100) - (b.sort_order ?? 100) ||
          labelOf(a).localeCompare(labelOf(b)),
      );
    }
    // zone: flatten leaves, keep groups that still need drill if no leaves?
    const st = zoneStats.find((s) => s.zone.id === view.zone.id);
    if (!st) return [];
    // Prefer flat leaves; if a matched root is group with children, show children
    // If group has no children yet, show group tile
    const out: HierarchyPreset[] = [];
    for (const r of st.roots) {
      if (isGroupPreset(r)) {
        const kids = childrenOf(r);
        if (kids.length) out.push(...kids.filter((k) => !isGroupPreset(k)));
        else out.push(r);
        // nested groups
        out.push(...kids.filter(isGroupPreset));
      } else {
        out.push(r);
      }
    }
    // de-dupe by id
    const seen = new Set<string>();
    return out
      .filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
      .sort(
        (a, b) =>
          (a.sort_order ?? 100) - (b.sort_order ?? 100) ||
          labelOf(a).localeCompare(labelOf(b)),
      );
  }, [view, zoneStats, childrenOf]);

  const filteredList = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return listTiles;
    return listTiles.filter((p) => labelOf(p).toLowerCase().includes(needle));
  }, [listTiles, q]);

  /** Global search on home */
  const homeSearchResults = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || view.kind !== "home") return null;
    return forGarment
      .filter((p) => isLeafPreset(p) && labelOf(p).toLowerCase().includes(needle))
      .sort((a, b) => labelOf(a).localeCompare(labelOf(b)))
      .slice(0, 40);
  }, [q, view.kind, forGarment]);

  function goHome() {
    setView({ kind: "home" });
    setQ("");
  }

  function onTile(p: HierarchyPreset) {
    if (editMode) return;
    if (isGroupPreset(p)) {
      setView({
        kind: "group",
        group: p,
        zone: view.kind === "zone" ? view.zone : view.kind === "group" ? view.zone : null,
      });
      setQ("");
      return;
    }
    onToggleLeaf(p);
  }

  function persistOrder(next: string[]) {
    setOrder(next);
    writeOrder(garmentType, next);
  }

  const crumb =
    view.kind === "home"
      ? normalizeGarmentType(garmentType)
      : view.kind === "zone"
        ? `${normalizeGarmentType(garmentType)} · ${view.zone.name}`
        : `${normalizeGarmentType(garmentType)}${view.zone ? ` · ${view.zone.name}` : ""} · ${labelOf(view.group)}`;

  return (
    <div className={cn("flex flex-col gap-2.5 w-full min-w-0", className)}>
      {/* nav */}
      {view.kind !== "home" ? (
        <div className="flex items-center gap-2 min-h-11 min-w-0">
          <button
            type="button"
            onClick={() => {
              if (view.kind === "group" && view.zone) {
                setView({ kind: "zone", zone: view.zone });
              } else {
                goHome();
              }
              setQ("");
            }}
            className="inline-flex items-center gap-1 shrink-0 min-h-11 px-2.5 rounded-lg border border-brass/30 text-brass-light text-[11px] font-bold tracking-widest uppercase hover:bg-brass/10"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="text-[12px] text-cream-dim truncate min-w-0 flex-1" title={crumb}>
            {crumb}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 min-h-9">
          <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light">
            Where on the garment
          </div>
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={cn(
              "text-[10px] font-bold tracking-widest uppercase min-h-9 px-2 rounded-md border",
              editMode
                ? "border-brass bg-brass/20 text-brass-light"
                : "border-brass/25 text-cream-dim hover:border-brass/45",
            )}
          >
            {editMode ? "Done" : "Rearrange"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-cream-dim text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading menu…
        </div>
      ) : (
        <>
          {/* Search */}
          <label className="relative block min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cream-dim pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                view.kind === "home"
                  ? `Search all ${normalizeGarmentType(garmentType).toLowerCase()} work…`
                  : "Search this list…"
              }
              className="w-full h-11 rounded-xl bg-black/40 border border-brass/30 pl-9 pr-3 text-sm text-cream outline-none focus:border-brass placeholder:text-cream-dim !bg-black/40"
            />
          </label>

          {/* Home search results */}
          {homeSearchResults && (
            <div className="flex flex-col gap-1.5 min-w-0">
              {homeSearchResults.length === 0 ? (
                <p className="text-sm text-cream-dim py-6 text-center">
                  No match. Try a part name, or use Repairs & custom.
                </p>
              ) : (
                homeSearchResults.map((p) => (
                  <LeafRow
                    key={p.id}
                    p={p}
                    on={selected.has(p.id)}
                    onClick={() => onToggleLeaf(p)}
                    showZone
                    zones={zones}
                  />
                ))
              )}
            </div>
          )}

          {/* HOME */}
          {view.kind === "home" && !homeSearchResults && (
            <>
              {quickPicks.length > 0 && !editMode && (
                <div className="min-w-0">
                  <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass/80 mb-1.5">
                    ★ Most used
                  </div>
                  <div className="grid grid-cols-2 gap-2 min-w-0">
                    {quickPicks.slice(0, 6).map((p) => {
                      const on = selected.has(p.id);
                      return (
                        <button
                          key={`qp-${p.id}`}
                          type="button"
                          onClick={() => onToggleLeaf(p)}
                          className={cn(
                            "min-h-[64px] rounded-[13px] border px-3 py-2.5 text-left min-w-0",
                            on
                              ? "border-brass bg-brass/20"
                              : "border-brass/30 bg-transparent hover:border-brass/55",
                          )}
                        >
                          <div className="text-[13px] font-medium text-cream leading-snug break-words">
                            {labelOf(p)}
                          </div>
                          <div className="flex justify-between items-baseline mt-1 gap-1">
                            <span className="text-[10.5px] text-cream-dim truncate">
                              {p.est_minutes ? `${p.est_minutes} min` : "\u00A0"}
                            </span>
                            <span className="text-[17px] tabular-nums text-brass-light font-semibold shrink-0">
                              {priceText(p, false)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Zone body map */}
              <div className="min-w-0">
                <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass-light mb-2">
                  Body map
                </div>
                <div className="grid grid-cols-2 gap-2.5 min-w-0">
                  {zoneStats.map(({ zone, from, count, selectedCount }) => {
                    const on = selectedCount > 0;
                    return (
                      <button
                        key={zone.id}
                        type="button"
                        onClick={() => {
                          setView({ kind: "zone", zone });
                          setQ("");
                          setEditMode(false);
                        }}
                        className={cn(
                          "relative flex flex-col items-center text-center px-2.5 pt-3.5 pb-3 rounded-[15px] border min-w-0 transition-colors",
                          on
                          ? "border-brass bg-gradient-to-b from-[#D3AE72] to-[#B08D57] shadow-[0_6px_18px_rgba(176,141,87,0.30)]"
                          : "border-brass/35 bg-white/[0.03] hover:border-brass/60",
                        )}
                      >
                        <GarmentZoneIcon
                          garmentType={garmentType}
                          zone={zone.id}
                          size={40}
                          active={on}
                        />
                        <div
                          className={cn(
                            "text-[13px] font-semibold mt-1.5 leading-snug",
                            on ? "text-[#0C1810]" : "text-cream",
                          )}
                        >
                          {zone.name}
                        </div>
                        <div
                          className={cn(
                            "text-[10.5px] mt-0.5",
                            on ? "text-[#0C1810]/70" : "text-cream-dim",
                          )}
                        >
                          {count
                            ? `${from > 0 ? `from ${money(from)}` : "quoted"} · ${count}`
                            : "—"}
                        </div>
                        {selectedCount > 0 && (
                          <span className="absolute top-2.5 right-2.5 min-w-[20px] h-5 px-1 rounded-full bg-[#0C1810] text-brass-light text-[11px] font-bold grid place-items-center">
                            {selectedCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Unmatched ERP groups / leaves */}
              {unmatchedRoots.length > 0 && (
                <div className="min-w-0">
                  <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-cream-dim mb-1.5">
                    More on library
                  </div>
                  <div className="grid grid-cols-2 gap-2 min-w-0">
                    {applyOrder(unmatchedRoots, order).map((p) => {
                      const folder = isGroupPreset(p);
                      const on = !folder && selected.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          draggable={editMode}
                          onDragStart={() => {
                            if (editMode) dragId.current = p.id;
                          }}
                          onDragOver={(e) => {
                            if (editMode) e.preventDefault();
                          }}
                          onDrop={() => {
                            const from = dragId.current;
                            dragId.current = null;
                            if (!from || from === p.id) return;
                            const ids = applyOrder(unmatchedRoots, order).map((x) => x.id);
                            const fi = ids.indexOf(from);
                            const ti = ids.indexOf(p.id);
                            if (fi < 0 || ti < 0) return;
                            const next = [...ids];
                            next.splice(fi, 1);
                            next.splice(ti, 0, from);
                            persistOrder(next);
                          }}
                          onClick={() => onTile(p)}
                          className={cn(
                            "relative flex flex-col gap-1 min-h-[88px] min-w-0 rounded-[14px] border px-2.5 py-2.5 text-left",
                            on
                              ? "border-brass bg-brass/15"
                              : folder
                                ? "border-brass/40 bg-brass/[0.08]"
                                : "border-brass/25 bg-white/[0.02]",
                          )}
                        >
                          {editMode && (
                            <GripVertical className="absolute top-1.5 right-1.5 w-3.5 h-3.5 text-cream-dim/70" />
                          )}
                          <div className="flex items-start gap-2 min-w-0">
                            {folder ? (
                              <Folder className="w-4 h-4 text-brass-light shrink-0 mt-0.5" />
                            ) : null}
                            <div className="text-[12.5px] font-semibold leading-snug break-words min-w-0">
                              {labelOf(p)}
                            </div>
                          </div>
                          <div className="mt-auto text-[14px] tabular-nums text-brass-light font-semibold">
                            {priceText(p, folder)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ZONE or GROUP list */}
          {view.kind !== "home" && (
            <div className="flex flex-col gap-1.5 min-w-0 w-full">
              {view.kind === "zone" && (
                <div className="flex items-center gap-3 mb-1 px-0.5">
                  <GarmentZoneIcon garmentType={garmentType} zone={view.zone.id} size={36} />
                  <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass-light">
                    {view.zone.name} · pick work
                  </div>
                </div>
              )}
              {filteredList.length === 0 ? (
                <p className="text-sm text-cream-dim py-8 text-center">No options in this area.</p>
              ) : (
                filteredList.map((p) => {
                  const folder = isGroupPreset(p);
                  if (folder) {
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onTile(p)}
                        className="w-full min-h-[52px] flex items-center gap-3 px-3 py-2.5 rounded-[14px] border border-brass/40 bg-brass/[0.08] text-left min-w-0"
                      >
                        <Folder className="w-5 h-5 text-brass-light shrink-0" />
                        <span className="flex-1 min-w-0 text-[13px] font-semibold break-words">
                          {labelOf(p)}
                        </span>
                        <span className="shrink-0 text-[15px] tabular-nums text-brass-light font-medium">
                          {priceText(p, true)}
                        </span>
                        <span className="text-brass-light text-lg">›</span>
                      </button>
                    );
                  }
                  return (
                    <LeafRow
                      key={p.id}
                      p={p}
                      on={selected.has(p.id)}
                      onClick={() => onToggleLeaf(p)}
                    />
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LeafRow({
  p,
  on,
  onClick,
  showZone,
  zones,
}: {
  p: HierarchyPreset;
  on: boolean;
  onClick: () => void;
  showZone?: boolean;
  zones?: BodyZoneDef[];
}) {
  const z = showZone && zones ? matchZone(p, zones) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full min-h-[52px] flex items-center gap-3 px-3 py-2.5 rounded-[14px] border text-left min-w-0",
        on
          ? "border-brass bg-brass/15 ring-1 ring-brass/40"
          : "border-brass/25 bg-white/[0.02] hover:border-brass/45",
      )}
    >
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-semibold leading-snug break-words">
          {labelOf(p)}
        </span>
        <span className="block text-[10.5px] text-cream-dim mt-0.5">
          {[
            z && zones ? zones.find((x) => x.id === z)?.name : null,
            p.est_minutes ? `${p.est_minutes} min` : null,
            Number(p.price) === 0 ? "Set at till" : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
        </span>
      </span>
      <span className="shrink-0 text-[15px] tabular-nums text-brass-light font-medium">
        {priceText(p, false)}
      </span>
      {on ? (
        <span className="shrink-0 w-[22px] h-[22px] rounded-full bg-brass text-[#0C1810] grid place-items-center text-[11px] font-bold">
          ✓
        </span>
      ) : (
        <span className="shrink-0 w-[22px] h-[22px] rounded-full border border-brass/35" />
      )}
    </button>
  );
}
