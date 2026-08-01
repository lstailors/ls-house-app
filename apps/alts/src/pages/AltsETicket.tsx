import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '@ls/api-client'
import { cn } from "@ls/design/utils"

interface PublicTicket {
  name: string
  customer_name: string
  workflow_state: string
  ticket_date: string
  due_date: string
  ticket_total: number | null
  payment_status: string | null
  origin_location: string
  locked?: boolean
  garments?: Array<{
    name: string
    garment_id: string
    garment_type: string
    garment_description: string
    color?: string
  }>
  lines?: Array<{
    garment_ref: string
    description: string
    price: number
  }>
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  Received:     { label: 'Received',           bg: 'bg-blue-900/40',    text: 'text-blue-300',    border: 'border-blue-500/30' },
  'In Progress':{ label: 'In Progress',        bg: 'bg-amber-900/40',   text: 'text-amber-300',   border: 'border-amber-500/30' },
  Ready:        { label: '✓ Ready for Pickup', bg: 'bg-emerald-900/40', text: 'text-emerald-300', border: 'border-emerald-500/30' },
  'Picked Up':  { label: 'Picked Up',          bg: 'bg-zinc-800/60',    text: 'text-zinc-400',    border: 'border-zinc-500/30' },
  Cancelled:    { label: 'Cancelled',          bg: 'bg-red-900/40',     text: 'text-red-400',     border: 'border-red-500/30' },
}

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0)
}

export default function ETicket() {
  const { ticketName } = useParams<{ ticketName: string }>()
  const [params] = useSearchParams()
  const key = params.get('k') || params.get('key') || ''

  const { data: ticket, isLoading, isError } = useQuery<PublicTicket>({
    queryKey: ['public-ticket', ticketName, key],
    queryFn: () =>
      api.get<PublicTicket>(
        `/api/intake-alterations/public/tickets/${encodeURIComponent(ticketName!)}${key ? `?k=${encodeURIComponent(key)}` : ''}`,
      ),
    enabled: !!ticketName,
    retry: 1,
    staleTime: 60_000,
  })

  const eTicketUrl = window.location.href
  const isReady = ticket?.workflow_state === 'Ready'
  const status = ticket ? (STATUS_CONFIG[ticket.workflow_state] ?? STATUS_CONFIG['Received']) : null
  const locked = !!ticket?.locked

  if (isLoading) {
    return (
      <div className="min-h-screen bg-forest-deep flex items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="h-6 w-6 rounded-full border-2 border-brass/30 border-t-brass-shimmer animate-spin mx-auto" />
          <p className="text-cream-dim/60 text-sm">Loading your ticket…</p>
        </div>
      </div>
    )
  }

  if (isError || !ticket) {
    return (
      <div className="min-h-screen bg-forest-deep flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-brass-shimmer font-bold text-xl tracking-widest uppercase">L&S Tailors</p>
        <p className="text-cream-muted text-base mt-2">Ticket not found</p>
        <p className="text-cream-dim/60 text-sm">Please contact us for assistance.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-forest-deep text-cream">
      <div className="max-w-sm mx-auto px-4 py-10 space-y-5">

        {/* ── Wordmark ── */}
        <div className="text-center space-y-0.5 pb-2">
          <p className="text-brass-shimmer font-bold text-2xl tracking-[0.2em] uppercase">
            L&S Tailors
          </p>
          <p className="text-cream-dim/50 text-[10px] tracking-[0.3em] uppercase">
            {ticket.origin_location === 'HOU' ? 'Houston' : 'New York City'}
          </p>
        </div>

        {/* ── Ready banner ── */}
        {isReady ? (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-900/20 px-4 py-4 text-center">
            <p className="text-emerald-300 font-bold text-lg">Your garment is ready!</p>
            <p className="text-emerald-400/70 text-sm mt-1">
              Please show this screen when you arrive for pickup.
            </p>
          </div>
        ) : null}

        {/* ── Ticket summary card ── */}
        <div
          className="rounded-2xl border border-white/[0.06] p-5 space-y-4"
          style={{ background: 'rgba(10,20,12,0.65)', backdropFilter: 'blur(16px)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-cream-dim/50 text-[10px] tracking-widest uppercase">Ticket</p>
              <p className="text-brass-shimmer font-bold text-xl leading-tight">{ticket.name}</p>
              <p className="text-cream-muted text-sm mt-0.5">{ticket.customer_name}</p>
            </div>
            {status ? (
              <span className={cn('text-xs px-2.5 py-1 rounded-full border font-medium shrink-0 mt-1', status.bg, status.text, status.border)}>
                {status.label}
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-y-3 gap-x-4 border-t border-white/[0.06] pt-4">
            <div>
              <p className="text-cream-dim/50 text-[10px] tracking-widest uppercase">Ticket Date</p>
              <p className="text-cream-muted text-sm mt-0.5">{formatDate(ticket.ticket_date)}</p>
            </div>
            <div>
              <p className="text-cream-dim/50 text-[10px] tracking-widest uppercase">Due Date</p>
              <p className="text-cream-muted text-sm mt-0.5">{formatDate(ticket.due_date)}</p>
            </div>
            <div className="col-span-2 flex items-center justify-between pt-1 border-t border-white/[0.04]">
              <p className="text-cream-dim/50 text-[10px] tracking-widest uppercase">Total</p>
              <p className="text-brass-shimmer font-bold text-lg">
                {locked || ticket.ticket_total == null ? '—' : formatCurrency(ticket.ticket_total)}
              </p>
            </div>
          </div>
        </div>

        {locked ? (
          <p className="text-center text-cream-dim/70 text-xs px-2">
            Status view — open the link from your L&amp;S text for full ticket details.
          </p>
        ) : null}

        {/* ── QR code ── */}
        <div
          className="rounded-2xl border border-white/[0.06] p-5 flex flex-col items-center gap-3"
          style={{ background: 'rgba(10,20,12,0.65)', backdropFilter: 'blur(16px)' }}
        >
          <p className="text-cream-dim/50 text-[10px] tracking-widest uppercase">
            Show to staff at pickup
          </p>
          <div className="p-3 bg-white rounded-xl shadow-lg">
            <QRCodeSVG
              value={eTicketUrl}
              size={196}
              bgColor="#ffffff"
              fgColor="#0D1A10"
              level="M"
            />
          </div>
          <p className="text-cream-dim/40 text-xs font-mono">{ticket.name}</p>
        </div>

        {/* ── Garment details ── */}
        {ticket.garments && ticket.garments.length > 0 ? (
          <div className="space-y-3">
            <p className="text-cream-dim/50 text-[10px] tracking-widest uppercase px-1">
              Alteration Details
            </p>
            {ticket.garments.map((g) => {
              const gLines = ticket.lines?.filter((l) => l.garment_ref === g.garment_id) ?? []
              const gTotal = gLines.reduce((s, l) => s + (l.price ?? 0), 0)
              return (
                <div
                  key={g.garment_id}
                  className="rounded-xl border border-white/[0.06] p-4 space-y-2"
                  style={{ background: 'rgba(10,20,12,0.5)' }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-brass-shimmer font-semibold text-sm">{g.garment_type}</span>
                    {g.color ? (
                      <span className="text-xs text-cream-dim border border-brass/20 rounded px-1.5 py-0.5">
                        {g.color}
                      </span>
                    ) : null}
                  </div>
                  {gLines.length > 0 ? (
                    <div className="space-y-1 border-t border-white/[0.05] pt-2">
                      {gLines.map((line, i) => (
                        <div key={i} className="flex items-start justify-between gap-2">
                          <span className="text-cream-muted text-sm flex-1">{line.description}</span>
                          <span className="text-brass-light text-sm shrink-0">{formatCurrency(line.price)}</span>
                        </div>
                      ))}
                      {gLines.length > 1 ? (
                        <div className="flex justify-end border-t border-white/[0.04] pt-1">
                          <span className="text-cream-dim/50 text-xs">Subtotal: {formatCurrency(gTotal)}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}

        {/* ── Footer ── */}
        <div className="text-center pt-4 pb-6 space-y-1">
          <p className="text-cream-dim/30 text-xs">Thank you for choosing L&S Tailors.</p>
          <p className="text-cream-dim/20 text-[10px]">Questions? Contact us at your nearest location.</p>
        </div>

      </div>
    </div>
  )
}
