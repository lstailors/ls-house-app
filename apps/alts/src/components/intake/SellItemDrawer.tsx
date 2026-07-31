import { cn } from "@ls/design/utils";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export type SellDrawerLine = {
  ref: string;
  item_code: string;
  item_name: string;
  color: string;
  size: string;
  qty: number;
  rate: number;
  availability: "in" | "order" | "out";
  eta?: string;
};

type Props = {
  open: boolean;
  line: SellDrawerLine | null;
  sizes: string[];
  colors: string[];
  onClose: () => void;
  onRemove: () => void;
  onColor: (v: string) => void;
  onSize: (v: string) => void;
  onQty: (n: number) => void;
  onRate: (n: number) => void;
  onEta: (v: string) => void;
};

/**
 * SPEC 057b:
 * - Phone: bottom sheet options (size/color/qty)
 * - Tablet: side drawer docked at cart rail (right: 340px)
 */
export default function SellItemDrawer({
  open,
  line,
  sizes,
  colors,
  onClose,
  onRemove,
  onColor,
  onSize,
  onQty,
  onRate,
  onEta,
}: Props) {
  const colorSwatch: Record<string, string> = {
    Navy: "#1a2744",
    White: "#f1e9d6",
    Forest: "#1F3A2E",
    Indigo: "#2c3e6b",
    Cream: "#F1E9D6",
    Black: "#111111",
    Sand: "#c4a574",
    Olive: "#4a5c3a",
    Cognac: "#8B5A2B",
    Charcoal: "#333333",
  };

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
          "inset-x-0 bottom-0 max-h-[88%] rounded-t-[22px] border-b-0",
          "pb-[env(safe-area-inset-bottom,0px)]",
          open ? "translate-y-0" : "translate-y-[105%]",
          "md:inset-y-0 md:left-auto md:right-[340px] md:bottom-auto md:max-h-none",
          "md:w-[min(420px,calc(100%-340px))] md:rounded-none md:border-b md:border-l md:border-r",
          "md:shadow-[-24px_0_60px_rgba(0,0,0,0.5)] md:pb-0",
          open ? "md:translate-x-0 md:translate-y-0" : "md:translate-x-[104%] md:translate-y-0",
        )}
        style={{ background: "linear-gradient(180deg,#152A1E 0%,#0D1A10 100%)" }}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={line ? `Sell options for ${line.item_name}` : "Sell options"}
      >
        <div className="md:hidden flex-none flex justify-center pt-2.5 pb-1" aria-hidden>
          <i className="block w-10 h-1 rounded-full bg-brass/40" />
        </div>

        {line ? (
          <>
            <div className="flex-none px-4 pt-2 md:pt-4 pb-3.5 border-b border-brass/20 flex items-start gap-3">
              <span className="w-[52px] h-[60px] rounded-xl flex-none border border-[rgba(79,191,142,0.4)] bg-[rgba(79,191,142,0.12)] grid place-items-center text-[var(--em,#4FBF8E)] text-lg font-bold">
                ◈
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="display text-[26px] italic font-semibold leading-tight">{line.item_name}</h3>
                <p className="text-[11.5px] text-cream-dim mt-1 leading-snug">
                  {line.ref} · {line.item_code}
                  {line.availability === "order" ? " · special order" : ""}
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
              {colors.length > 0 && (
                <>
                  <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mb-2">
                    Color
                  </div>
                  <div className="flex gap-2.5 flex-wrap mb-4">
                    {colors.map((c) => (
                      <button
                        key={c}
                        type="button"
                        title={c}
                        onClick={() => onColor(c)}
                        className={cn(
                          "w-11 h-11 rounded-full border-2",
                          line.color === c
                            ? "border-brass-light shadow-[0_0_0_2px_rgba(176,141,87,0.35)]"
                            : "border-transparent",
                        )}
                        style={{ background: colorSwatch[c] || "#666" }}
                      />
                    ))}
                  </div>
                </>
              )}
              <label className="block mb-3">
                <span className="block text-[9px] font-bold tracking-[0.12em] uppercase text-cream-dim mb-1.5">
                  Color label
                </span>
                <input
                  value={line.color}
                  onChange={(e) => onColor(e.target.value)}
                  className="w-full h-12 rounded-xl bg-black/40 border border-brass/30 px-3.5 text-sm text-cream outline-none focus:border-brass !bg-black/40"
                />
              </label>

              {sizes.length > 0 && (
                <>
                  <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mb-2">
                    Size
                  </div>
                  <div className="flex gap-2 flex-wrap mb-4">
                    {sizes.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => onSize(s)}
                        className={cn(
                          "h-11 min-w-11 px-3 rounded-[12px] border text-[13px] font-semibold",
                          line.size === s
                            ? "border-brass bg-brass/18 text-cream"
                            : "border-brass/28 bg-black/25 text-cream-muted",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light mb-2">
                Qty
              </div>
              <div className="flex items-center gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => onQty(Math.max(1, line.qty - 1))}
                  className="w-11 h-11 rounded-xl border border-brass/30 text-brass-light text-lg"
                >
                  −
                </button>
                <span className="display text-2xl font-semibold min-w-8 text-center">{line.qty}</span>
                <button
                  type="button"
                  onClick={() => onQty(line.qty + 1)}
                  className="w-11 h-11 rounded-xl border border-brass/30 text-brass-light text-lg"
                >
                  +
                </button>
              </div>

              <label className="block mb-3">
                <span className="block text-[9px] font-bold tracking-[0.12em] uppercase text-cream-dim mb-1.5">
                  Unit price
                </span>
                <input
                  value={String(line.rate)}
                  onChange={(e) => onRate(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                  inputMode="decimal"
                  className="w-full h-12 rounded-xl bg-black/40 border border-brass/30 px-3.5 text-sm font-mono text-cream outline-none focus:border-brass !bg-black/40"
                />
              </label>

              {line.availability === "order" && (
                <label className="block mb-3">
                  <span className="block text-[9px] font-bold tracking-[0.12em] uppercase text-cream-dim mb-1.5">
                    Fulfillment / ETA
                  </span>
                  <input
                    value={line.eta || ""}
                    onChange={(e) => onEta(e.target.value)}
                    placeholder="10–14 days"
                    className="w-full h-12 rounded-xl bg-black/40 border border-brass/30 px-3.5 text-sm text-cream outline-none focus:border-brass placeholder:text-cream-dim !bg-black/40"
                  />
                </label>
              )}

              <div className="mt-2 flex items-baseline justify-between border-t border-brass/15 pt-3">
                <span className="text-[9px] font-bold tracking-[0.14em] uppercase text-cream-dim">
                  Line total
                </span>
                <span className="display text-[28px] text-brass-light font-semibold">
                  {money(line.qty * line.rate)}
                </span>
              </div>
            </div>

            <div className="flex-none px-4 py-3 border-t border-brass/20 flex gap-2 bg-black/30">
              <button
                type="button"
                onClick={onRemove}
                className="flex-1 h-[50px] rounded-xl border border-brass/30 text-[10.5px] font-bold tracking-[0.14em] uppercase text-cream-muted hover:text-[var(--ro,#D97B6C)] hover:border-[rgba(217,123,108,0.45)]"
              >
                Remove
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
