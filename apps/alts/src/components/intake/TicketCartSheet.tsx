import type { ReactNode } from "react";
import { cn } from "@ls/design/utils";
import LuxuryLayer from "@alts/components/LuxuryLayer";
import { useMinWidth } from "@alts/lib/luxuryMotion";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export type CartSheetGarment = {
  ref: string;
  garmentType: string;
  color: string;
  lines: Array<{ description: string; price: number }>;
  soItemKey?: string;
  soItemName?: string;
};

export type CartSheetSell = {
  ref: string;
  item_name: string;
  item_code: string;
  color?: string;
  size?: string;
  qty: number;
  rate: number;
  availability?: "in" | "order" | "out";
  eta?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  garments: CartSheetGarment[];
  sellItems: CartSheetSell[];
  workTotal: number;
  itemsTotal: number;
  showSellChrome?: boolean;
  onEdit: (ref: string) => void;
  onRemove: (ref: string) => void;
  onContinue: () => void;
  onPark: () => void;
  onAddOther?: () => void;
  icon: (type: string) => ReactNode;
  /** When true, continue is primary CTA (cart step). Review steps may hide it. */
  showContinue?: boolean;
};

/** Phone: bottom sheet. Desktop: right slide-out cart (never an empty overlay box). */
export default function TicketCartSheet({
  open,
  onClose,
  garments,
  sellItems,
  workTotal,
  itemsTotal,
  showSellChrome = false,
  onEdit,
  onRemove,
  onContinue,
  onPark,
  onAddOther,
  icon,
  showContinue = true,
}: Props) {
  const desk = useMinWidth(768);
  const pieceCount = garments.length + sellItems.length;
  const ticketTotal = workTotal + itemsTotal;

  return (
    <LuxuryLayer
      open={open}
      onClose={onClose}
      variant={desk ? "drawer" : "sheet"}
      label="Ticket cart"
      z={80}
    >
      <div
        className={cn(
          "flex flex-col border-brass/30",
          desk
            ? "h-full w-[min(380px,100vw)] border-l shadow-[-24px_0_60px_rgba(0,0,0,0.5)]"
            : "w-full max-h-[86dvh] rounded-t-[22px] border border-b-0 shadow-[0_-20px_60px_rgba(0,0,0,0.5)] pb-[env(safe-area-inset-bottom,0px)]",
        )}
        style={{ background: "linear-gradient(180deg,#15291E,#0D1A10)" }}
      >
        {!desk && (
          <div className="flex-none flex justify-center pt-2.5 pb-1" aria-hidden>
            <i className="block w-10 h-1 rounded-full bg-brass/40" />
          </div>
        )}

        <div className={cn("flex-none px-4 pb-3 border-b border-brass/15 flex items-start gap-3", desk && "pt-4")}>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light">
              Ticket cart
            </div>
            <h3 className="display text-[22px] italic font-semibold leading-tight mt-0.5">
              {pieceCount} line{pieceCount === 1 ? "" : "s"}
            </h3>
            <p className="text-[11px] text-cream-dim mt-0.5">
              {showSellChrome ? "Alter + sell on one ticket" : "Edit lines, then continue"}
            </p>
          </div>
          <button
            type="button"
            className="w-11 h-11 rounded-xl border border-brass/25 bg-black/30 grid place-items-center text-cream-muted flex-none"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-[140px] overflow-y-auto p-3 overscroll-contain">
          {pieceCount === 0 ? (
            <div className="px-4 py-10 text-center text-cream-dim">
              <b className="display block text-xl italic font-semibold text-cream-muted mb-1.5">
                Nothing yet
              </b>
              <p className="text-[12px] leading-relaxed">
                {showSellChrome
                  ? "Use Alter for client pieces, Sell for MTM / stock / special-order."
                  : "Select pieces from the catalog."}
              </p>
            </div>
          ) : (
            <>
              {garments.map((g) => {
                const amt = g.lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
                const workNames = g.lines
                  .slice(0, 2)
                  .map((l) => l.description)
                  .filter(Boolean);
                const needWork = g.lines.length === 0;
                return (
                  <div
                    key={g.ref}
                    className="rounded-[14px] px-3 py-2.5 mb-2 border border-brass/18 bg-white/[0.02]"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="w-9 h-[42px] flex-none rounded-lg border border-brass/25 bg-black/30 grid place-items-center text-brass-light scale-75 origin-center">
                        {icon(g.garmentType)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[9.5px] text-brass-light">{g.ref}</span>
                          {showSellChrome && (
                            <span className="text-[8px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border border-brass/35 text-brass-light bg-brass/10">
                              Alter
                            </span>
                          )}
                        </div>
                        <div className="text-[13px] font-semibold mt-0.5 leading-snug">
                          {g.garmentType}
                          {g.color ? (
                            <span className="text-cream-dim font-normal"> · {g.color}</span>
                          ) : null}
                        </div>
                        <div
                          className={cn(
                            "text-[10.5px] mt-1 leading-snug",
                            needWork ? "text-[var(--am,#E8A85C)]" : "text-cream-dim",
                          )}
                        >
                          {needWork
                            ? "No work yet — edit to price"
                            : workNames.join(" · ") + (g.lines.length > 2 ? "…" : "")}
                        </div>
                      </div>
                      <div className="display text-xl text-brass-light font-semibold flex-none pt-0.5">
                        {needWork ? "—" : money(amt)}
                      </div>
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      <button
                        type="button"
                        onClick={() => onEdit(g.ref)}
                        className="h-11 px-3 rounded-lg border border-brass/30 bg-black/25 text-[10px] font-bold tracking-[0.1em] uppercase text-cream-muted"
                      >
                        Edit work
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(g.ref)}
                        className="h-11 px-3 rounded-lg border border-brass/20 bg-black/20 text-[10px] font-bold tracking-[0.1em] uppercase text-cream-dim"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}

              {sellItems.map((s) => {
                const amt = (Number(s.rate) || 0) * (Number(s.qty) || 1);
                const sub = [
                  s.color,
                  s.size ? `sz ${s.size}` : "",
                  s.qty > 1 ? `×${s.qty}` : "",
                  s.availability === "order" && s.eta ? `ETA ${s.eta}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div
                    key={s.ref}
                    className="rounded-[14px] px-3 py-2.5 mb-2 border border-[rgba(79,191,142,0.28)] bg-[rgba(79,191,142,0.06)]"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="w-9 h-[42px] flex-none rounded-lg border border-[rgba(79,191,142,0.35)] bg-[rgba(79,191,142,0.1)] grid place-items-center text-[var(--em,#4FBF8E)] text-sm font-bold">
                        ◈
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[9.5px] text-[var(--em,#4FBF8E)]">{s.ref}</span>
                          <span className="text-[8px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border border-[rgba(79,191,142,0.4)] text-[var(--em,#4FBF8E)] bg-[rgba(79,191,142,0.1)]">
                            Sell
                          </span>
                        </div>
                        <div className="text-[13px] font-semibold mt-0.5 leading-snug">{s.item_name}</div>
                        <div className="text-[10.5px] mt-1 leading-snug text-cream-dim">
                          {sub || s.item_code}
                        </div>
                      </div>
                      <div className="display text-xl text-brass-light font-semibold flex-none pt-0.5">
                        {money(amt)}
                      </div>
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      <button
                        type="button"
                        onClick={() => onEdit(s.ref)}
                        className="h-11 px-3 rounded-lg border border-brass/30 bg-black/25 text-[10px] font-bold tracking-[0.1em] uppercase text-cream-muted"
                      >
                        Edit item
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(s.ref)}
                        className="h-11 px-3 rounded-lg border border-brass/20 bg-black/20 text-[10px] font-bold tracking-[0.1em] uppercase text-cream-dim"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {onAddOther && (
          <div className="flex-none px-3 py-2 border-t border-brass/15">
            <button
              type="button"
              onClick={onAddOther}
              className="w-full h-11 rounded-[10px] border border-dashed border-brass/40 text-[10px] font-bold tracking-[0.12em] uppercase text-brass-light"
            >
              + Other / custom piece
            </button>
          </div>
        )}

        <div className="flex-none px-3.5 pt-3 pb-3.5 border-t border-brass/25 bg-black/25">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[9px] font-bold tracking-[0.14em] uppercase text-cream-dim">
              Ticket total
            </span>
            <span className="display text-[32px] font-semibold text-brass-light leading-none">
              {money(ticketTotal)}
            </span>
          </div>
          {showSellChrome && (
            <div className="text-[10.5px] text-cream-dim mb-2.5">
              Work <b className="text-cream-muted font-semibold">{money(workTotal)}</b>
              {" · "}
              Items <b className="text-cream-muted font-semibold">{money(itemsTotal)}</b>
            </div>
          )}
          {!showSellChrome && <div className="mb-2.5" />}
          {showContinue && (
            <button
              type="button"
              disabled={pieceCount < 1}
              onClick={onContinue}
              className="w-full h-[52px] rounded-[14px] bg-brass text-forest-deep text-[11.5px] font-bold tracking-[0.16em] uppercase shadow-[0_10px_28px_rgba(176,141,87,0.28)] disabled:bg-forest-raised disabled:text-cream-dim disabled:shadow-none disabled:cursor-not-allowed"
            >
              Price & review →
            </button>
          )}
          <button
            type="button"
            onClick={onPark}
            className={cn(
              "w-full h-11 rounded-xl border border-brass/30 text-[10px] font-bold tracking-[0.14em] uppercase text-cream-muted",
              showContinue ? "mt-2" : "",
            )}
          >
            Park ticket
          </button>
        </div>
      </div>
    </LuxuryLayer>
  );
}
