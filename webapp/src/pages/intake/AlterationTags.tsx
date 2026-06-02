import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, ArrowLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface AlterationTicketDoc {
  name: string
  customer_name: string
  customer: string
  origin_location: string
  workflow_state: string
  ticket_date: string
  due_date: string
  is_rush: 0 | 1
  ticket_total: number
  payment_status: string
  garments?: Array<{
    name: string
    garment_id: string
    garment_type: string
    garment_description: string
    color?: string
  }>
  lines?: Array<{
    name: string
    garment_ref: string
    description: string
    price: number
  }>
}

function formatDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AlterationTags() {
  const { ticketName } = useParams<{ ticketName: string }>()
  const navigate = useNavigate()

  const { data: ticket, isLoading } = useQuery<AlterationTicketDoc>({
    queryKey: ['intake-ticket', ticketName],
    queryFn: () => api.get<AlterationTicketDoc>(`/api/intake-alterations/tickets/${ticketName}`),
    enabled: !!ticketName,
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-forest-deep flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-brass/30 border-t-brass animate-spin" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="min-h-screen bg-forest-deep flex items-center justify-center text-cream-dim">
        Ticket not found.
      </div>
    )
  }

  const garments = ticket.garments ?? []

  return (
    <div className="min-h-screen bg-forest-deep text-cream">
      {/* Screen-only toolbar */}
      <div className="print:hidden flex items-center justify-between px-5 py-4 border-b border-brass/15">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-cream-muted hover:text-cream transition-colors text-sm"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="text-cream font-medium">{ticket.name} — Garment Tags</h1>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brass/20 border border-brass/30 text-brass-shimmer text-sm hover:bg-brass/30 transition-all"
        >
          <Printer size={14} /> Print
        </button>
      </div>

      {/* Tags grid */}
      <div className="p-6 print:p-4">
        {garments.length === 0 ? (
          <p className="text-cream-dim text-center py-12">No garments on this ticket.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 print:grid-cols-3 print:gap-3">
            {garments.map((g) => {
              const garmentLines = (ticket.lines ?? []).filter(l => l.garment_ref === g.garment_id)
              const tagUrl = `${window.location.origin}/garments/${ticket.name}/${g.garment_id}`

              return (
                <div
                  key={g.name}
                  className={cn(
                    'rounded-xl border p-4 space-y-3',
                    'bg-forest-raised border-brass/20',
                    'print:bg-white print:border-gray-300 print:rounded-sm print:break-inside-avoid',
                    ticket.is_rush === 1 && 'border-red-500/50 print:border-red-400',
                  )}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {ticket.is_rush === 1 && (
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-red-400 print:text-red-600 mb-1">
                          ⚡ RUSH
                        </span>
                      )}
                      <p className="text-brass-shimmer font-mono text-xs font-bold print:text-black">
                        {ticket.name}
                      </p>
                      <p className="text-cream font-semibold text-sm truncate print:text-black">
                        {ticket.customer_name}
                      </p>
                    </div>
                    {/* QR Code */}
                    <div className="shrink-0 p-1 bg-white rounded">
                      <QRCodeSVG value={tagUrl} size={64} level="M" />
                    </div>
                  </div>

                  {/* Garment info */}
                  <div className="border-t border-brass/10 print:border-gray-200 pt-2 space-y-1">
                    <p className="text-cream font-semibold text-sm print:text-black">
                      {g.garment_type}
                      {g.color ? <span className="text-cream-dim print:text-gray-500 font-normal"> · {g.color}</span> : null}
                    </p>
                    <p className="text-cream-dim text-xs print:text-gray-600 font-mono">
                      ID: {g.garment_id}
                    </p>
                    {g.garment_description && g.garment_description !== g.garment_type ? (
                      <p className="text-cream-muted text-xs print:text-gray-500">{g.garment_description}</p>
                    ) : null}
                  </div>

                  {/* Alteration lines */}
                  {garmentLines.length > 0 && (
                    <div className="space-y-0.5">
                      {garmentLines.map(l => (
                        <p key={l.name} className="text-cream-dim text-[11px] print:text-gray-600 truncate">
                          · {l.description}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="border-t border-brass/10 print:border-gray-200 pt-2 flex justify-between items-center">
                    <span className="text-cream-dim text-[10px] print:text-gray-500">
                      Due {formatDate(ticket.due_date)}
                    </span>
                    <span className="text-cream-dim text-[10px] print:text-gray-500 uppercase tracking-wide">
                      {ticket.origin_location}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
