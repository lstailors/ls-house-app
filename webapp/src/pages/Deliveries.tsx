import { useMemo, useState } from "react";
import { Truck, MapPin, Clock, CheckCircle2, Phone, Camera, QrCode, Plus, Printer, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
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
import { useDeliveries, useUpdateDelivery } from "@/lib/queries";
import { DispatchMap } from "@/components/maps/DispatchMap";
import { useNavigate } from "react-router-dom";
import { useMe } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Scheduled" },
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

  const navigate = useNavigate();
  const isDriver = me?.role === "driver";

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return deliveries.filter((d) => {
      if (filter !== "all" && d.status !== filter) return false;
      if (!s) return true;
      return (
        (d.customer?.name ?? "").toLowerCase().includes(s) ||
        (d.addressLine ?? "").toLowerCase().includes(s)
      );
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
          <Button
            onClick={() => setNewDeliveryOpen(true)}
            className="bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e] font-medium h-9 text-sm"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New Delivery
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <KpiCard label="Scheduled" value={counts.scheduled} icon={<Clock className="h-4 w-4" />} />
        <KpiCard
          label="Out for Delivery"
          value={counts.out}
          icon={<Truck className="h-4 w-4" />}
          accent="amber"
        />
        <KpiCard
          label="Delivered"
          value={counts.done}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="emerald"
        />
      </div>

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
                <StatusPill status={d.status} />
              </div>

              {d.addressLine ? (
                <div className="flex items-start gap-1.5 text-xs text-cream-muted mb-2">
                  <MapPin className="h-3 w-3 text-brass-light/60 mt-0.5 shrink-0" />
                  <span className="leading-snug">{d.addressLine}</span>
                </div>
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
