import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { toast } from "sonner";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import AuthImage from "@alts/components/AuthImage";

type StockPiece = {
  id: string;
  title: string;
  pieceNo: number | null;
  filename: string | null;
  status: string;
  kind: string | null;
  source: string | null;
  photoUrl: string | null;
  labelType: string | null;
  supplierMill: string | null;
  orderNo: string | null;
  patternNo: string | null;
  pieceTag: string | null;
  location: string | null;
  lengthYds: number | null;
  handwrittenQty: string | null;
  customerRef: string | null;
  labelDescription: string | null;
  sku: string | null;
  pricePerYd: number | null;
  width: string | null;
  composition: string | null;
  visualDescription: string | null;
  notes: string | null;
  usedOn: string | null;
  usedBy: string | null;
  usedFor: string | null;
  salesOrder: string | null;
};

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === "") return null;
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 py-2 border-b border-brass/10 last:border-0">
      <div className="text-[10px] tracking-[0.1em] uppercase text-cream-muted pt-0.5">{label}</div>
      <div className="text-[14px] text-cream leading-snug break-words">{value}</div>
    </div>
  );
}

export default function StockDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [usedFor, setUsedFor] = useState("");
  const [zoom, setZoom] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  const piece = useQuery({
    queryKey: ["fabric-stock", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await api.raw(`/api/fabric-stock/${encodeURIComponent(id)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Load failed");
      return (json?.data ?? json) as StockPiece;
    },
  });

  const useStock = useMutation({
    mutationFn: async () => {
      const res = await api.raw(`/api/fabric-stock/${encodeURIComponent(id)}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usedFor: usedFor.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Could not mark used");
      return (json?.data ?? json) as StockPiece;
    },
    onSuccess: (data) => {
      toast.success("Removed from available stock");
      setConfirm(false);
      queryClient.setQueryData(["fabric-stock", id], data);
      void queryClient.invalidateQueries({ queryKey: ["fabric-stock"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const s = piece.data;
  const available = s?.status === "Available";

  return (
    <div className="alts-root min-h-dvh flex flex-col bg-forest-deep">
      <header className="sticky top-0 z-20 flex items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-brass/20 bg-forest-deep/95 backdrop-blur-xl">
        <button type="button" onClick={() => navigate(-1)} className="btn-ghost h-11 px-3 text-[12px] shrink-0">
          ← Back
        </button>
        <BrandSeal size={28} />
        <div className="min-w-0 flex-1">
          <div className="display text-lg leading-tight truncate">{s?.title || "Stock piece"}</div>
          <div className="text-[10px] text-cream-muted tabular-nums">
            #{s?.pieceNo ?? "—"} · {s?.source} · {s?.kind}
          </div>
        </div>
        <Link to="/stock" className="btn-ghost h-11 px-3 text-[12px] shrink-0 hidden sm:inline-flex items-center">
          Gallery
        </Link>
      </header>

      {piece.isError && (
        <div className="p-4">
          <QueryErrorPanel
            title="Could not open piece"
            message={piece.error?.message}
            onRetry={() => piece.refetch()}
          />
        </div>
      )}
      {piece.isLoading && (
        <div className="grid place-items-center flex-1 text-cream-muted text-sm">Loading…</div>
      )}

      {s && (
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-5 py-4 pb-28 space-y-4">
          <button
            type="button"
            onClick={() => s.photoUrl && !photoFailed && setZoom(true)}
            className={cn(
              "relative w-full overflow-hidden rounded-2xl border border-brass/25 bg-black/40 shadow-glass-lg",
              s.photoUrl && !photoFailed ? "cursor-zoom-in" : "cursor-default",
            )}
          >
            <div className="relative aspect-[4/5] sm:aspect-[16/11] max-h-[min(72vh,820px)] mx-auto">
              {s.photoUrl && !photoFailed ? (
                <AuthImage
                  path={s.photoUrl}
                  alt={s.title}
                  className="absolute inset-0 w-full h-full bg-black"
                  fit="contain"
                  onFail={() => setPhotoFailed(true)}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center bg-gradient-to-br from-forest-raised to-forest-deep">
                  <span className="text-[11px] tracking-[0.16em] uppercase text-brass/80">Photo pending</span>
                  <p className="text-sm text-cream/90 max-w-md leading-relaxed">{s.visualDescription}</p>
                  <p className="text-[11px] text-cream-muted">No photo on this piece yet</p>
                </div>
              )}
              {s.status === "Used" && (
                <div className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-signal-rose text-[11px] font-bold tracking-[0.1em] uppercase text-white">
                  Used
                </div>
              )}
            </div>
          </button>

          <div className="rounded-2xl border border-brass/20 bg-forest-raised/50 px-4 sm:px-5 py-3 shadow-glass">
            <div className="display text-2xl sm:text-3xl text-cream mb-1">{s.title}</div>
            <p className="text-sm text-cream-muted leading-relaxed">{s.visualDescription}</p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="px-2 py-1 rounded-md border border-brass/30 text-[10px] uppercase tracking-[0.08em] text-brass-light">
                {s.source}
              </span>
              <span className="px-2 py-1 rounded-md border border-white/10 text-[10px] uppercase tracking-[0.08em] text-cream/80">
                {s.kind}
              </span>
              {s.lengthYds != null && (
                <span className="px-2 py-1 rounded-md border border-white/10 text-[10px] tabular-nums text-cream/80">
                  {s.lengthYds} yd
                </span>
              )}
              {s.location && (
                <span className="px-2 py-1 rounded-md border border-white/10 text-[10px] text-cream/80">
                  Loc {s.location}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-brass/20 bg-black/25 px-4 sm:px-5 py-2">
            <div className="text-[10px] tracking-[0.14em] uppercase text-brass-light/90 py-2 border-b border-brass/15 mb-1">
              Sheet details
            </div>
            <Row label="Client / ref" value={s.customerRef} />
            <Row label="Label" value={s.labelDescription} />
            <Row label="Mill" value={s.supplierMill} />
            <Row label="Pattern #" value={s.patternNo} />
            <Row label="Piece #" value={s.pieceTag} />
            <Row label="Order #" value={s.orderNo} />
            <Row label="Composition" value={s.composition} />
            <Row label="Width" value={s.width} />
            <Row label="SKU" value={s.sku} />
            <Row label="Hand qty" value={s.handwrittenQty} />
            <Row label="Label type" value={s.labelType} />
            <Row label="Filename" value={s.filename} />
            <Row label="Price / yd" value={s.pricePerYd != null ? `$${s.pricePerYd}` : null} />
            <Row label="Notes" value={s.notes} />
            {s.status === "Used" && (
              <>
                <Row label="Used on" value={s.usedOn} />
                <Row label="Used by" value={s.usedBy} />
                <Row label="Used for" value={s.usedFor} />
                <Row label="Sales order" value={s.salesOrder} />
              </>
            )}
          </div>
        </main>
      )}

      {s && available && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-brass/25 bg-forest-deep/95 backdrop-blur-xl px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="max-w-5xl mx-auto flex gap-2">
            <button type="button" onClick={() => navigate(-1)} className="btn-ghost h-12 px-4 text-[13px] flex-1 sm:flex-none">
              Back
            </button>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="btn-brass h-12 px-5 text-[13px] font-semibold flex-[2] sm:flex-1"
            >
              Use stock
            </button>
          </div>
        </div>
      )}

      {confirm && s && (
        <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/65 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-brass/35 bg-forest-raised shadow-glass-lg p-5 space-y-4">
            <div>
              <div className="text-[10px] tracking-[0.14em] uppercase text-brass-light mb-1">Confirm</div>
              <h2 className="display text-2xl text-cream">Remove from stock?</h2>
              <p className="text-sm text-cream-muted mt-2 leading-relaxed">
                Marks <span className="text-cream font-medium">{s.title}</span> as{" "}
                <span className="text-cream">Used</span> in ERPNext and hides it from Available.
              </p>
            </div>
            <label className="block space-y-1.5">
              <span className="text-[10px] tracking-[0.1em] uppercase text-cream-muted">Used for (optional)</span>
              <input
                value={usedFor}
                onChange={(e) => setUsedFor(e.target.value)}
                placeholder="Client / SO / note"
                className="w-full h-11 rounded-xl bg-black/30 border border-brass/25 px-3 text-[14px] text-cream placeholder:text-cream-muted/50 focus:outline-none focus:border-brass/55"
              />
            </label>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={useStock.isPending}
                onClick={() => setConfirm(false)}
                className="btn-ghost h-12 flex-1 text-[13px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={useStock.isPending}
                onClick={() => useStock.mutate()}
                className="h-12 flex-1 rounded-xl bg-signal-rose/90 hover:bg-signal-rose text-white text-[13px] font-semibold disabled:opacity-50"
              >
                {useStock.isPending ? "Saving…" : "Confirm · Use"}
              </button>
            </div>
          </div>
        </div>
      )}

      {zoom && s?.photoUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/92 flex flex-col"
          onClick={() => setZoom(false)}
          role="dialog"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-[12px] text-cream/80 truncate pr-3">{s.title}</span>
            <button type="button" className="btn-ghost h-10 px-3 text-[12px]" onClick={() => setZoom(false)}>
              Close
            </button>
          </div>
          <div className="flex-1 grid place-items-center p-2 overflow-auto" onClick={(e) => e.stopPropagation()}>
            <AuthImage
              path={s.photoUrl}
              alt={s.title}
              className="max-w-full max-h-[calc(100dvh-80px)] w-full h-[calc(100dvh-80px)]"
              fit="contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
