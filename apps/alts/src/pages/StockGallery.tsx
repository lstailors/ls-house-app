import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import AuthImage from "@alts/components/AuthImage";

type StockItem = {
  id: string;
  title: string;
  pieceNo: number | null;
  status: string;
  kind: string | null;
  source: string | null;
  photoUrl: string | null;
  lengthYds: number | null;
  visualDescription?: string | null;
};

type StockList = {
  items: StockItem[];
  counts?: {
    total?: number;
    available?: number;
    used?: number;
    fabric?: number;
    lining?: number;
    buttons?: number;
    yz?: number;
    sdc?: number;
    lst?: number;
    photos?: number;
  };
};

type FilterId = "available" | "fabric" | "lining" | "buttons" | "yz" | "sdc" | "lst" | "used" | "all";

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
        "shrink-0 h-9 px-3 rounded-full border text-[11px] font-semibold tracking-[0.06em] uppercase",
        active
          ? "bg-[#c4a574]/25 border-[#c4a574] text-[#e8d5a3]"
          : "bg-black/20 border-[#c4a574]/30 text-[#d4cdb8]",
      )}
    >
      {children}
      {count != null ? <span className="ml-1.5 tabular-nums text-[#f1e9d6]">{count}</span> : null}
    </button>
  );
}

function LargeCard({ item }: { item: StockItem }) {
  const [failed, setFailed] = useState(false);
  const showPhoto = item.photoUrl && !failed;

  return (
    <Link
      to={`/stock/${encodeURIComponent(item.id)}`}
      className="stock-card block overflow-hidden rounded-2xl border border-[#c4a574]/35 bg-[#14261c] shadow-glass"
    >
      <div className="relative w-full min-h-[min(78vh,920px)] bg-black">
        {showPhoto ? (
          <AuthImage
            path={item.photoUrl!}
            alt={item.title}
            className="absolute inset-0 w-full h-full"
            fit="contain"
            onFail={() => setFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center bg-[#1b3324]">
            <span className="text-[11px] tracking-[0.14em] uppercase text-[#c4a574]">No photo</span>
            <p className="text-sm text-[#f1e9d6]/90 max-w-md leading-relaxed">
              {item.visualDescription || item.title}
            </p>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0d1a10] via-[#0d1a10]/85 to-transparent px-4 pt-16 pb-4">
          <div className="text-[10px] text-[#c4a574] tabular-nums uppercase tracking-[0.08em]">
            #{item.pieceNo ?? "—"}
            {item.lengthYds != null ? ` · ${item.lengthYds} yd` : ""}
            {item.source ? ` · ${item.source}` : ""}
            {item.kind ? ` · ${item.kind}` : ""}
          </div>
          <div className="text-[20px] sm:text-[24px] font-semibold text-[#f1e9d6] leading-snug mt-1">
            {item.title}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function StockGallery() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("available");

  const params = useMemo(() => {
    const t = new URLSearchParams();
    t.set("limit", "300");
    if (query.trim()) t.set("q", query.trim());
    if (filter === "available" || filter === "used") {
      t.set("status", filter === "available" ? "Available" : "Used");
    }
    if (filter === "fabric" || filter === "lining" || filter === "buttons") {
      t.set("status", "Available");
      t.set("kind", filter);
    }
    if (filter === "yz" || filter === "sdc" || filter === "lst") {
      t.set("status", "Available");
      t.set("source", filter.toUpperCase());
    }
    return t.toString();
  }, [filter, query]);

  const stock = useQuery({
    queryKey: ["fabric-stock", params],
    queryFn: async () => {
      const res = await api.raw(`/api/fabric-stock?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Stock load failed");
      return (json?.data ?? json) as StockList;
    },
    staleTime: 20_000,
  });

  const items = [...(stock.data?.items ?? [])].sort((a, b) => {
    if (!!a.photoUrl !== !!b.photoUrl) return a.photoUrl ? -1 : 1;
    return (a.pieceNo ?? 0) - (b.pieceNo ?? 0);
  });
  const counts = stock.data?.counts;
  const photoCount = items.filter((i) => i.photoUrl).length;

  return (
    <div className="alts-root min-h-dvh flex flex-col bg-[#0d1a10]">
      <header className="sticky top-0 z-20 border-b border-[#c4a574]/20 bg-[#0d1a10]/95 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 px-4 py-3">
          <button type="button" onClick={() => navigate("/")} className="btn-ghost h-11 px-3 text-[12px] shrink-0">
            ← Home
          </button>
          <BrandSeal size={30} />
          <div className="min-w-0">
            <div className="display text-xl leading-tight text-[#f1e9d6]">Stock</div>
            <div className="text-[9px] tracking-[0.14em] uppercase text-[#c4a574]">
              {items.length} pieces
              {photoCount ? ` · ${photoCount} photos` : ""}
            </div>
          </div>
        </div>
        <div className="px-4 pb-3 space-y-2.5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(draft.trim());
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search color, client, pattern, mill…"
              className="flex-1 h-11 rounded-xl bg-black/30 border border-[#c4a574]/25 px-3.5 text-[14px] text-[#f1e9d6] placeholder:text-[#d4cdb8]/50 focus:outline-none"
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

      <main className="flex-1 px-4 py-4 max-w-3xl mx-auto w-full space-y-4 pb-28">
        {stock.isError && (
          <QueryErrorPanel
            title="Could not load stock"
            message={stock.error?.message || "API error"}
            onRetry={() => stock.refetch()}
          />
        )}
        {stock.isLoading && (
          <div className="grid place-items-center py-24 text-[#d4cdb8] text-sm">Loading stock…</div>
        )}
        {!stock.isLoading && !stock.isError && items.length === 0 && (
          <div className="rounded-2xl border border-[#c4a574]/20 bg-black/25 px-6 py-16 text-center">
            <div className="display text-2xl text-[#f1e9d6] mb-2">No pieces</div>
            <p className="text-sm text-[#d4cdb8]">Nothing matches this filter.</p>
          </div>
        )}
        {items.map((item) => (
          <LargeCard key={item.id} item={item} />
        ))}
      </main>
    </div>
  );
}
