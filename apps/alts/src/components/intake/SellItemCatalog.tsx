import type { ReactNode } from "react";
import { cn } from "@ls/design/utils";

export type SellFilterId = "all" | "mtm" | "in" | "order" | "tops" | "bottoms";

export type SellableItem = {
  item_code: string;
  item_name: string;
  item_group: string;
  rate: number;
  is_stock_item: boolean;
  stock_qty: number | null;
  availability: "in" | "order" | "out";
  has_variants: boolean;
  attributes?: { Size?: string[]; Color?: string[] };
  image?: string | null;
  ui_group?: "tops" | "bottoms" | "accessories" | "other";
  color_label?: string | null;
  source: "erp" | "seed";
  eta?: string | null;
  kind?: "mtm" | "rtw";
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const FILTERS: { id: SellFilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mtm", label: "MTM" },
  { id: "in", label: "In stock" },
  { id: "order", label: "Special order" },
  { id: "tops", label: "Tops" },
  { id: "bottoms", label: "Bottoms" },
];

type Props = {
  firstName: string;
  items: SellableItem[];
  loading?: boolean;
  filter: SellFilterId;
  onFilter: (id: SellFilterId) => void;
  query: string;
  onQuery: (q: string) => void;
  cartCounts: Record<string, number>;
  onAdd: (item: SellableItem) => void;
  seeded?: boolean;
  modeSwitch?: ReactNode;
};

export default function SellItemCatalog({
  firstName,
  items,
  loading,
  filter,
  onFilter,
  query,
  onQuery,
  cartCounts,
  onAdd,
  seeded,
  modeSwitch,
}: Props) {
  return (
    <section className="flex-1 min-w-0 flex flex-col overflow-hidden px-3 pt-3 pb-[calc(88px+env(safe-area-inset-bottom,0px))] md:px-5 md:pt-4 md:pb-3">
      <div className="flex items-end gap-3.5 mb-3 shrink-0">
        <div className="min-w-0">
          <h2 className="display text-[24px] md:text-[28px] leading-none italic">
            What are we selling {firstName}?
          </h2>
          <p className="text-[11.5px] text-cream-dim mt-1.5 leading-snug max-w-md">
            Stock, MTM, and special-order pieces on the same Walk-in ticket.
            {seeded ? " · Demo catalog until RTW is stocked in ERP." : ""}
          </p>
        </div>
      </div>

      {modeSwitch}

      <div className="flex gap-1.5 flex-wrap mb-3 shrink-0 items-center">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilter(f.id)}
            className={cn(
              "h-11 md:h-[34px] px-3 rounded-full border text-[10px] font-bold tracking-[0.12em] uppercase transition-colors",
              filter === f.id
                ? "bg-brass/20 border-brass text-brass-light"
                : "border-brass/25 bg-black/25 text-cream-muted hover:border-brass/45 hover:text-cream",
            )}
          >
            {f.label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Suit, polo, jeans…"
          className="w-full md:w-auto md:ml-auto h-11 md:h-[34px] min-w-0 md:min-w-[160px] px-3 rounded-full border border-brass/28 bg-black/35 text-[12px] text-cream outline-none focus:border-brass placeholder:text-cream-dim !bg-black/35"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 md:pr-1">
        {loading && !items.length ? (
          <p className="text-cream-dim text-sm py-8 text-center">Loading items…</p>
        ) : !items.length ? (
          <p className="text-cream-dim text-sm py-8 text-center">No sellable items match.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-2.5">
            {items.map((it) => {
              const count = cartCounts[it.item_code] || 0;
              const out = it.availability === "out";
              const mtm = it.kind === "mtm" || /^mtm(\s|$)/i.test(it.item_group);
              return (
                <button
                  key={it.item_code}
                  type="button"
                  disabled={out}
                  onClick={() => !out && onAdd(it)}
                  className={cn(
                    "relative min-h-[132px] md:min-h-[148px] rounded-2xl border flex flex-col items-center justify-center gap-1.5 p-3 md:p-3.5 transition-all active:scale-[0.97]",
                    out && "opacity-45 pointer-events-none",
                    count > 0
                      ? "border-brass/55 bg-[linear-gradient(160deg,rgba(176,141,87,0.16),rgba(176,141,87,0.03))]"
                      : "border-brass/25 bg-white/[0.03] hover:border-brass/45 hover:bg-white/[0.06]",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-2.5 left-2.5 text-[9px] font-bold tracking-[0.08em] uppercase px-1.5 py-0.5 rounded-md border",
                      mtm && "bg-[rgba(176,141,87,0.16)] text-brass-light border-brass/45",
                      !mtm &&
                        it.availability === "in" &&
                        "bg-[rgba(79,191,142,0.14)] text-[var(--em,#4FBF8E)] border-[rgba(79,191,142,0.35)]",
                      !mtm &&
                        it.availability === "order" &&
                        "bg-[rgba(232,168,92,0.12)] text-[var(--am,#E8A85C)] border-[rgba(232,168,92,0.4)]",
                      !mtm &&
                        it.availability === "out" &&
                        "bg-[rgba(217,123,108,0.12)] text-[var(--ro,#D97B6C)] border-[rgba(217,123,108,0.35)]",
                    )}
                  >
                    {mtm
                      ? "MTM"
                      : it.availability === "in"
                        ? `In · ${it.stock_qty ?? "—"}`
                        : it.availability === "order"
                          ? "Order"
                          : "Out"}
                  </span>
                  {count > 0 && (
                    <span className="absolute top-2.5 right-2.5 min-w-6 h-6 px-1.5 rounded-full bg-brass text-forest-deep text-[11px] font-bold grid place-items-center shadow-[0_4px_12px_rgba(176,141,87,0.35)]">
                      {count}
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-[10.5px] font-bold tracking-[0.14em] uppercase text-center leading-tight mt-4",
                      count > 0 ? "text-cream" : "text-cream-muted",
                    )}
                  >
                    {it.item_name}
                  </span>
                  {it.color_label ? (
                    <span className="text-[10px] text-cream-dim text-center">{it.color_label}</span>
                  ) : null}
                  <span className="display text-lg text-brass-light font-semibold">{money(it.rate)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
