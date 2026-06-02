import { useMemo, useState } from "react";
import { Receipt, RefreshCw } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { DataTable, type Column } from "@/components/glass/DataTable";
import { FilterBar } from "@/components/glass/FilterBar";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { useSalesOrders, useAlterations } from "@/lib/queries";
import { formatUSD, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesOrder, Alteration } from "@/lib/types";

type OrderType = "custom" | "alt";

interface UnifiedRow {
  id: string;
  customerName: string;
  date: string;
  status: string;
  total: number;
  type: OrderType;
  _so?: SalesOrder;
  _alt?: Alteration;
}

type FilterTab = "all" | "custom" | "alt";

export default function SalesOrders() {
  const { data: orders = [], isLoading: loadingSO } = useSalesOrders();
  const { data: alterations = [], isLoading: loadingAlt } = useAlterations();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");

  const isLoading = loadingSO || loadingAlt;

  const unified = useMemo<UnifiedRow[]>(() => {
    const soRows: UnifiedRow[] = orders.map((o) => ({
      id: o.erpnextId ?? o.id,
      customerName: o.customer?.name ?? "—",
      date: o.createdAt,
      status: o.status,
      total: o.total,
      type: "custom",
      _so: o,
    }));

    const altRows: UnifiedRow[] = alterations.map((a) => ({
      id: a.id,
      customerName: a.customer?.name ?? a.customerId ?? "—",
      date: a.createdAt,
      status: a.status,
      total: a.price,
      type: "alt",
      _alt: a,
    }));

    return [...soRows, ...altRows].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [orders, alterations]);

  const filtered = useMemo(() => {
    let rows = unified;

    if (tab === "custom") rows = rows.filter((r) => r.type === "custom");
    else if (tab === "alt") rows = rows.filter((r) => r.type === "alt");

    const s = search.toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.id.toLowerCase().includes(s) ||
        r.customerName.toLowerCase().includes(s),
    );
  }, [unified, tab, search]);

  const total = filtered.reduce((s, r) => s + r.total, 0);

  const columns: Column<UnifiedRow>[] = [
    {
      key: "id",
      header: "Order",
      cell: (r) => (
        <div className="font-mono text-[11px] text-cream-dim">{r.id}</div>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (r) =>
        r.type === "custom" ? (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide bg-brass/20 text-brass-light border border-brass/30">
            CUSTOM
          </span>
        ) : (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            ALT
          </span>
        ),
    },
    {
      key: "customer",
      header: "Customer",
      accessor: (r) => r.customerName ?? "",
      cell: (r) => (
        <span className="text-cream truncate">{r.customerName}</span>
      ),
    },
    {
      key: "date",
      header: "Date",
      accessor: (r) => r.date ?? "",
      cell: (r) => (
        <span className="text-cream-dim text-xs">{formatDate(r.date)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      accessor: (r) => r.status ?? "",
      cell: (r) => <StatusPill status={r.status} />,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      accessor: (r) => r.total ?? 0,
      cell: (r) => (
        <span className="font-display italic text-brass-shimmer text-base">
          {formatUSD(r.total)}
        </span>
      ),
    },
  ];

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: "all", label: "All", count: unified.length },
    {
      id: "custom",
      label: "Custom",
      count: unified.filter((r) => r.type === "custom").length,
    },
    {
      id: "alt",
      label: "Alterations",
      count: unified.filter((r) => r.type === "alt").length,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Orders · Sales"
        title={
          <>
            The <span className="text-brass-shimmer">order</span> ledger.
          </>
        }
        description="Live from ERPNext — custom commissions and alteration tickets unified."
        actions={
          <Button
            variant="outline"
            className="border-brass/20 hover:bg-brass/10 text-cream-muted"
          >
            <RefreshCw className="h-4 w-4 mr-1.5" /> Sync ERPNext
          </Button>
        }
      />

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-white/10 pb-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
              tab === t.id
                ? "text-brass-light border-b-2 border-brass-light"
                : "text-cream-muted hover:text-cream",
            )}
          >
            {t.label}
            <span className="ml-1.5 text-[10px] opacity-60">{t.count}</span>
          </button>
        ))}
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by ID or customer"
        right={
          <div className="ui-label text-[10px] text-cream-dim">
            Sum ·{" "}
            <span className="text-brass-light">
              {formatUSD(total, { compact: true })}
            </span>
          </div>
        }
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No orders"
          description="Sales orders and alteration tickets will appear here once synced from ERPNext."
        />
      ) : (
        <DataTable rows={filtered} columns={columns} rowKey={(r) => r.id} />
      )}
    </div>
  );
}
