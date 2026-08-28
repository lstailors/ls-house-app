import { cn } from "@ls/design/utils";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { LUX_MS, useBodyLock, useOverlayEscape, usePresence } from "@alts/lib/luxuryMotion";
import TaskSubitemPicker, { type HierarchyPreset } from "@alts/components/intake/TaskSubitemPicker";
import { formatLineMoney, formatMoney } from "@alts/lib/money";

function money(n?: number | string | null) {
  return formatLineMoney(n);
}

/** Staff color chips — reference only, not fabric SoT. */
const COLOR_SWATCHES: { label: string; hex: string }[] = [
  { label: "Black", hex: "#1a1a1a" },
  { label: "Navy", hex: "#1e3a5f" },
  { label: "Charcoal", hex: "#3d3d3d" },
  { label: "Grey", hex: "#8a8a8a" },
  { label: "Brown", hex: "#5c4033" },
  { label: "Camel", hex: "#c4a574" },
  { label: "Cream", hex: "#f1e9d6" },
  { label: "White", hex: "#f5f5f5" },
  { label: "Olive", hex: "#556b2f" },
  { label: "Blue", hex: "#3b6ea5" },
  { label: "Multi", hex: "linear-gradient(135deg,#1a1a1a 25%,#b08d57 25% 50%,#1e3a5f 50% 75%,#c4a574 75%)" },
];

const QTY_CHIPS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

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

export type DrawerPreset = HierarchyPreset;

type Props = {
  open: boolean;
  garment: DrawerGarment | null;
  presets: DrawerPreset[];
  presetsLoading?: boolean;
  customDesc: string;
  customPrice: string;
  noteOpenFor: string | null;
  /** Clone count for same work (1–30). Done expands G1…Gn in IntakeStepped. */
  pieceQty?: number;
  onPieceQty?: (n: number) => void;
  onClose: () => void;
  /** Prefer over onClose when qty clone should run */
  onDone?: () => void;
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

function clampQty(n: number) {
  return Math.max(1, Math.min(30, Math.floor(Number(n) || 1)));
}

/**
 * SPEC 057b + piece qty:
 * - Phone bottom sheet / tablet side drawer
 * - Sticky qty bar above Done (same work ×N → cart clones G1…Gn)
 */
export default function GarmentOptionsDrawer({
  open,
  garment,
  presets,
  presetsLoading,
  customDesc,
  customPrice,
  noteOpenFor,
  pieceQty = 1,
  onPieceQty,
  onClose,
  onDone,
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
  const { pathname } = useLocation();
  const onQc = /^\/qc(\/|$)/i.test(pathname);
  const visible = open && !!garment && !onQc;
  const { shown, entered } = usePresence(visible, LUX_MS);
  useBodyLock(shown);
  useOverlayEscape(shown, onClose);

  const qty = clampQty(pieceQty);
  const workTotal = (garment?.lines ?? []).reduce((s, l) => s + (Number(l.price) || 0), 0);
  const previewTotal = workTotal * qty;
  const finish = onDone || onClose;
  const setQty = (n: number) => onPieceQty?.(clampQty(n));

  const qtyBar =
    onPieceQty && garment ? (
      <div className="flex-none px-4 pt-2.5 pb-2 border-t border-brass/20 bg-black/40 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light">
              Quantity · same work
            </div>
            <p className="text-[10.5px] text-cream-dim mt-0.5 leading-snug">
              Clone piece + work into G1…G{qty} on Done
              {qty > 1 && garment.lines.length < 1 ? " · add work first" : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQty(qty - 1)}
              className="w-11 h-11 rounded-xl border border-brass/35 bg-black/35 text-lg font-bold text-cream hover:border-brass"
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="w-14 h-11 rounded-xl bg-black/40 border border-brass/35 text-center display text-xl text-brass-light outline-none focus:border-brass tabular-nums"
              aria-label="Piece quantity"
            />
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQty(qty + 1)}
              className="w-11 h-11 rounded-xl border border-brass/35 bg-black/35 text-lg font-bold text-cream hover:border-brass"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QTY_CHIPS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setQty(n)}
              className={cn(
                "min-w-11 h-9 px-2.5 rounded-lg border text-[11px] font-bold tracking-wide",
                qty === n
                  ? "bg-brass border-brass text-forest-deep"
                  : "border-brass/30 text-cream-dim hover:border-brass/50 hover:text-cream",
              )}
            >
              ×{n}
            </button>
          ))}
        </div>
      </div>
    ) : null;

  const footer = garment ? (
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
        onClick={finish}
        className="flex-[1.6] h-[50px] rounded-xl bg-brass text-forest-deep text-[10.5px] font-bold tracking-[0.14em] uppercase shadow-[0_8px_22px_rgba(176,141,87,0.25)] flex flex-col items-center justify-center leading-tight"
      >
        <span>{qty > 1 ? `Done · ${qty}× ${garment.garmentType}` : "Done"}</span>
        {workTotal > 0 ? (
          <span className="text-[9px] font-semibold opacity-80 normal-case tracking-normal mt-0.5">
            {qty > 1
              ? `${formatMoney(workTotal)} × ${qty} = ${formatMoney(previewTotal)}`
              : formatMoney(workTotal)}
          </span>
        ) : null}
      </button>
    </div>
  ) : null;

  const header = (g: DrawerGarment) => (
    <div className="flex-none px-4 pt-2 pb-3.5 border-b border-brass/20 flex items-start gap-3 md:pt-4">
      <span className="w-[52px] h-[60px] rounded-xl flex-none border border-brass/30 bg-brass/10 grid place-items-center text-brass-light">
        {icon(g.garmentType)}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="display text-[26px] italic font-semibold leading-tight">{g.garmentType}</h3>
        <p className="text-[11.5px] text-cream-dim mt-1 leading-snug">{g.ref} · options for this piece</p>
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
  );

  const fields = garment ? (
    <GarmentDrawerFields
      garment={garment}
      presets={presets}
      presetsLoading={presetsLoading}
      customDesc={customDesc}
      customPrice={customPrice}
      noteOpenFor={noteOpenFor}
      onColor={onColor}
      onNotes={onNotes}
      onTogglePreset={onTogglePreset}
      onRemoveLine={onRemoveLine}
      onCustomDesc={onCustomDesc}
      onCustomPrice={onCustomPrice}
      onAddCustom={onAddCustom}
      onNoteOpen={onNoteOpen}
      onLineNotes={onLineNotes}
      onLinePhoto={onLinePhoto}
      photoStrip={photoStrip}
    />
  ) : null;

  return !shown || typeof document === "undefined"
    ? null
    : createPortal(
        <>
          <div
            className={cn(
              "lux-intake-scrim fixed inset-0 z-[70] bg-[rgba(5,12,8,0.55)] backdrop-blur-[8px] transition-opacity md:right-[340px]",
              entered ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
            )}
            onClick={onClose}
            aria-hidden={!entered}
          />
          <div
            className={cn(
              "lux-intake-sheet fixed inset-x-0 bottom-0 z-[75] md:hidden flex flex-col border border-brass/30 border-b-0",
              "max-h-[min(88dvh,88%)] rounded-t-[22px]",
              "shadow-[0_-20px_60px_rgba(0,0,0,0.55)]",
              "pb-[env(safe-area-inset-bottom,0px)]",
              "transition-transform will-change-transform",
              entered ? "translate-y-0" : "translate-y-full pointer-events-none",
            )}
            style={{ background: "linear-gradient(180deg,#152A1E 0%,#0D1A10 100%)" }}
            role="dialog"
            aria-modal="true"
            aria-hidden={!entered}
            aria-label={garment ? `Options for ${garment.garmentType}` : "Garment options"}
          >
            <div className="flex-none flex justify-center pt-2.5 pb-1" aria-hidden>
              <i className="block w-10 h-1 rounded-full bg-brass/40" />
            </div>
            {garment ? (
              <>
                {header(garment)}
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 overscroll-contain">{fields}</div>
                {qtyBar}
                {footer}
              </>
            ) : null}
          </div>

          <div
            className={cn(
              "lux-intake-drawer fixed inset-y-0 z-[75] hidden md:flex flex-col",
              entered ? "is-in" : "is-out pointer-events-none",
              "right-[340px] w-[min(720px,calc(100vw-360px))] min-w-[320px]",
              "border-l border-r border-brass/30",
              "shadow-[-24px_0_60px_rgba(0,0,0,0.5)]",
            )}
            style={{ background: "linear-gradient(180deg,#152A1E 0%,#0D1A10 100%)" }}
            role="dialog"
            aria-modal="true"
            aria-hidden={!entered}
            aria-label={garment ? `Options for ${garment.garmentType}` : "Garment options"}
          >
            {garment ? (
              <>
                {header(garment)}
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 overscroll-contain">{fields}</div>
                {qtyBar}
                {footer}
              </>
            ) : null}
          </div>
        </>,
        document.body,
      );
}

function GarmentDrawerFields({
  garment,
  presets,
  presetsLoading,
  customDesc,
  customPrice,
  noteOpenFor,
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
}: {
  garment: DrawerGarment;
  presets: DrawerPreset[];
  presetsLoading?: boolean;
  customDesc: string;
  customPrice: string;
  noteOpenFor: string | null;
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
}) {
  const colorNorm = garment.color.trim().toLowerCase();

  return (
    <>
      <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mb-2">Piece details</div>

      <div className="mb-2.5">
        <span className="block text-[9px] font-bold tracking-[0.12em] uppercase text-cream-dim mb-1.5">
          Color · quick pick
        </span>
        <div className="flex flex-wrap gap-2 mb-2">
          {COLOR_SWATCHES.map((c) => {
            const on = colorNorm === c.label.toLowerCase();
            return (
              <button
                key={c.label}
                type="button"
                title={c.label}
                aria-label={c.label}
                aria-pressed={on}
                onClick={() => onColor(c.label)}
                className={cn(
                  "w-11 h-11 rounded-full border-2 shrink-0 transition-transform",
                  on ? "border-brass scale-110 shadow-[0_0_0_3px_rgba(176,141,87,0.35)]" : "border-brass/30",
                )}
                style={{
                  background: c.hex.startsWith("linear") ? undefined : c.hex,
                  backgroundImage: c.hex.startsWith("linear") ? c.hex : undefined,
                }}
              />
            );
          })}
        </div>
        <label className="block">
          <span className="sr-only">Or type custom / fabric</span>
          <input
            value={garment.color}
            onChange={(e) => onColor(e.target.value)}
            placeholder="Or type custom / fabric…"
            className="w-full h-12 rounded-xl bg-black/40 border border-brass/30 px-3.5 text-sm text-cream outline-none focus:border-brass focus:shadow-[0_0_0_3px_rgba(176,141,87,0.14)] placeholder:text-cream-dim !bg-black/40"
          />
        </label>
      </div>

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

      <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mt-3.5 mb-2">Work to do</div>

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

      <TaskSubitemPicker
        presets={presets}
        loading={presetsLoading}
        garmentType={garment.garmentType}
        selectedIds={garment.lines.map((l) => l.presetId).filter(Boolean) as string[]}
        onToggleLeaf={onTogglePreset}
      />

      <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mt-4 mb-2">Custom line</div>
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
          placeholder="TBD"
          inputMode="decimal"
          className="w-24 h-[46px] rounded-xl bg-black/40 border border-brass/30 px-3 text-sm font-mono text-cream outline-none focus:border-brass placeholder:text-cream-dim !bg-black/40"
          title="Leave blank or 0 for open/TBD amount"
        />
        <button
          type="button"
          onClick={onAddCustom}
          disabled={!customDesc.trim()}
          className="h-[46px] min-w-11 px-3.5 rounded-xl border border-brass/40 bg-brass/15 text-[10px] font-bold tracking-[0.12em] uppercase text-brass-light hover:bg-brass/25 disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <p className="text-[10px] text-cream-dim mt-1.5 leading-snug">
        Price blank or $0 = <b className="text-brass-light">TBD</b> (open amount). Free house work still uses{" "}
        <b className="text-brass-light">Re-do</b>.
      </p>

      <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mt-4 mb-2">Intake photos</div>
      {photoStrip}
    </>
  );
}
