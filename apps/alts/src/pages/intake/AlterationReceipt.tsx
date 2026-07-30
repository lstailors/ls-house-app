import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Printer, ArrowLeft, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@ls/api-client'
import { cn } from "@ls/design/utils"

interface AlterationTicketDoc {
  name: string
  customer_name: string
  customer: string
  customer_phone: string
  origin_location: string
  workflow_state: string
  ticket_date: string
  due_date: string
  is_rush: 0 | 1
  ticket_total: number
  payment_status: string
  delivery_method?: string
  customer_notes?: string
  garments?: Array<{ name: string; garment_id: string; garment_type: string; garment_description: string; color?: string }>
  lines?: Array<{ name: string; garment_ref: string; description: string; price: number }>
}

function fmt(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function usd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function AlterationReceipt() {
  const { ticketName } = useParams<{ ticketName: string }>()
  const navigate = useNavigate()
  const [printing, setPrinting] = useState(false)
  const printed = useRef(false)

  const { data: ticket, isLoading } = useQuery<AlterationTicketDoc>({
    queryKey: ['intake-ticket', ticketName],
    queryFn: () => api.get<AlterationTicketDoc>(`/api/intake-alterations/tickets/${ticketName}`),
    enabled: !!ticketName,
  })

  // Auto-open print dialog once data is loaded
  useEffect(() => {
    if (ticket && !printed.current) {
      printed.current = true
      setTimeout(() => window.print(), 600)
    }
  }, [ticket])

  const handleThermalPrint = async () => {
    if (!ticket) return
    setPrinting(true)
    try {
      const res = await api.raw('/api/print/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_name: ticket.name }),
      })
      const result = await res.json().catch(() => ({}))
      if (!result.ok) throw new Error(result.error ?? 'Print failed')
      toast.success('✓ Printed')
    } catch (e: any) {
      toast.error(e.message || 'Print failed')
    } finally { setPrinting(false) }
  }

  if (isLoading) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" />
    </div>
  )

  if (!ticket) return (
    <div className="min-h-screen bg-white flex items-center justify-center text-gray-500">Ticket not found.</div>
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
        }
      `}</style>

      {/* Screen toolbar — hidden on print */}
      <div className="no-print bg-gray-900 text-white flex items-center justify-between px-4 py-3 gap-3">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-300 hover:text-white text-sm">
          <ArrowLeft size={15} /> Back
        </button>
        <span className="text-sm font-medium text-gray-200">{ticket.name} · Receipt</span>
        <div className="flex gap-2">
          <button onClick={handleThermalPrint} disabled={printing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium disabled:opacity-50">
            <Zap size={12} /> {printing ? 'Printing…' : 'Print to Thermal'}
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium">
            <Printer size={12} /> Print
          </button>
        </div>
      </div>

      {/* Receipt — clean white, 80mm-constrained */}
      <div style={{ width: '76mm', margin: '12px auto', fontFamily: 'monospace', fontSize: '11px', color: '#000', background: '#fff', padding: '4mm 2mm' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '6px', marginBottom: '6px' }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: '16px', fontWeight: 'bold' }}>L&S Custom Tailors</div>
          <div style={{ fontSize: '10px', marginTop: '2px' }}>
            {ticket.origin_location === 'HOU' ? 'Houston' : 'New York City'}
          </div>
        </div>

        {/* Ticket info */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6px', fontSize: '10px' }}>
          <tbody>
            {(() => {
              const rows: Array<[string, string]> = [
                ['Ticket', String(ticket.name ?? '')],
                ['Customer', String(ticket.customer_name ?? '')],
                ['Date', fmt(ticket.ticket_date)],
                ['Due', fmt(ticket.due_date) + (ticket.is_rush === 1 ? '  ★ RUSH' : '')],
              ]
              if (ticket.customer_phone) rows.splice(2, 0, ['Phone', String(ticket.customer_phone)])
              if (ticket.delivery_method) rows.push(['Delivery', String(ticket.delivery_method)])
              return rows.map(([label, value]) => (
                <tr key={label}>
                  <td style={{ color: '#555', paddingRight: '8px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}:</td>
                  <td style={{ fontWeight: label === 'Customer' || label === 'Due' ? 'bold' : 'normal', color: label === 'Due' && ticket.is_rush === 1 ? '#cc0000' : '#000' }}>{value}</td>
                </tr>
              ))
            })()}
          </tbody>
        </table>

        <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

        {/* Line items */}
        {garments.map(g => {
          const gLines = lines.filter(l => l.garment_ref === g.garment_id)
          const gTotal = gLines.reduce((s, l) => s + (l.price ?? 0), 0)
          return (
            <div key={g.name} style={{ marginBottom: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '10px' }}>
                <span>{g.garment_type}{g.color ? ` · ${g.color}` : ''} ({g.garment_id})</span>
                {gTotal > 0 && <span>{usd(gTotal)}</span>}
              </div>
              {gLines.map(l => (
                <div key={l.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', paddingLeft: '8px', color: '#333' }}>
                  <span>{l.description}</span>
                  <span>{usd(l.price)}</span>
                </div>
              ))}
            </div>
          )
        })}

        <div style={{ borderTop: '2px solid #000', margin: '6px 0' }} />

        {/* Total */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' }}>
          <span>TOTAL</span>
          <span>{usd(ticket.ticket_total)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#555' }}>
          <span>Payment:</span>
          <span style={{ fontWeight: 'bold', color: ticket.payment_status === 'Paid' ? '#006600' : '#cc6600' }}>{ticket.payment_status ?? '—'}</span>
        </div>

        {ticket.customer_notes && (
          <>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ fontSize: '9px', color: '#444', fontStyle: 'italic' }}>{ticket.customer_notes}</div>
          </>
        )}

        <div style={{ borderTop: '1px dashed #000', margin: '8px 0 4px', textAlign: 'center', fontSize: '9px', color: '#555' }}>
          Thank you for choosing L&S Custom Tailors.
        </div>
      </div>
    </>
  )
}
