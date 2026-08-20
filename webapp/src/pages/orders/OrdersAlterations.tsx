import { useMemo, useState } from "react";
import { Plus, Scissors, Star } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { SectionHeader } from "@ls/design";
import { DataTable, type Column } from "@ls/design";
import { FilterBar } from "@ls/design";
import { StatusPill } from "@ls/design";
import { EmptyState } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { useAlterations } from "@/lib/queries";
import { formatUSD, formatDate } from "@ls/design/format";
import type { Alteration } from "@ls/types";
import { AlterationKpiBar } from "@/components/alterations/AlterationKpiBar";
import { AlterationDailyBrief } from "@/components/alterations/AlterationDailyBrief";
import { TransferButton } from "@/components/alterations/TransferButton";

const FILTERS = [
  { value: "all",          label: "All"         },
  { value: "in_progress",  label: "In Progress" },
  { value: "complete",     label: "Complete"    },
  { value: "delivered",    label: "Delivered"   },
];

export default function OrdersAlterations() {
  const { data: alterations = [], isLoading } = useAlterations();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [altKpis, setAltKpis] = useState<any>(null);
  const [kpiFilter, setKpiFilter] = useState<string>("active");

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return alterations.filter((a) => {
      if (filter === "in_progress" && a.status !== "intake" && a.status !== "in_progress") return false;
      if (filter === "complete"    && a.status !== "ready")     return false;
      if (filter === "delivered"   && a.status !== "picked_up") return false;
      if (!s) return true;
      return (
        a.customer?.name.toLowerCase().includes(s) ||
        a.customer?.phone.includes(search) ||
        a.tailor?.name.toLowerCase().includes(s)
      );
    });
  }, [alterations, search, filter]);

  const columns: Column<Alteration>[] = [
    {
      key: "customer",
      header: "Customer",
      accessor: (a) => a.customer?.name ?? "",
      cell: (a) => (
        <div className="min-w-0">
          <div className="text-cream font-medium truncate flex items-center gap-1.5">
            {a.customer?.name ?? "—"}
            {a.customer?.dossier?.vip ? <Star className="h-3 w-3 text-brass fill-brass" /> : null}
            {(a as any).isRush ? (
              <span className="px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest bg-signal-amber/20 text-signal-amber border border-signal-amber/30 rounded">
                RUSH
              </span>
            ) : null}
          </div>
          <div className="text-[11px] text-cream-dim truncate">{a.customer?.phone}</div>
        </div>
      ),
    },
    {
      key: "items",
      header: "Items",
      cell: (a) => {
        const first2 = a.items.slice(0, 2);
        return (
          <div className="min-w-0 max-w-[260px]">
            <div className="text-cream-muted text-sm truncate">
              {first2.map((i) => i.label).join(" · ")}
              {a.items.length > 2 ? <span className="text-cream-dim"> +{a.items.length - 2}</span> : null}
            </div>
            <div className="text-[10px] text-cream-dim">
              {a.items.length} item{a.items.length === 1 ? "" : "s"}
            </div>
          </div>
        );
      },
    },
    {
      key: "tailor",
      header: "Tailor",
      accessor: (a) => a.tailor?.name ?? "",
      cell: (a) =>
        a.tailor ? (
          <span className="text-cream-muted">{a.tailor.name}</span>
        ) : (
          <span className="text-cream-dim italic">Unassigned</span>
        ),
    },
    {
      key: "due",
      header: "Due",
      accessor: (a) => a.dueDate ?? "",
      cell: (a) => {
        if (!a.dueDate) return <span className="text-cream-dim">—</span>;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const due = new Date(a.dueDate); due.setHours(0, 0, 0, 0);
        const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
        let label: React.ReactNode;
        if (diff < 0) {
          label = <span className="text-red-400 font-medium text-xs">OVERDUE {Math.abs(diff)}d</span>;
        } else if (diff === 0) {
          label = <span className="text-signal-amber font-medium text-xs">Due Today</span>;
        } else if (diff === 1) {
          label = <span className="text-amber-300 text-xs">Due Tomorrow</span>;
        } else {
          label = <span className="text-cream-dim text-xs">Due in {diff}d</span>;
        }
        return (
          <div>
            {label}
            <div className="text-[10px] text-cream-dim">{formatDate(a.dueDate)}</div>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      accessor: (a) => a.status ?? "",
      cell: (a) => <StatusPill status={a.status} />,
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      accessor: (a) => a.price ?? 0,
      cell: (a) => (
        <span className="font-display italic text-brass-shimmer text-base">
          {formatUSD(a.price)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Orders · Alterations"
        title={<>The <span className="text-brass-shimmer">alterations</span> board.</>}
        description="Tickets across every stage — from intake to pickup."
        actions={
          <Button asChild className="btn-brass">
            <Link to="/intake/alterations">
              <Plus className="h-4 w-4 mr-1.5" /> New ticket
            </Link>
          </Button>
        }
      />

      <AlterationKpiBar activeFilter={kpiFilter} onFilter={setKpiFilter} />
      <AlterationDailyBrief kpis={altKpis} />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by customer, phone, or tailor"
        filterValue={filter}
        onFilterChange={setFilter}
        filterOptions={FILTERS}
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title="No alteration tickets"
          description="Tickets created in intake will appear here once synced from ERPNext."
          action={
            <Button asChild className="btn-brass">
              <Link to="/intake/alterations">New ticket</Link>
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/admin/orders/alterations/${r.id}`)}
        />
      )}

      <TransferButton />
    </div>
  );
}
