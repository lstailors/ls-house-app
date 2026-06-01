import { useMemo, useState } from "react";
import { Receipt, RefreshCw } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { DataTable, type Column } from "@/components/glass/DataTable";
import { FilterBar } from "@/components/glass/FilterBar";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { useSalesOrders } from "@/lib/queries";
import { formatUSD, formatDate } from "@/lib/format";
import type { SalesOrder } from "@/lib/types";

export default function SalesOrders() {
  const { data: orders = [], isLoading } = useSalesOrders();
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    if (!s) return orders;
    return orders.filter(
      (o) =>
        o.id.toLowerCase().includes(s) ||
        (o.erpnextId ?? "").toLowerCase().includes(s) ||
        (o.customer?.name ?? "").toLowerCase().includes(s),
    );
  }, [orders, search]);

  const total = rows.reduce((s, o) => s + o.total, 0);

  const columns: Column<SalesOrder>[] = [
    {
      key: "id",
      header: "Order",
      cell: (o) => (
        <div className="font-mono text-[11px] text-cream-dim">
          {o.erpnextId ?? `#${o.id.slice(-6).toUpperCase()}`}
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (o) => (
        <span className="text-cream truncate">{o.customer?.name ?? "—"}</span>
      ),
    },
    {
      key: "date",
      header: "Date",
      cell: (o) => <span className="text-cream-dim text-xs">{formatDate(o.createdAt)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (o) => <StatusPill status={o.status} />,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (o) => (
        <span className="font-display italic text-brass-shimmer text-base">
          {formatUSD(o.total)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Orders · Sales"
        title={<>The <span className="text-brass-shimmer">sales</span> ledger.</>}
        description="ERPNext mirror — every commission generates one of these."
        actions={
          <Button variant="outline" className="border-brass/20 hover:bg-brass/10 text-cream-muted">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Sync ERPNext
          </Button>
        }
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by ID or customer"
        right={
          <div className="ui-label text-[10px] text-cream-dim">
            Sum · <span className="text-brass-light">{formatUSD(total, { compact: true })}</span>
          </div>
        }
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No sales orders"
          description="Sales orders auto-generate when commissions are taken to deposit."
        />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />
      )}
    </div>
  );
}
