import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus, X, Check, ChevronDown, Printer, Tag, RefreshCw,
  AlertCircle, Loader2, ShoppingBag, Zap, CreditCard,
  Banknote, ClipboardList, Search, User, Phone, Mail, MapPin,
  Camera
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMe } from '@/lib/session'
import { CustomerEditSheet } from '@/components/pos/CustomerEditSheet'
import { SaveCartControls } from '@/components/alterations/SaveCartControls'
import type { ParkedCart, CartPayload } from '@/lib/cart/parked'
import type { CustomerInput } from '@/lib/erpnext/customer'

// ─── Formatters ──────────────────────────────────────────────────────────────
const formatUSD = (n: number) => '$' + n.toFixed(2)

// ─── Types ────────────────────────────────────────────────────────────────────
type AlterationLine = {
  preset: string
  description: string
  price: number
  estMinutes: number | null
}

type GarmentItem = {
  id: string
  ref: string
  garmentType: string
  description: string
  color: string
  notes: string
  lines: AlterationLine[]
  fabric: string
  condition: string
  fitAreas: string[]
  complexity: string
  photos: string[]
}

type Customer = { id?: string; name: string; phone: string; email: string } | null

type PaymentMethod = 'pay_now' | 'deposit' | 'on_account'

type Preset = {
  id: string
  preset_name: string
  garment_types: string[]
  price: number
  est_minutes: number | null
}

// ─── SVG Components ───────────────────────────────────────────────────────────
const GarmentSVGs: Record<string, JSX.Element> = {
  Jacket: (
    <svg viewBox="0 0 60 80" stroke="currentColor" strokeWidth={1.5} fill="none" className="w-full h-full">
      <path d="M20 5 L10 20 L5 22 L5 70 L20 70 L20 50 L40 50 L40 70 L55 70 L55 22 L50 20 L40 5" />
      <path d="M20 5 L25 12 L30 8 L35 12 L40 5" />
      <path d="M5 22 L15 25 L20 50" />
      <path d="M55 22 L45 25 L40 50" />
      <path d="M25 12 L25 50" strokeDasharray="2 2" />
    </svg>
  ),
  Trouser: (
    <svg viewBox="0 0 60 80" stroke="currentColor" strokeWidth={1.5} fill="none" className="w-full h-full">
      <path d="M10 5 L8 5 L5 35 L5 75 L25 75 L30 45 L35 75 L55 75 L55 35 L52 5 L10 5" />
      <path d="M10 5 L50 5" />
      <path d="M8 15 L52 15" />
      <path d="M15 35 L30 45 L45 35" />
    </svg>
  ),
  Shirt: (
    <svg viewBox="0 0 60 80" stroke="currentColor" strokeWidth={1.5} fill="none" className="w-full h-full">
      <path d="M22 5 L10 15 L5 13 L5 35 L15 35 L15 75 L45 75 L45 35 L55 35 L55 13 L50 15 L38 5" />
      <path d="M22 5 Q25 10 30 8 Q35 10 38 5" />
      <path d="M30 8 L30 75" strokeDasharray="2 2" />
      <path d="M5 22 L15 25" />
      <path d="M55 22 L45 25" />
      <circle cx="30" cy="25" r="1" fill="currentColor" />
      <circle cx="30" cy="35" r="1" fill="currentColor" />
      <circle cx="30" cy="45" r="1" fill="currentColor" />
    </svg>
  ),
  Dress: (
    <svg viewBox="0 0 60 80" stroke="currentColor" strokeWidth={1.5} fill="none" className="w-full h-full">
      <path d="M25 3 Q30 1 35 3 L38 8 L45 12 L42 25 L38 28 L38 40 Q42 55 48 78 L12 78 Q18 55 22 40 L22 28 L18 25 L15 12 L22 8 Z" />
      <path d="M22 28 Q30 32 38 28" />
      <path d="M25 3 Q30 6 35 3" />
    </svg>
  ),
  Coat: (
    <svg viewBox="0 0 60 80" stroke="currentColor" strokeWidth={1.5} fill="none" className="w-full h-full">
      <path d="M18 3 L8 18 L3 20 L3 78 L20 78 L20 55 L40 55 L40 78 L57 78 L57 20 L52 18 L42 3" />
      <path d="M18 3 L23 11 L30 7 L37 11 L42 3" />
      <path d="M3 20 L13 24 L20 55" />
      <path d="M57 20 L47 24 L40 55" />
      <path d="M23 11 L23 55" strokeDasharray="3 3" />
      <path d="M10 40 L18 40" />
    </svg>
  ),
  'Suit (2pc)': (
    <svg viewBox="0 0 60 80" stroke="currentColor" strokeWidth={1.5} fill="none" className="w-full h-full">
      <path d="M20 5 L10 18 L5 20 L5 48 L20 48 L20 38 L40 38 L40 48 L55 48 L55 20 L50 18 L40 5" />
      <path d="M20 5 L25 11 L30 8 L35 11 L40 5" />
      <path d="M5 20 L15 23 L20 38" />
      <path d="M55 20 L45 23 L40 38" />
      <path d="M12 52 L10 52 L8 80 L25 80 L28 62 L32 62 L35 80 L52 80 L50 52 L48 52 L12 52" />
    </svg>
  ),
  'Suit (3pc)': (
    <svg viewBox="0 0 60 80" stroke="currentColor" strokeWidth={1.5} fill="none" className="w-full h-full">
      <path d="M20 3 L10 16 L5 18 L5 44 L20 44 L20 34 L40 34 L40 44 L55 44 L55 18 L50 16 L40 3" />
      <path d="M20 3 L25 9 L30 6 L35 9 L40 3" />
      <path d="M22 9 L22 20 L38 20 L38 9" />
      <path d="M5 18 L15 21 L20 34" />
      <path d="M55 18 L45 21 L40 34" />
      <path d="M12 48 L10 48 L8 76 L24 76 L27 60 L33 60 L36 76 L52 76 L50 48 L12 48" />
    </svg>
  ),
  Vest: (
    <svg viewBox="0 0 60 80" stroke="currentColor" strokeWidth={1.5} fill="none" className="w-full h-full">
      <path d="M20 5 L12 15 L8 70 L25 70 L28 40 L32 40 L35 70 L52 70 L48 15 L40 5" />
      <path d="M20 5 L25 12 L30 8 L35 12 L40 5" />
      <path d="M12 15 L20 18" />
      <path d="M48 15 L40 18" />
      <circle cx="30" cy="25" r="1" fill="currentColor" />
      <circle cx="30" cy="33" r="1" fill="currentColor" />
      <circle cx="30" cy="41" r="1" fill="currentColor" />
    </svg>
  ),
  Skirt: (
    <svg viewBox="0 0 60 80" stroke="currentColor" strokeWidth={1.5} fill="none" className="w-full h-full">
      <path d="M15 8 L45 8 L45 22 L15 22 Z" />
      <path d="M15 22 Q8 50 5 78 L55 78 Q52 50 45 22" />
      <path d="M15 8 L15 22" />
      <path d="M45 8 L45 22" />
      <path d="M18 8 L18 22" strokeDasharray="2 2" />
      <path d="M30 8 L30 78" strokeDasharray="3 3" />
    </svg>
  ),
  Other: (
    <svg viewBox="0 0 60 80" stroke="currentColor" strokeWidth={1.5} fill="none" className="w-full h-full">
      <rect x="10" y="10" width="40" height="60" rx="4" />
      <path d="M20 30 L40 30" />
      <path d="M20 40 L40 40" />
      <path d="M20 50 L32 50" />
      <circle cx="30" cy="15" r="5" />
    </svg>
  ),
}

// ─── Garment Definitions ──────────────────────────────────────────────────────
const GARMENTS = [
  { type: 'Jacket', label: 'Jacket' },
  { type: 'Trouser', label: 'Trouser' },
  { type: 'Shirt', label: 'Shirt' },
  { type: 'Dress', label: 'Dress' },
  { type: 'Coat', label: 'Coat' },
  { type: 'Suit (2pc)', label: 'Suit 2pc' },
  { type: 'Suit (3pc)', label: 'Suit 3pc' },
  { type: 'Vest', label: 'Vest' },
  { type: 'Skirt', label: 'Skirt' },
  { type: 'Other', label: 'Other' },
]

// Alterations are tax-exempt (services, not goods)

// ─── Utility ──────────────────────────────────────────────────────────────────
const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

// ─── Customer Search ──────────────────────────────────────────────────────────
type CustomerResult = { id: string; name: string; phone: string; email: string; address?: string }

function CustomerSearch({
  customer,
  onSelect,
  onClear,
}: {
  customer: Customer
  onSelect: (c: Customer) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerResult[]>([])
  const [loading, setLoading] = useState(false)
  const [editOpen, setEditOpen] = useState(false) // must be at top level, not inside if(customer)
  const [open, setOpen] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [manual, setManual] = useState({ name: '', phone: '', email: '' })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 2) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await api.get<CustomerResult[]>(`/api/intake-alterations/customers/search?q=${encodeURIComponent(query)}`)
        setResults(Array.isArray(res) ? res : [])
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [query])

  if (customer) {
    return (
      <>
        <div className="glass-panel p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-brass/20 border border-brass/30 flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-brass-shimmer" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-cream font-medium truncate">{customer.name}</p>
            <p className="text-cream-muted text-xs">{customer.phone}</p>
            {customer.email && <p className="text-cream-dim text-xs truncate">{customer.email}</p>}
          </div>
          <button
            onClick={() => setEditOpen(true)}
            className="text-brass-light hover:text-brass transition-colors p-1 text-[10px] font-sans uppercase tracking-wider"
            title="Edit customer details"
          >
            Edit
          </button>
          <button
            onClick={onClear}
            className="text-cream-dim hover:text-cream transition-colors p-1"
            title="Change customer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {editOpen && customer.id && (
          <CustomerEditSheet
            customerId={customer.id}
            customerName={customer.name}
            onClose={() => setEditOpen(false)}
          />
        )}
      </>
    )
  }

  if (manualMode) {
    return (
      <div className="glass-panel p-4 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <span className="ui-label text-brass-shimmer">New Customer</span>
          <button
            onClick={() => setManualMode(false)}
            className="text-cream-dim hover:text-cream text-xs"
          >
            Search instead
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="ui-label text-cream-muted mb-1 block">Name *</label>
            <input
              className="w-full bg-forest-deep border border-brass/20 rounded px-3 py-2 text-cream text-sm focus:border-brass/50 focus:outline-none"
              placeholder="Full name"
              value={manual.name}
              onChange={e => setManual(m => ({ ...m, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="ui-label text-cream-muted mb-1 block">Phone</label>
            <input
              className="w-full bg-forest-deep border border-brass/20 rounded px-3 py-2 text-cream text-sm focus:border-brass/50 focus:outline-none"
              placeholder="+1..."
              value={manual.phone}
              onChange={e => setManual(m => ({ ...m, phone: e.target.value }))}
            />
          </div>
          <div>
            <label className="ui-label text-cream-muted mb-1 block">Email</label>
            <input
              className="w-full bg-forest-deep border border-brass/20 rounded px-3 py-2 text-cream text-sm focus:border-brass/50 focus:outline-none"
              placeholder="email@..."
              value={manual.email}
              onChange={e => setManual(m => ({ ...m, email: e.target.value }))}
            />
          </div>
        </div>
        <button
          disabled={!manual.name.trim()}
          onClick={() => {
            onSelect({ name: manual.name.trim(), phone: manual.phone.trim(), email: manual.email.trim() })
            setManualMode(false)
            setManual({ name: '', phone: '', email: '' })
          }}
          className="w-full py-2 rounded bg-brass/80 hover:bg-brass text-forest-deep font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Set Customer
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="glass-panel p-3 flex items-center gap-2">
        <Search className="w-4 h-4 text-cream-muted flex-shrink-0" />
        <input
          className="flex-1 bg-transparent text-cream text-sm placeholder:text-cream-dim focus:outline-none"
          placeholder="Search customer by name or phone…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && <Loader2 className="w-4 h-4 text-brass-shimmer animate-spin flex-shrink-0" />}
        <button
          onClick={() => { setManualMode(true); setQuery(''); setOpen(false) }}
          className="text-xs text-brass-light hover:text-brass-shimmer transition-colors flex-shrink-0"
        >
          + New
        </button>
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 glass-panel border border-brass/20 rounded-xl overflow-hidden shadow-xl">
          {results.map(r => (
            <button
              key={r.id}
              className="w-full px-4 py-3.5 text-left hover:bg-brass/10 transition-colors border-b border-brass/10 last:border-0 flex items-center gap-3"
              onClick={() => { onSelect(r); setQuery(''); setOpen(false) }}
            >
              <div className="w-9 h-9 rounded-full bg-brass/15 border border-brass/25 flex items-center justify-center flex-shrink-0">
                <span className="text-brass-shimmer font-semibold text-sm">{(r.name || r.id || '?').charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-cream text-sm font-semibold truncate">{r.name}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  {r.phone && (
                    <span className="flex items-center gap-1 text-cream-muted text-xs whitespace-nowrap">
                      <Phone className="w-3 h-3 text-brass-light/60 shrink-0" />{r.phone}
                    </span>
                  )}
                  {r.email && (
                    <span className="flex items-center gap-1 text-cream-dim text-xs truncate max-w-[160px]">
                      <Mail className="w-3 h-3 text-brass-light/60 shrink-0" />{r.email}
                    </span>
                  )}
                  {(r as CustomerResult).address && (
                    <span className="flex items-center gap-1 text-cream-dim text-xs truncate max-w-[180px]">
                      <MapPin className="w-3 h-3 text-brass-light/60 shrink-0" />{(r as CustomerResult).address}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && !loading && results.length === 0 && query.length >= 2 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 glass-panel border border-brass/20 rounded-lg px-4 py-3 shadow-xl">
          <p className="text-cream-muted text-sm">No customers found. <button className="text-brass-light underline" onClick={() => setManualMode(true)}>Add new?</button></p>
        </div>
      )}
    </div>
  )
}

// ─── Garment Tile ─────────────────────────────────────────────────────────────
function GarmentTile({
  type,
  label,
  count,
  isActive,
  onClick,
}: {
  type: string
  label: string
  count: number
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all group',
        'bg-forest-raised hover:border-brass/50',
        isActive
          ? 'border-brass/70 shadow-[0_0_12px_rgba(180,140,60,0.2)]'
          : 'border-brass/20'
      )}
    >
      <div className={cn(
        'w-10 h-14 transition-colors',
        isActive ? 'text-brass-shimmer' : 'text-cream-dim group-hover:text-cream-muted'
      )}>
        {GarmentSVGs[type] || GarmentSVGs['Other']}
      </div>
      <span className={cn(
        'text-xs font-medium transition-colors',
        isActive ? 'text-brass-shimmer' : 'text-cream-muted group-hover:text-cream'
      )}>
        {label}
      </span>
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-brass text-forest-deep text-xs font-bold flex items-center justify-center shadow">
          {count}
        </span>
      )}
    </button>
  )
}

// ─── Active Garment Card ──────────────────────────────────────────────────────
// ── Color Swatch Picker ───────────────────────────────────────────────────────

const SWATCHES = [
  { label: "Black",    hex: "#1a1a1a" },
  { label: "Charcoal", hex: "#3d3d3d" },
  { label: "Gray",     hex: "#808080" },
  { label: "White",    hex: "#f5f5f0", border: true },
  { label: "Navy",     hex: "#1b2a4a" },
  { label: "Blue",     hex: "#2563eb" },
  { label: "Brown",    hex: "#6b3f1f" },
  { label: "Camel",    hex: "#c19a6b" },
  { label: "Burgundy", hex: "#6d1a2e" },
  { label: "Olive",    hex: "#6b7c2d" },
  { label: "Khaki",    hex: "#c3b091" },
  { label: "Beige",    hex: "#e8d9c0", border: true },
  { label: "Multi",    hex: "multi" },
]

function ColorSwatchPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isMulti = value === "Multi" || (value && !SWATCHES.find(s => s.label === value && s.hex !== "multi"))
  const [customOpen, setCustomOpen] = useState(false)
  const [customVal, setCustomVal] = useState("")

  return (
    <div className="space-y-2">
      {/* Swatch grid */}
      <div className="flex flex-wrap gap-2">
        {SWATCHES.map(s => {
          const selected = value === s.label
          if (s.hex === "multi") {
            return (
              <button
                key="multi"
                type="button"
                title="Multi-color"
                onClick={() => onChange("Multi")}
                className={cn(
                  'w-8 h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all',
                  selected
                    ? 'border-brass-shimmer scale-110 shadow-[0_0_0_2px_rgba(176,141,87,0.4)]'
                    : 'border-brass/30 hover:border-brass/60'
                )}
                style={{ background: 'conic-gradient(#1a1a1a,#2563eb,#dc2626,#2d5a27,#6b3f1f,#1a1a1a)' }}
              >
                {selected && <span className="text-white drop-shadow">✓</span>}
              </button>
            )
          }
          return (
            <button
              key={s.label}
              type="button"
              title={s.label}
              onClick={() => onChange(s.label)}
              className={cn(
                'w-8 h-8 rounded-full border-2 transition-all',
                selected
                  ? 'border-brass-shimmer scale-110 shadow-[0_0_0_2px_rgba(176,141,87,0.4)]'
                  : s.border ? 'border-brass/30 hover:border-brass/60' : 'border-transparent hover:border-brass/40'
              )}
              style={{ backgroundColor: s.hex }}
            >
              {selected && (
                <span className={cn('block text-center text-xs font-bold drop-shadow', s.hex === '#f5f5f0' || s.hex === '#fffff0' || s.hex === '#fffdd0' || s.hex === '#bfdbfe' ? 'text-gray-600' : 'text-white')}>✓</span>
              )}
            </button>
          )
        })}
        {/* Custom */}
        <button
          type="button"
          title="Custom color"
          onClick={() => setCustomOpen(v => !v)}
          className={cn(
            'w-8 h-8 rounded-full border-2 border-dashed border-brass/40 hover:border-brass flex items-center justify-center text-brass-shimmer text-lg transition-all',
            customOpen && 'border-brass'
          )}
        >+</button>
      </div>

      {/* Selected label */}
      {value && (
        <div className="flex items-center gap-2">
          <span className="text-cream-muted text-xs">Selected:</span>
          <span className="text-cream text-xs font-medium">{value}</span>
          <button type="button" onClick={() => onChange('')} className="text-cream-dim hover:text-cream text-[10px]">✕</button>
        </div>
      )}

      {/* Custom input */}
      {customOpen && (
        <div className="flex gap-2">
          <input
            autoFocus
            className="flex-1 bg-forest-deep border border-brass/30 rounded-lg px-3 py-1.5 text-cream text-sm focus:border-brass/60 focus:outline-none"
            placeholder="e.g. Cobalt Blue, Herringbone…"
            value={customVal}
            onChange={e => setCustomVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && customVal.trim()) { onChange(customVal.trim()); setCustomVal(''); setCustomOpen(false); } }}
          />
          <button
            type="button"
            onClick={() => { if (customVal.trim()) { onChange(customVal.trim()); setCustomVal(''); setCustomOpen(false); } }}
            className="px-3 py-1.5 rounded-lg bg-brass/20 border border-brass/30 text-brass-shimmer text-xs hover:bg-brass/30 transition-all"
          >Set</button>
        </div>
      )}
    </div>
  )
}

// ─── Fabric Picker ────────────────────────────────────────────────────────────
const FABRICS = ['Wool', 'Cotton', 'Linen', 'Cashmere', 'Silk', 'Denim', 'Leather', 'Synthetic']

function FabricPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {FABRICS.map(label => {
        const selected = value === label
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(selected ? '' : label)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition-all',
              selected
                ? 'bg-brass/25 border-brass-shimmer text-brass-shimmer'
                : 'border-brass/20 text-cream-muted hover:border-brass/40 hover:text-cream'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Condition Picker ─────────────────────────────────────────────────────────
const CONDITIONS = [
  { label: 'Excellent', color: 'emerald' },
  { label: 'Good',      color: 'emerald' },
  { label: 'Fair',      color: 'amber'   },
  { label: 'Worn',      color: 'amber'   },
  { label: 'Damaged',   color: 'rose'    },
]

const CONDITION_DOT: Record<string, string> = {
  emerald: 'bg-emerald-400',
  amber:   'bg-amber-400',
  rose:    'bg-rose-400',
}
const CONDITION_SELECTED: Record<string, string> = {
  emerald: 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300',
  amber:   'bg-amber-500/20 border-amber-400/60 text-amber-300',
  rose:    'bg-rose-500/20 border-rose-400/60 text-rose-300',
}

function ConditionPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CONDITIONS.map(({ label, color }) => {
        const selected = value === label
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(selected ? '' : label)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all',
              selected
                ? CONDITION_SELECTED[color]
                : 'border-brass/20 text-cream-muted hover:border-brass/40 hover:text-cream'
            )}
          >
            <span className={cn('w-2 h-2 rounded-full flex-shrink-0', CONDITION_DOT[color])} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Fit Area Picker ──────────────────────────────────────────────────────────
const FIT_AREAS = ['Waist', 'Shoulders', 'Sleeves', 'Length', 'Seat', 'Chest', 'Hem', 'Collar', 'Lining']

function FitAreaPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (area: string) => {
    if (value.includes(area)) {
      onChange(value.filter(a => a !== area))
    } else {
      onChange([...value, area])
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {FIT_AREAS.map(area => {
        const selected = value.includes(area)
        return (
          <button
            key={area}
            type="button"
            onClick={() => toggle(area)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition-all',
              selected
                ? 'bg-brass/25 border-brass-shimmer text-brass-shimmer'
                : 'border-brass/20 text-cream-muted hover:border-brass/40 hover:text-cream'
            )}
          >
            {area}
          </button>
        )
      })}
    </div>
  )
}

// ─── Complexity Picker ────────────────────────────────────────────────────────
const COMPLEXITIES = [
  { label: 'Simple',   desc: '1–2 alterations'       },
  { label: 'Standard', desc: '3–5 alterations'        },
  { label: 'Complex',  desc: '6+ or structural'       },
]

function ComplexityPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COMPLEXITIES.map(({ label, desc }) => {
        const selected = value === label
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(selected ? '' : label)}
            className={cn(
              'flex flex-col items-start px-4 py-2 rounded-xl border transition-all text-left min-w-[90px]',
              selected
                ? 'bg-brass/25 border-brass-shimmer text-brass-shimmer'
                : 'border-brass/20 text-cream-muted hover:border-brass/40 hover:text-cream'
            )}
          >
            <span className="text-xs font-semibold">{label}</span>
            <span className={cn('text-[10px] mt-0.5', selected ? 'text-brass-light/70' : 'text-cream-dim')}>{desc}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Garment Photo Capture ────────────────────────────────────────────────────
interface GarmentPhotoCaptureProps {
  garmentId: string
  ticketRef: string
  photos: string[]
  onChange: (photos: string[]) => void
}

function GarmentPhotoCapture({ garmentId, ticketRef, photos, onChange }: GarmentPhotoCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<Record<string, number>>({})

  const uploadPhoto = async (file: File): Promise<string | null> => {
    const path = `intake/${ticketRef}/${garmentId}/${Date.now()}-${file.name}`
    const formData = new FormData()
    formData.append('file', file)
    formData.append('path', path)

    try {
      const res = await fetch('/api/intake-alterations/photos', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) return null
      const data = await res.json()
      return (data as any).data?.url ?? null
    } catch {
      return null
    }
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const fileArr = Array.from(files)
    for (const file of fileArr) {
      const key = `${file.name}-${Date.now()}`
      setUploading(prev => ({ ...prev, [key]: 0 }))
      const url = await uploadPhoto(file)
      setUploading(prev => { const next = { ...prev }; delete next[key]; return next })
      if (url) {
        onChange([...photos, url])
      } else {
        toast.error(`Failed to upload ${file.name}`)
      }
    }
  }

  const removePhoto = (url: string) => {
    onChange(photos.filter(p => p !== url))
  }

  const uploadingCount = Object.keys(uploading).length

  return (
    <div className="space-y-3">
      {/* Thumbnail grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((url, i) => (
            <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-brass/20">
              <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(url)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-900/80 text-red-300 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {uploadingCount > 0 && Array.from({ length: uploadingCount }).map((_, i) => (
            <div key={`uploading-${i}`} className="aspect-square rounded-lg border border-brass/20 bg-forest-deep flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-brass-shimmer animate-spin" />
            </div>
          ))}
        </div>
      )}

      {/* Add photos button */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadingCount > 0}
        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-brass/30 text-cream-muted hover:border-brass/50 hover:text-cream transition-all text-sm disabled:opacity-50"
      >
        {uploadingCount > 0 ? (
          <><Loader2 className="w-4 h-4 animate-spin text-brass-shimmer" /> Uploading…</>
        ) : (
          <><Camera className="w-4 h-4 text-brass-shimmer" /> Add Photos</>
        )}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
    </div>
  )
}

function ActiveGarmentCard({
  garment,
  presets,
  onUpdate,
  onRemove,
}: {
  garment: GarmentItem
  presets: Preset[]
  onUpdate: (g: GarmentItem) => void
  onRemove: () => void
}) {
  const [showCustom, setShowCustom] = useState(false)
  const [customDesc, setCustomDesc] = useState('')
  const [customPrice, setCustomPrice] = useState('')

  const relevantPresets = presets.filter(p =>
    p.garment_types.includes(garment.garmentType) || p.garment_types.includes('All')
  )

  const activePresets = new Set(garment.lines.filter(l => l.preset).map(l => l.preset))

  const togglePreset = (preset: Preset) => {
    if (activePresets.has(preset.id)) {
      onUpdate({ ...garment, lines: garment.lines.filter(l => l.preset !== preset.id) })
    } else {
      onUpdate({
        ...garment,
        lines: [
          ...garment.lines,
          { preset: preset.id, description: preset.preset_name, price: preset.price, estMinutes: preset.est_minutes },
        ],
      })
    }
  }

  const addCustom = () => {
    const price = parseFloat(customPrice)
    if (!customDesc.trim() || isNaN(price)) return
    onUpdate({
      ...garment,
      lines: [
        ...garment.lines,
        { preset: '', description: customDesc.trim(), price, estMinutes: null },
      ],
    })
    setCustomDesc('')
    setCustomPrice('')
    setShowCustom(false)
  }

  const subtotal = garment.lines.reduce((s, l) => s + l.price, 0)

  return (
    <div className="glass-panel p-5 mt-4 border border-brass/30 rounded-2xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-brass/20 border border-brass/40 text-brass-shimmer font-bold text-sm">
            {garment.ref}
          </span>
          <h3 className="text-cream font-semibold text-lg">{garment.garmentType}</h3>
        </div>
        <button
          onClick={onRemove}
          className="p-1.5 rounded-lg hover:bg-red-900/30 text-cream-dim hover:text-red-400 transition-colors"
          title="Remove garment"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Detail Inputs */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div>
          <label className="ui-label text-cream-muted mb-1 block">Description</label>
          <input
            className="w-full bg-forest-deep border border-brass/20 rounded-lg px-3 py-2 text-cream text-sm focus:border-brass/50 focus:outline-none"
            placeholder="e.g. Navy blazer"
            value={garment.description}
            onChange={e => onUpdate({ ...garment, description: e.target.value })}
          />
        </div>
        <div>
          <label className="ui-label text-cream-muted mb-1 block">Color</label>
          <ColorSwatchPicker
            value={garment.color}
            onChange={color => onUpdate({ ...garment, color })}
          />
        </div>
        <div className="col-span-2">
          <label className="ui-label text-cream-muted mb-1 block">Notes</label>
          <textarea
            rows={2}
            className="w-full bg-forest-deep border border-brass/20 rounded-lg px-3 py-2 text-cream text-sm focus:border-brass/50 focus:outline-none resize-none"
            placeholder="Special instructions, fabric notes…"
            value={garment.notes}
            onChange={e => onUpdate({ ...garment, notes: e.target.value })}
          />
        </div>

        {/* Fabric + Condition row */}
        <div>
          <label className="ui-label text-cream-muted mb-1 block">Fabric</label>
          <FabricPicker value={garment.fabric} onChange={fabric => onUpdate({ ...garment, fabric })} />
        </div>
        <div>
          <label className="ui-label text-cream-muted mb-1 block">Condition</label>
          <ConditionPicker value={garment.condition} onChange={condition => onUpdate({ ...garment, condition })} />
        </div>

        {/* Fit Areas - full width */}
        <div className="col-span-2">
          <label className="ui-label text-cream-muted mb-1 block">
            Fit Areas <span className="text-cream-dim">(select all that apply)</span>
          </label>
          <FitAreaPicker value={garment.fitAreas} onChange={fitAreas => onUpdate({ ...garment, fitAreas })} />
        </div>

        {/* Complexity - full width */}
        <div className="col-span-2">
          <label className="ui-label text-cream-muted mb-1 block">Complexity</label>
          <ComplexityPicker value={garment.complexity} onChange={complexity => onUpdate({ ...garment, complexity })} />
        </div>

        {/* Photos - full width */}
        <div className="col-span-2">
          <label className="ui-label text-cream-muted mb-1 block">
            Photos <span className="text-cream-dim">(damage, marks, reference)</span>
          </label>
          <GarmentPhotoCapture
            garmentId={garment.id}
            ticketRef={`temp-${garment.id}`}
            photos={garment.photos}
            onChange={photos => onUpdate({ ...garment, photos })}
          />
        </div>
      </div>

      {/* Alteration Chips */}
      <div className="mb-4">
        <p className="ui-label text-cream-muted mb-2">Alterations</p>
        {relevantPresets.length === 0 ? (
          <p className="text-cream-dim text-sm italic">No presets for this garment type</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {relevantPresets.map(preset => {
              const selected = activePresets.has(preset.id)
              return (
                <button
                  key={preset.id}
                  onClick={() => togglePreset(preset)}
                  className={cn(
                    'relative flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-left',
                    selected
                      ? 'bg-brass/20 border-brass/70 shadow-[0_0_10px_rgba(180,140,60,0.15)]'
                      : 'bg-forest-raised/60 border-brass/15 hover:border-brass/40 hover:bg-forest-raised'
                  )}
                >
                  {selected && (
                    <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-brass flex items-center justify-center">
                      <Check className="w-3 h-3 text-forest-deep" />
                    </span>
                  )}
                  <span className={cn(
                    'text-xs font-medium leading-snug pr-6',
                    selected ? 'text-cream' : 'text-cream-muted'
                  )}>
                    {preset.preset_name}
                  </span>
                  <span className={cn(
                    'font-display italic text-base font-semibold',
                    selected ? 'text-brass-shimmer' : 'text-brass-light/70'
                  )}>
                    {formatUSD(preset.price)}
                  </span>
                  {preset.est_minutes && (
                    <span className="text-[10px] text-cream-dim">{preset.est_minutes} min</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Custom Lines */}
      {garment.lines.filter(l => !l.preset).map((line, idx) => (
        <div key={idx} className="flex items-center gap-2 mb-2">
          <div className="flex-1 bg-brass/10 border border-brass/20 rounded-lg px-3 py-1.5 flex items-center justify-between">
            <span className="text-cream text-sm">{line.description}</span>
            <span className="text-brass-shimmer text-sm font-medium ml-2">{formatUSD(line.price)}</span>
          </div>
          <button
            className="p-1 text-cream-dim hover:text-red-400 transition-colors"
            onClick={() => {
              const customLines = garment.lines.filter(l => !l.preset)
              const toRemove = customLines[idx]
              const newLines = garment.lines.filter(l => l !== toRemove)
              onUpdate({ ...garment, lines: newLines })
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {/* Custom Alteration Form */}
      {showCustom ? (
        <div className="flex items-end gap-2 mt-3 p-3 bg-brass/5 border border-brass/20 rounded-xl">
          <div className="flex-1">
            <label className="ui-label text-cream-muted mb-1 block">Description</label>
            <input
              autoFocus
              className="w-full bg-forest-deep border border-brass/20 rounded px-3 py-1.5 text-cream text-sm focus:border-brass/50 focus:outline-none"
              placeholder="e.g. Hem tape repair"
              value={customDesc}
              onChange={e => setCustomDesc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustom()}
            />
          </div>
          <div className="w-24">
            <label className="ui-label text-cream-muted mb-1 block">Price</label>
            <input
              className="w-full bg-forest-deep border border-brass/20 rounded px-3 py-1.5 text-cream text-sm focus:border-brass/50 focus:outline-none"
              placeholder="25.00"
              value={customPrice}
              onChange={e => setCustomPrice(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustom()}
            />
          </div>
          <button
            onClick={addCustom}
            disabled={!customDesc.trim() || !customPrice}
            className="px-3 py-1.5 rounded bg-brass/80 hover:bg-brass text-forest-deep font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
          <button
            onClick={() => { setShowCustom(false); setCustomDesc(''); setCustomPrice('') }}
            className="p-1.5 text-cream-dim hover:text-cream"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCustom(true)}
          className="mt-3 flex items-center gap-1.5 text-sm text-brass-light hover:text-brass-shimmer transition-colors"
        >
          <Plus className="w-4 h-4" />
          Custom alteration
        </button>
      )}

      {/* Subtotal */}
      {garment.lines.length > 0 && (
        <div className="mt-4 pt-3 border-t border-brass/20 flex items-center justify-between">
          <span className="text-cream-muted text-sm">{garment.lines.length} alteration{garment.lines.length !== 1 ? 's' : ''}</span>
          <span className="text-brass-shimmer font-semibold">{formatUSD(subtotal)}</span>
        </div>
      )}
    </div>
  )
}

// ─── Checkout Cart ─────────────────────────────────────────────────────────────
function CheckoutCart({
  garments,
  customer,
  isRush,
  onRushToggle,
  paymentMethod,
  onPaymentMethodChange,
  deposit,
  onDepositChange,
  origin,
  submitting,
  onSubmit,
  dueDate,
  onDueDateChange,
}: {
  garments: GarmentItem[]
  customer: Customer
  isRush: boolean
  onRushToggle: () => void
  paymentMethod: PaymentMethod
  onPaymentMethodChange: (m: PaymentMethod) => void
  deposit: string
  onDepositChange: (v: string) => void
  origin: 'NYC' | 'HOU'
  submitting: boolean
  onSubmit: () => void
  dueDate: string
  onDueDateChange: (v: string) => void
}) {
  const garmentSubtotal = garments.reduce((s, g) => s + g.lines.reduce((ss, l) => ss + l.price, 0), 0)
  const rushFee = isRush ? 25 : 0
  const subtotalWithRush = garmentSubtotal + rushFee
  const total = subtotalWithRush

  const garmentsWithLines = garments.filter(g => g.lines.length > 0)
  const canSubmit = !!customer && garmentsWithLines.length > 0 && !submitting

  const ctaLabel = submitting
    ? 'Processing…'
    : paymentMethod === 'pay_now'
    ? 'Create Ticket & Charge Square'
    : paymentMethod === 'deposit'
    ? 'Create Ticket & Take Deposit'
    : 'Create Ticket'

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-brass/20 flex items-center justify-between">
        <h2 className="text-cream font-semibold text-lg flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-brass-shimmer" />
          Checkout
        </h2>
        {garments.length > 0 && (
          <span className="text-cream-muted text-sm">{garments.length} garment{garments.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Garment Lines */}
        {garments.length === 0 ? (
          <p className="text-cream-dim text-sm text-center py-4 italic">No garments added yet</p>
        ) : (
          <div className="space-y-2">
            {garments.map(g => {
              const sub = g.lines.reduce((s, l) => s + l.price, 0)
              return (
                <div key={g.id} className="flex items-center justify-between py-2 border-b border-brass/10 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-full bg-brass/15 border border-brass/30 text-brass-shimmer text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {g.ref}
                    </span>
                    <div className="min-w-0">
                      <p className="text-cream text-sm font-medium truncate">{g.garmentType}</p>
                      <p className="text-cream-dim text-xs">{g.lines.length} alteration{g.lines.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <span className={cn('text-sm font-medium ml-2 flex-shrink-0', sub > 0 ? 'text-cream' : 'text-cream-dim')}>
                    {sub > 0 ? formatUSD(sub) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Rush Toggle */}
        <div className="flex items-center justify-between py-2">
          <button
            onClick={onRushToggle}
            className={cn(
              'flex items-center gap-2 text-sm font-medium transition-colors',
              isRush ? 'text-amber-400' : 'text-cream-muted hover:text-cream'
            )}
          >
            <Zap className={cn('w-4 h-4', isRush && 'fill-amber-400')} />
            Rush (+$25.00)
          </button>
          <div
            onClick={onRushToggle}
            className={cn(
              'relative w-10 h-5 rounded-full cursor-pointer transition-colors',
              isRush ? 'bg-amber-500/70' : 'bg-forest-deep border border-brass/30'
            )}
          >
            <div className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-cream transition-transform',
              isRush ? 'translate-x-5' : 'translate-x-0.5'
            )} />
          </div>
        </div>

        {/* Due Date */}
        <div className="space-y-2">
          <p className="ui-label text-cream-muted">Due Date</p>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { label: '3 days', days: 3 },
              { label: '5 days', days: 5 },
              { label: '1 week', days: 7 },
              { label: '2 weeks', days: 14 },
            ].map(({ label, days }) => {
              const d = new Date()
              d.setDate(d.getDate() + days)
              const val = d.toISOString().slice(0, 10)
              return (
                <button
                  key={days}
                  type="button"
                  onClick={() => onDueDateChange(val)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                    dueDate === val
                      ? 'bg-brass/20 border-brass/50 text-brass-shimmer'
                      : 'border-brass/20 text-cream-muted hover:border-brass/40 hover:text-cream'
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <input
            type="date"
            value={dueDate}
            onChange={e => onDueDateChange(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
            className="w-full bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2.5 text-cream text-sm focus:outline-none focus:border-brass/50 [color-scheme:dark]"
          />
        </div>

        {/* Total */}
        <div className="border-t border-brass/20 pt-3 space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-cream-muted">Subtotal</span>
            <span className="text-cream">{formatUSD(subtotalWithRush)}</span>
          </div>
          <div className="flex items-center justify-between font-semibold pt-1 border-t border-brass/20">
            <span className="text-cream">Total</span>
            <span className="text-brass-shimmer text-lg">{formatUSD(total)}</span>
          </div>
        </div>

        {/* Payment Method */}
        <div>
          <p className="ui-label text-cream-muted mb-2">Payment Method</p>
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { value: 'pay_now' as PaymentMethod, label: 'Pay Now', icon: CreditCard },
              { value: 'deposit' as PaymentMethod, label: 'Deposit', icon: Banknote },
              { value: 'on_account' as PaymentMethod, label: 'On Account', icon: ClipboardList },
            ] as const).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => onPaymentMethodChange(value)}
                className={cn(
                  'flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-xs font-medium transition-all',
                  paymentMethod === value
                    ? 'bg-brass/20 border-brass/60 text-brass-shimmer'
                    : 'bg-transparent border-brass/20 text-cream-muted hover:border-brass/40 hover:text-cream'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {paymentMethod === 'deposit' && (
            <div className="mt-3">
              <label className="ui-label text-cream-muted mb-1 block">Deposit Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-muted text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full bg-forest-deep border border-brass/20 rounded-lg pl-7 pr-3 py-2 text-cream text-sm focus:border-brass/50 focus:outline-none"
                  placeholder="0.00"
                  value={deposit}
                  onChange={e => onDepositChange(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* CTA */}
        <button
          disabled={!canSubmit}
          onClick={onSubmit}
          className={cn(
            'w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2',
            canSubmit
              ? 'bg-brass hover:bg-brass/90 text-forest-deep shadow-md hover:shadow-brass/20'
              : 'bg-brass/20 text-cream-dim cursor-not-allowed'
          )}
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {ctaLabel}
        </button>

        {!customer && (
          <p className="text-center text-cream-dim text-xs flex items-center justify-center gap-1">
            <AlertCircle className="w-3 h-3" /> Select a customer to continue
          </p>
        )}
        {customer && garmentsWithLines.length === 0 && (
          <p className="text-center text-cream-dim text-xs flex items-center justify-center gap-1">
            <AlertCircle className="w-3 h-3" /> Add at least one alteration
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Success State ─────────────────────────────────────────────────────────────
function SuccessState({
  ticketName,
  customer,
  garmentCount,
  onReset,
}: {
  ticketName: string
  customer: Customer
  garmentCount: number
  onReset: () => void
}) {
  return (
    <div className="min-h-screen bg-forest-deep flex items-center justify-center p-6">
      <div className="glass-panel rounded-2xl p-8 max-w-md w-full text-center border border-brass/30">
        <div className="w-16 h-16 rounded-full bg-brass/20 border-2 border-brass/50 flex items-center justify-center mx-auto mb-5">
          <Check className="w-8 h-8 text-brass-shimmer" />
        </div>
        <h2 className="text-cream text-2xl font-bold mb-1">Ticket Created</h2>
        <p className="text-brass-shimmer text-xl font-mono font-semibold mb-4">{ticketName}</p>

        {customer && (
          <div className="mb-5 p-3 bg-brass/10 rounded-xl border border-brass/20">
            <p className="text-cream font-medium">{customer.name}</p>
            {customer.phone && <p className="text-cream-muted text-sm">{customer.phone}</p>}
          </div>
        )}

        <p className="text-cream-muted text-sm mb-6">
          {garmentCount} garment{garmentCount !== 1 ? 's' : ''} logged
        </p>

        <div className="space-y-3">
          <button
            onClick={() => window.open(`/intake/alterations/tickets/${ticketName}/print`)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-brass/30 text-cream hover:bg-brass/10 transition-colors"
          >
            <Printer className="w-4 h-4 text-brass-shimmer" />
            Print Receipt
          </button>
          <button
            onClick={() => window.open(`/intake/alterations/tickets/${ticketName}/tags`)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-brass/30 text-cream hover:bg-brass/10 transition-colors"
          >
            <Tag className="w-4 h-4 text-brass-shimmer" />
            Print Garment Tags
          </button>
          <button
            onClick={onReset}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brass/80 hover:bg-brass text-forest-deep font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            New Order
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function IntakeAlterations() {
  const { data: me } = useMe()
  const [customer, setCustomer] = useState<Customer>(null)
  const [garments, setGarments] = useState<GarmentItem[]>([])
  const [activeGarmentId, setActiveGarmentId] = useState<string | null>(null)
  const [isRush, setIsRush] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pay_now')
  const [deposit, setDeposit] = useState('')
  const [origin, setOrigin] = useState<'NYC' | 'HOU'>('NYC')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<{ ticketName: string } | null>(null)

  const { data: presetsData } = useQuery({
    queryKey: ['presets', origin],
    queryFn: () => api.get<Preset[]>(`/api/intake-alterations/presets?origin=${origin}`),
    staleTime: 5 * 60 * 1000,
  })
  const presets: Preset[] = (presetsData as Preset[] | undefined) ?? []

  useQuery({
    queryKey: ['tailors'],
    queryFn: () => api.get('/api/intake-alterations/tailors'),
    staleTime: 5 * 60 * 1000,
  })

  const activeGarment = garments.find(g => g.id === activeGarmentId) ?? null

  const addGarment = useCallback((type: string) => {
    const newRef = `G${garments.length + 1}`
    const newItem: GarmentItem = {
      id: uuid(),
      ref: newRef,
      garmentType: type,
      description: '',
      color: '',
      notes: '',
      lines: [],
      fabric: '',
      condition: '',
      fitAreas: [],
      complexity: '',
      photos: [],
    }
    setGarments(prev => [...prev, newItem])
    setActiveGarmentId(newItem.id)
  }, [garments.length])

  const updateGarment = useCallback((updated: GarmentItem) => {
    setGarments(prev => prev.map(g => g.id === updated.id ? updated : g))
  }, [])

  const removeGarment = useCallback((id: string) => {
    setGarments(prev => {
      const remaining = prev.filter(g => g.id !== id)
      // Re-number refs
      return remaining.map((g, i) => ({ ...g, ref: `G${i + 1}` }))
    })
    setActiveGarmentId(prev => {
      if (prev === id) return null
      return prev
    })
  }, [])

  const handleTileClick = useCallback((type: string) => {
    addGarment(type)
  }, [addGarment])

  const defaultDueDate = () => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  }
  const [dueDate, setDueDate] = useState(defaultDueDate)

  const handleSubmit = async () => {
    if (!customer || garments.filter(g => g.lines.length > 0).length === 0) return
    if (!dueDate) { toast.error('Please select a due date'); return }
    setSubmitting(true)
    try {
      const payload = {
        customer,
        garments: garments.filter(g => g.lines.length > 0),
        isRush,
        paymentMethod,
        deposit: paymentMethod === 'deposit' ? parseFloat(deposit) || 0 : null,
        origin,
        ticket_date: new Date().toISOString().split('T')[0],
        due_date: dueDate,
      }
      const result = await api.post<{ ticketName: string }>('/api/intake-alterations/tickets', payload)
      setSubmitted({ ticketName: result.ticketName })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create ticket. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = () => {
    setCustomer(null)
    setGarments([])
    setActiveGarmentId(null)
    setIsRush(false)
    setPaymentMethod('pay_now')
    setDeposit('')
    setSubmitted(null)
    setDueDate(defaultDueDate())
  }

  if (submitted) {
    return (
      <SuccessState
        ticketName={submitted.ticketName}
        customer={customer}
        garmentCount={garments.filter(g => g.lines.length > 0).length}
        onReset={handleReset}
      />
    )
  }

  const garmentCounts = garments.reduce<Record<string, number>>((acc, g) => {
    acc[g.garmentType] = (acc[g.garmentType] || 0) + 1
    return acc
  }, {})

  const snapshot = useCallback(() => ({
    customer: customer ?? {},
    customerRef: customer?.id ?? null,
    cart: {
      garments: garments.map(g => ({
        id: g.id,
        ref: g.ref,
        garmentType: g.garmentType,
        description: g.description,
        color: g.color,
        notes: g.notes,
        lines: g.lines,
        fabric: g.fabric,
        condition: g.condition,
        fitAreas: g.fitAreas,
        complexity: g.complexity,
        photos: g.photos,
      })),
      lines: garments.flatMap(g => g.lines),
    } as CartPayload,
  }), [customer, garments])

  const handleResume = useCallback((cart: ParkedCart) => {
    setCustomer(cart.customer ? {
      id: cart.customer.id,
      name: cart.customer.name || '',
      phone: cart.customer.phone || '',
      email: cart.customer.email || '',
    } : null)
    setGarments(cart.cart?.garments ?? [])
    setActiveGarmentId(null)
    setIsRush(false)
    setPaymentMethod('pay_now')
    setDeposit('')
  }, [])

  const handleCommitted = useCallback((ticket: string) => {
    setSubmitted({ ticketName: ticket })
  }, [])

  return (
    <div className="min-h-screen bg-forest-deep text-cream">
      {/* Top Bar */}
      <div className="border-b border-brass/20 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-cream font-bold text-lg tracking-wide">Alteration Intake</h1>
          <span className="text-cream-dim text-sm">·</span>
          <div className="flex gap-1">
            {(['NYC', 'HOU'] as const).map(loc => (
              <button
                key={loc}
                onClick={() => setOrigin(loc)}
                className={cn(
                  'px-3 py-1 rounded-md text-sm font-medium transition-colors',
                  origin === loc
                    ? 'bg-brass/20 text-brass-shimmer border border-brass/40'
                    : 'text-cream-muted hover:text-cream'
                )}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>
        <div className="text-cream-dim text-xs">
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex flex-col lg:flex-row gap-0 lg:gap-6 p-4 lg:p-6 max-w-7xl mx-auto">

        {/* LEFT: Garment Picker + Active Card */}
        <div className="flex-1 lg:w-2/3 space-y-5 min-w-0">

          {/* Customer Search */}
          <div>
            <p className="ui-label text-cream-muted mb-2">Customer</p>
            <CustomerSearch
              customer={customer}
              onSelect={setCustomer}
              onClear={() => setCustomer(null)}
            />
          </div>

          {/* Garment Picker */}
          <div>
            <p className="ui-label text-cream-muted mb-2">Select Garment</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {GARMENTS.map(g => (
                <GarmentTile
                  key={g.type}
                  type={g.type}
                  label={g.label}
                  count={garmentCounts[g.type] || 0}
                  isActive={activeGarment?.garmentType === g.type && activeGarment != null}
                  onClick={() => handleTileClick(g.type)}
                />
              ))}
            </div>
          </div>

          {/* Garment Switcher — when multiple garments */}
          {garments.length > 1 && (
            <div>
              <p className="ui-label text-cream-muted mb-2">Garments in Order</p>
              <div className="flex flex-wrap gap-2">
                {garments.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setActiveGarmentId(g.id)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-all',
                      activeGarmentId === g.id
                        ? 'bg-brass/20 border-brass/50 text-brass-shimmer'
                        : 'border-brass/20 text-cream-muted hover:border-brass/40 hover:text-cream'
                    )}
                  >
                    <span className="font-bold">{g.ref}</span>
                    <span>{g.garmentType}</span>
                    {g.lines.length > 0 && (
                      <span className={cn(
                        'w-4 h-4 rounded-full text-xs flex items-center justify-center',
                        activeGarmentId === g.id ? 'bg-brass/40 text-forest-deep' : 'bg-brass/20 text-brass-light'
                      )}>
                        {g.lines.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active Garment Card */}
          {activeGarment && (
            <ActiveGarmentCard
              garment={activeGarment}
              presets={presets}
              onUpdate={updateGarment}
              onRemove={() => removeGarment(activeGarment.id)}
            />
          )}

          {!activeGarment && garments.length === 0 && (
            <div className="glass-panel rounded-2xl p-8 text-center border border-dashed border-brass/20">
              <ShoppingBag className="w-8 h-8 text-cream-dim mx-auto mb-3" />
              <p className="text-cream-muted text-sm">Click a garment type above to start adding items</p>
            </div>
          )}
        </div>

        {/* RIGHT: Checkout Cart */}
        <div className="lg:w-1/3 lg:sticky lg:top-6 lg:self-start mt-5 lg:mt-0 space-y-4">
          <SaveCartControls
            createdBy={me?.id || ''}
            location={origin}
            activeCartId={undefined}
            snapshot={snapshot}
            onResume={handleResume}
            onCommitted={handleCommitted}
          />
          <CheckoutCart
            garments={garments}
            customer={customer}
            isRush={isRush}
            onRushToggle={() => setIsRush(r => !r)}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            deposit={deposit}
            onDepositChange={setDeposit}
            origin={origin}
            submitting={submitting}
            onSubmit={handleSubmit}
            dueDate={dueDate}
            onDueDateChange={setDueDate}
          />
        </div>
      </div>

      {/* Mobile Sticky Bottom Summary */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 glass-panel border-t border-brass/30 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-cream text-sm font-semibold">
            {garments.length} garment{garments.length !== 1 ? 's' : ''}
            {garments.some(g => g.lines.length > 0) && (
              <span className="text-cream-muted ml-1">·</span>
            )}
            {garments.some(g => g.lines.length > 0) && (
              <span className="text-brass-shimmer ml-1">
                {formatUSD(
                  garments.reduce((s, g) => s + g.lines.reduce((ss, l) => ss + l.price, 0), 0) +
                  (isRush ? 25 : 0)
                )}
              </span>
            )}
          </p>
          {customer && <p className="text-cream-dim text-xs">{customer.name}</p>}
        </div>
        <button
          disabled={!customer || garments.filter(g => g.lines.length > 0).length === 0 || submitting}
          onClick={handleSubmit}
          className="px-5 py-2.5 rounded-xl bg-brass text-forest-deep font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? 'Processing…' : 'Checkout'}
        </button>
      </div>
    </div>
  )
}
