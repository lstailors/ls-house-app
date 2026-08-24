import { useEffect, useState } from "react";
import type { Column } from "@ls/design";
import { cn } from "@ls/design/utils";
import type { LookbookSwatchRow } from "@ls/types";

/** Fabric Buying USD rates are not whole dollars — house formatUSD rounds them away. */
export function formatLookbookUSD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// Lookbook photos live on the ERP host, not on alts — an alts-origin link 404s.
export const ERP_ORIGIN = "https://erp.lstailors.com";

export const BUCKET_META: Record<
  LookbookSwatchRow["bucket"],
  { label: string; accent: string; dot: string; blurb: string }
> = {
  book: {
    label: "Book",
    accent: "text-signal-emerald",
    dot: "bg-signal-emerald",
    blurb: "Priced from the mill book. Never overwritten.",
  },
  joined: {
    label: "Joined · Fabric Buying USD",
    accent: "text-brass-light",
    dot: "bg-brass-light",
    blurb: "Article matches exactly one Fabric Buying USD rate.",
  },
  conflict: {
    label: "Conflict",
    accent: "text-signal-amber",
    dot: "bg-signal-amber",
    blurb: "Prices disagree — nothing is picked until a human decides.",
  },
  noListino: {
    label: "No listino",
    accent: "text-cream-muted",
    dot: "bg-cream-dim",
    blurb: "No price and no listino match. Stays blank.",
  },
};

export function BucketChip({ bucket, className }: { bucket: LookbookSwatchRow["bucket"]; className?: string }) {
  const meta = BUCKET_META[bucket];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider", meta.accent, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function swatchDetailPath(swatchNumber: string): string {
  return `/admin/reference/lookbook-prices/swatch?id=${encodeURIComponent(swatchNumber)}`;
}

export function swatchPrice(row: LookbookSwatchRow): string {
  if (row.bucket === "conflict") {
    return (row.conflictRates ?? []).map((v) => formatLookbookUSD(v)).join(" vs ") || "—";
  }
  if (row.bucket === "joined") return row.joinRate != null ? formatLookbookUSD(row.joinRate) : "—";
  return row.bookPrice != null ? formatLookbookUSD(row.bookPrice) : "—";
}

/** Columns for a clickable swatch listing (list + search results). */
export function swatchColumns(): Column<LookbookSwatchRow>[] {
  return [
    {
      key: "swatch",
      header: "Swatch",
      cell: (r) => (
        <div className="min-w-0">
          <div className="text-cream text-sm font-mono truncate">{r.swatchNumber}</div>
          <div className="text-[11px] text-cream-dim italic truncate">
            {r.mill}
            {r.collection ? ` · ${r.collection}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "article",
      header: "Article",
      cell: (r) => <span className="text-cream-muted text-xs font-mono">{r.articleId ?? "—"}</span>,
    },
    {
      key: "bucket",
      header: "Bucket",
      cell: (r) => <BucketChip bucket={r.bucket} />,
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      cell: (r) => (
        <span
          className={cn(
            "text-sm",
            r.bucket === "conflict" ? "text-signal-amber font-mono" : "font-display italic text-brass-shimmer",
          )}
        >
          {swatchPrice(r)}
        </span>
      ),
    },
  ];
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
