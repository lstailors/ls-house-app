import { useMemo, useState } from "react";
import { BookOpen, Layers, RefreshCw } from "lucide-react";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { DataTable, type Column } from "@ls/design";
import { EmptyState } from "@ls/design";
import { useLookbookPriceReview } from "@/lib/queries";
import { formatUSD } from "@ls/design/format";
import type { LookbookExampleRow, LookbookMillReview, LshPricingGapMill } from "@ls/types";
import { cn } from "@ls/design/utils";

// Lookbook photos live on the ERP host, not on alts — an alts-origin link 404s.
const ERP_ORIGIN = "https://erp.lstailors.com";

const BUCKETS = [
  { key: "book", label: "Book", accent: "text-signal-emerald", dot: "bg-signal-emerald" },
  { key: "joined", label: "Joined · Fabric Buying USD", accent: "text-brass-light", dot: "bg-brass-light" },
  { key: "conflict", label: "Conflict", accent: "text-signal-amber", dot: "bg-signal-amber" },
  { key: "noListino", label: "No listino", accent: "text-cream-muted", dot: "bg-cream-dim" },
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

function exampleColumns(bucket: BucketKey): Column<LookbookExampleRow>[] {
  return [
    {
      key: "swatch",
      header: "Swatch",
      cell: (r) => (
        <div className="min-w-0">
          <div className="text-cream text-sm font-mono truncate">{r.swatchNumber}</div>
          {r.collection ? (
            <div className="text-[11px] text-cream-dim italic truncate">{r.collection}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "article",
      header: "Article",
      cell: (r) => <span className="text-cream-muted text-xs font-mono">{r.articleId ?? "—"}</span>,
    },
    {
      key: "price",
      header: bucket === "conflict" ? "Prices in play" : bucket === "joined" ? "USD rate" : "Book price",
      align: "right",
      cell: (r) =>
        bucket === "conflict" ? (
          <span className="text-signal-amber text-sm font-mono">
            {(r.conflictRates ?? []).map((v) => formatUSD(v)).join(" vs ") || "—"}
          </span>
        ) : (
          <span className="font-display italic text-brass-shimmer">
            {bucket === "joined"
              ? r.joinRate != null
                ? formatUSD(r.joinRate)
                : "—"
              : r.bookPrice != null
                ? formatUSD(r.bookPrice)
                : "—"}
          </span>
        ),
    },
    {
      key: "photo",
      header: "Photo",
      cell: (r) =>
        r.photoUrl ? (
          <a
            href={`${ERP_ORIGIN}${r.photoUrl}`}
            target="_blank"
            rel="noreferrer"
            className="text-brass-light text-xs underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            view
          </a>
        ) : (
          <span className="text-cream-dim text-xs">—</span>
        ),
    },
  ];
}

export default function LookbookPriceReviewPage() {
  const { data, isLoading, isError, refetch, isFetching } = useLookbookPriceReview();
  const [selectedMill, setSelectedMill] = useState<string | null>(null);

  const mills = data?.mills ?? [];
  const selected = useMemo(
    () => mills.find((m) => m.mill === selectedMill) ?? null,
    [mills, selectedMill],
  );

  const millColumns: Column<LookbookMillReview>[] = [
    {
      key: "mill",
      header: "Mill",
      cell: (m) => <span className="text-cream font-medium">{m.mill}</span>,
    },
    {
      key: "swatches",
      header: "Swatches",
      align: "right",
      cell: (m) => <span className="text-cream-muted font-mono text-sm">{m.swatchCount.toLocaleString()}</span>,
    },
    {
      key: "book",
      header: "Book",
      align: "right",
      cell: (m) => <span className="text-signal-emerald font-mono text-sm">{m.buckets.book.toLocaleString()}</span>,
    },
    {
      key: "joined",
      header: "Joined",
      align: "right",
      cell: (m) => (
        <span className="text-brass-light font-mono text-sm">
          {m.buckets.joined.toLocaleString()}
          {m.buckets.joinedPending > 0 ? (
            <span className="text-cream-dim text-[11px]"> ({m.buckets.joinedPending.toLocaleString()} pending)</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "conflict",
      header: "Conflict",
      align: "right",
      cell: (m) => <span className="text-signal-amber font-mono text-sm">{m.buckets.conflict.toLocaleString()}</span>,
    },
    {
      key: "noListino",
      header: "No listino",
      align: "right",
      cell: (m) => <span className="text-cream-muted font-mono text-sm">{m.buckets.noListino.toLocaleString()}</span>,
    },
  ];

  const gapColumns: Column<LshPricingGapMill>[] = [
    {
      key: "mill",
      header: "Listino mill",
      cell: (g) => <span className="text-cream">{g.mill}</span>,
    },
    {
      key: "rows",
      header: "Rows",
      align: "right",
      cell: (g) => <span className="text-cream-muted font-mono text-sm">{g.rows.toLocaleString()}</span>,
    },
    {
      key: "keys",
      header: "Distinct keys",
      align: "right",
      cell: (g) => <span className="text-cream-muted font-mono text-sm">{g.distinctKeys.toLocaleString()}</span>,
    },
    {
      key: "conflicts",
      header: "Internal conflicts",
      align: "right",
      cell: (g) => (
        <span className={cn("font-mono text-sm", g.internalConflicts > 0 ? "text-signal-amber" : "text-cream-dim")}>
          {g.internalConflicts.toLocaleString()}
        </span>
      ),
    },
    {
      key: "reachable",
      header: "Reaches lookbook",
      cell: (g) => (
        <span className={cn("text-xs uppercase tracking-wider", g.reachable ? "text-signal-emerald" : "text-cream-dim")}>
          {g.reachable ? "yes" : "no"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Reference · Lookbook Prices"
        title={
          <>
            The <span className="text-brass-shimmer">price</span> review.
          </>
        }
        description="Read-only against live Desk. Book prices stand; joins come from the Fabric Buying USD price list; conflicts pick nothing; blanks stay blank."
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Reading the lookbook from Desk…</div>
      ) : isError || !data ? (
        <div className="space-y-3">
          <EmptyState
            icon={BookOpen}
            title="Desk unavailable"
            description="Could not build the price review. The first load reads the whole lookbook and can take a minute."
          />
          <div className="flex justify-center">
            <button
              type="button"
              className="text-brass-light text-sm underline underline-offset-2 inline-flex items-center gap-1.5"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              {isFetching ? "Reading Desk…" : "Retry now"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <GlassCard className="p-5">
              <div className="ui-label mb-1 text-cream-muted">Swatches</div>
              <div className="kpi-number">{(data.totals.swatches - data.totals.swExcluded).toLocaleString()}</div>
              <div className="text-[11px] text-cream-dim">{data.totals.swExcluded} SW- excluded</div>
            </GlassCard>
            {BUCKETS.map((b) => (
              <GlassCard key={b.key} className="p-5">
                <div className={cn("ui-label mb-1 flex items-center gap-1.5", b.accent)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", b.dot)} />
                  {b.label}
                </div>
                <div className="kpi-number">{data.totals[b.key].toLocaleString()}</div>
                {b.key === "joined" && data.totals.joinedPending > 0 ? (
                  <div className="text-[11px] text-cream-dim">
                    {data.totals.joinedPending.toLocaleString()} matched, not yet written
                  </div>
                ) : null}
              </GlassCard>
            ))}
          </div>

          <DataTable
            rows={mills}
            columns={millColumns}
            rowKey={(m) => m.mill}
            onRowClick={(m) => setSelectedMill(m.mill === selectedMill ? null : m.mill)}
          />

          {selected ? (
            <GlassCard className="p-5 space-y-5">
              <div className="flex items-center justify-between">
                <div className="text-cream font-medium">
                  {selected.mill}
                  <span className="text-cream-dim text-sm"> — example rows per bucket</span>
                </div>
                <button
                  type="button"
                  className="text-cream-dim text-xs underline underline-offset-2"
                  onClick={() => setSelectedMill(null)}
                >
                  close
                </button>
              </div>
              {BUCKETS.map((b) => {
                const rows = selected.examples[b.key];
                if (rows.length === 0) return null;
                return (
                  <div key={b.key} className="space-y-2">
                    <div className={cn("ui-label flex items-center gap-1.5", b.accent)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", b.dot)} />
                      {b.label}
                    </div>
                    <DataTable rows={rows} columns={exampleColumns(b.key)} rowKey={(r) => r.swatchNumber} />
                  </div>
                );
              })}
            </GlassCard>
          ) : (
            <div className="text-[11px] text-cream-dim italic">Click a mill row to see example swatches per bucket.</div>
          )}

          <div className="space-y-2">
            <SectionHeader
              eyebrow="LSH Fabric Pricing"
              title={
                <>
                  The <span className="text-brass-shimmer">gap</span> story.
                </>
              }
              description="Legacy listino rows summarized per mill. Collection-name keys cannot reach lookbook articles — this panel shows where listini and the lookbook don't touch. Hess is not Holland & Sherry and stays unmapped."
            />
            <DataTable rows={data.lshGap} columns={gapColumns} rowKey={(g) => g.mill} />
          </div>

          <div className="text-[11px] text-cream-dim italic flex items-center gap-1.5">
            <Layers className="h-3 w-3 text-brass-light/60" />
            Generated {new Date(data.generatedAt).toLocaleString()} · cached 10 min ·{" "}
            <button
              type="button"
              className="underline underline-offset-2 inline-flex items-center gap-1"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
              refresh
            </button>
          </div>
        </>
      )}
    </div>
  );
}
