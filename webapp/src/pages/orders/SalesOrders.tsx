import { useEffect, useMemo, useState } from "react";
import { Receipt, RefreshCw, AlertTriangle, LayoutGrid, List } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { FilterBar } from "@/components/glass/FilterBar";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatUSD, formatDate } from "@/lib/format";

interface ErpSalesOrder {
  id: string;
  erpnextId: string;
  customer: { name: string } | null;
  makeType: string | null;
  status: string;
  priceStatus: string;
  total: number;
  grandTotal: number;
  transactionDate: string | null;
  deliveryDate: string | null;
  createdAt: string;
}

const STATUS_FILTERS = [
  { value: "active", label: "Active" },
  { value: "all", label: "All" },
  { value: "Completed", label: "Completed" },
  { value: "Cancelled", label: "Cancelled" },
];

function priceBadge(status: string) {
  if (status === "placeholder")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-signal-amber/50 text-signal-amber text-[9px] tracking-wide font-semibold uppercase">
        <AlertTriangle className="h-2.5 w-2.5" /> Price TBD
      </span>
    );
  if (status === "cost_applied")
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-brass/40 text-brass-light text-[9px] tracking-wide font-semibold uppercase">
        Draft Price
      </span>
    );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-emerald-500/30 text-emerald-400 text-[9px] tracking-wide font-semibold uppercase">
      Priced
    </span>
  );
}

export default function SalesOrders() {
  const [orders, setOrders] = useState<ErpSalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [view, setView] = useState<"list" | "kanban">("list");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ErpSalesOrder[]>(`/api/sales-orders?status=${statusFilter}`);
      setOrders(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const rows = useMemo(() => {
    const s = search.toLowerCase();
    if (!s) return orders;
    return orders.filter(
      (o) =>
        o.erpnextId.toLowerCase().includes(s) ||
        (o.customer?.name ?? "").toLowerCase().includes(s) ||
        (o.makeType ?? "").toLowerCase().includes(s),
    );
  }, [orders, search]);

  const kpis = useMemo(() => ({
    open: rows.filter((r) => !["Completed", "Cancelled", "Closed"].includes(r.status)).length,
    awaitingPrice: rows.filter((r) => r.priceStatus === "placeholder").length,
    value: rows.filter((r) => r.status !== "Cancelled").reduce((s, r) => s + r.grandTotal, 0),
  }), [rows]);

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Workshop · Sales Orders"
        title={<>The <span className="text-brass-shimmer">sales</span> ledger.</>}
        description="Live from ERPNext — every custom commission generates one of these."
        actions={
          <Button
            variant="outline"
            className="border-brass/20 hover:bg-brass/10 text-cream-muted"
            onClick={load}
          >
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        }
      />

      {/* KPI bar */}
      {!loading && orders.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Open Orders", value: kpis.open, warn: false },
            { label: "Awaiting Price", value: kpis.awaitingPrice, warn: kpis.awaitingPrice > 0 },
            { label: "Pipeline Value", value: formatUSD(kpis.value, { compact: true }), mono: true },
          ].map(({ label, value, warn, mono }: any) => (
            <div key={label} className="glass-panel p-4">
              <div className="ui-label mb-1">{label}</div>
              <div className={`kpi-number ${warn ? "text-signal-amber" : mono ? "text-brass-shimmer" : "text-cream"}`}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by order, customer, type…"
        filterValue={statusFilter}
        onFilterChange={setStatusFilter}
        filterOptions={STATUS_FILTERS}
        right={
          <div className="flex items-center gap-1 border border-brass/15 rounded-md p-0.5">
            {(["list", "kanban"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`p-1.5 rounded transition-colors ${view === v ? "bg-brass/20 text-cream" : "text-cream-dim hover:text-cream"}`}
              >
                {v === "list" ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <div className="glass-panel border-l-4 border-signal-rose p-3 text-sm text-signal-rose">
          {error} — <button onClick={load} className="underline">retry</button>
        </div>
      )}

      {loading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No sales orders" description="ERPNext orders will appear here." />
      ) : (
        <div className="glass-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-brass/10 bg-forest-raised/30">
              <tr className="text-left">
                {["Order", "Customer", "Type", "Status", "Price", "Date", "Total"].map((h) => (
                  <th key={h} className="px-4 py-2.5 ui-label text-[9px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-brass/8 hover:bg-brass/3 transition-colors">
                  <td className="px-4 py-3 font-display italic text-brass-light text-sm">{r.erpnextId}</td>
                  <td className="px-4 py-3 text-cream">{r.customer?.name ?? "—"}</td>
                  <td className="px-4 py-3 ui-label text-[10px]">{r.makeType ?? "—"}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-4 py-3">{priceBadge(r.priceStatus)}</td>
                  <td className="px-4 py-3 text-cream-dim text-xs">{r.transactionDate ? formatDate(r.transactionDate) : "—"}</td>
                  <td className="px-4 py-3 text-right font-display italic text-brass-shimmer">
                    {formatUSD(r.grandTotal)}
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
