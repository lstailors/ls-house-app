import type { ReactNode } from "react";
import { cn } from "@ls/design/utils";
import { formatMoney } from "@alts/lib/money";

function money(n?: number | string | null) {
  return formatMoney(n);
}

export type CartGarment = {
  kind?: "alter";
  ref: string;
  garmentType: string;
  color: string;
  lines: Array<{ description: string; price: number }>;
  soItemKey?: string;
  soItemName?: string;
};

export type CartSellLine = {
  kind: "sell";
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
  garments: CartGarment[];
  sellItems?: CartSellLine[];
  activeRef: string | null;
  workTotal: number;
  itemsTotal?: number;
  onSelect: (ref: string) => void;
  onEdit: (ref: string) => void;
  onRemove: (ref: string) => void;
  onAddOther: () => void;
  onContinue: () => void;
  onPark: () => void;
  icon: (type: string) => ReactNode;
  showSellChrome?: boolean;
};

export default function TicketCartRail({
  garments,
  sellItems = [],
  activeRef,
  workTotal,
  itemsTotal = 0,
  onSelect,
  onEdit,
  onRemove,
  onAddOther,
  onContinue,
  onPark,
  icon,
  showSellChrome = false,
}: Props) {
  const pieceCount = garments.length + sellItems.length;
  const ticketTotal = workTotal + itemsTotal;

  return (
    <aside
      className="hidden md:flex w-[340px] h-full flex-none flex-col min-h-0 border-l border-brass/20 bg-black/35 relative z-40 self-stretch"
      aria-label="Ticket cart"
    >
      <div className="flex-none px-4 pt-3.5 pb-3 border-b border-brass/15 bg-gradient-to-b from-brass/15 to-transparent">
        <div className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light">Ticket cart</div>
        <div className="display text-2xl italic leading-tight mt-0.5">
          {pieceCount} line{pieceCount === 1 ? "" : "s"}
        </div>
        <div className="text-[10.5px] text-cream-dim mt-0.5">
          {showSellChrome ? "Alter garments or sell items" : "Always visible — options never cover this rail"}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {pieceCount === 0 ? (
          <div className="px-4 py-8 text-center text-cream-dim">
            <b className="display block text-xl italic font-semibold text-cream-muted mb-1.5">Nothing yet</b>
            <p className="text-[11.5px] leading-relaxed">
              {showSellChrome
                ? "Use Alter for client pieces, Sell for MTM / stock / special-order."
                : "Select pieces from the catalog."}
            </p>
          </div>
        ) : (
          <>
            {garments.map((g) => {
              const amt = g.lines.reduce((s, l) => s + (Number(l.price) || 0), 0);
              const sel = activeRef === g.ref;
              const workNames = g.lines
                .slice(0, 2)
                .map((l) => l.description)
                .filter(Boolean);
              const needWork = g.lines.length === 0;
              return (
                <div
                  key={g.ref}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(g.ref)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(g.ref);
                    }
                  }}
                  className={cn(
                    "relative rounded-[14px] px-3 py-2.5 mb-2 border cursor-pointer transition-colors",
                    sel
                      ? "border-brass/55 bg-brass/[0.12]"
                      : "border-brass/15 bg-white/[0.02] hover:border-brass/40 hover:bg-brass/[0.06]",
                  )}
                >
                  {sel && (
                    <span className="absolute left-0 top-2.5 bottom-2.5 w-[2.5px] rounded bg-brass" aria-hidden />
                  )}
                  <div className="flex items-start gap-2.5">
                    <span className="w-9 h-[42px] flex-none rounded-lg border border-brass/25 bg-black/30 grid place-items-center text-brass-light scale-75 origin-center">
                      {icon(g.garmentType)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
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
                      {g.soItemKey ? (
                        <div className="mt-1 inline-flex items-center gap-1 text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border border-[rgba(155,139,196,0.45)] text-[var(--vi,#9B8BC4)] bg-[rgba(155,139,196,0.15)]">
                          SO piece{g.soItemName ? ` · ${g.soItemName}` : ""}
                        </div>
                      ) : null}
                      <div
                        className={cn(
                          "text-[10.5px] mt-1 leading-snug",
                          needWork ? "text-[var(--am,#E8A85C)]" : "text-cream-dim",
                        )}
                      >
                        {needWork
                          ? "No work yet — tap to price"
                          : workNames.join(" · ") + (g.lines.length > 2 ? "…" : "")}
                      </div>
                    </div>
                    <div className="display text-xl text-brass-light font-semibold flex-none pt-0.5">
                      {needWork ? "—" : money(amt)}
                    </div>
                  </div>
                  <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => onEdit(g.ref)}
                      className="h-7 px-2.5 rounded-lg border border-brass/30 bg-black/25 text-[9px] font-bold tracking-[0.1em] uppercase text-cream-muted hover:border-brass hover:text-brass-light"
                    >
                      Edit work
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(g.ref)}
                      className="h-7 px-2.5 rounded-lg border border-brass/20 bg-black/20 text-[9px] font-bold tracking-[0.1em] uppercase text-cream-dim hover:text-[var(--ro,#D97B6C)] hover:border-[rgba(217,123,108,0.45)]"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}

            {sellItems.map((s) => {
              const amt = (Number(s.rate) || 0) * (Number(s.qty) || 1);
              const sel = activeRef === s.ref;
              const sub = [s.color, s.size ? `sz ${s.size}` : "", s.qty > 1 ? `×${s.qty}` : "", s.availability === "order" && s.eta ? `ETA ${s.eta}` : ""]
                .filter(Boolean)
                .join(" · ");
              return (
                <div
                  key={s.ref}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(s.ref)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(s.ref);
                    }
                  }}
                  className={cn(
                    "relative rounded-[14px] px-3 py-2.5 mb-2 border cursor-pointer transition-colors",
                    sel
                      ? "border-[rgba(79,191,142,0.55)] bg-[rgba(79,191,142,0.1)]"
                      : "border-brass/15 bg-white/[0.02] hover:border-[rgba(79,191,142,0.4)]",
                  )}
                >
                  {sel && (
                    <span
                      className="absolute left-0 top-2.5 bottom-2.5 w-[2.5px] rounded bg-[var(--em,#4FBF8E)]"
                      aria-hidden
                    />
                  )}
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
                      <div className="text-[10.5px] mt-1 leading-snug text-cream-dim">{sub || s.item_code}</div>
                    </div>
                    <div className="display text-xl text-brass-light font-semibold flex-none pt-0.5">
                      {money(amt)}
                    </div>
                  </div>
                  <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => onEdit(s.ref)}
                      className="h-7 px-2.5 rounded-lg border border-brass/30 bg-black/25 text-[9px] font-bold tracking-[0.1em] uppercase text-cream-muted hover:border-brass hover:text-brass-light"
                    >
                      Edit item
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(s.ref)}
                      className="h-7 px-2.5 rounded-lg border border-brass/20 bg-black/20 text-[9px] font-bold tracking-[0.1em] uppercase text-cream-dim hover:text-[var(--ro,#D97B6C)] hover:border-[rgba(217,123,108,0.45)]"
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

      <div className="flex-none px-2.5 py-2 border-t border-brass/15">
        <button
          type="button"
          onClick={onAddOther}
          className="w-full h-9 rounded-[10px] border border-dashed border-brass/40 text-[10px] font-bold tracking-[0.12em] uppercase text-brass-light hover:bg-brass/10 hover:border-solid"
        >
          + Other / custom piece
        </button>
      </div>

      <div className="flex-none px-3.5 pt-3 pb-3.5 border-t border-brass/25 bg-gradient-to-b from-brass/[0.06] to-black/25">
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
        <button
          type="button"
          disabled={pieceCount < 1}
          onClick={onContinue}
          className="w-full h-[52px] rounded-[14px] bg-brass text-forest-deep text-[11.5px] font-bold tracking-[0.16em] uppercase shadow-[0_10px_28px_rgba(176,141,87,0.28)] disabled:bg-forest-raised disabled:text-cream-dim disabled:shadow-none disabled:cursor-not-allowed"
        >
          Price & review →
        </button>
        <button
          type="button"
          onClick={onPark}
          className="w-full h-10 mt-2 rounded-xl border border-brass/30 text-[10px] font-bold tracking-[0.14em] uppercase text-cream-muted hover:border-brass hover:text-brass-light"
        >
          Park ticket
        </button>
      </div>
    </aside>
  );
}
