import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, ArrowLeft, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface AlterationTicketDoc {
  name: string
  customer_name: string
  origin_location: string
  due_date: string
  is_rush: 0 | 1
  garments?: Array<{ name: string; garment_id: string; garment_type: string; garment_description: string; color?: string }>
  lines?: Array<{ name: string; garment_ref: string; description: string; price: number }>
}

function fmt(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AlterationTags() {
  const { ticketName } = useParams<{ ticketName: string }>()
  const navigate = useNavigate()
  const [printing, setPrinting] = useState(false)
  const printed = useRef(false)

  const { data: ticket, isLoading } = useQuery<AlterationTicketDoc>({
    queryKey: ['intake-ticket', ticketName],
    queryFn: () => api.get<AlterationTicketDoc>(`/api/intake-alterations/tickets/${ticketName}`),
    enabled: !!ticketName,
  })

  // Auto-open print dialog once loaded
  useEffect(() => {
    if (ticket && !printed.current) {
      printed.current = true
      setTimeout(() => window.print(), 600)
    }
  }, [ticket])

  const handleEpsonPrint = async () => {
    if (!ticket) return
    setPrinting(true)
    try {
      const res = await api.raw('/api/print/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_name: ticket.name }),
      })
      const result = await res.json().catch(() => ({}))
      if (!result.ok) throw new Error(result.error ?? 'Print failed')
      toast.success(`✓ Printed ${ticket.garments?.length ?? 0} tag${(ticket.garments?.length ?? 0) !== 1 ? 's' : ''}`)
    } catch (e: any) {
      toast.error(e.message || 'Print failed')
    } finally { setPrinting(false) }
  }

  if (isLoading) return (
    <div className="min-h-dvh bg-white flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" />
    </div>
  )

  if (!ticket) return (
    <div className="min-h-dvh bg-white flex items-center justify-center text-gray-500">Ticket not found.</div>
  )

  const garments = ticket.garments ?? []
  const lines = ticket.lines ?? []

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        @media print {
          @page { size: 80mm auto; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; width: 80mm !important; background: white; }
          .no-print { display: none !important; }
          .tag { page-break-inside: avoid; break-inside: avoid; width: 76mm !important; }
          div[style*="gridTemplateColumns"] { display: block !important; }
        }
      `}</style>

      {/* Screen toolbar */}
      <div className="no-print bg-gray-900 text-white flex items-center justify-between px-4 py-3">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-300 hover:text-white text-sm">
          <ArrowLeft size={15} /> Back
        </button>
        <span className="text-sm font-medium text-gray-200">
          {ticket.name} · {garments.length} Tag{garments.length !== 1 ? 's' : ''}
        </span>
        <div className="flex gap-2">
          <button onClick={handleEpsonPrint} disabled={printing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium disabled:opacity-50">
            <Zap size={12} /> {printing ? 'Printing…' : 'Print to Thermal'}
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium">
            <Printer size={12} /> Print
          </button>
        </div>
      </div>

      {/* Tags — clean white grid */}
      <div style={{ background: '#fff', padding: '8px' }}>
        {garments.length === 0 && (
          <p style={{ textAlign: 'center', color: '#888', padding: '40px', fontFamily: 'sans-serif' }}>No garments on this ticket.</p>
        )}

        {/* 2-up grid on screen, single column on print */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', maxWidth: '180mm', margin: '0 auto' }}
          className="print:block print:max-w-none">
          {garments.map(g => {
            const gLines = lines.filter(l => l.garment_ref === g.garment_id)
            const tagUrl = `${window.location.origin}/garments/${ticket.name}/${g.garment_id}`

            return (
              <div key={g.name} className="tag" style={{
                border: ticket.is_rush === 1 ? '2px solid #cc0000' : '1px solid #ccc',
                borderRadius: '6px',
                padding: '8px',
                fontFamily: 'monospace',
                fontSize: '10px',
                color: '#000',
                background: '#fff',
                marginBottom: '4px',
              }}>
                {/* Rush banner */}
                {ticket.is_rush === 1 && (
                  <div style={{ background: '#cc0000', color: '#fff', textAlign: 'center', fontWeight: 'bold', fontSize: '10px', letterSpacing: '2px', padding: '2px', marginBottom: '6px', borderRadius: '3px' }}>
                    ★ RUSH ★
                  </div>
                )}

                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'Georgia, serif', fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' }}>
                      {ticket.customer_name}
                    </div>
                    <div style={{ fontSize: '9px', color: '#555', fontFamily: 'monospace' }}>{ticket.name}</div>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', marginTop: '4px' }}>
                      {g.garment_type}
                      {g.color ? <span style={{ fontWeight: 'normal', color: '#555' }}> · {g.color}</span> : null}
                    </div>
                    <div style={{ fontSize: '9px', color: '#777', marginTop: '1px' }}>ID: {g.garment_id}</div>
                  </div>
                  {/* QR code */}
                  <div style={{ flexShrink: 0, padding: '3px', border: '1px solid #ddd', borderRadius: '4px', background: '#fff' }}>
                    <QRCodeSVG value={tagUrl} size={72} level="M" />
                  </div>
                </div>

                {/* Alteration lines */}
                {gLines.length > 0 && (
                  <div style={{ borderTop: '1px dashed #ccc', paddingTop: '4px', marginTop: '2px' }}>
                    {gLines.map(l => (
                      <div key={l.name} style={{ fontSize: '9px', color: '#333', padding: '1px 0' }}>· {l.description}</div>
                    ))}
                  </div>
                )}

                {/* Footer */}
                <div style={{ borderTop: '1px dashed #ccc', marginTop: '6px', paddingTop: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#666' }}>
                  <span>Due {fmt(ticket.due_date)}</span>
                  <span>{ticket.origin_location}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
