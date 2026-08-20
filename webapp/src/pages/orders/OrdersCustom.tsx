import { useMemo, useState } from "react";
import { Plus, Sparkles, Star } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { SectionHeader } from "@ls/design";
import { DataTable, type Column } from "@ls/design";
import { FilterBar } from "@ls/design";
import { StatusPill } from "@ls/design";
import { EmptyState } from "@ls/design";
import { GlassCard } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { useCustomOrders } from "@/lib/queries";
import { GARMENT_LABEL } from "@/lib/pricing";
import { formatUSD, formatDate, statusToLabel } from "@ls/design/format";
import type { CustomOrder } from "@ls/types";
import { cn } from "@ls/design/utils";
import { MTM_STATUSES } from "@/lib/mtmStatus";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "quote", label: "Quote" },
  { value: "deposit_paid", label: "Deposit Paid" },
  { value: "in_production", label: "In Production" },
  { value: "ready", label: "Ready" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const STAGES: CustomOrder["status"][] = [
  "quote",
  "deposit_paid",
  "in_production",
  "ready",
  "delivered",
  "cancelled",
];

export default function OrdersCustom() {
  const { data: orders = [], isLoading } = useCustomOrders();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of STAGES) counts[s] = 0;
    for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1;
    return counts;
  }, [orders]);

  const liveCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of MTM_STATUSES) counts[s.key] = 0;
    for (const o of orders) {
      const live = (o as CustomOrder & { orderStatus?: string | null }).orderStatus;
      if (live) counts[live] = (counts[live] ?? 0) + 1;
    }
    return counts;
  }, [orders]);

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return orders.filter((o) => {
      const live = (o as CustomOrder & { orderStatus?: string | null }).orderStatus;
      if (filter !== "all" && o.status !== filter && live !== filter) return false;
      if (!s) return true;
      return (
        o.customer?.name.toLowerCase().includes(s) ||
        o.customer?.phone.includes(search) ||
        GARMENT_LABEL[o.garmentType].toLowerCase().includes(s)
      );
    });
  }, [orders, search, filter]);

  const columns: Column<CustomOrder>[] = [
    {
      key: "id",
      header: "Order",
      cell: (o) => (
        <div className="font-mono text-[11px] text-cream-dim">#{o.id.slice(-6).toUpperCase()}</div>
      ),
      width: "100px",
    },
    {
      key: "customer",
      header: "Customer",
      accessor: (o) => o.customer?.name ?? "",
      cell: (o) => (
        <div className="min-w-0">
          <div className="text-cream font-medium truncate flex items-center gap-1.5">
            {o.customer?.name ?? "—"}
            {o.customer?.dossier?.vip ? <Star className="h-3 w-3 text-brass fill-brass" /> : null}
          </div>
          <div className="text-[11px] text-cream-dim truncate">{o.customer?.phone}</div>
        </div>
      ),
    },
    {
      key: "garment",
      header: "Garment",
      accessor: (o) => o.garmentType ?? "",
      cell: (o) => (
        <div className="flex items-center gap-2">
          <Sparkles className="h-3 w-3 text-brass-light/70" />
          <span className="text-cream-muted">{GARMENT_LABEL[o.garmentType]}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      accessor: (o) => o.status ?? "",
      cell: (o) => (
        <StatusPill status={(o as CustomOrder & { orderStatus?: string | null }).orderStatus || o.status} />
      ),
    },
    {
      key: "deposit",
      header: "Deposit",
      accessor: (o) => o.depositAmount ?? 0,
      cell: (o) => (
        <span className="text-cream-muted text-sm tabular-nums">
          {o.depositAmount > 0 ? formatUSD(o.depositAmount) : "—"}
        </span>
      ),
    },
    {
      key: "price",
      header: "Quoted",
      align: "right",
      accessor: (o) => o.quotedPrice ?? 0,
      cell: (o) =>
        o.priceTbd ? (
          <span className="ui-label text-signal-amber">TBD</span>
        ) : (
          <span className="font-display italic text-brass-shimmer text-base">
            {formatUSD(o.quotedPrice)}
          </span>
        ),
    },
    {
      key: "date",
      header: "Created",
      accessor: (o) => o.createdAt ?? "",
      cell: (o) => <span className="text-cream-dim text-xs">{formatDate(o.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Orders · Custom"
        title={<>The <span className="text-brass-shimmer">commissions</span> pipeline.</>}
        description="Every custom order, from quote to delivery."
        actions={
          <Button asChild className="btn-brass">
            <Link to="/admin/intake/custom">
              <Plus className="h-4 w-4 mr-1.5" /> New commission
            </Link>
          </Button>
        }
      />

      {/* Pipeline mini-board */}
      <GlassCard variant="strong" className="p-5">
        <div className="ui-label mb-3">Pipeline</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {STAGES.map((s) => {
            const active = filter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(active ? "all" : s)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-all",
                  active
                    ? "border-brass bg-brass/15 shadow-brass-glow"
                    : "border-brass/15 bg-brass/5 hover:border-brass/40 hover:bg-brass/10",
                )}
              >
                <div className="kpi-number text-2xl">{stageCounts[s] ?? 0}</div>
                <div className="ui-label text-[9px] mt-1">{statusToLabel(s)}</div>
              </button>
            );
          })}
        </div>
        <div className="ui-label mt-4 mb-2">Live MTM status</div>
        <div className="flex flex-wrap gap-1.5">
          {MTM_STATUSES.map((s) => {
            const active = filter === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setFilter(active ? "all" : s.key)}
                className={cn(
                  "h-11 min-h-[44px] px-3 rounded-full border text-[9px] font-semibold tracking-[0.06em] uppercase whitespace-nowrap",
                  active
                    ? "bg-brass/20 border-brass text-brass-light"
                    : "border-brass/20 bg-forest-raised/40 text-cream-dim hover:border-brass/45",
                )}
              >
                {s.key}
                {liveCounts[s.key] ? ` · ${liveCounts[s.key]}` : ""}
              </button>
            );
          })}
        </div>
      </GlassCard>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by customer, phone, or garment"
        filterValue={filter}
        onFilterChange={setFilter}
        filterOptions={FILTERS}
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No commissions yet"
          description="A bespoke commission begins at the counter — open the Custom Made POS."
          action={
            <Button asChild className="btn-brass">
              <Link to="/admin/intake/custom">Start commission</Link>
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/admin/orders/custom/${r.id}`)}
        />
      )}
    </div>
  );
}
