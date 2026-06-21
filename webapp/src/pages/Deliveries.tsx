import { useMemo, useState } from "react";
import { Truck, MapPin, Clock, CheckCircle2, Phone, Camera, QrCode, Plus, Printer, ChevronDown, ChevronUp, Package, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { KpiCard } from "@/components/glass/KpiCard";
import { StatusPill } from "@/components/glass/StatusPill";
import { FilterBar } from "@/components/glass/FilterBar";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { DriverRoute } from "@/components/deliveries/DriverRoute";
import { NewDeliveryDialog } from "@/components/deliveries/NewDeliveryDialog";
import { MarkDeliveredDialog } from "@/components/deliveries/MarkDeliveredDialog";
import { ProofViewerDialog } from "@/components/deliveries/ProofViewerDialog";
import { useDeliveries, useUpdateDelivery, useDeliveryDailyOpsSummary } from "@/lib/queries";
import { AnomaliesCard } from "@/components/deliveries/AnomaliesCard";
import { DispatchMap } from "@/components/maps/DispatchMap";
import { useNavigate } from "react-router-dom";
import { useMe } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Delivery } from "@/lib/types";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "ready_for_pickup", label: "Ready for Pickup" },
  { value: "out_for_delivery", label: "Out" },
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Failed" },
];

export default function Deliveries() {
  const { data: me } = useMe();
  const { data: deliveries = [], isLoading } = useDeliveries();
  const update = useUpdateDelivery();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [newDeliveryOpen, setNewDeliveryOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [deliverTarget, setDeliverTarget] = useState<Delivery | null>(null);
  const [proofTarget, setProofTarget] = useState<Delivery | null>(null);
  const [activeTab, setActiveTab]   = useState<"board" | "candidates">("board");
  const [opsOpen, setOpsOpen]       = useState(false);

  const qc = useQueryClient();
  const navigate = useNavigate();
  const isDriver = me?.role === "driver";

  const dailyOps = useDeliveryDailyOpsSummary(opsOpen);

  const { data: candidates = [] } = useQuery({
    queryKey: ["delivery-candidates"],
    queryFn: () => api.get<any[]>("/api/deliveries/candidates"),
    staleTime: 5 * 60_000,
    enabled: activeTab === "candidates",
  });

  const scheduleDelivery = useMutation({
    mutationFn: (candidate: any) =>
      api.post<Delivery>("/api/deliveries/from-order", {
        sales_order: candidate.name,
        customer_name: candidate.customer_name,
        customer_phone: candidate.contact_mobile ?? candidate.contact_phone ?? null,
        notify_phone: candidate.contact_mobile ?? candidate.contact_phone ?? null,
        location: (me as any)?.locationId ?? "NYC",
      }),
    onSuccess: () => {
      toast.success("Delivery scheduled");
      setActiveTab("board");
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      qc.invalidateQueries({ queryKey: ["delivery-candidates"] });
    },
    onError: () => toast.error("Could not schedule delivery"),
  });

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    const STATUS_RANK: Record<string, number> = {
      out_for_delivery: 0,
      ready_for_pickup: 1,
      scheduled:        1,
      failed:           2,
      delivered:        3,
    };

    return deliveries
      .filter((d) => {
        if (filter !== "all" && d.status !== filter) return false;
        if (!s) return true;
        return (
          (d.customer?.name ?? "").toLowerCase().includes(s) ||
          (d.addressLine ?? "").toLowerCase().includes(s)
        );
      })
      .sort((a, b) => {
        // 1. Status priority (out for delivery → scheduled → failed → delivered)
        const rankDiff = (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1);
        if (rankDiff !== 0) return rankDiff;
        // 2. Scheduled date ascending (soonest first); nulls last
        const aDate = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
        const bDate = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
        if (aDate !== bDate) return aDate - bDate;
        // 3. Newest created last as tiebreaker
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [deliveries, filter, search]);

  const counts = useMemo(() => {
    return {
      scheduled: deliveries.filter((d) => d.status === "scheduled").length,
      out: deliveries.filter((d) => d.status === "out_for_delivery").length,
      done: deliveries.filter((d) => d.status === "delivered").length,
    };
  }, [deliveries]);

  // Drivers see the mobile-first stop list, not the dispatch board.
  if (isDriver) {
    return (
      <DriverRoute
        deliveries={deliveries}
        isLoading={isLoading}
        driverName={me?.name ?? "Driver"}
      />
    );
  }

  const handleStart = async (id: string) => {
    try {
      await update.mutateAsync({ id, status: "out_for_delivery" });
      toast.success("Marked out for delivery");
    } catch (e) {
      toast.error((e as Error).message || "Could not update");
    }
  };

  return (
    <div className="space-y-5 md:space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Logistics"
        title={<>The <span className="text-brass-shimmer">dispatch</span> board.</>}
        description="Every finished garment, from the rack to the customer's hand."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setOpsOpen((v) => !v)}
              className="border-brass/20 hover:bg-brass/10 text-cream-muted h-9 text-sm gap-1.5"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Daily ops</span>
            </Button>
            <Button
              onClick={() => setNewDeliveryOpen(true)}
              className="bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e] font-medium h-9 text-sm"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" /> New Delivery
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        <KpiCard
          label="Scheduled"
          value={counts.scheduled}
          icon={<Clock className="h-4 w-4" />}
          onClick={() => setFilter((f) => f === "scheduled" ? "all" : "scheduled")}
          active={filter === "scheduled"}
        />
        <KpiCard
          label="Out for Delivery"
          value={counts.out}
          icon={<Truck className="h-4 w-4" />}
          accent="amber"
          onClick={() => setFilter((f) => f === "out_for_delivery" ? "all" : "out_for_delivery")}
          active={filter === "out_for_delivery"}
        />
        <KpiCard
          label="Delivered"
          value={counts.done}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="emerald"
          onClick={() => setFilter((f) => f === "delivered" ? "all" : "delivered")}
          active={filter === "delivered"}
        />
        <KpiCard
          label="Ready to Ship"
          value={candidates.length}
          icon={<Package className="h-4 w-4" />}
          accent="amber"
          onClick={() => setActiveTab((t) => t === "candidates" ? "board" : "candidates")}
          active={activeTab === "candidates"}
        />
      </div>

      {/* Daily ops summary panel (collapsible) */}
      {opsOpen ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <GlassCard className="p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-widest text-cream-dim flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-brass-light/70" /> Daily Ops Summary
            </div>
            {dailyOps.isFetching && !dailyOps.data ? (
              <div className="flex items-center gap-2 text-xs text-cream-muted">
                <Clock className="h-3.5 w-3.5 animate-spin" /> Generating summary…
              </div>
            ) : dailyOps.error ? (
              <div className="text-xs text-signal-rose">Summary unavailable — check AI_GATEWAY_API_KEY.</div>
            ) : dailyOps.data ? (
              <div className="space-y-3">
                <p className="text-xs text-cream-muted leading-relaxed">{dailyOps.data.summary}</p>
                {dailyOps.data.highlights?.length ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-cream-dim mb-1">Highlights</div>
                    <ul className="space-y-0.5">
                      {dailyOps.data.highlights.map((h, i) => (
                        <li key={i} className="text-xs text-signal-emerald flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0">✓</span>{h}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {dailyOps.data.flagged?.length ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-cream-dim mb-1">Follow-up needed</div>
                    <ul className="space-y-0.5">
                      {dailyOps.data.flagged.map((f, i) => (
                        <li key={i} className="text-xs text-signal-amber flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0">⚑</span>{f}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="text-[9px] text-cream-dim/50 font-mono">{dailyOps.data.model}</div>
              </div>
            ) : null}
          </GlassCard>
          <AnomaliesCard />
        </div>
      ) : null}

      {/* Delivery Map */}
      <GlassCard className="overflow-hidden">
        <button
          type="button"
          onClick={() => setMapOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-brass/5 transition-colors"
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-cream-dim">
            <MapPin className="h-3.5 w-3.5 text-brass-light/60" />
            Route Map
            <span className="text-[10px] normal-case tracking-normal text-cream-dim/60 ml-1">
              · {deliveries.filter((d) => !["delivered","failed","cancelled"].includes(d.status) && d.addressLine).length} pending stops
            </span>
          </div>
          {mapOpen ? <ChevronUp className="h-3.5 w-3.5 text-cream-dim" /> : <ChevronDown className="h-3.5 w-3.5 text-cream-dim" />}
        </button>
        {mapOpen && (
          <DispatchMap
            deliveries={deliveries}
            onSelect={(id) => navigate(`/deliveries/${id}`)}
            height={420}
          />
        )}
      </GlassCard>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-forest-dark/40 border border-brass/10 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("board")}
          className={cn(
            "px-4 py-1.5 rounded-md text-xs font-medium transition-colors",
            activeTab === "board"
              ? "bg-brass/20 text-brass-light border border-brass/30"
              : "text-cream-dim hover:text-cream"
          )}
        >
          Dispatch Board
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("candidates")}
          className={cn(
            "px-4 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
            activeTab === "candidates"
              ? "bg-brass/20 text-brass-light border border-brass/30"
              : "text-cream-dim hover:text-cream"
          )}
        >
          Ready to Deliver
          {candidates.length > 0 ? (
            <span className="bg-signal-amber/20 text-signal-amber text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {candidates.length}
            </span>
          ) : null}
        </button>
      </div>

      {activeTab === "candidates" ? (
        candidates.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No orders ready to dispatch"
            description="Sales orders marked 'To Deliver and Bill' will appear here."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {candidates.map((c: any) => (
              <GlassCard key={c.name} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <div className="text-cream font-medium truncate text-base">{c.customer_name}</div>
                    <div className="text-[11px] text-brass-light/60 font-mono mt-0.5">{c.name}</div>
                  </div>
                  <span className="text-[10px] text-cream-dim bg-forest-dark/60 border border-brass/10 rounded px-2 py-0.5 shrink-0 ml-2">
                    Ready
                  </span>
                </div>
                {c.delivery_date ? (
                  <div className="flex items-center gap-1.5 text-xs text-cream-dim mb-2">
                    <Clock className="h-3 w-3" />
                    <span>{c.delivery_date}</span>
                  </div>
                ) : null}
                {(c.contact_mobile ?? c.contact_phone) ? (
                  <div className="flex items-center gap-1.5 text-xs text-cream-muted mb-3">
                    <Phone className="h-3 w-3 text-brass-light/60" />
                    <span className="font-mono">{c.contact_mobile ?? c.contact_phone}</span>
                  </div>
                ) : null}
                <div className="pt-3 border-t border-brass/10">
                  <Button
                    size="sm"
                    onClick={() => scheduleDelivery.mutate(c)}
                    disabled={scheduleDelivery.isPending}
                    className="btn-brass w-full text-xs h-8"
                  >
                    <Truck className="h-3.5 w-3.5 mr-1.5" /> Schedule Delivery
                  </Button>
                </div>
              </GlassCard>
            ))}
          </div>
        )
      ) : (
        <>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by customer or address"
        filterValue={filter}
        onFilterChange={setFilter}
        filterOptions={FILTERS}
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No deliveries"
          description="Deliveries appear when commissions are marked ready."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((d) => (
            <GlassCard
              key={d.id}
              hover
              onClick={() => navigate(`/deliveries/${d.id}`)}
              className={cn(
                "p-4 transition-transform hover:-translate-y-0.5 cursor-pointer",
                d.status === "out_for_delivery" && "border-signal-amber/40",
                d.status === "delivered" && "border-signal-emerald/30",
                d.status === "failed" && "border-signal-rose/40",
              )}
            >
              {(() => {
                const isOverdue = d.status === "scheduled" && d.scheduledAt && new Date(d.scheduledAt) < new Date();
                return (
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0">
                      <div className="text-cream font-medium truncate">{d.customer?.name ?? "—"}</div>
                      <div className="text-[11px] text-cream-dim font-mono">
                        {d.deliveryNo ? d.deliveryNo : `#${d.id.slice(-6).toUpperCase()}`}
                      </div>
                      {d.qrToken ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <QrCode className="h-2.5 w-2.5 text-brass-light/60" />
                          <span className="text-[9px] text-brass-light/60 font-mono">{d.qrToken.slice(0, 8)}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusPill status={d.status} />
                      {isOverdue ? <span className="text-xs font-bold text-red-400 uppercase">Overdue</span> : null}
                    </div>
                  </div>
                );
              })()}

              {d.addressLine ? (
                <div className="flex items-start gap-1.5 text-xs text-cream-muted mb-1">
                  <MapPin className="h-3 w-3 text-brass-light/60 mt-0.5 shrink-0" />
                  <span className="leading-snug">{d.addressLine}</span>
                </div>
              ) : null}
              {(d as any).orderRef ? (
                <div className="text-[10px] text-brass-light/50 font-mono mt-0.5 mb-2">{(d as any).orderRef}</div>
              ) : null}

              <div className="flex items-center gap-1.5 text-xs text-cream-dim mb-3">
                <Clock className="h-3 w-3" />
                <span>{formatDateTime(d.scheduledAt)}</span>
              </div>

              {d.driver ? (
                <div className="text-[10px] text-cream-dim uppercase tracking-widerer mb-3">
                  Driver · <span className="text-cream-muted normal-case tracking-normal">{d.driver.name}</span>
                </div>
              ) : null}

              {d.proofOfDeliveryUrl ? (
                <button
                  type="button"
                  onClick={() => setProofTarget(d)}
                  className="flex items-center gap-1.5 text-[10px] text-signal-emerald mb-3 hover:underline"
                >
                  <Camera className="h-3 w-3" /> Proof on file
                </button>
              ) : null}

              <div className="flex items-center gap-2 pt-3 border-t border-brass/10" onClick={(e) => e.stopPropagation()}>
                {d.status === "scheduled" ? (
                  <Button
                    size="sm"
                    onClick={() => handleStart(d.id)}
                    disabled={update.isPending}
                    className="btn-brass flex-1 text-xs h-8"
                  >
                    <Truck className="h-3.5 w-3.5 mr-1.5" /> Start delivery
                  </Button>
                ) : null}
                {d.status === "out_for_delivery" ? (
                  <Button
                    size="sm"
                    onClick={() => setDeliverTarget(d)}
                    disabled={update.isPending}
                    className="btn-brass flex-1 text-xs h-8"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark delivered
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/deliveries/${d.id}/label`)}
                  className="border-brass/20 hover:bg-brass/10 text-cream-muted h-8 px-2"
                  title="Print label"
                >
                  <Printer className="h-3.5 w-3.5" />
                </Button>
                {d.customer?.phone ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-brass/20 hover:bg-brass/10 text-cream-muted h-8 px-2"
                    asChild
                  >
                    <a href={`tel:${d.customer.phone}`}>
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                ) : null}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
        </>
      )}

      <NewDeliveryDialog
        open={newDeliveryOpen}
        onClose={() => setNewDeliveryOpen(false)}
      />

      <MarkDeliveredDialog
        delivery={deliverTarget}
        onClose={() => setDeliverTarget(null)}
      />

      <ProofViewerDialog
        delivery={proofTarget}
        onClose={() => setProofTarget(null)}
      />
    </div>
  );
}
