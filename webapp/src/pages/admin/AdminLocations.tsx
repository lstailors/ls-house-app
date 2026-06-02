import { useState } from "react";
import { Building2, MapPin, Plus, Power, Pencil, Phone, Wifi, DollarSign, Settings } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { GlassCard } from "@/components/glass/GlassCard";
import { StatusPill } from "@/components/glass/StatusPill";
import { EmptyState } from "@/components/glass/EmptyState";
import { Button } from "@/components/ui/button";
import { useLocations, useCreateLocation, useUpdateLocation } from "@/lib/queries";
import { toast } from "sonner";
import type { Location } from "@/lib/types";

const INPUT = "w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50";
const LABEL = "ui-label block mb-1";

// ─── Location form fields shape ───────────────────────────────────────────────

interface LocationForm {
  name: string; shortName: string; code: string
  address: string; city: string; state: string; postalCode: string
  phone: string; twilioNumber: string; timezone: string
  erpnextCompanyOrBranch: string; erpnextWarehouse: string
  erpArAccount: string; squareLocationId: string
  defaultDepositPct: string; calComCalendarId: string
}

function emptyForm(loc?: Location): LocationForm {
  const l = loc as any
  return {
    name: l?.name ?? "",
    shortName: l?.shortName ?? "",
    code: l?.code ?? "",
    address: l?.address ?? "",
    city: l?.city ?? "",
    state: l?.state ?? "",
    postalCode: l?.postalCode ?? "",
    phone: l?.phone ?? "",
    twilioNumber: l?.twilioNumber ?? "",
    timezone: l?.timezone ?? "America/New_York",
    erpnextCompanyOrBranch: l?.erpnextCompanyOrBranch ?? "",
    erpnextWarehouse: l?.erpnextWarehouse ?? "",
    erpArAccount: l?.erpArAccount ?? "",
    squareLocationId: l?.squareLocationId ?? "",
    defaultDepositPct: String(l?.defaultDepositPct ?? "50"),
    calComCalendarId: l?.calComCalendarId ?? "",
  }
}

// ─── Shared Form ──────────────────────────────────────────────────────────────

function LocationFormFields({ form, set, isNew }: { form: LocationForm; set: (k: keyof LocationForm, v: string) => void; isNew: boolean }) {
  const f = (k: keyof LocationForm) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value) })
  return (
    <div className="space-y-5">
      {/* Identity */}
      <section>
        <p className="ui-label text-brass-shimmer/70 mb-3 flex items-center gap-1.5"><Building2 className="h-3 w-3" /> Identity</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={LABEL}>Store Name</label>
            <input {...f("name")} className={INPUT} placeholder="New York City" />
          </div>
          <div>
            <label className={LABEL}>Short Name</label>
            <input {...f("shortName")} className={INPUT} placeholder="NYC" maxLength={10} />
          </div>
          {isNew && (
            <div>
              <label className={LABEL}>Location Code</label>
              <input {...f("code")} className={INPUT} placeholder="NYC" maxLength={10} onChange={e => set("code", e.target.value.toUpperCase())} />
            </div>
          )}
          <div className={isNew ? "" : "col-span-2"}>
            <label className={LABEL}>Timezone</label>
            <input {...f("timezone")} className={INPUT} placeholder="America/New_York" />
          </div>
        </div>
      </section>

      {/* Address */}
      <section>
        <p className="ui-label text-brass-shimmer/70 mb-3 flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Address</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={LABEL}>Street Address</label>
            <input {...f("address")} className={INPUT} placeholder="123 Fifth Ave" />
          </div>
          <div>
            <label className={LABEL}>City</label>
            <input {...f("city")} className={INPUT} placeholder="New York" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL}>State</label>
              <input {...f("state")} className={INPUT} placeholder="NY" maxLength={2} />
            </div>
            <div>
              <label className={LABEL}>ZIP</label>
              <input {...f("postalCode")} className={INPUT} placeholder="10001" />
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section>
        <p className="ui-label text-brass-shimmer/70 mb-3 flex items-center gap-1.5"><Phone className="h-3 w-3" /> Contact & Comms</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Store Phone</label>
            <input {...f("phone")} className={INPUT} placeholder="+12125551234" />
          </div>
          <div>
            <label className={LABEL}>Twilio SMS Number</label>
            <input {...f("twilioNumber")} className={INPUT} placeholder="+12125551234" />
          </div>
        </div>
      </section>

      {/* ERPNext */}
      <section>
        <p className="ui-label text-brass-shimmer/70 mb-3 flex items-center gap-1.5"><Settings className="h-3 w-3" /> ERPNext</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className={LABEL}>Company / Branch</label>
            <input {...f("erpnextCompanyOrBranch")} className={INPUT} placeholder="L&S Tailors NY LLC" />
          </div>
          <div>
            <label className={LABEL}>Default Warehouse</label>
            <input {...f("erpnextWarehouse")} className={INPUT} placeholder="Finished Goods - LSTNY" />
          </div>
          <div>
            <label className={LABEL}>A/R Account</label>
            <input {...f("erpArAccount")} className={INPUT} placeholder="1121 - A/R - Bespoke & MTM - LSTNY" />
          </div>
        </div>
      </section>

      {/* Billing */}
      <section>
        <p className="ui-label text-brass-shimmer/70 mb-3 flex items-center gap-1.5"><DollarSign className="h-3 w-3" /> Billing</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Default Deposit %</label>
            <input {...f("defaultDepositPct")} type="number" min="0" max="100" className={INPUT} placeholder="50" />
          </div>
          <div>
            <label className={LABEL}>Square Location ID</label>
            <input {...f("squareLocationId")} className={INPUT} placeholder="LXXXXXX" />
          </div>
          <div className="col-span-2">
            <label className={LABEL}>Cal.com Calendar ID</label>
            <input {...f("calComCalendarId")} className={INPUT} placeholder="cal_..." />
          </div>
        </div>
      </section>
    </div>
  )
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ location, onClose }: { location: Location; onClose: () => void }) {
  const [form, setForm] = useState<LocationForm>(() => emptyForm(location))
  const update = useUpdateLocation(location.id)

  function set(k: keyof LocationForm, v: string) { setForm(f => ({ ...f, [k]: v })) }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await update.mutateAsync({
        name: form.name, shortName: form.shortName,
        address: form.address || null, city: form.city || null,
        state: form.state || null, postalCode: form.postalCode || null,
        phone: form.phone || null, twilioNumber: form.twilioNumber || null,
        timezone: form.timezone || null,
        erpnextCompanyOrBranch: form.erpnextCompanyOrBranch || null,
        erpnextWarehouse: form.erpnextWarehouse || null,
        erpArAccount: form.erpArAccount || null,
        squareLocationId: form.squareLocationId || null,
        defaultDepositPct: Number(form.defaultDepositPct) || 50,
        calComCalendarId: form.calComCalendarId || null,
      } as any)
      toast.success("Location updated.")
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update location.")
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="glass-panel-strong rounded-2xl p-6 w-full max-w-lg my-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="display-heading text-xl text-cream">Edit — {location.name}</h2>
          <span className="font-mono text-xs text-brass-shimmer border border-brass/30 px-2 py-0.5 rounded">{location.id}</span>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <LocationFormFields form={form} set={set} isNew={false} />
          <div className="flex gap-2 pt-2 border-t border-brass/10">
            <Button type="submit" className="btn-brass" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save Changes"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="border-brass/20 text-cream-muted">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── New Location Modal ───────────────────────────────────────────────────────

function NewLocationModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<LocationForm>(() => emptyForm())
  const create = useCreateLocation()

  function set(k: keyof LocationForm, v: string) { setForm(f => ({ ...f, [k]: v })) }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.code) { toast.error("Name and code are required."); return }
    try {
      await create.mutateAsync({
        code: form.code, name: form.name,
        address: form.address || undefined,
        erpnextCompany: form.erpnextCompanyOrBranch || undefined,
      })
      toast.success("Location created.")
      onClose()
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create location.")
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="glass-panel-strong rounded-2xl p-6 w-full max-w-lg my-8">
        <h2 className="display-heading text-xl text-cream mb-5">New Location</h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <LocationFormFields form={form} set={set} isNew={true} />
          <div className="flex gap-2 pt-2 border-t border-brass/10">
            <Button type="submit" className="btn-brass" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="border-brass/20 text-cream-muted">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Location Card ────────────────────────────────────────────────────────────

function LocationCard({ location, onEdit }: { location: Location; onEdit: () => void }) {
  const update = useUpdateLocation(location.id)
  const l = location as any

  const handleToggle = async () => {
    try {
      await update.mutateAsync({ isActive: !location.isActive } as any)
      toast.success(location.isActive ? "Location closed." : "Location opened.")
    } catch { toast.error("Failed to update location.") }
  }

  return (
    <GlassCard variant="strong" className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full border border-brass/30 bg-brass/10 flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5 text-brass-light" />
          </div>
          <div>
            <p className="text-cream font-semibold text-base leading-tight">{location.name}</p>
            <p className="font-mono text-xs text-brass-shimmer">{location.id}</p>
          </div>
        </div>
        <StatusPill status={location.isActive ? "active" : "inactive"} variant={location.isActive ? "emerald" : "muted"} label={location.isActive ? "Open" : "Closed"} />
      </div>

      {/* Address */}
      {(l.address || l.city) && (
        <div className="flex items-start gap-1.5 text-xs text-cream-muted">
          <MapPin className="h-3 w-3 text-brass/50 mt-0.5 shrink-0" />
          <span>{[l.address, l.city, l.state, l.postalCode].filter(Boolean).join(", ")}</span>
        </div>
      )}

      {/* Key settings grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs border-t border-brass/10 pt-3">
        {[
          ["ERPNext", l.erpnextCompanyOrBranch],
          ["Warehouse", l.erpnextWarehouse],
          ["Phone", l.phone],
          ["SMS Number", l.twilioNumber],
          ["Deposit %", l.defaultDepositPct ? `${l.defaultDepositPct}%` : null],
          ["Timezone", l.timezone],
        ].filter(([, v]) => v).map(([label, value]) => (
          <div key={label as string}>
            <p className="ui-label text-[8px] mb-0.5">{label}</p>
            <p className="text-cream-muted font-mono text-[11px] truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-brass/10 pt-3">
        <Button variant="outline" size="sm" onClick={onEdit} className="border-brass/20 hover:bg-brass/10 text-cream-muted flex-1 flex items-center gap-1.5">
          <Pencil className="h-3 w-3" /> Edit Settings
        </Button>
        <Button variant="outline" size="sm" onClick={handleToggle} disabled={update.isPending} className="border-brass/20 hover:bg-brass/10 text-cream-muted px-3" title={location.isActive ? "Close location" : "Open location"}>
          <Power className="h-3.5 w-3.5" />
        </Button>
      </div>
    </GlassCard>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminLocations() {
  const { data: locations = [], isLoading } = useLocations()
  const [showNew, setShowNew] = useState(false)
  const [editLocation, setEditLocation] = useState<Location | null>(null)

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Admin · Locations"
        title={<>The <span className="text-brass-shimmer">storefronts</span>.</>}
        description="Each location runs independently — separate books, ERPNext company, SMS number, and deposit rules."
        actions={
          <Button className="btn-brass" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> New location
          </Button>
        }
      />

      {isLoading ? (
        <div className="text-cream-muted text-sm">Loading…</div>
      ) : locations.length === 0 ? (
        <EmptyState icon={Building2} title="No locations yet" description="Add the first storefront." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {locations.map(l => (
            <LocationCard key={l.id} location={l} onEdit={() => setEditLocation(l)} />
          ))}
        </div>
      )}

      {showNew && <NewLocationModal onClose={() => setShowNew(false)} />}
      {editLocation && <EditModal location={editLocation} onClose={() => setEditLocation(null)} />}
    </div>
  )
}
