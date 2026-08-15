/**
 * Body-zone home + folder drill-in.
 * Home: Quick actions (starred) · body map · search
 * Zone / group / search: large square tiles (same language as the body map)
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ChevronLeft, Folder, GripVertical, Loader2, Search, Star } from "lucide-react";
import { cn } from "@ls/design/utils";
import { GarmentZoneIcon } from "@alts/components/intake/GarmentZoneIcon";
import {
  loadFavoriteIds,
  normalizeGarmentType,
  reorderFavoriteIds,
  toggleFavoriteId,
} from "@alts/lib/intakeFavorites";
import {
  isGroup as isGroupFn,
  labelOfPreset,
  matchZone,
  zonesForGarment,
  type BodyZoneDef,
} from "@alts/components/intake/bodyZones";

export { normalizeGarmentType };

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
  const [favIds, setFavIds] = useState<string[]>([]);
  const [capHint, setCapHint] = useState(false);
  const dragId = useRef<string | null>(null);
  const didDrag = useRef(false);

  const forGarment = useMemo(
    () => presets.filter((p) => garmentMatchesPreset(p, garmentType)),
    [presets, garmentType],
  );

  const seedIds = useMemo(() => {
    return forGarment
      .filter((p) => isLeafPreset(p) && (p.quick_pick === 1 || p.quick_pick === true))
      .sort(
        (a, b) =>
          (a.sort_order ?? 100) - (b.sort_order ?? 100) ||
          labelOf(a).localeCompare(labelOf(b)),
      )
      .map((p) => p.id);
  }, [forGarment]);

  const seedKey = seedIds.join("\0");

  useEffect(() => {
    setView({ kind: "home" });
    setQ("");
    setEditMode(false);
    setOrder(readOrder(garmentType));
    setCapHint(false);
  }, [garmentType]);

  useEffect(() => {
    setFavIds(loadFavoriteIds(garmentType, seedKey ? seedKey.split("\0") : []));
  }, [garmentType, seedKey]);

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

  const byId = useMemo(() => new Map(forGarment.map((p) => [p.id, p])), [forGarment]);

  const favoritePresets = useMemo(() => {
    return favIds
      .map((id) => byId.get(id))
      .filter((p): p is HierarchyPreset => !!p && isLeafPreset(p));
  }, [favIds, byId]);

  const starred = useMemo(() => new Set(favIds), [favIds]);

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

  const listTiles = useMemo(() => {
    if (view.kind === "home") return [];
    if (view.kind === "group") {
      return childrenOf(view.group).sort(
        (a, b) =>
          (a.sort_order ?? 100) - (b.sort_order ?? 100) ||
          labelOf(a).localeCompare(labelOf(b)),
      );
    }
    const st = zoneStats.find((s) => s.zone.id === view.zone.id);
    if (!st) return [];
    const out: HierarchyPreset[] = [];
    for (const r of st.roots) {
      if (isGroupPreset(r)) {
        const kids = childrenOf(r);
        if (kids.length) out.push(...kids.filter((k) => !isGroupPreset(k)));
        else out.push(r);
        out.push(...kids.filter(isGroupPreset));
      } else {
        out.push(r);
      }
    }
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
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
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

  function onStar(p: HierarchyPreset) {
    const result = toggleFavoriteId(garmentType, p.id, seedIds);
    setFavIds(result.ids);
    setCapHint(result.atCap);
  }

  function onFavPointerDown(id: string, e: PointerEvent<HTMLDivElement>) {
    if (!editMode) return;
    dragId.current = id;
    didDrag.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onFavPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!editMode || !dragId.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const tile = el?.closest("[data-fav-id]") as HTMLElement | null;
    const toId = tile?.dataset.favId;
    if (!toId || toId === dragId.current) return;
    didDrag.current = true;
    const next = reorderFavoriteIds(garmentType, dragId.current, toId, seedIds);
    setFavIds(next);
  }

  function onFavPointerUp() {
    dragId.current = null;
  }

  const crumb =
    view.kind === "home"
      ? normalizeGarmentType(garmentType)
      : view.kind === "zone"
        ? `${normalizeGarmentType(garmentType)} · ${view.zone.name}`
        : `${normalizeGarmentType(garmentType)}${view.zone ? ` · ${view.zone.name}` : ""} · ${labelOf(view.group)}`;

  return (
    <div className={cn("flex flex-col gap-2.5 w-full min-w-0", className)}>
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
        <div className="flex items-center min-h-9">
          <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light">
            Where on the garment
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-cream-dim text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading menu…
        </div>
      ) : (
        <>
          <label className="relative block min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cream-dim pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                view.kind === "home"
                  ? `Search all ${normalizeGarmentType(garmentType).toLowerCase()} work…`
                  : "Search this area…"
              }
              className="w-full h-11 rounded-xl bg-black/40 border border-brass/30 pl-9 pr-3 text-sm text-cream outline-none focus:border-brass placeholder:text-cream-dim !bg-black/40"
            />
          </label>

          {homeSearchResults && (
            <div className="min-w-0">
              {homeSearchResults.length === 0 ? (
                <p className="text-sm text-cream-dim py-6 text-center">
                  No match. Try a part name, or use Repairs & custom.
                </p>
              ) : (
                <TileGrid>
                  {homeSearchResults.map((p) => (
                    <WorkTile
                      key={p.id}
                      p={p}
                      on={selected.has(p.id)}
                      starred={starred.has(p.id)}
                      onClick={() => onTile(p)}
                      onStar={() => onStar(p)}
                      hint={zones.find((z) => z.id === matchZone(p, zones))?.name}
                    />
                  ))}
                </TileGrid>
              )}
            </div>
          )}

          {view.kind === "home" && !homeSearchResults && (
            <>
              {favoritePresets.length > 0 && (
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5 min-h-11">
                    <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass/80">
                      ★ Quick actions
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditMode((v) => !v)}
                      className={cn(
                        "text-[10px] font-bold tracking-widest uppercase min-h-11 px-2.5 rounded-md border",
                        editMode
                          ? "border-brass bg-brass/20 text-brass-light"
                          : "border-brass/25 text-cream-dim hover:border-brass/45",
                      )}
                    >
                      {editMode ? "Done" : "Edit"}
                    </button>
                  </div>
                  {editMode && (
                    <p className="text-[11px] text-cream-dim mb-2">
                      Hold and drag to reorder. Tap a star to remove.
                    </p>
                  )}
                  {capHint && (
                    <p className="text-[11px] text-brass-light mb-2">
                      Quick actions holds 8. Unstar one to add another.
                    </p>
                  )}
                  <TileGrid>
                    {favoritePresets.map((p) => (
                      <div
                        key={`fav-${p.id}`}
                        data-fav-id={p.id}
                        className="min-w-0"
                        onPointerDown={(e) => onFavPointerDown(p.id, e)}
                        onPointerMove={onFavPointerMove}
                        onPointerUp={onFavPointerUp}
                        onPointerCancel={onFavPointerUp}
                      >
                        <WorkTile
                          p={p}
                          on={selected.has(p.id)}
                          starred
                          compact
                          onClick={() => onTile(p)}
                          onStar={() => onStar(p)}
                          editMode={editMode}
                        />
                      </div>
                    ))}
                  </TileGrid>
                </div>
              )}

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
                          "relative flex flex-col items-center text-center px-2.5 pt-3.5 pb-3 rounded-[15px] border min-w-0 min-h-[148px] transition-colors",
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

              {unmatchedRoots.length > 0 && (
                <div className="min-w-0">
                  <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-cream-dim mb-1.5">
                    More on library
                  </div>
                  <TileGrid>
                    {applyOrder(unmatchedRoots, order).map((p) =>
                      isGroupPreset(p) ? (
                        <FolderTile key={p.id} p={p} onClick={() => onTile(p)} />
                      ) : (
                        <WorkTile
                          key={p.id}
                          p={p}
                          on={selected.has(p.id)}
                          starred={starred.has(p.id)}
                          onClick={() => onTile(p)}
                          onStar={() => onStar(p)}
                        />
                      ),
                    )}
                  </TileGrid>
                </div>
              )}
            </>
          )}

          {view.kind !== "home" && (
            <div className="flex flex-col gap-2 min-w-0 w-full">
              {view.kind === "zone" && (
                <div className="flex items-center gap-3 mb-1 px-0.5">
                  <GarmentZoneIcon garmentType={garmentType} zone={view.zone.id} size={36} />
                  <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass-light">
                    {view.zone.name} · pick work
                  </div>
                </div>
              )}
              {capHint && (
                <p className="text-[11px] text-brass-light">
                  Quick actions holds 8. Unstar one to add another.
                </p>
              )}
              {filteredList.length === 0 ? (
                <p className="text-sm text-cream-dim py-8 text-center">No options in this area.</p>
              ) : (
                <TileGrid>
                  {filteredList.map((p) =>
                    isGroupPreset(p) ? (
                      <FolderTile key={p.id} p={p} onClick={() => onTile(p)} />
                    ) : (
                      <WorkTile
                        key={p.id}
                        p={p}
                        on={selected.has(p.id)}
                        starred={starred.has(p.id)}
                        onClick={() => onTile(p)}
                        onStar={() => onStar(p)}
                      />
                    ),
                  )}
                </TileGrid>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TileGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 min-w-0">{children}</div>;
}

function WorkTile({
  p,
  on,
  starred,
  onClick,
  onStar,
  hint,
  editMode,
  compact,
}: {
  p: HierarchyPreset;
  on: boolean;
  starred: boolean;
  onClick: () => void;
  onStar: () => void;
  hint?: string;
  editMode?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex flex-col justify-between text-left w-full min-w-0 border pr-12 transition-colors",
          compact
            ? "min-h-[64px] rounded-[13px] px-3 py-2.5"
            : "min-h-[148px] rounded-[15px] px-3 pt-3 pb-3",
          on
            ? compact
              ? "border-brass bg-brass/20"
              : "border-brass bg-gradient-to-b from-[#D3AE72] to-[#B08D57] shadow-[0_6px_18px_rgba(176,141,87,0.30)]"
            : "border-brass/35 bg-white/[0.03] hover:border-brass/60",
        )}
      >
        <div
          className={cn(
            "font-medium leading-snug break-words",
            compact ? "text-[13px]" : "text-[14px] font-semibold",
            on && !compact ? "text-[#0C1810]" : "text-cream",
          )}
        >
          {labelOf(p)}
        </div>
        <div className={cn("mt-auto", compact ? "pt-1" : "pt-2")}>
          {!compact && (
            <div
              className={cn(
                "text-[10.5px] truncate",
                on ? "text-[#0C1810]/70" : "text-cream-dim",
              )}
            >
              {hint || (p.est_minutes ? `${p.est_minutes} min` : "\u00A0")}
            </div>
          )}
          <div className="flex justify-between items-baseline gap-1">
            {compact ? (
              <span className="text-[10.5px] text-cream-dim truncate">
                {p.est_minutes ? `${p.est_minutes} min` : "\u00A0"}
              </span>
            ) : null}
            <div
              className={cn(
                "tabular-nums font-semibold shrink-0",
                compact ? "text-[17px] ml-auto" : "text-[18px]",
                on && !compact ? "text-[#0C1810]" : "text-brass-light",
              )}
            >
              {priceText(p, false)}
            </div>
          </div>
        </div>
      </button>
      <button
        type="button"
        aria-label={starred ? `Remove ${labelOf(p)} from Quick actions` : `Add ${labelOf(p)} to Quick actions`}
        aria-pressed={starred}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onStar();
        }}
        className={cn(
          "absolute top-1 right-1 w-11 h-11 grid place-items-center rounded-lg",
          on ? "text-[#0C1810]" : "text-brass-light",
        )}
      >
        <Star className={cn("w-4 h-4", starred && "fill-current")} />
      </button>
      {editMode && (
        <span className="absolute bottom-2 right-2 text-cream-dim/70 pointer-events-none" aria-hidden>
          <GripVertical className={cn("w-4 h-4", on && "text-[#0C1810]/60")} />
        </span>
      )}
    </div>
  );
}

function FolderTile({ p, onClick }: { p: HierarchyPreset; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col justify-between text-left w-full min-h-[148px] min-w-0 rounded-[15px] border border-brass/40 bg-brass/[0.08] px-3 pt-3 pb-3 hover:border-brass/60"
    >
      <Folder className="w-6 h-6 text-brass-light" />
      <div>
        <div className="text-[14px] font-semibold leading-snug break-words text-cream">
          {labelOf(p)}
        </div>
        <div className="text-[18px] tabular-nums font-semibold text-brass-light mt-1">
          {priceText(p, true)}
        </div>
      </div>
    </button>
  );
}
