import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, ArrowLeft, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { buildTagsXml, sendToEpson, getPrinterIp } from '@/lib/thermal'

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
      const garments = (ticket.garments ?? []).map(g => ({
        id: g.garment_id,
        type: g.garment_type,
        color: g.color,
        dueDate: formatDate(ticket.due_date),
        lines: (ticket.lines ?? [])
          .filter(l => l.garment_ref === g.garment_id)
          .map(l => ({ description: l.description })),
      }))
      const xml = buildTagsXml({
        ticketName: ticket.name,
        customerName: ticket.customer_name,
        location: ticket.origin_location === 'HOU' ? 'HOU' : 'NYC',
        isRush: ticket.is_rush === 1,
        appBaseUrl: window.location.origin,
        garments,
      })
      await sendToEpson(xml)
      toast.success(`${garments.length} tag${garments.length !== 1 ? 's' : ''} sent to printer`)
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

  return (
    <>
      {/* 80mm thermal print styles */}
      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 2mm; }
          body { background: white !important; color: black !important; }
          .no-print { display: none !important; }
          .tag-card { break-inside: avoid; page-break-inside: avoid; border: 1px solid #ccc; padding: 4mm; margin-bottom: 2mm; font-family: monospace; font-size: 10px; color: black; width: 76mm; }
        }
      `}</style>

      <div className="min-h-screen bg-forest-deep text-cream">
        {/* Toolbar */}
        <div className="no-print flex items-center justify-between px-5 py-4 border-b border-brass/15">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-cream-muted hover:text-cream transition-colors text-sm"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-cream font-medium text-sm">
            {ticket.name} — {garments.length} Garment Tag{garments.length !== 1 ? 's' : ''}
          </h1>
          <div className="flex items-center gap-2">
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
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-forest-raised border border-brass/20 text-cream-muted text-sm hover:border-brass/40 hover:text-cream transition-all"
            >
              <Printer size={14} /> Print Dialog
            </button>
          </div>
        </div>

        {/* Tags */}
        <div className="p-5 max-w-2xl mx-auto">
          {garments.length === 0 ? (
            <p className="text-cream-dim text-center py-12">No garments on this ticket.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 print:grid-cols-1 print:gap-2">
              {garments.map(g => {
                const gLines = (ticket.lines ?? []).filter(l => l.garment_ref === g.garment_id)
                const tagUrl = `${window.location.origin}/garments/${ticket.name}/${g.garment_id}`

                return (
                  <div
                    key={g.name}
                    className={cn(
                      'tag-card rounded-xl border p-4 space-y-3 font-mono text-xs',
                      'bg-forest-raised border-brass/20',
                      ticket.is_rush === 1 && 'border-red-500/50',
                    )}
                  >
                    {/* Rush */}
                    {ticket.is_rush === 1 && (
                      <div className="text-center text-red-400 font-bold text-sm print:text-red-600 tracking-widest">
                        ⚡ RUSH ⚡
                      </div>
                    )}

                    {/* Top row: info + QR */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <p className="text-brass-shimmer font-bold print:text-black text-[11px]">{ticket.name}</p>
                        <p className="text-cream font-bold text-sm print:text-black truncate">{ticket.customer_name}</p>
                        <p className="text-cream font-semibold print:text-black">
                          {g.garment_type}
                          {g.color ? <span className="text-cream-dim print:text-gray-500 font-normal"> · {g.color}</span> : null}
                        </p>
                        <p className="text-cream-dim print:text-gray-500 text-[10px]">ID: {g.garment_id}</p>
                      </div>
                      <div className="shrink-0 p-1.5 bg-white rounded-lg">
                        <QRCodeSVG value={tagUrl} size={72} level="M" />
                      </div>
                    </div>

                    {/* Alteration lines */}
                    {gLines.length > 0 && (
                      <div className="border-t border-brass/10 print:border-gray-200 pt-2 space-y-0.5">
                        {gLines.map(l => (
                          <p key={l.name} className="text-cream-dim print:text-gray-600 text-[10px] truncate">
                            · {l.description}
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="border-t border-brass/10 print:border-gray-200 pt-2 flex justify-between">
                      <span className="text-cream-dim print:text-gray-500 text-[10px]">
                        Due {formatDate(ticket.due_date)}
                      </span>
                      <span className="text-cream-dim print:text-gray-500 text-[10px] uppercase tracking-wide">
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
    </>
  )
}
