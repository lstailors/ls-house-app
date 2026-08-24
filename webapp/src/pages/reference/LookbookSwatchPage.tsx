import { Link, useSearchParams } from "react-router-dom";
import { BookOpen, ExternalLink } from "lucide-react";
import { SectionHeader, GlassCard, EmptyState } from "@ls/design";
import { useLookbookSwatch } from "@/lib/queries";
import {
  BUCKET_META,
  BucketChip,
  DownloadPhotoLink,
  PricePair,
  SwatchThumb,
  deskSwatchUrl,
  lookbookPhotoSrc,
} from "./lookbook-shared";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="ui-label text-cream-dim mb-0.5">{label}</div>
      <div className="text-cream text-sm">{children}</div>
    </div>
  );
}

export default function LookbookSwatchPage() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const { data: row, isLoading, isError, error } = useLookbookSwatch(id);
  const deskError = error instanceof Error ? error.message : null;

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Reference · Lookbook Prices"
        title={<span className="font-mono text-[0.8em]">{id ?? "Swatch"}</span>}
        description={row ? BUCKET_META[row.bucket].blurb : "Swatch detail, read-only against live Desk."}
      />

      <div className="text-xs">
        <Link to="/admin/reference/lookbook-prices/all" className="text-cream-dim underline underline-offset-2">
          ← All swatches
        </Link>
        <span className="text-cream-dim"> · </span>
        <Link to="/admin/reference/lookbook-prices" className="text-cream-dim underline underline-offset-2">
          Price review
        </Link>
      </div>

      {!id ? (
        <EmptyState icon={BookOpen} title="No swatch selected" description="Open a swatch from the list or a search result." />
      ) : isLoading ? (
        <div className="text-cream-muted text-sm">Reading the lookbook from Desk…</div>
      ) : isError || !row ? (
        <EmptyState
          icon={BookOpen}
          title={deskError?.includes("Failed to build") ? "Desk unavailable" : "Swatch not found"}
          description={
            deskError ?? "Not in the lookbook (SW- stock is excluded), or Desk is unavailable."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <GlassCard className="p-5 space-y-3">
            {row.photoUrl ? (
              <a href={lookbookPhotoSrc(row.photoUrl)} target="_blank" rel="noreferrer" className="block">
                <SwatchThumb
                  photoUrl={row.photoUrl}
                  alt={row.swatchNumber}
                  className="w-full max-h-[28rem] object-contain rounded"
                />
              </a>
            ) : (
              <div className="min-h-56 flex items-center justify-center text-cream-dim text-sm italic">
                No lookbook photo
              </div>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <DownloadPhotoLink swatchNumber={row.swatchNumber} photoUrl={row.photoUrl} />
              <a
                href={deskSwatchUrl(row.swatchNumber)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-brass-light underline underline-offset-2"
              >
                <ExternalLink className="h-3 w-3" />
                Open in Desk
              </a>
              {row.mill ? (
                <Link
                  to={`/admin/reference/lookbook-prices/all?mill=${encodeURIComponent(row.mill)}`}
                  className="text-xs text-cream-dim underline underline-offset-2"
                >
                  All {row.mill} →
                </Link>
              ) : null}
            </div>
          </GlassCard>

          <GlassCard className="p-5 space-y-4">
            <BucketChip bucket={row.bucket} />
            <PricePair {...row} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Mill">{row.mill}</Field>
              <Field label="Article">
                <span className="font-mono">{row.articleId ?? "—"}</span>
              </Field>
              <Field label="Collection">{row.collection ?? "—"}</Field>
              <Field label="Fabric">{row.fabricName ?? "—"}</Field>
              <Field label="Composition">{row.composition ?? "—"}</Field>
              <Field label="Availability">{row.availability ?? "—"}</Field>
              <Field label="Weight">{row.weightGrams != null ? `${row.weightGrams} g/m` : "—"}</Field>
              <Field label="Width">{row.widthCm != null ? `${row.widthCm} cm` : "—"}</Field>
              <Field label="Season">{row.season ?? "—"}</Field>
            </div>
            {row.bucket === "joined" && row.joinedPending ? (
              <div className="text-[11px] text-cream-dim italic">
                Matched, not yet written — this is what a future write job would fill.
              </div>
            ) : null}
          </GlassCard>
        </div>
      )}
    </div>
  );
}
