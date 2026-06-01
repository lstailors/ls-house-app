import { useEffect, useMemo, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { FilterBar } from "@/components/glass/FilterBar";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatUSD, formatDate } from "@/lib/format";

interface ErpInvoice {
  id: string;
  erpnextId: string;
  salesOrderErpName: string | null;
  customer: { name: string } | null;
  status: string; // paid | sent | overdue | draft | void
  total: number;
  grandTotal: number;
  outstandingAmount: number;
  paidAmount: number;
  postingDate: string | null;
  dueDate: string | null;
  pdfUrl: string | null;
  createdAt: string;
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "sent", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "draft", label: "Draft" },
  { value: "void", label: "Void" },
];

export default function Invoices() {
  const [invoices, setInvoices] = useState<ErpInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ErpInvoice[]>("/api/invoices");
      setInvoices(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    return invoices.filter((i) => {
      if (filter !== "all" && i.status !== filter) return false;
      if (!s) return true;
      return (
        i.erpnextId.toLowerCase().includes(s) ||
        (i.customer?.name ?? "").toLowerCase().includes(s) ||
        (i.salesOrderErpName ?? "").toLowerCase().includes(s)
      );
    });
  }, [invoices, search, filter]);

  const totals = useMemo(() => ({
    paid: invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.paidAmount, 0),
    outstanding: invoices.filter((i) => ["sent", "overdue"].includes(i.status)).reduce((s, i) => s + i.outstandingAmount, 0),
  }), [invoices]);

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Workshop · Invoices"
        title={<>The <span className="text-brass-shimmer">invoice</span> book.</>}
        description="Live from ERPNext — issued, paid, and outstanding across every commission."
        actions={
          <Button variant="outline" className="border-brass/20 hover:bg-brass/10 text-cream-muted" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        }
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

      {error && (
        <div className="glass-panel border-l-4 border-signal-rose p-3 text-sm text-signal-rose">
          {error} — <button onClick={load} className="underline">retry</button>
        </div>
      )}

      {loading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title="No invoices" description="ERPNext invoices will appear here." />
      ) : (
        <div className="glass-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-brass/10 bg-forest-raised/30">
              <tr className="text-left">
                {["Invoice", "Order", "Customer", "Date", "Due", "Status", "Outstanding", "Total"].map((h) => (
                  <th key={h} className="px-4 py-2.5 ui-label text-[9px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="border-t border-brass/8 hover:bg-brass/3 transition-colors">
                  <td className="px-4 py-3 font-display italic text-brass-light text-sm">{i.erpnextId}</td>
                  <td className="px-4 py-3 text-cream-dim text-xs">{i.salesOrderErpName ?? "—"}</td>
                  <td className="px-4 py-3 text-cream">{i.customer?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-cream-dim text-xs">{i.postingDate ? formatDate(i.postingDate) : "—"}</td>
                  <td className="px-4 py-3 text-cream-dim text-xs">{i.dueDate ? formatDate(i.dueDate) : "—"}</td>
                  <td className="px-4 py-3"><StatusPill status={i.status} /></td>
                  <td className="px-4 py-3 text-right font-display italic text-signal-amber tabular-nums">
                    {i.outstandingAmount > 0 ? formatUSD(i.outstandingAmount) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-display italic text-brass-shimmer tabular-nums">
                    {formatUSD(i.grandTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
