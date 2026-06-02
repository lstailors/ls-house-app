import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Printer, ArrowLeft, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { buildReceiptXml, sendToEpson, getPrinterIp } from '@/lib/thermal'

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
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatUSD(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function AlterationReceipt() {
  const { ticketName } = useParams<{ ticketName: string }>()
  const navigate = useNavigate()
  const [printing, setPrinting] = useState(false)

  const { data: ticket, isLoading } = useQuery<AlterationTicketDoc>({
    queryKey: ['intake-ticket', ticketName],
    queryFn: () => api.get<AlterationTicketDoc>(`/api/intake-alterations/tickets/${ticketName}`),
    enabled: !!ticketName,
  })

  const handleEpsonPrint = async () => {
    if (!ticket) return
    if (!getPrinterIp()) {
      toast.error('No printer IP set — go to Settings to add it')
      return
    }
    setPrinting(true)
    try {
      const xml = buildReceiptXml({
        ticketName: ticket.name,
        customerName: ticket.customer_name,
        customerPhone: ticket.customer_phone,
        location: ticket.origin_location === 'HOU' ? 'Houston' : 'New York City',
        ticketDate: formatDate(ticket.ticket_date),
        dueDate: formatDate(ticket.due_date),
        isRush: ticket.is_rush === 1,
        deliveryMethod: ticket.delivery_method,
        paymentStatus: ticket.payment_status ?? '—',
        customerNotes: ticket.customer_notes,
        total: ticket.ticket_total,
        garments: (ticket.garments ?? []).map(g => ({
          id: g.garment_id,
          type: g.garment_type,
          color: g.color,
          lines: (ticket.lines ?? [])
            .filter(l => l.garment_ref === g.garment_id)
            .map(l => ({ description: l.description, price: l.price })),
        })),
      })
      await sendToEpson(xml)
      toast.success('Receipt sent to printer')
    } catch (e: any) {
      toast.error(e.message || 'Print failed — check printer is on and on same WiFi')
    } finally {
      setPrinting(false)
    }
  }

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
    <>
      {/* 80mm thermal print styles */}
      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 2mm; }
          body { background: white !important; color: black !important; }
          .no-print { display: none !important; }
          .receipt-body { width: 76mm; font-family: monospace; font-size: 11px; color: black; }
        }
      `}</style>

      <div className="min-h-screen bg-forest-deep text-cream">
        {/* Toolbar — hidden on print */}
        <div className="no-print flex items-center justify-between px-5 py-4 border-b border-brass/15">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-cream-muted hover:text-cream transition-colors text-sm"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-cream font-medium text-sm">{ticket.name} — Receipt</h1>
          <div className="flex items-center gap-2">
            {/* Direct Epson print */}
            <button
              onClick={handleEpsonPrint}
              disabled={printing}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                'bg-brass/20 border border-brass/40 text-brass-shimmer',
                'hover:bg-brass/30 disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <Zap size={14} />
              {printing ? 'Printing…' : 'Print to Epson'}
            </button>
            {/* System print dialog (AirPrint) */}
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-forest-raised border border-brass/20 text-cream-muted text-sm hover:border-brass/40 hover:text-cream transition-all"
            >
              <Printer size={14} /> Print Dialog
            </button>
          </div>
        </div>

        {/* Receipt — 80mm-width constrained */}
        <div className="receipt-body max-w-[80mm] mx-auto p-3 font-mono text-xs">

          {/* Header */}
          <div className="text-center border-b border-current pb-2 mb-2">
            <p className="font-bold text-sm text-brass-shimmer print:text-black">L&S Custom Tailors</p>
            <p className="text-cream-dim print:text-gray-600 text-[10px]">
              {ticket.origin_location === 'HOU' ? 'Houston' : 'New York City'}
            </p>
          </div>

          {/* Ticket info */}
          <div className="space-y-0.5 mb-2">
            {[
              ['Ticket', ticket.name],
              ['Customer', ticket.customer_name],
              ticket.customer_phone ? ['Phone', ticket.customer_phone] : null,
              ['Date', formatDate(ticket.ticket_date)],
              ['Due', formatDate(ticket.due_date) + (ticket.is_rush === 1 ? ' ** RUSH **' : '')],
              ticket.delivery_method ? ['Delivery', ticket.delivery_method] : null,
            ].filter(Boolean).map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-cream-dim print:text-gray-500">{label}:</span>
                <span className={cn(
                  'text-cream print:text-black ml-2 text-right',
                  label === 'Due' && ticket.is_rush === 1 && 'text-red-400 font-bold print:text-red-600',
                )}>{value}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-current my-2" />

          {/* Line items */}
          {garments.map(g => {
            const gLines = lines.filter(l => l.garment_ref === g.garment_id)
            const gTotal = gLines.reduce((s, l) => s + (l.price ?? 0), 0)
            return (
              <div key={g.name} className="mb-2">
                <div className="flex justify-between font-bold">
                  <span className="text-cream print:text-black">
                    {g.garment_type}{g.color ? ` - ${g.color}` : ''} ({g.garment_id})
                  </span>
                  {gTotal > 0 && <span className="text-cream print:text-black">{formatUSD(gTotal)}</span>}
                </div>
                {gLines.map(l => (
                  <div key={l.name} className="flex justify-between ml-2 text-cream-dim print:text-gray-600">
                    <span>{l.description}</span>
                    <span>{formatUSD(l.price)}</span>
                  </div>
                ))}
              </div>
            )
          })}

          <div className="border-t-2 border-current my-2" />

          {/* Total */}
          <div className="flex justify-between font-bold text-sm">
            <span className="text-cream print:text-black">TOTAL</span>
            <span className="text-brass-shimmer print:text-black">{formatUSD(ticket.ticket_total)}</span>
          </div>
          <div className="flex justify-between text-cream-dim print:text-gray-600">
            <span>Payment:</span>
            <span className={ticket.payment_status === 'Paid' ? 'text-emerald-400 print:text-green-700' : 'text-signal-amber print:text-orange-600'}>
              {ticket.payment_status ?? '—'}
            </span>
          </div>

          {ticket.customer_notes && (
            <>
              <div className="border-t border-current my-2" />
              <p className="text-cream-dim print:text-gray-600 italic">{ticket.customer_notes}</p>
            </>
          )}

          <div className="border-t border-current my-2" />
          <p className="text-center text-cream-dim print:text-gray-500 text-[10px]">
            Thank you for choosing L&S Custom Tailors.
          </p>
        </div>
      </div>
    </>
  )
}
