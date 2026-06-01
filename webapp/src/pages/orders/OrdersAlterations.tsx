import { useMemo, useState } from "react";
import { Plus, Scissors, Star } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { DataTable, type Column } from "@/components/glass/DataTable";
import { FilterBar } from "@/components/glass/FilterBar";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { useAlterations } from "@/lib/queries";
import { formatUSD, formatDate, relativeDay } from "@/lib/format";
import type { Alteration } from "@/lib/types";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "intake", label: "Intake" },
  { value: "in_progress", label: "In Progress" },
  { value: "ready", label: "Ready" },
  { value: "picked_up", label: "Picked Up" },
];

export default function OrdersAlterations() {
  const { data: alterations = [], isLoading } = useAlterations();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return alterations.filter((a) => {
      if (filter !== "all" && a.status !== filter) return false;
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
      cell: (a) => (
        <div className="min-w-0">
          <div className="text-cream font-medium truncate flex items-center gap-1.5">
            {a.customer?.name ?? "—"}
            {a.customer?.dossier?.vip ? <Star className="h-3 w-3 text-brass fill-brass" /> : null}
          </div>
          <div className="text-[11px] text-cream-dim truncate">{a.customer?.phone}</div>
        </div>
      ),
    },
    {
      key: "items",
      header: "Items",
      cell: (a) => (
        <div className="min-w-0 max-w-[260px]">
          <div className="text-cream-muted text-sm truncate">
            {a.items.map((i) => i.label).join(" · ")}
          </div>
          <div className="text-[10px] text-cream-dim">
            {a.items.length} item{a.items.length === 1 ? "" : "s"}
          </div>
        </div>
      ),
    },
    {
      key: "tailor",
      header: "Tailor",
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
      cell: (a) => (
        <div>
          <div className="text-cream-muted">{relativeDay(a.dueDate)}</div>
          <div className="text-[10px] text-cream-dim">{formatDate(a.dueDate)}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (a) => <StatusPill status={a.status} />,
    },
    {
      key: "price",
      header: "Price",
      align: "right",
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
          title="Alteration tickets are managed in Geelus"
          description="Sync integration coming soon. Alteration data will appear here once the Geelus connection is live."
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
          onRowClick={(r) => navigate(`/orders/alterations#${r.id}`)}
        />
      )}
    </div>
  );
}
