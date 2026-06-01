import { useState } from "react";
import { Building2, MapPin, Plus, Power } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { useLocations, useCreateLocation, useUpdateLocation } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import type { Location } from "@/lib/types";

const INPUT_CLS =
  "w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50";

// ─── New Location Modal ───────────────────────────────────────────────────────

function NewLocationModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [erpnextCompany, setErpnextCompany] = useState("");

  const createLocation = useCreateLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !code) {
      toast.error("Name and code are required.");
      return;
    }
    try {
      await createLocation.mutateAsync({
        name,
        code: code.toUpperCase(),
        address: address || undefined,
        erpnextCompany: erpnextCompany || undefined,
      });
      toast.success("Location created.");
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create location.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-panel-strong rounded-2xl p-6 w-full max-w-md">
        <h2 className="display-heading text-xl text-cream mb-4">New Location</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="ui-label block mb-1.5">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT_CLS}
              placeholder="New York City"
            />
          </div>
          <div>
            <label className="ui-label block mb-1.5">Code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className={INPUT_CLS}
              placeholder="NYC"
              maxLength={10}
            />
          </div>
          <div>
            <label className="ui-label block mb-1.5">Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={INPUT_CLS}
              placeholder="123 Fifth Ave, New York, NY 10001"
            />
          </div>
          <div>
            <label className="ui-label block mb-1.5">ERPNext Company</label>
            <input
              value={erpnextCompany}
              onChange={(e) => setErpnextCompany(e.target.value)}
              className={INPUT_CLS}
              placeholder="L&S NYC LLC"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="btn-brass" disabled={createLocation.isPending}>
              {createLocation.isPending ? "Creating…" : "Create"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="border-brass/20 text-cream-muted">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Toggle Active Button ─────────────────────────────────────────────────────

function ToggleActiveButton({ location }: { location: Location }) {
  const updateLocation = useUpdateLocation(location.id);

  const handleToggle = async () => {
    try {
      await updateLocation.mutateAsync({ isActive: !location.isActive });
      toast.success(location.isActive ? "Location closed." : "Location opened.");
    } catch {
      toast.error("Failed to update location.");
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleToggle}
      disabled={updateLocation.isPending}
      className="border-brass/20 hover:bg-brass/10 text-cream-muted"
    >
      <Power className="h-3.5 w-3.5" />
    </Button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminLocations() {
  const { data: locations = [], isLoading } = useLocations();
  const [showNewModal, setShowNewModal] = useState(false);

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
          <Button className="btn-brass" onClick={() => setShowNewModal(true)}>
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
                <ToggleActiveButton location={l} />
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {showNewModal && <NewLocationModal onClose={() => setShowNewModal(false)} />}
    </div>
  );
}
