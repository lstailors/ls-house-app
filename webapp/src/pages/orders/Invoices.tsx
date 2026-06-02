import { useMemo, useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Scissors } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { DataTable, type Column } from "@/components/glass/DataTable";
import { FilterBar } from "@/components/glass/FilterBar";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { useInvoices } from "@/lib/queries";
import { formatUSD, formatDate } from "@/lib/format";
import type { Invoice } from "@/lib/types";

// Use actual ERPNext status values returned by the backend
const FILTERS = [
  { value: "all",      label: "All"     },
  { value: "Unpaid",   label: "Unpaid"  },
  { value: "Overdue",  label: "Overdue" },
  { value: "Paid",     label: "Paid"    },
  { value: "Draft",    label: "Draft"   },
  { value: "Void",     label: "Void"    },
];

// Extended Invoice type with extra fields the new backend returns
interface ErpInvoice extends Invoice {
  alterationTicketRef?: string | null;
  outstanding?: number;
  dueDate?: string | null;
}

export default function Invoices() {
  const { data: invoices = [], isLoading } = useInvoices();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("id") ?? null;
  const highlightRef = useRef<HTMLTableRowElement>(null);

  // Auto-scroll to highlighted row and clear the filter so it's visible
  useEffect(() => {
    if (!highlightId || isLoading) return;
    // If the invoice is overdue, switch to show all so it's visible
    setFilter("all");
    const timer = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    return () => clearTimeout(timer);
  }, [highlightId, isLoading]);

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return (invoices as ErpInvoice[]).filter((i) => {
      if (filter !== "all" && i.status !== filter) return false;
      if (!s) return true;
      return (
        i.id.toLowerCase().includes(s) ||
        (i.erpnextId ?? "").toLowerCase().includes(s) ||
        (i.customer?.name ?? "").toLowerCase().includes(s) ||
        ((i as ErpInvoice).alterationTicketRef ?? "").toLowerCase().includes(s)
      );
    });
  }, [invoices, search, filter]);

  const totals = useMemo(() => {
    const all = invoices as ErpInvoice[];
    return {
      paid: all.filter((i) => i.status === "Paid").reduce((s, i) => s + i.total, 0),
      outstanding: all
        .filter((i) => i.status === "Unpaid" || i.status === "Overdue")
        .reduce((s, i) => s + (i.outstanding ?? i.total), 0),
    };
  }, [invoices]);

  const columns: Column<ErpInvoice>[] = [
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
      key: "salesOrderId" as any,
      header: "Order",
      cell: (i) => {
        const ref = i.alterationTicketRef;
        if (ref) {
          return (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-widest bg-emerald-900/40 text-emerald-400 border border-emerald-700/40">
                <Scissors className="h-2.5 w-2.5" />ALT
              </span>
              <span className="font-mono text-[10px] text-cream-dim">{ref}</span>
            </div>
          );
        }
        return <span className="text-cream-dim text-[10px]">—</span>;
      },
    },
    {
      key: "customer",
      header: "Customer",
      accessor: (i) => i.customer?.name ?? "",
      cell: (i) => <span className="text-cream">{i.customer?.name ?? "—"}</span>,
    },
    {
      key: "date",
      header: "Date",
      accessor: (i) => i.createdAt ?? "",
      cell: (i) => <span className="text-cream-dim text-xs">{formatDate(i.createdAt)}</span>,
    },
    {
      key: "dueDate" as any,
      header: "Due",
      accessor: (i) => (i as any).dueDate ?? "",
      cell: (i) => (
        <span className="text-cream-dim text-xs">
          {i.dueDate ? formatDate(i.dueDate) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      accessor: (i) => i.status ?? "",
      cell: (i) => <StatusPill status={i.status} />,
    },
    {
      key: "total",
      header: "Outstanding",
      align: "right",
      accessor: (i) => i.outstanding ?? 0,
      cell: (i) => (
        <span className="font-mono text-xs text-cream-dim tabular-nums">
          {(i.outstanding ?? 0) > 0 ? formatUSD(i.outstanding ?? 0) : "—"}
        </span>
      ),
    },
    {
      key: "pdfUrl" as any,
      header: "Total",
      align: "right",
      accessor: (i) => i.total ?? 0,
      cell: (i) => (
        <span className="font-display italic text-brass-shimmer text-base tabular-nums">
          {formatUSD(i.total)}
        </span>
      ),
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
        searchPlaceholder="Search by invoice, customer, or order…"
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
          description="Invoices generate from both custom commissions and alteration tickets."
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          highlightRow={highlightId ? (r) => (r.erpnextId ?? r.id) === highlightId : undefined}
          highlightRef={highlightRef}
        />
      )}
    </div>
  );
}
