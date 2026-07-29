import { useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft, Building2, MapPin, Phone, Settings, DollarSign,
  RefreshCw, CheckCircle2, AlertCircle, Wifi, Calendar
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@ls/api-client"
import { GlassCard } from "@ls/design"
import { Button } from "@ls/design/ui/button"
import { cn } from "@ls/design/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

interface LocationSettings {
  code: string
  name: string
  shortName: string | null
  address: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  phone: string | null
  twilioNumber: string | null
  timezone: string | null
  isActive: boolean
  sortOrder: number
  defaultDepositPct: number
  squareLocationId: string | null
  calComCalendarId: string | null
  erpnextCompany: string | null
  erpnextWarehouse: string | null
  erpArAccount: string | null
  erp: {
    abbr: string
    defaultCurrency: string
    country: string
    taxId: string | null
    email: string | null
    website: string | null
    phoneNo: string | null
    defaultBankAccount: string | null
    defaultCashAccount: string | null
    defaultReceivableAccount: string | null
    defaultIncomeAccount: string | null
    defaultExpenseAccount: string | null
    costCenter: string | null
    monthlyTarget: number
    totalMonthlySales: number
    parentCompany: string | null
  } | null
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const INPUT = "w-full text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream placeholder:text-cream-dim/40 focus:outline-none focus:border-brass/50"
const READONLY = "w-full text-sm bg-forest-raised/30 border border-brass/10 rounded-xl px-3 py-2.5 text-cream-dim cursor-not-allowed"
const LABEL = "ui-label block mb-1.5"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {children}
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "identity", label: "Identity", icon: Building2 },
  { id: "address",  label: "Address",  icon: MapPin },
  { id: "comms",    label: "Comms",    icon: Phone },
  { id: "erp",      label: "ERPNext",  icon: Settings },
  { id: "billing",  label: "Billing",  icon: DollarSign },
] as const

type TabId = (typeof TABS)[number]["id"]

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LocationSettings() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabId>("identity")

  const { data: settings, isLoading, error } = useQuery<LocationSettings>({
    queryKey: ["location-settings", code],
    queryFn: () => api.get(`/api/locations/${code}/settings`),
    enabled: !!code,
  })

  const save = useMutation({
    mutationFn: (payload: any) => api.put(`/api/locations/${code}/settings`, payload),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["location-settings", code] })
      qc.invalidateQueries({ queryKey: ["locations"] })
      toast.success(data?.erpSynced ? "Saved & synced to ERPNext ✓" : "Saved (ERPNext sync skipped)")
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-cream-muted text-sm">
        Loading location…
      </div>
    )
  }

  if (error || !settings) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-cream-muted text-sm">Could not load location settings.</p>
        <Button variant="outline" onClick={() => navigate("/admin/locations")} className="border-brass/20 text-cream-muted">
          Back to Locations
        </Button>
      </div>
    )
  }

  const erpOnline = settings.erp !== null

  return (
    <div className="space-y-6 animate-fade-up max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/admin/locations")}
          className="text-cream-muted hover:text-cream hover:bg-brass/10 rounded-xl"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="display-heading text-2xl text-cream">{settings.name}</h1>
            <span className="font-mono text-xs text-brass-shimmer border border-brass/30 bg-brass/5 px-2 py-0.5 rounded">
              {settings.code}
            </span>
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              settings.isActive
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-cream-dim/10 text-cream-muted border border-cream-dim/20"
            )}>
              {settings.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="text-cream-muted text-xs mt-0.5">Location Settings</p>
        </div>
        {/* ERP status */}
        <div className={cn(
          "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border",
          erpOnline
            ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
            : "text-amber-400 border-amber-500/20 bg-amber-500/5"
        )}>
          <Wifi className="h-3 w-3" />
          {erpOnline ? "ERP Connected" : "ERP Offline"}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-forest-raised/40 border border-brass/10 rounded-2xl overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap",
                activeTab === tab.id
                  ? "bg-brass/20 text-brass-light border border-brass/30"
                  : "text-cream-muted hover:text-cream hover:bg-forest-raised/60"
              )}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <GlassCard variant="strong" className="p-6">
        {activeTab === "identity" && (
          <IdentityTab settings={settings} onSave={save.mutate} saving={save.isPending} />
        )}
        {activeTab === "address" && (
          <AddressTab settings={settings} onSave={save.mutate} saving={save.isPending} />
        )}
        {activeTab === "comms" && (
          <CommsTab settings={settings} onSave={save.mutate} saving={save.isPending} />
        )}
        {activeTab === "erp" && (
          <ErpTab settings={settings} onSave={save.mutate} saving={save.isPending} erpOnline={erpOnline} />
        )}
        {activeTab === "billing" && (
          <BillingTab settings={settings} onSave={save.mutate} saving={save.isPending} />
        )}
      </GlassCard>
    </div>
  )
}

// ─── Identity Tab ─────────────────────────────────────────────────────────────

function IdentityTab({ settings, onSave, saving }: { settings: LocationSettings; onSave: (p: any) => void; saving: boolean }) {
  const [name, setName] = useState(settings.name)
  const [shortName, setShortName] = useState(settings.shortName ?? "")
  const [timezone, setTimezone] = useState(settings.timezone ?? "")
  const [isActive, setIsActive] = useState(settings.isActive)
  const [sortOrder, setSortOrder] = useState(String(settings.sortOrder))

  return (
    <div className="space-y-5">
      <TabHeading icon={Building2} title="Identity" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Field label="Store Name">
            <input value={name} onChange={e => setName(e.target.value)} className={INPUT} placeholder="New York City" />
          </Field>
        </div>
        <Field label="Short Name">
          <input value={shortName} onChange={e => setShortName(e.target.value)} className={INPUT} placeholder="NYC" maxLength={10} />
        </Field>
        <Field label="Sort Order">
          <input value={sortOrder} onChange={e => setSortOrder(e.target.value)} type="number" className={INPUT} placeholder="0" />
        </Field>
        <Field label="Timezone">
          <input value={timezone} onChange={e => setTimezone(e.target.value)} className={INPUT} placeholder="America/New_York" />
        </Field>
        <Field label="Active Status">
          <button
            type="button"
            onClick={() => setIsActive(v => !v)}
            className={cn(
              "w-full text-sm rounded-xl px-3 py-2.5 text-left border transition-colors",
              isActive
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-forest-raised/50 border-brass/20 text-cream-muted"
            )}
          >
            {isActive ? "Active — Location is open" : "Inactive — Location is closed"}
          </button>
        </Field>
      </div>
      <SaveBar onSave={() => onSave({ name, shortName: shortName || null, timezone: timezone || null, isActive, sortOrder: Number(sortOrder) })} saving={saving} />
    </div>
  )
}

// ─── Address Tab ──────────────────────────────────────────────────────────────

function AddressTab({ settings, onSave, saving }: { settings: LocationSettings; onSave: (p: any) => void; saving: boolean }) {
  const [address, setAddress] = useState(settings.address ?? "")
  const [city, setCity] = useState(settings.city ?? "")
  const [state, setState] = useState(settings.state ?? "")
  const [postalCode, setPostalCode] = useState(settings.postalCode ?? "")

  return (
    <div className="space-y-5">
      <TabHeading icon={MapPin} title="Address" note="Changes sync to ERPNext company" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Field label="Street Address">
            <input value={address} onChange={e => setAddress(e.target.value)} className={INPUT} placeholder="123 Fifth Ave" />
          </Field>
        </div>
        <Field label="City">
          <input value={city} onChange={e => setCity(e.target.value)} className={INPUT} placeholder="New York" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State">
            <input value={state} onChange={e => setState(e.target.value)} className={INPUT} placeholder="NY" maxLength={2} />
          </Field>
          <Field label="ZIP">
            <input value={postalCode} onChange={e => setPostalCode(e.target.value)} className={INPUT} placeholder="10001" />
          </Field>
        </div>
      </div>
      <SaveBar onSave={() => onSave({ address: address || null, city: city || null, state: state || null, postalCode: postalCode || null })} saving={saving} />
    </div>
  )
}

// ─── Comms Tab ────────────────────────────────────────────────────────────────

function CommsTab({ settings, onSave, saving }: { settings: LocationSettings; onSave: (p: any) => void; saving: boolean }) {
  const [phone, setPhone] = useState(settings.phone ?? "")
  const [twilioNumber, setTwilioNumber] = useState(settings.twilioNumber ?? "")
  const [email, setEmail] = useState(settings.erp?.email ?? "")
  const [website, setWebsite] = useState(settings.erp?.website ?? "")

  return (
    <div className="space-y-5">
      <TabHeading icon={Phone} title="Communications" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Store Phone (syncs to ERPNext)">
          <input value={phone} onChange={e => setPhone(e.target.value)} className={INPUT} placeholder="+12125551234" />
        </Field>
        <Field label="Twilio SMS Number">
          <input value={twilioNumber} onChange={e => setTwilioNumber(e.target.value)} className={INPUT} placeholder="+12125551234" />
        </Field>
        <Field label="ERPNext Email">
          <input value={email} onChange={e => setEmail(e.target.value)} className={INPUT} placeholder="nyc@lstailors.com" />
        </Field>
        <Field label="ERPNext Website">
          <input value={website} onChange={e => setWebsite(e.target.value)} className={INPUT} placeholder="https://lstailors.com" />
        </Field>
      </div>
      <SaveBar
        onSave={() => onSave({
          phone: phone || null,
          twilioNumber: twilioNumber || null,
          erp: { email: email || null, website: website || null },
        })}
        saving={saving}
      />
    </div>
  )
}

// ─── ERP Tab ──────────────────────────────────────────────────────────────────

function ErpTab({ settings, onSave, saving, erpOnline }: { settings: LocationSettings; onSave: (p: any) => void; saving: boolean; erpOnline: boolean }) {
  const e = settings.erp
  const [taxId, setTaxId] = useState(e?.taxId ?? "")
  const [defaultBankAccount, setDefaultBankAccount] = useState(e?.defaultBankAccount ?? "")
  const [defaultIncomeAccount, setDefaultIncomeAccount] = useState(e?.defaultIncomeAccount ?? "")
  const [costCenter, setCostCenter] = useState(e?.costCenter ?? "")
  const [erpnextWarehouse, setErpnextWarehouse] = useState(settings.erpnextWarehouse ?? "")
  const [monthlyTarget, setMonthlyTarget] = useState(String(e?.monthlyTarget ?? 0))

  const dot = erpOnline
    ? <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1" />
    : <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />

  return (
    <div className="space-y-5">
      <TabHeading icon={Settings} title="ERPNext" note={erpOnline ? "Live data loaded" : "ERP unreachable — showing last known values"} />

      {/* Read-only display */}
      <div className="space-y-3">
        <p className="ui-label text-brass-shimmer/70 text-[10px] uppercase tracking-widest">Company Info (read-only)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company Name">
            <div className="relative">
              {dot}
              <input readOnly value={settings.erpnextCompany ?? "—"} className={READONLY} />
            </div>
          </Field>
          <Field label="Abbreviation">
            <input readOnly value={e?.abbr ?? "—"} className={READONLY} />
          </Field>
          <Field label="Currency">
            <input readOnly value={e?.defaultCurrency ?? "—"} className={READONLY} />
          </Field>
          <Field label="Country">
            <input readOnly value={e?.country ?? "—"} className={READONLY} />
          </Field>
          {e?.parentCompany ? (
            <Field label="Parent Company">
              <input readOnly value={e.parentCompany} className={READONLY} />
            </Field>
          ) : null}
        </div>
      </div>

      {/* Editable ERP fields */}
      <div className="space-y-3 border-t border-brass/10 pt-4">
        <p className="ui-label text-brass-shimmer/70 text-[10px] uppercase tracking-widest">Editable — syncs back to ERPNext</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Tax ID">
            <input value={taxId} onChange={e => setTaxId(e.target.value)} className={INPUT} placeholder="EIN / Tax ID" />
          </Field>
          <Field label="Monthly Sales Target">
            <input value={monthlyTarget} onChange={e => setMonthlyTarget(e.target.value)} type="number" className={INPUT} placeholder="0" />
          </Field>
          <Field label="Default Bank Account">
            <input value={defaultBankAccount} onChange={e => setDefaultBankAccount(e.target.value)} className={INPUT} placeholder="10001 - Cash - …" />
          </Field>
          <Field label="Default Income Account">
            <input value={defaultIncomeAccount} onChange={e => setDefaultIncomeAccount(e.target.value)} className={INPUT} placeholder="4000 - Revenue - …" />
          </Field>
          <Field label="Cost Center">
            <input value={costCenter} onChange={e => setCostCenter(e.target.value)} className={INPUT} placeholder="Main - …" />
          </Field>
          <Field label="Default Warehouse">
            <input value={erpnextWarehouse} onChange={e => setErpnextWarehouse(e.target.value)} className={INPUT} placeholder="Finished Goods - …" />
          </Field>
        </div>
      </div>

      <SaveBar
        onSave={() => onSave({
          erpnextWarehouse: erpnextWarehouse || null,
          erp: {
            taxId: taxId || null,
            monthlyTarget: Number(monthlyTarget),
            defaultBankAccount: defaultBankAccount || null,
            defaultIncomeAccount: defaultIncomeAccount || null,
            costCenter: costCenter || null,
          },
        })}
        saving={saving}
      />
    </div>
  )
}

// ─── Billing Tab ──────────────────────────────────────────────────────────────

function BillingTab({ settings, onSave, saving }: { settings: LocationSettings; onSave: (p: any) => void; saving: boolean }) {
  const [defaultDepositPct, setDefaultDepositPct] = useState(String(settings.defaultDepositPct))
  const [squareLocationId, setSquareLocationId] = useState(settings.squareLocationId ?? "")
  const [erpArAccount, setErpArAccount] = useState(settings.erpArAccount ?? "")
  const [calComCalendarId, setCalComCalendarId] = useState(settings.calComCalendarId ?? "")

  return (
    <div className="space-y-5">
      <TabHeading icon={DollarSign} title="Billing & Integrations" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Default Deposit %">
          <input value={defaultDepositPct} onChange={e => setDefaultDepositPct(e.target.value)} type="number" min="0" max="100" className={INPUT} placeholder="50" />
        </Field>
        <Field label="Square Location ID">
          <input value={squareLocationId} onChange={e => setSquareLocationId(e.target.value)} className={INPUT} placeholder="LXXXXXXXXXXXXXXXX" />
        </Field>
        <Field label="A/R Account (ERPNext)">
          <input value={erpArAccount} onChange={e => setErpArAccount(e.target.value)} className={INPUT} placeholder="1121 - A/R - …" />
        </Field>
        <Field label="Cal.com Calendar ID">
          <input value={calComCalendarId} onChange={e => setCalComCalendarId(e.target.value)} className={INPUT} placeholder="cal_…" />
        </Field>
      </div>
      <SaveBar
        onSave={() => onSave({
          defaultDepositPct: Number(defaultDepositPct),
          squareLocationId: squareLocationId || null,
          erpArAccount: erpArAccount || null,
          calComCalendarId: calComCalendarId || null,
        })}
        saving={saving}
      />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TabHeading({ icon: Icon, title, note }: { icon: React.ElementType; title: string; note?: string }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-brass/10">
      <Icon className="h-4 w-4 text-brass-light" />
      <span className="display-heading text-base text-cream">{title}</span>
      {note ? <span className="text-xs text-cream-muted ml-2">— {note}</span> : null}
    </div>
  )
}

function SaveBar({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  return (
    <div className="flex justify-end pt-2 border-t border-brass/10">
      <Button
        onClick={onSave}
        disabled={saving}
        className="btn-brass min-w-[120px]"
      >
        {saving ? (
          <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving…</>
        ) : (
          <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Save Changes</>
        )}
      </Button>
    </div>
  )
}
