import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Circle, Tag, User, Calendar, MapPin, Shirt } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

interface GarmentData {
  garment: {
    name: string
    garment_id: string
    garment_type: string
    garment_description: string
    color: string
    fabric_notes: string
    garment_status: string
    garment_total: number
  }
  lines: Array<{ name: string; garment_ref: string; description: string; price: number; line_status: string }>
  ticket: {
    name: string
    customer: string
    customerName: string | null
    originLocation: string
    workflowState: string
    promisedDate: string | null
    dueDate: string | null
  }
}

const STATUS_ORDER = ['Received', 'In Progress', 'Ready'] as const

const STATUS_COLORS: Record<string, string> = {
  Received: 'bg-blue-900/40 text-blue-300 border-blue-500/30',
  'In Progress': 'bg-amber-900/40 text-amber-300 border-amber-500/30',
  Ready: 'bg-emerald-900/40 text-emerald-300 border-emerald-500/30',
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function GarmentTag() {
  const { ticketId, garmentId } = useParams<{ ticketId: string; garmentId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['garment', ticketId, garmentId],
    queryFn: () => api.get<GarmentData>(`/api/alterations/${ticketId}/garments/${garmentId}`),
    enabled: !!ticketId && !!garmentId,
  })

  const statusMutation = useMutation({
    mutationFn: (garment_status: string) =>
      api.raw(`/api/alterations/${ticketId}/garments/${garmentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garment_status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['garment', ticketId, garmentId] })
      toast.success('Garment status updated')
    },
    onError: () => toast.error('Failed to update status'),
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-forest-deep flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-brass/30 border-t-brass animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-forest-deep flex flex-col items-center justify-center gap-4 text-cream-dim">
        <p>Garment not found.</p>
        <button onClick={() => navigate(-1)} className="text-brass-shimmer text-sm underline">Go back</button>
      </div>
    )
  }

  const { garment, lines, ticket } = data
  const currentStatusIdx = STATUS_ORDER.indexOf(garment.garment_status as typeof STATUS_ORDER[number])
  const isReady = garment.garment_status === 'Ready'

  return (
    <div className="min-h-screen bg-forest-deep text-cream">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/orders/alterations/${ticketId}`)}
            className="w-9 h-9 rounded-full bg-forest-raised border border-brass/20 flex items-center justify-center hover:border-brass/40 transition-all"
          >
            <ArrowLeft size={16} className="text-cream-muted" />
          </button>
          <div>
            <h1 className="text-cream text-xl font-bold font-mono">{garment.garment_id}</h1>
            <p className="text-cream-dim text-xs">{ticket.name}</p>
          </div>
          <div className="ml-auto">
            <span className={cn('px-2.5 py-1 rounded-full text-xs border font-medium', STATUS_COLORS[garment.garment_status] ?? 'bg-zinc-800/60 text-zinc-400 border-zinc-500/30')}>
              {garment.garment_status}
            </span>
          </div>
        </div>

        {/* Garment Info */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-brass-shimmer/15 border border-brass/30 flex items-center justify-center shrink-0">
              <Shirt size={18} className="text-brass-shimmer" />
            </div>
            <div className="flex-1">
              <h2 className="text-cream font-semibold text-lg">{garment.garment_type}</h2>
              <p className="text-cream-muted text-sm">{garment.garment_description}</p>
              {garment.color ? <p className="text-cream-dim text-xs mt-0.5">{garment.color}</p> : null}
            </div>
            <p className="text-brass-shimmer font-semibold">{formatCurrency(garment.garment_total)}</p>
          </div>

          {garment.fabric_notes ? (
            <p className="text-cream-dim text-sm bg-forest-raised rounded-lg px-3 py-2">{garment.fabric_notes}</p>
          ) : null}

          {/* Alteration lines */}
          {lines.length > 0 ? (
            <div className="space-y-2 border-t border-brass/10 pt-3">
              <p className="text-cream-dim text-xs ui-label">Alterations</p>
              {lines.map((l) => (
                <div key={l.name} className="flex justify-between items-center text-sm">
                  <span className="text-cream-muted">{l.description}</span>
                  <span className="text-cream font-mono text-xs">{formatCurrency(l.price)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-cream-dim/50 text-sm italic">No alteration lines</p>
          )}
        </div>

        {/* Ticket Info */}
        <div className="glass-panel rounded-xl p-5 space-y-3">
          <p className="text-cream-dim text-xs ui-label">Ticket</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-cream-muted">
              <User size={13} className="text-brass-shimmer/60" />
              <span>{ticket.customerName ?? ticket.customer}</span>
            </div>
            <div className="flex items-center gap-2 text-cream-muted">
              <MapPin size={13} className="text-brass-shimmer/60" />
              <span>{ticket.originLocation}</span>
            </div>
            {ticket.dueDate ? (
              <div className="flex items-center gap-2 text-cream-muted">
                <Calendar size={13} className="text-brass-shimmer/60" />
                <span>Due {formatDate(ticket.dueDate)}</span>
              </div>
            ) : null}
            {ticket.promisedDate ? (
              <div className="flex items-center gap-2 text-cream-muted">
                <Calendar size={13} className="text-brass-shimmer/60" />
                <span>Promised {formatDate(ticket.promisedDate)}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Status Progress */}
        <div className="glass-panel rounded-xl p-5 space-y-3">
          <p className="text-cream-dim text-xs ui-label">Garment Progress</p>
          <div className="flex items-center gap-2">
            {STATUS_ORDER.map((s, i) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={cn(
                  'flex flex-col items-center gap-1 flex-1',
                )}>
                  <div className={cn(
                    'w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all',
                    i <= currentStatusIdx
                      ? 'border-brass bg-brass-shimmer/20'
                      : 'border-brass/20 bg-transparent',
                  )}>
                    {i < currentStatusIdx ? (
                      <CheckCircle2 size={14} className="text-brass-shimmer" />
                    ) : i === currentStatusIdx ? (
                      <div className="w-2 h-2 rounded-full bg-brass-shimmer" />
                    ) : (
                      <Circle size={14} className="text-brass/20" />
                    )}
                  </div>
                  <span className={cn('text-xs text-center leading-tight', i <= currentStatusIdx ? 'text-cream-muted' : 'text-cream-dim/40')}>
                    {s}
                  </span>
                </div>
                {i < STATUS_ORDER.length - 1 ? (
                  <div className={cn('h-px flex-1 mb-4', i < currentStatusIdx ? 'bg-brass/40' : 'bg-brass/10')} />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {!isReady ? (
            <button
              onClick={() => {
                const next = currentStatusIdx === 0 ? 'In Progress' : 'Ready'
                statusMutation.mutate(next)
              }}
              disabled={statusMutation.isPending}
              className={cn(
                'w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2',
                'bg-emerald-700/80 border border-emerald-500/40 text-emerald-100',
                'hover:bg-emerald-600/80 disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <CheckCircle2 size={16} />
              {statusMutation.isPending
                ? 'Saving…'
                : currentStatusIdx === 0
                ? 'Start Work on Garment'
                : 'Mark Garment Ready'}
            </button>
          ) : (
            <div className="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 bg-emerald-900/30 border border-emerald-500/30 text-emerald-400">
              <CheckCircle2 size={16} />
              Garment Ready
            </div>
          )}

          <button
            onClick={() => navigate(`/orders/alterations/${ticketId}`)}
            className="w-full py-3 rounded-xl text-sm text-cream-muted border border-brass/20 bg-forest-raised hover:border-brass/40 transition-all flex items-center justify-center gap-2"
          >
            <Tag size={14} />
            View Full Ticket
          </button>
        </div>

      </div>
    </div>
  )
}
