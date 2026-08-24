import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LayoutGrid, LayoutList, Layers, RefreshCw, X } from "lucide-react";
import { SectionHeader, DataTable, FilterBar, EmptyState, GlassCard } from "@ls/design";
import { cn } from "@ls/design/utils";
import { useLookbookSwatches } from "@/lib/queries";
import {
  BUCKET_META,
  BucketChip,
  DownloadPhotoLink,
  PhotoLightbox,
  PricePair,
  SwatchThumb,
  swatchColumns,
  swatchDetailPath,
  useDebounced,
} from "./lookbook-shared";

export default function LookbookSwatchesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const mill = params.get("mill") ?? "";
  const bucket = params.get("bucket") ?? "";
  const photo = params.get("photo") === "1";
  const view = params.get("view") === "list" ? "list" : "gallery";
  const start = Math.max(0, Number(params.get("start")) || 0);
  const dq = useDebounced(q, 300);
  const page = view === "gallery" ? 36 : 50;
  const listSearch = params.toString();
  const [lite, setLite] = useState<number | null>(null);

  const { data, isLoading, isError, error, isFetching, refetch } = useLookbookSwatches({
    q: dq.trim().length >= 2 ? dq.trim() : undefined,
    mill: mill || undefined,
    bucket: bucket || undefined,
    photo: photo || undefined,
    start,
    limit: page,
  });
  const deskError = error instanceof Error ? error.message : null;

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

  const mills = data?.mills ?? [];
  const photoRows = useMemo(() => (data?.rows ?? []).filter((r) => r.photoUrl), [data]);
  const goDetail = (id: string) => navigate(swatchDetailPath(id, listSearch));
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(start + page, total);

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Reference · Lookbook Prices"
        title={
          <>
            Every <span className="text-brass-shimmer">swatch</span>.
          </>
        }
        description="Photo gallery of the lookbook. Filter by mill, bucket, or photo. Click a card for the detail page — download lives there and on each tile."
      />

      <FilterBar
        search={q}
        onSearchChange={(v) => set("q", v || null)}
        searchPlaceholder="Fuzzy search — swatch, article, collection, mill"
        filterValue={bucket}
        onFilterChange={(v) => set("bucket", v || null)}
        filterOptions={filterOptions}
        right={
          <>
            <select
              value={mill}
              onChange={(e) => set("mill", e.target.value || null)}
              className="h-9 rounded-full border border-brass/15 bg-forest-raised/40 px-3 text-xs text-cream"
            >
              <option value="">All mills</option>
              {mill && !mills.includes(mill) ? <option value={mill}>{mill}</option> : null}
              {mills.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => set("photo", photo ? null : "1")}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs border",
                photo ? "border-brass bg-brass/15 text-cream" : "border-brass/15 text-cream-muted",
              )}
            >
              With photo
            </button>
            <div className="inline-flex rounded-full border border-brass/15 overflow-hidden">
              <button
                type="button"
                className={cn("px-2.5 py-1.5", view === "gallery" ? "bg-brass/15 text-cream" : "text-cream-dim")}
                onClick={() => set("view", null)}
                title="Gallery"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn("px-2.5 py-1.5", view === "list" ? "bg-brass/15 text-cream" : "text-cream-dim")}
                onClick={() => set("view", "list")}
                title="List"
              >
                <LayoutList className="h-3.5 w-3.5" />
              </button>
            </div>
            {mill ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs text-brass-light border border-brass/25 rounded-full px-3 py-1.5"
                onClick={() => set("mill", null)}
              >
                {mill}
                <X className="h-3 w-3" />
              </button>
            ) : null}
            <Link to="/admin/reference/lookbook-prices" className="text-cream-dim text-xs underline underline-offset-2">
              ← Price review
            </Link>
          </>
        }
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Reading the lookbook from Desk…</div>
      ) : isError || !data ? (
        <div className="space-y-3">
          <EmptyState
            icon={Layers}
            title="Desk unavailable"
            description={deskError ?? "Could not load swatches. Retry in a moment."}
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
      ) : data.rows.length === 0 ? (
        <EmptyState icon={Layers} title="No matches" description="Nothing in the lookbook matches that search." />
      ) : (
        <>
          <div className={cn("text-[11px] text-cream-dim", isFetching && "opacity-60")}>
            {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} swatches
          </div>
          {view === "list" ? (
            <DataTable
              rows={data.rows}
              columns={swatchColumns()}
              rowKey={(r) => r.swatchNumber}
              onRowClick={(r) => goDetail(r.swatchNumber)}
            />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {data.rows.map((r) => (
                <GlassCard key={r.swatchNumber} className="overflow-hidden hover:bg-brass/[0.04] transition-colors h-full">
                  <button
                    type="button"
                    className="block w-full"
                    onClick={() => {
                      if (!r.photoUrl) {
                        goDetail(r.swatchNumber);
                        return;
                      }
                      const i = photoRows.findIndex((p) => p.swatchNumber === r.swatchNumber);
                      setLite(i >= 0 ? i : 0);
                    }}
                  >
                    <SwatchThumb photoUrl={r.photoUrl} alt={r.swatchNumber} className="aspect-square w-full" />
                  </button>
                  <button type="button" className="block w-full text-left p-3 space-y-2" onClick={() => goDetail(r.swatchNumber)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-cream text-xs font-mono truncate">{r.swatchNumber}</div>
                        <div className="text-[11px] text-cream-dim italic truncate">{r.mill}</div>
                      </div>
                      <BucketChip bucket={r.bucket} />
                    </div>
                    <PricePair {...r} compact />
                    <DownloadPhotoLink swatchNumber={r.swatchNumber} photoUrl={r.photoUrl} />
                  </button>
                </GlassCard>
              ))}
            </div>
          )}
          {lite != null && photoRows[lite] ? (
            <PhotoLightbox
              rows={photoRows}
              index={lite}
              onClose={() => setLite(null)}
              onChange={setLite}
              backSearch={listSearch}
            />
          ) : null}
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-brass-light underline underline-offset-2 disabled:opacity-30"
              disabled={start === 0}
              onClick={() => set("start", start - page > 0 ? String(start - page) : null)}
            >
              ← Previous
            </button>
            <button
              type="button"
              className="text-brass-light underline underline-offset-2 disabled:opacity-30"
              disabled={to >= total}
              onClick={() => set("start", String(start + page))}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
