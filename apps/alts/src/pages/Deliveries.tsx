import { useMemo, useState } from "react";
import { Truck, MapPin, Clock, CheckCircle2, Phone, Camera, Plus, Printer, ChevronDown, ChevronUp, Package, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { KpiCard } from "@ls/design";
import { FilterBar } from "@ls/design";
import { EmptyState } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { DriverRoute } from "@alts/components/deliveries/DriverRoute";
import { NewDeliveryDialog } from "@alts/components/deliveries/NewDeliveryDialog";
import { MarkDeliveredDialog } from "@alts/components/deliveries/MarkDeliveredDialog";
import { ProofViewerDialog } from "@alts/components/deliveries/ProofViewerDialog";
import { useDeliveries, useUpdateDelivery, useDeliveryDailyOpsSummary } from "@alts/lib/queries";
import { AnomaliesCard } from "@alts/components/deliveries/AnomaliesCard";
import { DispatchMap } from "@alts/components/maps/DispatchMap";
import { useNavigate } from "react-router-dom";
import { useMe } from "@ls/auth/session";
import { formatDateTime } from "@ls/design/format";
import { cn } from "@ls/design/utils";
import { api } from "@ls/api-client";
import type { Delivery } from "@ls/types";
import StatusBadge from "@alts/components/StatusBadge";
import type { StatusTone } from "@alts/lib/statusTone";
import { KanbanSkeleton } from "@alts/components/skeletons";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Queued" },
  { value: "out_for_delivery", label: "Out" },
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "On hold" },
];

const BOARD_COLS = [
  { key: "scheduled", label: "Queued", statuses: ["scheduled"] as const, tone: "shop" as StatusTone },
  { key: "out_for_delivery", label: "Out", statuses: ["out_for_delivery"] as const, tone: "qc" as StatusTone },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] as const, tone: "pickup" as StatusTone },
  { key: "failed", label: "On hold", statuses: ["failed", "cancelled"] as const, tone: "tasks" as StatusTone },
] as const;

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

  const counts = useMemo(() => {
    return {
      scheduled: deliveries.filter((d) => d.status === "scheduled").length,
      out: deliveries.filter((d) => d.status === "out_for_delivery").length,
      done: deliveries.filter((d) => d.status === "delivered").length,
      failed: deliveries.filter((d) => d.status === "failed" || d.status === "cancelled").length,
    };
  }, [deliveries]);

  const boardColumns = useMemo(() => {
    const s = search.toLowerCase();
    const matchSearch = (d: Delivery) => {
      if (!s) return true;
      const method = String((d as { method?: string }).method ?? "");
      return (
        (d.customer?.name ?? "").toLowerCase().includes(s) ||
        (d.addressLine ?? "").toLowerCase().includes(s) ||
        method.toLowerCase().includes(s)
      );
    };
    return BOARD_COLS.map((col) => ({
      ...col,
      items: deliveries
        .filter((d) => (col.statuses as readonly string[]).includes(d.status) && matchSearch(d))
        .filter((d) => filter === "all" || d.status === filter)
        .sort((a, b) => {
          const aDate = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity;
          const bDate = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity;
          if (aDate !== bDate) return aDate - bDate;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }),
    }));
  }, [deliveries, filter, search]);

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
          label="Queued"
          value={counts.scheduled}
          icon={<Clock className="h-4 w-4" />}
          onClick={() => setFilter((f) => (f === "scheduled" ? "all" : "scheduled"))}
          active={filter === "scheduled"}
        />
        <KpiCard
          label="Out for Delivery"
          value={counts.out}
          icon={<Truck className="h-4 w-4" />}
          accent="amber"
          onClick={() => setFilter((f) => (f === "out_for_delivery" ? "all" : "out_for_delivery"))}
          active={filter === "out_for_delivery"}
        />
        <KpiCard
          label="Delivered"
          value={counts.done}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="emerald"
          onClick={() => setFilter((f) => (f === "delivered" ? "all" : "delivered"))}
          active={filter === "delivered"}
        />
        <KpiCard
          label="On hold"
          value={counts.failed}
          icon={<Package className="h-4 w-4" />}
          accent="amber"
          onClick={() => setFilter((f) => (f === "failed" ? "all" : "failed"))}
          active={filter === "failed"}
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
        <KanbanSkeleton cols={4} />
      ) : boardColumns.every((c) => c.items.length === 0) ? (
        <EmptyState
          icon={Truck}
          title="No deliveries queued"
          description="Build a run from ready tickets and sales orders."
          action={
            <Button className="btn-brass" onClick={() => setNewDeliveryOpen(true)}>
              Build a run
            </Button>
          }
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          {boardColumns.map((col) => (
            <div
              key={col.key}
              className={cn(
                "min-w-[260px] w-[min(100%,300px)] sm:min-w-0 sm:flex-1 snap-start flex flex-col rounded-2xl border max-h-[70vh]",
                col.tone === "pickup" && "border-[rgba(79,191,142,0.35)] bg-[rgba(79,191,142,0.06)]",
                col.tone === "qc" && "border-[rgba(232,168,92,0.4)] bg-[rgba(232,168,92,0.07)]",
                col.tone === "tasks" && "border-[rgba(217,123,108,0.4)] bg-[rgba(217,123,108,0.07)]",
                col.tone === "shop" && "border-brass/25 bg-black/20",
              )}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-brass/10 bg-forest-deep/90 backdrop-blur rounded-t-2xl">
                <StatusBadge status={col.label} tone={col.tone} />
                <span className="text-[11px] font-mono text-brass-light/80 tabular-nums">
                  {col.items.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {col.items.length === 0 ? (
                  <div className="text-[11px] text-cream-dim/60 px-2 py-6 text-center">Empty</div>
                ) : (
                  col.items.map((d) => {
                    const isOverdue =
                      d.status === "scheduled" &&
                      d.scheduledAt &&
                      new Date(d.scheduledAt) < new Date();
                    const methodRaw = String((d as { method?: string }).method || "");
                    const methodLabel =
                      methodRaw === "Hand Delivery"
                        ? "HAND"
                        : methodRaw === "Ship (FedEx)"
                          ? "FEDEX"
                          : methodRaw === "Pickup"
                            ? "PICKUP"
                            : methodRaw.toUpperCase() || null;
                    return (
                      <GlassCard
                        key={d.id}
                        hover
                        onClick={() => navigate(`/deliveries/${d.id}`)}
                        className={cn(
                          "p-3 transition-transform hover:-translate-y-0.5 cursor-pointer",
                          d.status === "out_for_delivery" && "border-signal-amber/40",
                          d.status === "delivered" && "border-signal-emerald/30",
                          d.status === "failed" && "border-signal-rose/40",
                        )}
                      >
                        <div className="flex items-start justify-between mb-2 gap-2">
                          <div className="min-w-0">
                            <div className="text-cream font-medium truncate text-sm">
                              {d.customer?.name ?? "—"}
                            </div>
                            <div className="text-[10px] text-cream-dim font-mono truncate">
                              {d.deliveryNo ? d.deliveryNo : `#${d.id.slice(-6).toUpperCase()}`}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <StatusBadge
                              status={isOverdue ? "Overdue" : d.status}
                              tone={isOverdue ? "tasks" : col.tone}
                              size="sm"
                            />
                            {methodLabel ? (
                              <span className="text-[9px] uppercase tracking-wider text-brass-light/80">
                                {methodLabel}
                              </span>
                            ) : null}
                            {isOverdue ? (
                              <span className="text-[10px] font-bold text-red-400 uppercase">Overdue</span>
                            ) : null}
                          </div>
                        </div>

                        {d.addressLine ? (
                          <div className="flex items-start gap-1.5 text-[11px] text-cream-muted mb-1.5">
                            <MapPin className="h-3 w-3 text-brass-light/60 mt-0.5 shrink-0" />
                            <span className="leading-snug line-clamp-2">{d.addressLine}</span>
                          </div>
                        ) : null}

                        <div className="flex items-center gap-1.5 text-[11px] text-cream-dim mb-2">
                          <Clock className="h-3 w-3" />
                          <span>{formatDateTime(d.scheduledAt)}</span>
                        </div>

                        {d.driver ? (
                          <div className="text-[10px] text-cream-dim mb-2">
                            Driver · <span className="text-cream-muted">{d.driver.name}</span>
                          </div>
                        ) : null}

                        {d.proofOfDeliveryUrl ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProofTarget(d);
                            }}
                            className="flex items-center gap-1.5 text-[10px] text-signal-emerald mb-2 hover:underline"
                          >
                            <Camera className="h-3 w-3" /> Proof on file
                          </button>
                        ) : null}

                        <div
                          className="flex items-center gap-1.5 pt-2 border-t border-brass/10"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {d.status === "scheduled" ? (
                            <Button
                              size="sm"
                              onClick={() => handleStart(d.id)}
                              disabled={update.isPending}
                              className="btn-brass flex-1 text-[11px] h-7"
                            >
                              <Truck className="h-3 w-3 mr-1" /> Start
                            </Button>
                          ) : null}
                          {d.status === "out_for_delivery" ? (
                            <Button
                              size="sm"
                              onClick={() => setDeliverTarget(d)}
                              disabled={update.isPending}
                              className="btn-brass flex-1 text-[11px] h-7"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Delivered
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/deliveries/${d.id}/label`)}
                            className="border-brass/20 hover:bg-brass/10 text-cream-muted h-7 px-2"
                            title="Print label"
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          {d.customer?.phone ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-brass/20 hover:bg-brass/10 text-cream-muted h-7 px-2"
                              asChild
                            >
                              <a href={`tel:${d.customer.phone}`}>
                                <Phone className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          ) : null}
                        </div>
                      </GlassCard>
                    );
                  })
                )}
              </div>
            </div>
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
