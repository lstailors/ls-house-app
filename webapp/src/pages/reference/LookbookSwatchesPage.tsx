import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Layers, X } from "lucide-react";
import { SectionHeader, DataTable, FilterBar, EmptyState } from "@ls/design";
import { cn } from "@ls/design/utils";
import { useLookbookSwatches } from "@/lib/queries";
import {
  BUCKET_META,
  swatchColumns,
  swatchDetailPath,
  useDebounced,
} from "./lookbook-shared";

const PAGE = 50;

export default function LookbookSwatchesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const mill = params.get("mill") ?? "";
  const bucket = params.get("bucket") ?? "";
  const start = Math.max(0, Number(params.get("start")) || 0);
  const dq = useDebounced(q, 300);

  const { data, isLoading, isError, isFetching } = useLookbookSwatches({
    q: dq.trim().length >= 2 ? dq.trim() : undefined,
    mill: mill || undefined,
    bucket: bucket || undefined,
    start,
    limit: PAGE,
  });

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "start") next.delete("start");
    setParams(next, { replace: key === "q" });
  };

  const filterOptions = useMemo(
    () => [
      { value: "", label: "All buckets" },
      ...Object.entries(BUCKET_META).map(([value, m]) => ({ value, label: m.label })),
    ],
    [],
  );

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(start + PAGE, total);

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Reference · Lookbook Prices"
        title={
          <>
            Every <span className="text-brass-shimmer">swatch</span>.
          </>
        }
        description="All non-SW lookbook swatches with their price bucket. Search by swatch number, article, collection, fabric or mill. Click a row for the detail page."
      />

      <FilterBar
        search={q}
        onSearchChange={(v) => set("q", v || null)}
        searchPlaceholder="Fuzzy search — swatch, article, collection, mill"
        filterValue={bucket}
        onFilterChange={(v) => set("bucket", v || null)}
        filterOptions={filterOptions}
        right={
          mill ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs text-brass-light border border-brass/25 rounded-full px-3 py-1.5"
              onClick={() => set("mill", null)}
            >
              {mill}
              <X className="h-3 w-3" />
            </button>
          ) : (
            <Link to="/admin/reference/lookbook-prices" className="text-cream-dim text-xs underline underline-offset-2">
              ← Price review
            </Link>
          )
        }
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Reading the lookbook from Desk…</div>
      ) : isError || !data ? (
        <EmptyState icon={Layers} title="Desk unavailable" description="Could not load swatches. Retry in a moment." />
      ) : data.rows.length === 0 ? (
        <EmptyState icon={Layers} title="No matches" description="Nothing in the lookbook matches that search." />
      ) : (
        <>
          <div className={cn("text-[11px] text-cream-dim", isFetching && "opacity-60")}>
            {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} swatches
          </div>
          <DataTable
            rows={data.rows}
            columns={swatchColumns()}
            rowKey={(r) => r.swatchNumber}
            onRowClick={(r) => navigate(swatchDetailPath(r.swatchNumber))}
          />
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-brass-light underline underline-offset-2 disabled:opacity-30"
              disabled={start === 0}
              onClick={() => set("start", start - PAGE > 0 ? String(start - PAGE) : null)}
            >
              ← Previous
            </button>
            <button
              type="button"
              className="text-brass-light underline underline-offset-2 disabled:opacity-30"
              disabled={to >= total}
              onClick={() => set("start", String(start + PAGE))}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
