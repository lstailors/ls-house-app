import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, AlertTriangle, Factory, PackageSearch } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { useYzProduction } from "@/lib/queries";
import type { YZOrder } from "@/lib/types";
import { matchesQuery, computeStats, byShipDate, hasAttention, attentionCount } from "@/lib/shopFloor";
import { cn } from "@/lib/utils";
import { StatsBar } from "@/components/shop-floor/StatsBar";
import { ProductionBrief } from "@/components/shop-floor/ProductionBrief";
import { ViewToggle, type ShopFloorView } from "@/components/shop-floor/ViewToggle";
import { SearchInput } from "@/components/shop-floor/SearchInput";
import { KanbanBoard } from "@/components/shop-floor/KanbanBoard";
import { CalendarView } from "@/components/shop-floor/CalendarView";
import { TableView } from "@/components/shop-floor/TableView";
import { OrderDrawer } from "@/components/shop-floor/OrderDrawer";

const VIEW_STORAGE_KEY = "shopFloor.view";
const VALID_VIEWS: ShopFloorView[] = ["kanban", "calendar", "table"];

function isView(v: string | null): v is ShopFloorView {
  return !!v && VALID_VIEWS.includes(v as ShopFloorView);
}

// Loading skeleton — a few ghost kanban columns.
function LoadingSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="w-[280px] shrink-0 rounded-2xl border border-brass/10 bg-forest-deep/30 p-2.5">
          <div className="mb-3 h-6 rounded bg-brass/5" />
          {Array.from({ length: 3 }).map((__, j) => (
            <div key={j} className="mb-2.5 h-24 animate-pulse rounded-xl bg-forest-raised/40" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ShopFloor() {
  const [params, setParams] = useSearchParams();
  const { data, isLoading, isError, isFetching, refetch } = useYzProduction();

  const orders = useMemo<YZOrder[]>(() => data ?? [], [data]);

  // ── URL-driven state ──────────────────────────────────────────────────────
  const query = params.get("q") ?? "";

  // View: URL param wins, else last localStorage choice, else kanban.
  const view: ShopFloorView = isView(params.get("view"))
    ? (params.get("view") as ShopFloorView)
    : (isView(localStorage.getItem(VIEW_STORAGE_KEY))
        ? (localStorage.getItem(VIEW_STORAGE_KEY) as ShopFloorView)
        : "kanban");

  // Ensure the URL always reflects the resolved view (keeps links shareable).
  useEffect(() => {
    if (!isView(params.get("view"))) {
      setParams((p) => {
        const nx = new URLSearchParams(p);
        nx.set("view", view);
        return nx;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setView = useCallback(
    (v: ShopFloorView) => {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
      setParams((p) => {
        const nx = new URLSearchParams(p);
        nx.set("view", v);
        return nx;
      });
    },
    [setParams],
  );

  const setQuery = useCallback(
    (q: string) => {
      setParams((p) => {
        const nx = new URLSearchParams(p);
        if (q) nx.set("q", q);
        else nx.delete("q");
        return nx;
      }, { replace: true });
    },
    [setParams],
  );

  const attnOnly = params.get("attn") === "1";
  const setAttnOnly = useCallback(
    (v: boolean) => {
      setParams((p) => {
        const nx = new URLSearchParams(p);
        if (v) nx.set("attn", "1");
        else nx.delete("attn");
        return nx;
      });
    },
    [setParams],
  );

  const selectedOrderNo = params.get("order");

  const setSelectedOrderNo = useCallback(
    (orderNo: string | null) => {
      setParams((p) => {
        const nx = new URLSearchParams(p);
        if (orderNo) nx.set("order", orderNo);
        else nx.delete("order");
        return nx;
      });
    },
    [setParams],
  );

  // ── Derived data ──────────────────────────────────────────────────────────
  const stats = useMemo(() => computeStats(orders), [orders]);

  const filtered = useMemo(
    () => orders.filter((o) => matchesQuery(o, query) && (!attnOnly || hasAttention(o))),
    [orders, query, attnOnly],
  );

  const attnCount = useMemo(() => attentionCount(orders), [orders]);

  // Consistent ordering used for drawer prev/next navigation.
  const navList = useMemo(() => [...filtered].sort(byShipDate), [filtered]);

  const selectedOrder = useMemo(
    () => (selectedOrderNo ? orders.find((o) => o.name === selectedOrderNo) ?? null : null),
    [orders, selectedOrderNo],
  );

  const handleSelect = useCallback(
    (o: YZOrder) => setSelectedOrderNo(o.name),
    [setSelectedOrderNo],
  );

  const showStale = isError && orders.length > 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Production Operations"
        title="Shop Floor"
        description="Live YZ production tracker — every order in the workshop, at a glance."
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="border border-brass/20 text-cream-dim hover:text-cream"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 sm:mr-1.5", isFetching && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        }
      />

      {/* Stale banner — ERPNext unreachable but we have cached orders */}
      {showStale ? (
        <div className="flex items-center gap-2 rounded-xl border border-signal-amber/30 bg-signal-amber/10 px-4 py-2.5 text-sm text-signal-amber">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Couldn't reach ERPNext — showing the last loaded data.
          <button onClick={() => refetch()} className="ml-auto underline hover:no-underline">
            Retry
          </button>
        </div>
      ) : null}

      {/* AI production brief — what needs attention now */}
      <ProductionBrief onOpenOrder={setSelectedOrderNo} />

      <StatsBar stats={stats} />

      {/* Global search + attention filter — shared across every view */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} className="w-full max-w-md" />
        {attnCount > 0 ? (
          <button
            type="button"
            onClick={() => setAttnOnly(!attnOnly)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors",
              attnOnly
                ? "border-[#FF5722]/50 bg-[#FF5722]/15 font-medium text-[#FF8A65]"
                : "border-brass/20 text-cream-dim hover:border-brass/40 hover:text-cream",
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Attention
            <span
              className={cn(
                "rounded-full px-1.5 text-xs font-semibold",
                attnOnly ? "bg-[#FF5722]/25 text-[#FF8A65]" : "bg-brass/15 text-brass-light",
              )}
            >
              {attnCount}
            </span>
          </button>
        ) : null}
      </div>

      {/* Views */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : isError && orders.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load production orders"
          description="ERPNext is unreachable right now. Try refreshing in a moment."
          action={
            <Button onClick={() => refetch()} className="bg-brass text-forest-deep hover:bg-brass-light">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Retry
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={query ? PackageSearch : Factory}
          title={query ? "No matching orders" : "No production orders"}
          description={
            query
              ? `Nothing matches “${query}”. Try a different order number, customer, or fabric.`
              : "There are no orders in the YZ production tracker yet."
          }
        />
      ) : view === "kanban" ? (
        <KanbanBoard orders={filtered} onSelect={handleSelect} />
      ) : view === "calendar" ? (
        <CalendarView orders={filtered} onSelect={handleSelect} />
      ) : (
        <TableView orders={filtered} onSelect={handleSelect} />
      )}

      <OrderDrawer
        orders={navList}
        order={selectedOrder}
        onClose={() => setSelectedOrderNo(null)}
        onNavigate={handleSelect}
      />
    </div>
  );
}
