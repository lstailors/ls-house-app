import { useMemo, useState } from "react";
import { FileText, Download } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { DataTable, type Column } from "@/components/glass/DataTable";
import { FilterBar } from "@/components/glass/FilterBar";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { useInvoices } from "@/lib/queries";
import { formatUSD, formatDate } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import { Button } from "@/components/ui/button";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

export default function Invoices() {
  const { data: invoices = [], isLoading } = useInvoices();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return invoices.filter((i) => {
      if (filter !== "all" && i.status !== filter) return false;
      if (!s) return true;
      return (
        i.id.toLowerCase().includes(s) ||
        (i.erpnextId ?? "").toLowerCase().includes(s) ||
        (i.customer?.name ?? "").toLowerCase().includes(s)
      );
    });
  }, [invoices, search, filter]);

  const totals = useMemo(() => {
    return {
      paid: invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0),
      outstanding: invoices.filter((i) => i.status === "sent").reduce((s, i) => s + i.total, 0),
    };
  }, [invoices]);

  const columns: Column<Invoice>[] = [
    {
      key: "id",
      header: "Invoice",
      cell: (i) => (
        <div className="font-mono text-[11px] text-cream-dim">
          {i.erpnextId ?? `#${i.id.slice(-6).toUpperCase()}`}
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (i) => <span className="text-cream">{i.customer?.name ?? "—"}</span>,
    },
    {
      key: "date",
      header: "Issued",
      cell: (i) => <span className="text-cream-dim text-xs">{formatDate(i.createdAt)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (i) => <StatusPill status={i.status} />,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (i) => (
        <span className="font-display italic text-brass-shimmer text-base">
          {formatUSD(i.total)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (i) =>
        i.pdfUrl ? (
          <Button variant="ghost" size="sm" className="text-cream-dim hover:text-brass-light h-7 px-2" asChild>
            <a href={i.pdfUrl} target="_blank" rel="noreferrer">
              <Download className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : (
          <span className="text-cream-dim text-[10px]">—</span>
        ),
      width: "50px",
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Orders · Invoices"
        title={<>The <span className="text-brass-shimmer">invoice</span> book.</>}
        description="Issued, paid, outstanding — across every commission and alteration."
      />

      <div className="grid grid-cols-2 gap-4">
        <div className="glass-panel p-5">
          <div className="ui-label mb-1">Paid</div>
          <div className="kpi-number text-emerald-400">{formatUSD(totals.paid, { compact: true })}</div>
        </div>
        <div className="glass-panel p-5">
          <div className="ui-label mb-1">Outstanding</div>
          <div className="kpi-number text-signal-amber">{formatUSD(totals.outstanding, { compact: true })}</div>
        </div>
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by ID or customer"
        filterValue={filter}
        onFilterChange={setFilter}
        filterOptions={FILTERS}
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No invoices"
          description="Invoices generate when sales orders reach the deposit step."
        />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />
      )}
    </div>
  );
}
