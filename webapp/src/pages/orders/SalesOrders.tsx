import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import {
  TrendingUp,
  Receipt,
  DollarSign,
  Clock,
  AlertCircle,
  ChevronRight,
} from "lucide-react"
import { useSalesOrders, useAlterations } from "@/lib/queries"
import { formatUSD, formatDate } from "@/lib/format"
import { GlassCard } from "@/components/glass/GlassCard"
import { DataTable, type Column } from "@/components/glass/DataTable"
import { StatusPill } from "@/components/glass/StatusPill"
import { SectionHeader } from "@/components/glass/SectionHeader"
import { cn } from "@/lib/utils"
import type { Alteration } from "@/lib/types"

type TabId = "custom" | "alt"

// ── Status label helpers ─────────────────────────────────────────────────────

function altStageLabel(status: string) {
  const map: Record<string, string> = {
    in_progress: "In Progress",
    received: "Received",
    ready: "Ready",
    picked_up: "Picked Up",
    complete: "Complete",
    delivered: "Delivered",
  }
  return map[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function deliveryBadgeClass(status: string | null) {
  if (!status) return "bg-zinc-500/10 text-zinc-400 border-zinc-500/25"
  if (status === "Fully Delivered") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
  if (status === "Partly Delivered") return "bg-amber-500/15 text-amber-400 border-amber-500/30"
  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/25"
}

// ── KPI Tile ─────────────────────────────────────────────────────────────────

interface KpiTileProps {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  accent?: "emerald" | "amber" | "rose" | "brass" | "default"
}

function KpiTile({ icon: Icon, label, value, sub, accent = "default" }: KpiTileProps) {
  const accentMap = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
    brass: "text-brass-shimmer",
    default: "text-brass-shimmer",
  }
  return (
    <GlassCard className="p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", accentMap[accent])} />
        <span className="ui-label text-[9px] text-cream-dim truncate">{label}</span>
      </div>
      <div className={cn("font-display italic text-xl tabular-nums leading-none", accentMap[accent])}>
        {value}
      </div>
      {sub ? <div className="text-[10px] text-cream-dim">{sub}</div> : null}
    </GlassCard>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SalesOrders() {
  const navigate = useNavigate()
  const { data: orders = [], isLoading: loadingSO } = useSalesOrders()
  const { data: alterations = [], isLoading: loadingAlt } = useAlterations()
  const [tab, setTab] = useState<TabId>("custom")
  const [search, setSearch] = useState("")

  // Cast orders to any[] for richer fields from the API
  const rawOrders = orders as any[]

  // ── KPI computation ────────────────────────────────────────────────────────
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  const pipeline = rawOrders.reduce((s: number, o: any) => s + (o.grandTotal ?? o.total ?? 0), 0)
  const collected = rawOrders.reduce((s: number, o: any) => s + (o.advancePaid ?? 0), 0)
  const outstanding = rawOrders.reduce((s: number, o: any) => {
    if (o.billingStatus === "Fully Billed") return s
    return s + Math.max(0, (o.grandTotal ?? o.total ?? 0) - (o.advancePaid ?? 0))
  }, 0)
  const thisMonthCount = rawOrders.filter((o: any) => {
    const d = o.transactionDate ? new Date(o.transactionDate) : null
    return d && d >= thisMonthStart
  }).length
  const overdueCount = rawOrders.filter((o: any) => {
    if (!o.deliveryDate) return false
    const dd = new Date(o.deliveryDate)
    dd.setHours(0, 0, 0, 0)
    return dd < today && o.deliveryStatus !== "Fully Delivered"
  }).length

  // ── Search filter ──────────────────────────────────────────────────────────
  const s = search.toLowerCase()

  const filteredOrders = useMemo(() => {
    if (!s) return rawOrders
    return rawOrders.filter(
      (o: any) =>
        (o.id ?? "").toLowerCase().includes(s) ||
        (o.erpnextId ?? "").toLowerCase().includes(s) ||
        (o.customer?.name ?? "").toLowerCase().includes(s),
    )
  }, [rawOrders, s])

  const filteredAlts = useMemo(() => {
    if (!s) return alterations
    return (alterations as Alteration[]).filter(
      (a) =>
        (a.id ?? "").toLowerCase().includes(s) ||
        (a.customer?.name ?? a.customerId ?? "").toLowerCase().includes(s),
    )
  }, [alterations, s])

  // ── Custom Orders columns ──────────────────────────────────────────────────
  const soColumns: Column<any>[] = [
    {
      key: "id",
      header: "Order",
      accessor: (r) => r.id ?? "",
      cell: (r) => (
        <div className="font-mono text-[11px] text-brass/80 tracking-tight">{r.erpnextId ?? r.id}</div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      accessor: (r) => r.customer?.name ?? "",
      cell: (r) => (
        <span className="text-cream font-medium truncate max-w-[150px] block">{r.customer?.name ?? "—"}</span>
      ),
    },
    {
      key: "date",
      header: "Date",
      accessor: (r) => r.transactionDate ?? "",
      cell: (r) => (
        <span className="text-cream-dim text-xs">{r.transactionDate ? formatDate(r.transactionDate) : "—"}</span>
      ),
    },
    {
      key: "delivery",
      header: "Delivery",
      accessor: (r) => r.deliveryDate ?? "",
      cell: (r) => {
        if (!r.deliveryDate) return <span className="text-cream-dim text-xs">—</span>
        const dd = new Date(r.deliveryDate)
        dd.setHours(0, 0, 0, 0)
        const isPast = dd < today && r.deliveryStatus !== "Fully Delivered"
        return (
          <span className={cn("text-xs", isPast ? "text-rose-400 font-medium" : "text-cream-dim")}>
            {formatDate(r.deliveryDate)}
          </span>
        )
      },
    },
    {
      key: "grandTotal",
      header: "Total",
      align: "right",
      accessor: (r) => r.grandTotal ?? r.total ?? 0,
      cell: (r) => (
        <span className="font-display italic text-brass-shimmer text-base tabular-nums">
          {formatUSD(r.grandTotal ?? r.total ?? 0)}
        </span>
      ),
    },
    {
      key: "collected",
      header: "Collected",
      align: "right",
      accessor: (r) => r.advancePaid ?? 0,
      cell: (r) =>
        (r.advancePaid ?? 0) > 0 ? (
          <span className="text-emerald-400 tabular-nums text-xs">{formatUSD(r.advancePaid)}</span>
        ) : (
          <span className="text-cream-dim text-xs">—</span>
        ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      accessor: (r) => Math.max(0, (r.grandTotal ?? r.total ?? 0) - (r.advancePaid ?? 0)),
      cell: (r) => {
        const bal = Math.max(0, (r.grandTotal ?? r.total ?? 0) - (r.advancePaid ?? 0))
        return bal > 0 ? (
          <span className="text-rose-400 tabular-nums text-xs font-medium">{formatUSD(bal)}</span>
        ) : (
          <span className="text-emerald-400 text-xs">Paid</span>
        )
      },
    },
    {
      key: "billing",
      header: "Billing",
      accessor: (r) => r.billingStatus ?? "",
      cell: (r) => r.billingStatus ? <StatusPill status={r.billingStatus} /> : <span className="text-cream-dim text-xs">—</span>,
    },
    {
      key: "deliveryStatus",
      header: "Delivery",
      accessor: (r) => r.deliveryStatus ?? "",
      cell: (r) => (
        <span
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
            deliveryBadgeClass(r.deliveryStatus),
          )}
        >
          {r.deliveryStatus ?? "Not Delivered"}
        </span>
      ),
    },
    {
      key: "arrow",
      header: "",
      cell: () => <ChevronRight className="h-3.5 w-3.5 text-cream-dim/40" />,
    },
  ]

  // ── Alterations columns ────────────────────────────────────────────────────
  const altColumns: Column<Alteration>[] = [
    {
      key: "id",
      header: "Ticket",
      accessor: (a) => (a as any).ticket_id ?? a.id ?? "",
      cell: (a) => (
        <div className="font-mono text-[11px] text-brass/80 tracking-tight">
          {(a as any).ticket_id ?? a.id}
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      accessor: (a) => a.customer?.name ?? a.customerId ?? "",
      cell: (a) => (
        <span className="text-cream font-medium truncate max-w-[150px] block">
          {a.customer?.name ?? a.customerId ?? "—"}
        </span>
      ),
    },
    {
      key: "dueDate",
      header: "Due Date",
      accessor: (a) => a.dueDate ?? "",
      cell: (a) => {
        if (!a.dueDate) return <span className="text-cream-dim text-xs">—</span>
        const dd = new Date(a.dueDate)
        dd.setHours(0, 0, 0, 0)
        const isPast = dd < today && a.status !== "picked_up" && a.status !== "complete" && a.status !== "delivered"
        return (
          <span className={cn("text-xs", isPast ? "text-rose-400 font-medium" : "text-cream-dim")}>
            {formatDate(a.dueDate)}
          </span>
        )
      },
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      accessor: (a) => a.price ?? 0,
      cell: (a) => (
        <span className="font-display italic text-brass-shimmer text-base tabular-nums">
          {formatUSD(a.price ?? 0)}
        </span>
      ),
    },
    {
      key: "payment",
      header: "Payment",
      accessor: (a) => (a as any).paymentStatus ?? "",
      cell: (a) => {
        const ps = (a as any).paymentStatus
        return ps ? <StatusPill status={ps} /> : <span className="text-cream-dim text-xs">—</span>
      },
    },
    {
      key: "stage",
      header: "Stage",
      accessor: (a) => a.status ?? "",
      cell: (a) => {
        const wf = (a as any).workflow_state ?? a.status ?? ""
        return <StatusPill status={wf} />
      },
    },
    {
      key: "arrow",
      header: "",
      cell: () => <ChevronRight className="h-3.5 w-3.5 text-cream-dim/40" />,
    },
  ]

  const tabs = [
    { id: "custom" as TabId, label: "Custom Orders", count: rawOrders.length },
    { id: "alt" as TabId, label: "Alterations", count: alterations.length },
  ]

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Orders · Hub"
        title={
          <>
            The <span className="text-brass-shimmer">order</span> ledger.
          </>
        }
        description="Custom commissions and alterations — all financials in one place."
      />

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiTile
          icon={TrendingUp}
          label="Pipeline"
          value={formatUSD(pipeline, { compact: true })}
          sub={`${rawOrders.length} orders`}
          accent="brass"
        />
        <KpiTile
          icon={DollarSign}
          label="Collected"
          value={formatUSD(collected, { compact: true })}
          accent="emerald"
        />
        <KpiTile
          icon={Receipt}
          label="Outstanding"
          value={formatUSD(outstanding, { compact: true })}
          accent={outstanding > 0 ? "amber" : "default"}
        />
        <KpiTile
          icon={Clock}
          label="This Month"
          value={String(thisMonthCount)}
          sub="new orders"
          accent="default"
        />
        <KpiTile
          icon={AlertCircle}
          label="Overdue"
          value={String(overdueCount)}
          sub={overdueCount > 0 ? "past due date" : "none overdue"}
          accent={overdueCount > 0 ? "rose" : "default"}
        />
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-white/10">
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

      {/* Search */}
      <div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID or customer name…"
          className="w-full sm:w-80 bg-forest-raised border border-brass/20 rounded-lg px-3 py-2 text-cream text-sm placeholder:text-cream-dim/50 focus:outline-none focus:border-brass/50 transition-colors"
        />
      </div>

      {/* Table */}
      {tab === "custom" ? (
        loadingSO ? (
          <div className="text-cream-muted text-sm animate-pulse">Loading orders…</div>
        ) : (
          <DataTable
            rows={filteredOrders}
            columns={soColumns}
            rowKey={(r) => r.id ?? r.erpnextId}
            onRowClick={(r) => navigate("/sales-orders/" + (r.erpnextId ?? r.id))}
            density="compact"
          />
        )
      ) : loadingAlt ? (
        <div className="text-cream-muted text-sm animate-pulse">Loading alterations…</div>
      ) : (
        <DataTable
          rows={filteredAlts as Alteration[]}
          columns={altColumns}
          rowKey={(a) => a.id}
          onRowClick={(a) => navigate("/orders/alterations/" + a.id)}
          density="compact"
        />
      )}
    </div>
  )
}
