'use client'

import { useEffect, useState } from 'react'
import { Phone, Mail, MapPin, FileText, Loader2, Check, X } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface CustomerDetail {
  id: string
  name: string
  mobile: string
  email: string
  notes: string
  contactName: string | null
  address: {
    id: string
    line1: string
    line2: string
    city: string
    state: string
    zip: string
    country: string
  } | null
}

interface Props {
  customerId: string | null
  customerName?: string
  onClose: () => void
  onSaved?: () => void
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div className="space-y-1">
      <label className="font-sans uppercase text-[9px] tracking-[0.15em] font-medium text-[var(--ls-on-surface-muted)]">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 rounded-[var(--ls-radius)] border border-[var(--ls-line)] bg-[var(--ls-surface)] text-[var(--ls-on-surface)] text-sm focus:outline-none focus:border-[var(--ls-brass)] transition-colors placeholder:text-[var(--ls-on-surface-muted)]"
      />
    </div>
  )
}

export function CustomerEditSheet({ customerId, customerName, onClose, onSaved }: Props) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // editable fields
  const [mobile, setMobile] = useState('')
  const [email, setEmail]   = useState('')
  const [notes, setNotes]   = useState('')
  const [line1, setLine1]   = useState('')
  const [line2, setLine2]   = useState('')
  const [city,  setCity]    = useState('')
  const [state, setState]   = useState('')
  const [zip,   setZip]     = useState('')
  const [country, setCountry] = useState('United States')

  useEffect(() => {
    if (!customerId) return
    setLoading(true)
    api.get<CustomerDetail>(`/api/intake-alterations/customers/${encodeURIComponent(customerId)}`)
      .then(d => {
        setDetail(d)
        setMobile(d.mobile || '')
        setEmail(d.email || '')
        setNotes(d.notes || '')
        setLine1(d.address?.line1 || '')
        setLine2(d.address?.line2 || '')
        setCity(d.address?.city || '')
        setState(d.address?.state || '')
        setZip(d.address?.zip || '')
        setCountry(d.address?.country || 'United States')
      })
      .catch(() => toast.error('Could not load customer details'))
      .finally(() => setLoading(false))
  }, [customerId])

  async function save() {
    if (!customerId) return
    setSaving(true)
    try {
      await api.patch(`/api/intake-alterations/customers/${encodeURIComponent(customerId)}`, {
        mobile,
        email,
        notes,
        address: { line1, line2, city, state, zip, country },
      })
      toast.success('Customer updated')
      onSaved?.()
      onClose()
    } catch (e: any) {
      toast.error(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[var(--ls-radius)] bg-[var(--ls-surface-raised)] border border-[var(--ls-line)] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ls-line)]">
          <div>
            <div className="font-sans uppercase text-[9px] tracking-[0.15em] text-[var(--ls-brass)]">Customer</div>
            <h2 className="font-display italic text-xl text-[var(--ls-on-surface)]">
              {detail?.name || customerName || 'Edit Details'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-[var(--ls-radius)] border border-[var(--ls-line)] text-[var(--ls-on-surface-muted)] hover:bg-[var(--ls-surface-hover)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="animate-spin text-[var(--ls-on-surface-muted)]" />
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Contact */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Phone size={12} className="text-[var(--ls-brass)]" />
                <span className="font-sans uppercase text-[9px] tracking-[0.15em] font-semibold text-[var(--ls-brass)]">Contact</span>
              </div>
              <Field label="Mobile / Phone" value={mobile} onChange={setMobile} placeholder="+1 212 555 0100" type="tel" />
              <Field label="Email" value={email} onChange={setEmail} placeholder="client@example.com" type="email" />
            </div>

            <div className="h-px bg-[var(--ls-line)]" />

            {/* Address */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MapPin size={12} className="text-[var(--ls-brass)]" />
                <span className="font-sans uppercase text-[9px] tracking-[0.15em] font-semibold text-[var(--ls-brass)]">Address</span>
              </div>
              <Field label="Street Line 1" value={line1} onChange={setLine1} placeholder="123 Main St" />
              <Field label="Street Line 2" value={line2} onChange={setLine2} placeholder="Apt 4B" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="City" value={city} onChange={setCity} placeholder="New York" />
                <Field label="State" value={state} onChange={setState} placeholder="NY" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="ZIP" value={zip} onChange={setZip} placeholder="10065" />
                <Field label="Country" value={country} onChange={setCountry} placeholder="United States" />
              </div>
            </div>

            <div className="h-px bg-[var(--ls-line)]" />

            {/* Notes */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileText size={12} className="text-[var(--ls-brass)]" />
                <span className="font-sans uppercase text-[9px] tracking-[0.15em] font-semibold text-[var(--ls-brass)]">Notes</span>
              </div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Preferences, fit notes, allergies, VIP status…"
                rows={4}
                className="w-full px-3 py-2 rounded-[var(--ls-radius)] border border-[var(--ls-line)] bg-[var(--ls-surface)] text-[var(--ls-on-surface)] text-sm focus:outline-none focus:border-[var(--ls-brass)] transition-colors placeholder:text-[var(--ls-on-surface-muted)] resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 h-10 rounded-[var(--ls-radius)] bg-[var(--ls-brass)] text-[var(--ls-forest-deep)] font-sans uppercase text-[11px] tracking-[0.1em] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {saving ? 'Saving…' : 'Save to ERPNext'}
              </button>
              <button
                onClick={onClose}
                className="h-10 px-4 rounded-[var(--ls-radius)] border border-[var(--ls-line)] text-[var(--ls-on-surface-muted)] font-sans uppercase text-[11px] tracking-[0.1em] font-semibold hover:bg-[var(--ls-surface-hover)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
