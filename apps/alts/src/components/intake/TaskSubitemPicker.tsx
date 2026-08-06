/**
 * SPEC 073b — iOS-style folder picker for alteration tasks.
 * Home = folders (groups) + loose leaves; open folder = billable options.
 * Long-press / drag to rearrange folders (persisted per garment in localStorage).
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
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function labelOf(p: HierarchyPreset) {
  return (p.display_name || p.preset_name || p.id || "").trim();
}

export function isGroupPreset(p: HierarchyPreset) {
  return p.is_group === 1 || p.is_group === true;
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
  return `alts-folder-order:v1:${normalizeGarmentType(garmentType)}`;
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
    /* ignore quota */
  }
}

function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ra = rank.has(a.id) ? (rank.get(a.id) as number) : 10_000;
    const rb = rank.has(b.id) ? (rank.get(b.id) as number) : 10_000;
    if (ra !== rb) return ra - rb;
    return 0;
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

  /** folder stack for nested groups (iOS open folder) */
  const [stack, setStack] = useState<HierarchyPreset[]>([]);
  const [q, setQ] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    setStack([]);
    setQ("");
    setEditMode(false);
    setOrder(readOrder(garmentType));
  }, [garmentType]);

  const forGarment = useMemo(
    () => presets.filter((p) => garmentMatchesPreset(p, garmentType)),
    [presets, garmentType],
  );

  const childrenOf = useCallback(
    (parent: HierarchyPreset | null) => {
      if (!parent) {
        return forGarment.filter((p) => !p.parent_preset);
      }
      const keys = new Set([parent.id, parent.name, parent.preset_name].filter(Boolean) as string[]);
      return forGarment.filter((p) => p.parent_preset && keys.has(p.parent_preset));
    },
    [forGarment],
  );

  const currentFolder = stack.length ? stack[stack.length - 1] : null;
  const levelRaw = useMemo(() => childrenOf(currentFolder), [childrenOf, currentFolder]);

  const levelTiles = useMemo(() => {
    // Home: folders first (groups), then loose leaves — user order on home only
    const groups = levelRaw.filter(isGroupPreset);
    const leaves = levelRaw.filter((p) => !isGroupPreset(p));
    if (!currentFolder) {
      const sortedGroups = applyOrder(groups, order);
      const sortedLeaves = applyOrder(leaves, order);
      return [...sortedGroups, ...sortedLeaves];
    }
    return [...groups, ...leaves].sort(
      (a, b) =>
        (a.sort_order ?? 100) - (b.sort_order ?? 100) || labelOf(a).localeCompare(labelOf(b)),
    );
  }, [levelRaw, currentFolder, order]);

  const quickPicks = useMemo(() => {
    if (currentFolder) return [];
    return forGarment
      .filter((p) => isLeafPreset(p) && (p.quick_pick === 1 || p.quick_pick === true))
      .sort(
        (a, b) =>
          (a.sort_order ?? 100) - (b.sort_order ?? 100) || labelOf(a).localeCompare(labelOf(b)),
      );
  }, [forGarment, currentFolder]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return levelTiles;
    return levelTiles.filter((p) => labelOf(p).toLowerCase().includes(needle));
  }, [levelTiles, q]);

  const showSearch = levelTiles.length > 8;

  function openFolder(p: HierarchyPreset) {
    setStack((s) => [...s, p]);
    setQ("");
    setEditMode(false);
  }

  function goBack() {
    setStack((s) => s.slice(0, -1));
    setQ("");
  }

  function onTile(p: HierarchyPreset) {
    if (editMode) return;
    if (isGroupPreset(p)) {
      openFolder(p);
      return;
    }
    onToggleLeaf(p);
  }

  function persistOrder(next: string[]) {
    setOrder(next);
    writeOrder(garmentType, next);
  }

  function onDragStart(id: string) {
    if (!editMode || currentFolder) return;
    dragId.current = id;
  }

  function onDragOver(e: React.DragEvent, overId: string) {
    if (!editMode || !dragId.current || dragId.current === overId) return;
    e.preventDefault();
  }

  function onDrop(overId: string) {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === overId || currentFolder) return;
    const ids = levelTiles.map((t) => t.id);
    const fi = ids.indexOf(from);
    const ti = ids.indexOf(overId);
    if (fi < 0 || ti < 0) return;
    const next = [...ids];
    next.splice(fi, 1);
    next.splice(ti, 0, from);
    persistOrder(next);
  }

  const crumb = [normalizeGarmentType(garmentType), ...stack.map(labelOf)].join(" · ");

  return (
    <div className={cn("flex flex-col gap-2.5 w-full min-w-0", className)}>
      {/* nav */}
      {currentFolder ? (
        <div className="flex items-center gap-2 min-h-11 min-w-0">
          <button
            type="button"
            onClick={goBack}
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
            Select task
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

      {editMode && !currentFolder && (
        <p className="text-[11px] text-cream-dim leading-snug">
          Drag folders/tiles to reorder — like iPhone home screen. Order saved on this device.
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-cream-dim text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading menu…
        </div>
      ) : (
        <>
          {/* Quick picks — home only, never crush */}
          {!currentFolder && quickPicks.length > 0 && !editMode && (
            <div className="min-w-0">
              <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass/80 mb-1.5">
                ★ Quick picks
              </div>
              <div className="flex flex-col gap-1.5 min-w-0">
                {quickPicks.map((p) => {
                  const on = selected.has(p.id);
                  return (
                    <button
                      key={`qp-${p.id}`}
                      type="button"
                      onClick={() => onToggleLeaf(p)}
                      className={cn(
                        "w-full min-h-[48px] rounded-[12px] border px-3 py-2 text-left transition-colors flex items-center gap-3 min-w-0",
                        on
                          ? "border-brass bg-brass/20"
                          : "border-brass/30 bg-brass/[0.07] hover:border-brass/55",
                      )}
                    >
                      <span className="flex-1 min-w-0 text-[13px] font-semibold leading-snug break-words">
                        {labelOf(p)}
                      </span>
                      <span className="shrink-0 text-[15px] tabular-nums text-brass-light font-medium">
                        {priceText(p, false)}
                      </span>
                      {on ? (
                        <span className="shrink-0 w-[22px] h-[22px] rounded-full bg-brass text-forest-deep grid place-items-center text-[11px] font-bold">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="h-px bg-brass/20 my-3" />
              <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-cream-dim mb-1.5">
                Folders & library
              </div>
            </div>
          )}

          {currentFolder && (
            <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-brass-light">
              {isGroupPreset(currentFolder) ? `Inside “${labelOf(currentFolder)}”` : "Options"}
            </div>
          )}

          {showSearch && (
            <label className="relative block mb-0.5 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cream-dim pointer-events-none" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search this folder…"
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
          ) : currentFolder ? (
            /* Inside folder: clean single-column list */
            <div className="flex flex-col gap-1.5 min-w-0 w-full">
              {filtered.map((p) => {
                const folder = isGroupPreset(p);
                const on = !folder && selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onTile(p)}
                    className={cn(
                      "w-full min-h-[52px] flex items-center gap-3 px-3 py-2.5 rounded-[14px] border text-left min-w-0",
                      on
                        ? "border-brass bg-brass/15 ring-1 ring-brass/40"
                        : folder
                          ? "border-brass/40 bg-brass/[0.08] hover:border-brass/60"
                          : "border-brass/25 bg-white/[0.02] hover:border-brass/45",
                    )}
                  >
                    {folder ? (
                      <Folder className="w-5 h-5 text-brass-light shrink-0" strokeWidth={1.75} />
                    ) : null}
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold leading-snug break-words">
                        {labelOf(p)}
                      </span>
                      <span className="block text-[10.5px] text-cream-dim mt-0.5">
                        {folder
                          ? "Folder"
                          : p.est_minutes
                            ? `${p.est_minutes} min`
                            : Number(p.price) === 0
                              ? "Set at till"
                              : "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[15px] tabular-nums text-brass-light font-medium">
                      {priceText(p, folder)}
                    </span>
                    {folder ? (
                      <span className="shrink-0 text-brass-light text-lg leading-none">›</span>
                    ) : on ? (
                      <span className="shrink-0 w-[22px] h-[22px] rounded-full bg-brass text-forest-deep grid place-items-center text-[11px] font-bold">
                        ✓
                      </span>
                    ) : (
                      <span className="shrink-0 w-[22px] h-[22px] rounded-full border border-brass/35" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            /* Home: iOS-style folder grid — 2 cols with real min width, never letter-stack */
            <div className="grid grid-cols-2 gap-2 min-w-0 w-full">
              {filtered.map((p) => {
                const folder = isGroupPreset(p);
                const on = !folder && selected.has(p.id);
                const childCount = folder ? childrenOf(p).length : 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    draggable={editMode}
                    onDragStart={() => onDragStart(p.id)}
                    onDragOver={(e) => onDragOver(e, p.id)}
                    onDrop={() => onDrop(p.id)}
                    onClick={() => onTile(p)}
                    className={cn(
                      "relative flex flex-col items-stretch gap-1.5 min-h-[104px] min-w-0 rounded-[16px] border px-2.5 py-2.5 text-left transition-colors",
                      on
                        ? "border-brass bg-brass/15 ring-1 ring-brass/40"
                        : folder
                          ? "border-brass/40 bg-gradient-to-b from-brass/15 to-black/20 hover:border-brass/65"
                          : "border-brass/25 bg-white/[0.03] hover:border-brass/45",
                      editMode && "cursor-grab active:cursor-grabbing",
                    )}
                  >
                    {editMode && (
                      <span className="absolute top-1.5 right-1.5 text-cream-dim/70">
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                    )}
                    <div className="flex items-start gap-2 min-w-0">
                      {folder ? (
                        <span className="shrink-0 w-9 h-9 rounded-[11px] bg-brass/20 border border-brass/35 grid place-items-center">
                          <Folder className="w-5 h-5 text-brass-light" strokeWidth={1.75} />
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "shrink-0 w-9 h-9 rounded-[11px] border grid place-items-center text-[11px] font-bold",
                            on
                              ? "bg-brass border-brass text-forest-deep"
                              : "border-brass/30 text-transparent",
                          )}
                        >
                          ✓
                        </span>
                      )}
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="text-[12.5px] font-semibold leading-snug break-words hyphens-auto">
                          {labelOf(p)}
                        </div>
                        {folder && childCount > 0 && (
                          <div className="text-[10px] text-cream-dim mt-0.5">
                            {childCount} option{childCount === 1 ? "" : "s"}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-auto pt-1 flex items-end justify-between gap-1 min-w-0">
                      <span className="text-[14px] tabular-nums text-brass-light font-semibold leading-none">
                        {priceText(p, folder)}
                      </span>
                      {folder ? (
                        <span className="text-[10px] font-bold tracking-wider uppercase text-brass/80">
                          Open
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {editMode && !currentFolder && order.length > 0 && (
            <button
              type="button"
              className="text-[10px] text-cream-dim underline self-start min-h-9"
              onClick={() => {
                persistOrder([]);
              }}
            >
              Reset order
            </button>
          )}
        </>
      )}
    </div>
  );
}
