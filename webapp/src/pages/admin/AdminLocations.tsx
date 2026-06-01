import { Building2, MapPin, Plus, Power } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { useLocations } from "@/lib/queries";
import { formatDate } from "@/lib/format";

export default function AdminLocations() {
  const { data: locations = [], isLoading } = useLocations();

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Admin · Locations"
        title={
          <>
            The <span className="text-brass-shimmer">storefronts</span>.
          </>
        }
        description="Each address where a gentleman can walk in and be measured."
        actions={
          <Button className="btn-brass">
            <Plus className="h-4 w-4 mr-1.5" /> New location
          </Button>
        }
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : locations.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No locations yet"
          description="Add the first storefront to start booking commissions."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {locations.map((l) => (
            <GlassCard key={l.id} variant="strong" hover className="p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="h-11 w-11 rounded-full border border-brass/30 bg-brass/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-brass-light" />
                </div>
                <StatusPill
                  status={l.isActive ? "active" : "inactive"}
                  variant={l.isActive ? "emerald" : "muted"}
                  label={l.isActive ? "Open" : "Closed"}
                />
              </div>
              <div className="ui-label text-[10px] mb-1">Storefront</div>
              <div className="display-heading text-2xl text-cream mb-2 leading-tight">
                {l.name}
              </div>
              {l.address ? (
                <div className="flex items-start gap-1.5 text-xs text-cream-muted mb-3">
                  <MapPin className="h-3 w-3 text-brass-light/60 mt-0.5 shrink-0" />
                  <span className="leading-snug">{l.address}</span>
                </div>
              ) : null}

              <div className="brass-divider my-4" />

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="ui-label text-[9px] mb-0.5">ERPNext</div>
                  <div className="text-cream-muted font-mono text-[11px] truncate">
                    {l.erpnextCompanyOrBranch ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="ui-label text-[9px] mb-0.5">Opened</div>
                  <div className="text-cream-muted">{formatDate(l.createdAt)}</div>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-brass/20 hover:bg-brass/10 text-cream-muted flex-1"
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-brass/20 hover:bg-brass/10 text-cream-muted"
                >
                  <Power className="h-3.5 w-3.5" />
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
