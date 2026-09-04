import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
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

export function lookbookPhotoSrc(photoUrl: string): string {
  return `${ERP_ORIGIN}${photoUrl}`;
}

export function lookbookDownloadHref(swatchNumber: string): string {
  return `/api/lookbook-prices/photo?id=${encodeURIComponent(swatchNumber)}`;
}

export function deskSwatchUrl(swatchNumber: string): string {
  return `${ERP_ORIGIN}/desk/fabric-swatch/${encodeURIComponent(swatchNumber)}`;
}

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

export function swatchDetailPath(swatchNumber: string, backSearch = ""): string {
  const qs = new URLSearchParams();
  qs.set("id", swatchNumber);
  const cleaned = backSearch.replace(/^\?/, "");
  if (cleaned) qs.set("back", cleaned);
  return `/admin/reference/lookbook-prices/swatch?${qs.toString()}`;
}

export function swatchListPath(backSearch?: string | null): string {
  const cleaned = (backSearch ?? "").replace(/^\?/, "");
  return cleaned
    ? `/admin/reference/lookbook-prices/all?${cleaned}`
    : "/admin/reference/lookbook-prices/all";
}

type PriceFields = {
  bookPrice: number | null;
  joinRate: number | null;
  conflictRates?: number[];
  bucket?: LookbookSwatchRow["bucket"];
  joinedPending?: boolean;
};

function usdFromConflict(p: PriceFields): number | null {
  const rates = p.conflictRates ?? [];
  if (p.bookPrice != null && rates.length >= 2 && Math.abs(rates[0]! - p.bookPrice) <= 0.01) {
    return rates[1] ?? null;
  }
  return null;
}

/** Book vs Buying USD, labeled. Conflict stays amber and picks nothing. */
export function PricePair({
  bookPrice,
  joinRate,
  conflictRates,
  bucket,
  joinedPending,
  compact = false,
}: PriceFields & { compact?: boolean }) {
  const conflict = bucket === "conflict";
  const usd = joinRate ?? usdFromConflict({ bookPrice, joinRate, conflictRates, bucket });
  const multiUsd = conflict && usd == null && (conflictRates?.length ?? 0) > 0;

  const row = (label: string, value: string, tone: string) => (
    <div className={cn("flex items-baseline justify-between gap-3", compact ? "text-[11px]" : "text-sm")}>
      <span className="text-cream-dim uppercase tracking-wider text-[10px]">{label}</span>
      <span className={cn("font-mono tabular-nums", tone)}>{value}</span>
    </div>
  );

  return (
    <div className={cn("min-w-[9.5rem]", conflict && "text-signal-amber")}>
      {row("Book", bookPrice != null ? formatLookbookUSD(bookPrice) : "—", conflict ? "text-signal-amber" : "text-cream")}
      {row(
        "Buying USD",
        multiUsd ? (conflictRates ?? []).map((v) => formatLookbookUSD(v)).join(" · ") : usd != null ? formatLookbookUSD(usd) : "—",
        conflict ? "text-signal-amber" : "text-brass-shimmer",
      )}
      {joinedPending ? <div className="text-[10px] text-cream-dim italic text-right">matched, not written</div> : null}
    </div>
  );
}

export function SwatchThumb({
  photoUrl,
  alt,
  className,
}: {
  photoUrl: string | null;
  alt: string;
  className?: string;
}) {
  if (!photoUrl) {
    return <div className={cn("bg-forest-raised/70 border border-brass/10", className)} aria-hidden />;
  }
  return (
    <img
      src={lookbookPhotoSrc(photoUrl)}
      alt={alt}
      className={cn("object-cover bg-forest-raised/70", className)}
      loading="lazy"
    />
  );
}

export function PhotoLightbox({
  rows,
  index,
  onClose,
  onChange,
  backSearch = "",
}: {
  rows: LookbookSwatchRow[];
  index: number;
  onClose: () => void;
  onChange: (index: number) => void;
  backSearch?: string;
}) {
  const row = rows[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < rows.length - 1) onChange(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onChange(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, rows.length, onClose, onChange]);

  if (!row?.photoUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-forest-deep/92 backdrop-blur-md flex flex-col"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={row.swatchNumber}
    >
      <div className="flex-1 flex items-center justify-center p-4 min-h-0" onClick={(e) => e.stopPropagation()}>
        <img
          src={lookbookPhotoSrc(row.photoUrl)}
          alt={row.swatchNumber}
          className="max-h-[78vh] max-w-full object-contain rounded"
        />
      </div>
      <div
        className="px-4 py-3 border-t border-brass/15 flex flex-wrap items-center justify-between gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <div className="font-mono text-cream text-sm truncate">{row.swatchNumber}</div>
          <div className="text-cream-dim text-[11px] italic truncate">{row.mill}</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="text-brass-light disabled:opacity-30"
            disabled={index === 0}
            onClick={() => onChange(index - 1)}
            aria-label="Previous photo"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="text-brass-light disabled:opacity-30"
            disabled={index === rows.length - 1}
            onClick={() => onChange(index + 1)}
            aria-label="Next photo"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <DownloadPhotoLink swatchNumber={row.swatchNumber} photoUrl={row.photoUrl} />
          <Link
            to={swatchDetailPath(row.swatchNumber, backSearch)}
            className="text-xs text-brass-light underline underline-offset-2"
          >
            Details
          </Link>
          <button type="button" onClick={onClose} className="text-cream-dim" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function DownloadPhotoLink({
  swatchNumber,
  photoUrl,
  className,
  label = "Download",
}: {
  swatchNumber: string;
  photoUrl: string | null;
  className?: string;
  label?: string;
}) {
  if (!photoUrl) return null;
  return (
    <a
      href={lookbookDownloadHref(swatchNumber)}
      download
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-brass-light underline underline-offset-2",
        className,
      )}
    >
      <Download className="h-3 w-3" />
      {label}
    </a>
  );
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
      key: "photo",
      header: "",
      cell: (r) => <SwatchThumb photoUrl={r.photoUrl} alt={r.swatchNumber} className="h-11 w-11 rounded" />,
    },
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
      cell: (r) => <PricePair {...r} compact />,
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
