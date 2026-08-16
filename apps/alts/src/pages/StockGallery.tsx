import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import { AuthImage } from "@alts/components/AuthImage";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import "@alts/styles/alts-pos.css";

type StockCard = {
  id: string;
  pieceNo: number | null;
  title: string;
  status: string;
  kind: string;
  source: string;
  photoUrl: string | null;
  supplierMill: string;
  patternNo: string;
  pieceTag: string;
  location: string;
  lengthYds: number | null;
  customerRef: string;
  labelDescription: string;
  composition: string;
  visualDescription: string;
  sku: string;
};

type Counts = {
  available: number;
  used: number;
  fabric: number;
  lining: number;
  buttons: number;
  yz: number;
  sdc: number;
  lst: number;
  total: number;
};

type FilterKey =
  | "available"
  | "used"
  | "fabric"
  | "lining"
  | "buttons"
  | "yz"
  | "sdc"
  | "lst"
  | "all";

function kindLabel(k: string) {
  if (k === "lining") return "Lining";
  if (k === "buttons") return "Buttons";
  if (k === "trim") return "Trim";
  if (k === "unsure") return "Unsure";
  return "Fabric";
}

function Chip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 h-9 px-3 rounded-full border text-[11px] font-semibold tracking-[0.06em] uppercase transition-colors",
        active
          ? "bg-brass/25 border-brass text-brass-light"
          : "bg-black/20 border-brass/25 text-cream-muted hover:border-brass/45 hover:text-cream",
      )}
    >
      {children}
      {count != null ? (
        <span className={cn("ml-1.5 tabular-nums", active ? "text-cream" : "text-cream-muted/80")}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function StockThumb({ item }: { item: StockCard }) {
  const [failed, setFailed] = useState(false);
  const showPhoto = !!item.photoUrl && !failed;
  return (
    <div className="relative aspect-[5/4] bg-[#1b3324]">
      {showPhoto ? (
        <AuthImage
          path={item.photoUrl!}
          alt={item.title}
          className="absolute inset-0 w-full h-full object-cover"
          onFail={() => setFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center">
          <span className="text-[11px] tracking-[0.14em] uppercase text-brass/70">No photo</span>
        </div>
      )}
    </div>
  );
}

export default function StockGallery() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [go, setGo] = useState("");
  const [filter, setFilter] = useState<FilterKey>("available");

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "300");
    if (go.trim()) p.set("q", go.trim());
    if (filter === "available" || filter === "used") p.set("status", filter === "available" ? "Available" : "Used");
    if (filter === "fabric" || filter === "lining" || filter === "buttons") {
      p.set("status", "Available");
      p.set("kind", filter);
    }
    if (filter === "yz" || filter === "sdc" || filter === "lst") {
      p.set("status", "Available");
      p.set("source", filter.toUpperCase());
    }
    // all = no status filter (includes used)
    return p.toString();
  }, [filter, go]);

  const list = useQuery({
    queryKey: ["fabric-stock", queryParams],
    queryFn: async () => {
      const res = await api.raw(`/api/fabric-stock?${queryParams}`);
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(j?.error?.message || "Stock load failed");
      return (j?.data ?? j) as { items: StockCard[]; counts: Counts };
    },
    staleTime: 20_000,
  });

  const items = list.data?.items ?? [];
  const counts = list.data?.counts;

  const runSearch = () => setGo(q.trim());

  return (
    <div className="alts-root min-h-dvh flex flex-col bg-forest-deep">
      <header className="sticky top-0 z-20 border-b border-brass/20 bg-forest-deep/95 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 sm:gap-3 px-4 sm:px-5 py-3">
          <button
            type="button"
            onClick={() => nav("/")}
            className="btn-ghost h-11 px-3 text-[12px] shrink-0"
          >
            ← Home
          </button>
          <BrandSeal size={30} />
          <div className="min-w-0">
            <div className="display text-xl leading-tight">Stock</div>
            <div className="caps text-[9px] text-cream-muted">Fabric · lining · remnants</div>
          </div>
          <div className="flex-1" />
          <div className="hidden sm:block text-right shrink-0">
            <div className="text-[11px] text-brass-light tabular-nums font-semibold">
              {counts?.available ?? "—"} available
            </div>
            <div className="text-[10px] text-cream-muted tabular-nums">{counts?.used ?? 0} used</div>
          </div>
        </div>

        <div className="px-4 sm:px-5 pb-3 space-y-2.5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search color, client, pattern, mill…"
              className="flex-1 h-11 rounded-xl bg-black/30 border border-brass/25 px-3.5 text-[14px] text-cream placeholder:text-cream-muted/50 focus:outline-none focus:border-brass/55"
            />
            <button type="submit" className="btn-brass h-11 px-4 text-[12px] shrink-0">
              Search
            </button>
          </form>

          <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 scrollbar-none">
            <Chip active={filter === "available"} onClick={() => setFilter("available")} count={counts?.available}>
              Available
            </Chip>
            <Chip active={filter === "fabric"} onClick={() => setFilter("fabric")} count={counts?.fabric}>
              Fabric
            </Chip>
            <Chip active={filter === "lining"} onClick={() => setFilter("lining")} count={counts?.lining}>
              Lining
            </Chip>
            <Chip active={filter === "buttons"} onClick={() => setFilter("buttons")} count={counts?.buttons}>
              Buttons
            </Chip>
            <Chip active={filter === "yz"} onClick={() => setFilter("yz")} count={counts?.yz}>
              YZ
            </Chip>
            <Chip active={filter === "sdc"} onClick={() => setFilter("sdc")} count={counts?.sdc}>
              SDC
            </Chip>
            <Chip active={filter === "lst"} onClick={() => setFilter("lst")} count={counts?.lst}>
              LST
            </Chip>
            <Chip active={filter === "used"} onClick={() => setFilter("used")} count={counts?.used}>
              Used
            </Chip>
            <Chip active={filter === "all"} onClick={() => setFilter("all")} count={counts?.total}>
              All
            </Chip>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-5 py-4">
        {list.isError && (
          <QueryErrorPanel
            title="Could not load stock"
            message={(list.error as Error)?.message || "API error"}
            onRetry={() => list.refetch()}
          />
        )}

        {list.isLoading && (
          <div className="grid place-items-center py-24 text-cream-muted text-sm">Loading stock…</div>
        )}

        {!list.isLoading && !list.isError && items.length === 0 && (
          <div className="rounded-2xl border border-brass/20 bg-black/25 px-6 py-16 text-center">
            <div className="display text-2xl text-cream mb-2">No pieces</div>
            <p className="text-sm text-cream-muted max-w-sm mx-auto">
              Nothing matches this filter. Try Available or clear search.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          {items.map((item) => (
            <Link
              key={item.id}
              to={`/stock/${encodeURIComponent(item.id)}`}
              className="group overflow-hidden rounded-2xl border border-brass/25 bg-[#1f3a2b] shadow-glass hover:border-brass/55 transition-colors"
            >
              <StockThumb item={item} />
              <div className="px-2.5 py-2.5 space-y-1">
                <div className="flex flex-wrap gap-1">
                  <span className="px-1.5 py-0.5 rounded-md bg-black/40 border border-brass/30 text-[9px] tracking-[0.08em] uppercase text-brass-light">
                    {item.source}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-md bg-black/40 border border-white/10 text-[9px] tracking-[0.08em] uppercase text-[#f1e9d6]/85">
                    {kindLabel(item.kind)}
                  </span>
                  {item.status === "Used" && (
                    <span className="px-1.5 py-0.5 rounded-md bg-signal-rose/80 text-[9px] tracking-[0.08em] uppercase text-white">
                      Used
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-brass-light/90 tabular-nums">
                  #{item.pieceNo ?? "—"}
                  {item.lengthYds != null ? ` · ${item.lengthYds} yd` : ""}
                </div>
                <div className="text-[13px] font-semibold text-[#f1e9d6] leading-snug line-clamp-2">
                  {item.title}
                </div>
                {item.customerRef ? (
                  <div className="text-[11px] text-[#d4cdb8] truncate">{item.customerRef}</div>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
