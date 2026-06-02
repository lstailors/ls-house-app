import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Printer, ArrowLeft } from 'lucide-react'
import { api } from '@/lib/api'

interface AlterationTicketDoc {
  name: string
  customer_name: string
  customer: string
  customer_phone: string
  origin_location: string
  workflow_state: string
  ticket_date: string
  due_date: string
  promised_date?: string
  is_rush: 0 | 1
  ticket_total: number
  payment_status: string
  delivery_method?: string
  internal_notes?: string
  customer_notes?: string
  garments?: Array<{
    name: string
    garment_id: string
    garment_type: string
    garment_description: string
    color?: string
    garment_total?: number
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
  return new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatUSD(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function AlterationReceipt() {
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
  const lines = ticket.lines ?? []

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
        <h1 className="text-cream font-medium">{ticket.name} — Receipt</h1>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brass/20 border border-brass/30 text-brass-shimmer text-sm hover:bg-brass/30 transition-all"
        >
          <Printer size={14} /> Print
        </button>
      </div>

      {/* Receipt */}
      <div className="max-w-md mx-auto p-6 print:p-4 print:max-w-none">
        <div className="space-y-6 print:space-y-4">

          {/* Header */}
          <div className="text-center border-b border-brass/20 print:border-gray-300 pb-5 print:pb-3">
            <p className="text-brass-shimmer font-display italic text-2xl print:text-black print:text-xl">
              L&S Custom Tailors
            </p>
            <p className="text-cream-dim text-xs print:text-gray-500 mt-1">
              {ticket.origin_location === 'HOU' ? 'Houston' : 'New York City'}
            </p>
          </div>

          {/* Ticket info */}
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-cream-dim print:text-gray-500">Ticket</span>
              <span className="text-cream font-mono print:text-black">{ticket.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-cream-dim print:text-gray-500">Date</span>
              <span className="text-cream print:text-black">{formatDate(ticket.ticket_date)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-cream-dim print:text-gray-500">Customer</span>
              <span className="text-cream font-medium print:text-black">{ticket.customer_name}</span>
            </div>
            {ticket.customer_phone ? (
              <div className="flex justify-between text-sm">
                <span className="text-cream-dim print:text-gray-500">Phone</span>
                <span className="text-cream print:text-black">{ticket.customer_phone}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-sm">
              <span className="text-cream-dim print:text-gray-500">Due</span>
              <span className={`font-medium print:text-black ${ticket.is_rush === 1 ? 'text-red-400 print:text-red-600' : 'text-cream'}`}>
                {formatDate(ticket.due_date)}
                {ticket.is_rush === 1 ? ' · RUSH' : ''}
              </span>
            </div>
            {ticket.delivery_method ? (
              <div className="flex justify-between text-sm">
                <span className="text-cream-dim print:text-gray-500">Delivery</span>
                <span className="text-cream print:text-black">{ticket.delivery_method}</span>
              </div>
            ) : null}
          </div>

          {/* Line items by garment */}
          <div className="border-t border-brass/15 print:border-gray-300 pt-4 print:pt-3 space-y-4 print:space-y-3">
            {garments.map((g) => {
              const gLines = lines.filter(l => l.garment_ref === g.garment_id)
              const gTotal = gLines.reduce((s, l) => s + (l.price ?? 0), 0)
              return (
                <div key={g.name}>
                  <div className="flex justify-between items-baseline">
                    <span className="text-cream font-medium text-sm print:text-black">
                      {g.garment_type}
                      {g.color ? <span className="text-cream-dim print:text-gray-500 font-normal"> · {g.color}</span> : null}
                      <span className="text-brass-shimmer print:text-gray-400 font-mono text-[10px] ml-2">({g.garment_id})</span>
                    </span>
                    {gTotal > 0 ? (
                      <span className="text-cream font-medium text-sm print:text-black">{formatUSD(gTotal)}</span>
                    ) : null}
                  </div>
                  {gLines.map(l => (
                    <div key={l.name} className="flex justify-between text-xs ml-3 mt-0.5">
                      <span className="text-cream-dim print:text-gray-500">{l.description}</span>
                      <span className="text-cream-muted print:text-gray-600">{formatUSD(l.price)}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          {/* Total */}
          <div className="border-t-2 border-brass/30 print:border-gray-400 pt-3 flex justify-between items-baseline">
            <span className="text-cream font-semibold print:text-black">Total</span>
            <span className="text-brass-shimmer font-display italic text-2xl print:text-black print:text-xl">
              {formatUSD(ticket.ticket_total)}
            </span>
          </div>

          {/* Payment status */}
          <div className="flex justify-between text-sm">
            <span className="text-cream-dim print:text-gray-500">Payment</span>
            <span className={`font-medium print:text-black ${
              ticket.payment_status === 'Paid' ? 'text-emerald-400 print:text-green-600' : 'text-signal-amber print:text-orange-600'
            }`}>
              {ticket.payment_status ?? '—'}
            </span>
          </div>

          {/* Customer notes */}
          {ticket.customer_notes ? (
            <div className="border-t border-brass/10 print:border-gray-200 pt-3">
              <p className="text-cream-dim text-xs print:text-gray-500 mb-1 uppercase tracking-wide text-[9px]">Notes</p>
              <p className="text-cream-muted text-sm print:text-gray-600 italic">{ticket.customer_notes}</p>
            </div>
          ) : null}

          {/* Footer */}
          <div className="border-t border-brass/10 print:border-gray-200 pt-4 text-center">
            <p className="text-cream-dim text-xs print:text-gray-400 italic">
              Thank you for choosing L&S Custom Tailors.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
