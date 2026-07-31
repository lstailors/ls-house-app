import { cn } from "@ls/design/utils";
import type { ReactNode } from "react";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export type DrawerLine = {
  id: string;
  description: string;
  price: number;
  estMinutes?: number | null;
  presetId?: string;
  notes?: string;
  photoPreviewUrls?: string[];
};

export type DrawerGarment = {
  ref: string;
  garmentType: string;
  color: string;
  notes: string;
  lines: DrawerLine[];
  photoPreviewUrls?: string[];
};

export type DrawerPreset = {
  id: string;
  preset_name: string;
  price: number;
  est_minutes?: number | null;
};

type Props = {
  open: boolean;
  garment: DrawerGarment | null;
  presets: DrawerPreset[];
  presetsLoading?: boolean;
  customDesc: string;
  customPrice: string;
  noteOpenFor: string | null;
  onClose: () => void;
  onRemovePiece: () => void;
  onColor: (v: string) => void;
  onNotes: (v: string) => void;
  onTogglePreset: (p: DrawerPreset) => void;
  onRemoveLine: (lineId: string) => void;
  onCustomDesc: (v: string) => void;
  onCustomPrice: (v: string) => void;
  onAddCustom: () => void;
  onNoteOpen: (lineId: string | null) => void;
  onLineNotes: (lineId: string, notes: string) => void;
  onLinePhoto: (lineId: string, file: File) => void;
  photoStrip: ReactNode;
  icon: (type: string) => ReactNode;
};

/**
 * SPEC 057b:
 * - Phone: bottom sheet (~88%), grab + scrim
 * - Tablet (≥768): side drawer docked at cart rail (right: 340px) — never covers rail
 */
export default function GarmentOptionsDrawer({
  open,
  garment,
  presets,
  presetsLoading,
  customDesc,
  customPrice,
  noteOpenFor,
  onClose,
  onRemovePiece,
  onColor,
  onNotes,
  onTogglePreset,
  onRemoveLine,
  onCustomDesc,
  onCustomPrice,
  onAddCustom,
  onNoteOpen,
  onLineNotes,
  onLinePhoto,
  photoStrip,
  icon,
}: Props) {
  return (
    <>
      <div
        className={cn(
          "absolute inset-0 z-40 bg-[rgba(5,12,8,0.52)] transition-opacity duration-200 md:right-[340px]",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
        aria-hidden={!open}
      />
      <div
        className={cn(
          "absolute z-[45] flex flex-col border border-brass/30 shadow-[0_-20px_60px_rgba(0,0,0,0.5)]",
          "transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
          // phone bottom sheet
          "inset-x-0 bottom-0 max-h-[88%] rounded-t-[22px] border-b-0",
          "pb-[env(safe-area-inset-bottom,0px)]",
          open ? "translate-y-0" : "translate-y-[105%]",
          // tablet side drawer
          "md:inset-y-0 md:left-auto md:right-[340px] md:bottom-auto md:max-h-none",
          "md:w-[min(420px,calc(100%-340px))] md:rounded-none md:border-b md:border-l md:border-r",
          "md:shadow-[-24px_0_60px_rgba(0,0,0,0.5)] md:pb-0",
          open ? "md:translate-x-0 md:translate-y-0" : "md:translate-x-[104%] md:translate-y-0",
        )}
        style={{ background: "linear-gradient(180deg,#152A1E 0%,#0D1A10 100%)" }}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={garment ? `Options for ${garment.garmentType}` : "Garment options"}
      >
        {/* phone grab */}
        <div className="md:hidden flex-none flex justify-center pt-2.5 pb-1" aria-hidden>
          <i className="block w-10 h-1 rounded-full bg-brass/40" />
        </div>

        {garment ? (
          <>
            <div className="flex-none px-4 pt-2 md:pt-4 pb-3.5 border-b border-brass/20 flex items-start gap-3">
              <span className="w-[52px] h-[60px] rounded-xl flex-none border border-brass/30 bg-brass/10 grid place-items-center text-brass-light">
                {icon(garment.garmentType)}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="display text-[26px] italic font-semibold leading-tight">{garment.garmentType}</h3>
                <p className="text-[11.5px] text-cream-dim mt-1 leading-snug">
                  {garment.ref} · options for this piece
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-11 h-11 rounded-xl border border-brass/25 bg-black/30 grid place-items-center text-cream-muted hover:border-brass hover:text-cream flex-none"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 overscroll-contain">
              <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mb-2">
                Piece details
              </div>
              <label className="block mb-2.5">
                <span className="block text-[9px] font-bold tracking-[0.12em] uppercase text-cream-dim mb-1.5">
                  Color / fabric
                </span>
                <input
                  value={garment.color}
                  onChange={(e) => onColor(e.target.value)}
                  placeholder="Navy wool, charcoal…"
                  className="w-full h-12 rounded-xl bg-black/40 border border-brass/30 px-3.5 text-sm text-cream outline-none focus:border-brass focus:shadow-[0_0_0_3px_rgba(176,141,87,0.14)] placeholder:text-cream-dim !bg-black/40"
                />
              </label>
              <label className="block mb-1">
                <span className="block text-[9px] font-bold tracking-[0.12em] uppercase text-cream-dim mb-1.5">
                  Garment notes
                </span>
                <textarea
                  value={garment.notes}
                  onChange={(e) => onNotes(e.target.value)}
                  placeholder="Client notes, condition, fit cues…"
                  rows={2}
                  className="w-full rounded-xl bg-black/40 border border-brass/30 px-3.5 py-3 text-sm text-cream outline-none focus:border-brass resize-y min-h-[72px] placeholder:text-cream-dim !bg-black/40"
                />
              </label>

              <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mt-3.5 mb-2">
                Work to do
              </div>

              {garment.lines.length > 0 && (
                <div className="space-y-2 mb-3">
                  {garment.lines.map((l) => {
                    const custom = !l.presetId;
                    const openNote =
                      noteOpenFor === l.id || !!(l.notes && l.notes.trim()) || !!(l.photoPreviewUrls?.length);
                    return (
                      <div key={l.id}>
                        <div
                          className={cn(
                            "flex items-center gap-3 min-h-14 px-3 py-2.5 rounded-[14px] border",
                            custom ? "border-signal-amber/45 bg-signal-amber/10" : "border-brass bg-brass/15",
                          )}
                        >
                          <span className="w-[26px] h-[26px] rounded-full bg-brass text-forest-deep border border-brass grid place-items-center text-xs font-bold flex-none">
                            ✓
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-semibold leading-snug">
                              {l.description}
                              {custom ? (
                                <span className="ml-1.5 text-[7.5px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border border-signal-amber/50 text-signal-amber">
                                  custom
                                </span>
                              ) : null}
                            </span>
                            <span className="text-[10.5px] text-cream-dim">
                              {l.estMinutes ? `${l.estMinutes} min` : custom ? "Custom" : "—"}
                            </span>
                          </span>
                          <span className="display text-xl text-brass-light flex-none">{money(l.price)}</span>
                          <button
                            type="button"
                            className="w-11 h-11 rounded-lg bg-white/[0.04] text-cream-dim flex-none"
                            onClick={() => onRemoveLine(l.id)}
                            aria-label="Remove line"
                          >
                            ✕
                          </button>
                        </div>
                        {!openNote ? (
                          <button
                            type="button"
                            onClick={() => onNoteOpen(l.id)}
                            className="mt-1.5 inline-flex items-center gap-1 min-h-11 text-[11px] font-bold tracking-widest uppercase text-cream-dim border border-brass/25 bg-black/20 rounded-md px-2.5 py-2 hover:border-brass/50 hover:text-brass-light"
                          >
                            ✎ Note / photo
                          </button>
                        ) : (
                          <div className="mt-1.5 border-l-2 border-brass pl-2.5 py-1.5">
                            <textarea
                              value={l.notes || ""}
                              onChange={(e) => onLineNotes(l.id, e.target.value)}
                              placeholder="Working buttonholes — open and re-sew…"
                              rows={2}
                              className="w-full rounded-xl bg-black/40 border border-brass/30 px-3 py-2 text-[12px] text-cream resize-none !bg-black/40"
                            />
                            <div className="flex flex-wrap gap-2 mt-1.5 items-center">
                              {(l.photoPreviewUrls || []).map((src, i) => (
                                <img
                                  key={i}
                                  src={src}
                                  alt=""
                                  className="w-10 h-10 rounded-lg object-cover border border-brass/30"
                                />
                              ))}
                              <label className="w-11 h-11 rounded-lg border border-dashed border-brass/35 grid place-items-center text-cream-dim text-lg cursor-pointer hover:border-brass">
                                +
                                <input
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  className="hidden"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) onLinePhoto(l.id, f);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                              {!l.notes?.trim() && !(l.photoPreviewUrls?.length) && (
                                <button
                                  type="button"
                                  className="text-[11px] text-cream-dim ml-auto min-h-11 px-2"
                                  onClick={() => onNoteOpen(null)}
                                >
                                  Collapse
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                {presets.map((p) => {
                  const on = !!garment.lines.find((l) => l.presetId === p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onTogglePreset(p)}
                      className={cn(
                        "w-full flex items-center gap-3 min-h-14 px-3 py-2.5 rounded-[14px] border text-left transition-colors",
                        on
                          ? "border-brass bg-brass/15"
                          : "border-brass/25 bg-white/[0.02] hover:border-brass/45 hover:bg-brass/[0.06]",
                      )}
                    >
                      <span
                        className={cn(
                          "w-[26px] h-[26px] rounded-full border grid place-items-center text-xs font-bold flex-none",
                          on
                            ? "bg-brass border-brass text-forest-deep"
                            : "border-brass/40 text-transparent",
                        )}
                      >
                        ✓
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-semibold leading-snug">{p.preset_name}</span>
                        <span className="text-[10.5px] text-cream-dim">
                          {p.est_minutes ? `${p.est_minutes} min` : "—"}
                        </span>
                      </span>
                      <span className="display text-xl text-brass-light flex-none">
                        {money(Number(p.price) || 0)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!presets.length && !presetsLoading && (
                <p className="text-cream-dim text-sm mt-2">No presets for this type — use a custom line.</p>
              )}

              <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mt-4 mb-2">
                Custom line
              </div>
              <div className="flex gap-2 items-stretch">
                <input
                  value={customDesc}
                  onChange={(e) => onCustomDesc(e.target.value)}
                  placeholder="Describe the work"
                  className="flex-1 h-[46px] rounded-xl bg-black/40 border border-brass/30 px-3.5 text-sm text-cream outline-none focus:border-brass placeholder:text-cream-dim !bg-black/40"
                />
                <input
                  value={customPrice}
                  onChange={(e) => onCustomPrice(e.target.value)}
                  placeholder="$"
                  inputMode="decimal"
                  className="w-24 h-[46px] rounded-xl bg-black/40 border border-brass/30 px-3 text-sm font-mono text-cream outline-none focus:border-brass placeholder:text-cream-dim !bg-black/40"
                />
                <button
                  type="button"
                  onClick={onAddCustom}
                  disabled={!customDesc.trim() || !(Number(customPrice.replace(/[^0-9.]/g, "")) > 0)}
                  className="h-[46px] min-w-11 px-3.5 rounded-xl border border-brass/40 bg-brass/15 text-[10px] font-bold tracking-[0.12em] uppercase text-brass-light hover:bg-brass/25 disabled:opacity-40"
                >
                  Add
                </button>
              </div>

              <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mt-4 mb-2">
                Intake photos
              </div>
              {photoStrip}
            </div>

            <div className="flex-none px-4 py-3 border-t border-brass/20 flex gap-2 bg-black/30">
              <button
                type="button"
                onClick={onRemovePiece}
                className="flex-1 h-[50px] rounded-xl border border-brass/30 text-[10.5px] font-bold tracking-[0.14em] uppercase text-cream-muted hover:text-[var(--ro,#D97B6C)] hover:border-[rgba(217,123,108,0.45)]"
              >
                Remove piece
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-[1.4] h-[50px] rounded-xl bg-brass text-forest-deep text-[10.5px] font-bold tracking-[0.14em] uppercase shadow-[0_8px_22px_rgba(176,141,87,0.25)]"
              >
                Done
              </button>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
