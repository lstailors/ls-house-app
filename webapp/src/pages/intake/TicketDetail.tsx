import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft,
  Printer,
  Tag,
  User,
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

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
  assigned_tailor?: string
  assigned_tailor_name?: string
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
    preset?: string
  }>
}

interface TailorDoc {
  name: string
  full_name: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const WORKFLOW_STEPS = ['Received', 'In Progress', 'Ready', 'Picked Up'] as const
type WorkflowStep = typeof WORKFLOW_STEPS[number]

const STATUS_COLORS: Record<string, string> = {
  Received: 'bg-blue-900/40 text-blue-300 border-blue-500/30',
  'In Progress': 'bg-amber-900/40 text-amber-300 border-amber-500/30',
  Ready: 'bg-emerald-900/40 text-emerald-300 border-emerald-500/30',
  'Picked Up': 'bg-zinc-800/60 text-zinc-400 border-zinc-500/30',
  Cancelled: 'bg-red-900/40 text-red-400 border-red-500/30',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function stepIndex(state: string) {
  return WORKFLOW_STEPS.indexOf(state as WorkflowStep)
}

// ── Sub-components ─────────────────────────────────────────────────────────

function WorkflowBar({ current }: { current: string }) {
  const currentIdx = stepIndex(current)
  const isCancelled = current === 'Cancelled'

  return (
    <div className="glass-panel rounded-lg p-4 mb-6">
      <div className="flex items-center gap-1 sm:gap-2">
        {WORKFLOW_STEPS.map((step, idx) => {
          const isPast = idx < currentIdx
          const isActive = idx === currentIdx
          const isFuture = idx > currentIdx

          return (
            <div key={step} className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div
                  className={cn(
                    'flex items-center justify-center w-7 h-7 rounded-full border-2 transition-all mb-1 shrink-0',
                    isCancelled
                      ? 'border-red-500/40 text-red-500/40'
                      : isPast
                        ? 'border-brass-light bg-brass-light/20 text-brass-light'
                        : isActive
                          ? 'border-brass-shimmer bg-brass-shimmer/20 text-brass-shimmer scale-110'
                          : 'border-cream-dim/20 text-cream-dim/30'
                  )}
                >
                  {isPast && !isCancelled ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <Circle size={14} />
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs text-center leading-tight truncate max-w-full',
                    isCancelled
                      ? 'text-red-500/50'
                      : isActive
                        ? 'text-brass-shimmer font-semibold'
                        : isPast
                          ? 'text-brass-light/70'
                          : 'text-cream-dim/40'
                  )}
                >
                  {step}
                </span>
              </div>

              {idx < WORKFLOW_STEPS.length - 1 && (
                <div
                  className={cn(
                    'h-0.5 flex-1 min-w-[8px] mb-4 transition-all',
                    isCancelled
                      ? 'bg-red-500/20'
                      : idx < currentIdx
                        ? 'bg-brass-light/50'
                        : 'bg-cream-dim/10'
                  )}
                />
              )}
            </div>
          )
        })}
      </div>

      {isCancelled && (
        <p className="text-center text-red-400 text-xs mt-2 flex items-center justify-center gap-1">
          <AlertTriangle size={12} /> This ticket has been cancelled
        </p>
      )}
    </div>
  )
}

function GarmentCard({
  garment,
  lines,
}: {
  garment: AlterationTicketDoc['garments'][0]
  lines: AlterationTicketDoc['lines']
}) {
  const garmentLines = lines?.filter((l) => l.garment_ref === garment.name) ?? []
  const garmentTotal = garmentLines.reduce((sum, l) => sum + (l.price ?? 0), 0)
  const ticketName = useParams<{ ticketName: string }>().ticketName
  const qrValue = window.location.origin + '/garments/' + ticketName + '/' + garment.garment_id

  return (
    <div className="glass-panel rounded-lg p-4 space-y-3">
      {/* Garment header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-brass-shimmer font-semibold text-sm">
              {garment.garment_type}
            </span>
            {garment.color && (
              <span className="text-xs text-cream-dim border border-brass/20 rounded px-1.5 py-0.5">
                {garment.color}
              </span>
            )}
          </div>
          <p className="text-cream-muted text-sm mt-0.5">{garment.garment_description}</p>
          <p className="text-cream-dim text-xs mt-1 font-mono">ID: {garment.garment_id}</p>
        </div>

        {/* QR Code */}
        <div className="shrink-0 p-1.5 bg-white rounded-md">
          <QRCodeSVG
            value={qrValue}
            size={64}
            bgColor="#ffffff"
            fgColor="#1a1a1a"
            level="M"
          />
        </div>
      </div>

      {/* Alteration lines */}
      {garmentLines.length > 0 && (
        <div className="border-t border-brass/10 pt-3 space-y-1.5">
          {garmentLines.map((line) => (
            <div key={line.name} className="flex items-start justify-between gap-2">
              <span className="text-cream-muted text-sm flex-1">{line.description}</span>
              <span className="text-brass-light text-sm font-medium shrink-0">
                {formatCurrency(line.price)}
              </span>
            </div>
          ))}
          {garmentLines.length > 1 && (
            <div className="flex justify-end pt-1 border-t border-brass/10">
              <span className="text-cream-dim text-xs">
                Subtotal: {formatCurrency(garmentTotal)}
              </span>
            </div>
          )}
        </div>
      )}

      {garmentLines.length === 0 && (
        <p className="text-cream-dim/50 text-xs italic">No alteration lines</p>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function TicketDetail() {
  const { ticketName } = useParams<{ ticketName: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selectedTailor, setSelectedTailor] = useState<string>('')
  const [selectedTailorName, setSelectedTailorName] = useState<string>('')

  // ── Queries ──────────────────────────────────────────────────────────────

  const {
    data: ticket,
    isLoading,
    isError,
  } = useQuery<AlterationTicketDoc>({
    queryKey: ['ticket', ticketName],
    queryFn: () => api.get<AlterationTicketDoc>('/api/intake-alterations/tickets/' + ticketName),
    enabled: !!ticketName,
    onSuccess: (data) => {
      setSelectedTailor(data.assigned_tailor ?? '')
      setSelectedTailorName(data.assigned_tailor_name ?? '')
    },
  })

  const { data: tailors } = useQuery<TailorDoc[]>({
    queryKey: ['tailors'],
    queryFn: () => api.get<TailorDoc[]>('/api/intake-alterations/tailors'),
  })

  // ── Mutations ────────────────────────────────────────────────────────────

  const assignTailorMutation = useMutation({
    mutationFn: ({ tailorId, tailorName }: { tailorId: string; tailorName: string }) =>
      api.patch(`/api/intake-alterations/tickets/${ticketName}/tailor`, { tailorId, tailorName }),
    onSuccess: () => {
      toast.success('Tailor assigned successfully')
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketName] })
    },
    onError: () => {
      toast.error('Failed to assign tailor')
    },
  })

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/api/intake-alterations/tickets/${ticketName}/status`, { status }),
    onSuccess: (_, status) => {
      toast.success(`Status updated to "${status}"`)
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketName] })
    },
    onError: () => {
      toast.error('Failed to update status')
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleTailorChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    setSelectedTailor(val)
    const tailor = tailors?.find((t) => t.name === val)
    setSelectedTailorName(tailor?.full_name ?? '')
  }

  function handleSaveTailor() {
    assignTailorMutation.mutate({ tailorId: selectedTailor, tailorName: selectedTailorName })
  }

  function handleStatusUpdate(status: string) {
    if (status === ticket?.workflow_state) return
    updateStatusMutation.mutate(status)
  }

  // ── Render guards ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-forest-deep flex items-center justify-center">
        <div className="text-cream-dim animate-pulse">Loading ticket…</div>
      </div>
    )
  }

  if (isError || !ticket) {
    return (
      <div className="min-h-screen bg-forest-deep flex flex-col items-center justify-center gap-4">
        <AlertTriangle className="text-red-400" size={40} />
        <p className="text-cream-muted">Ticket not found</p>
        <button
          onClick={() => navigate(-1)}
          className="text-brass-light underline text-sm"
        >
          Go back
        </button>
      </div>
    )
  }

  const statusPillClass = STATUS_COLORS[ticket.workflow_state] ?? 'bg-zinc-800 text-zinc-400'

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-forest-deep text-cream">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-brass-shimmer italic text-2xl font-bold tracking-wide">
                {ticket.name}
              </h1>
              {ticket.is_rush === 1 && (
                <span className="bg-red-900/50 text-red-300 border border-red-500/30 text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Rush
                </span>
              )}
            </div>
            <p className="text-cream-muted text-lg">{ticket.customer_name}</p>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border', statusPillClass)}>
                {ticket.workflow_state}
              </span>
              <span className="text-cream-dim text-sm">{ticket.origin_location}</span>
            </div>
          </div>

          <div className="text-right shrink-0">
            <p className="text-cream-dim text-xs ui-label">Ticket Date</p>
            <p className="text-cream-muted text-sm">{formatDate(ticket.ticket_date)}</p>
            {ticket.due_date && (
              <>
                <p className="text-cream-dim text-xs ui-label mt-2">Due</p>
                <p className="text-cream-muted text-sm">{formatDate(ticket.due_date)}</p>
              </>
            )}
          </div>
        </div>

        {/* ── Workflow Bar ── */}
        <WorkflowBar current={ticket.workflow_state} />

        {/* ── Garments ── */}
        <section>
          <h2 className="ui-label text-cream-dim mb-3">
            Garments ({ticket.garments?.length ?? 0})
          </h2>
          {ticket.garments && ticket.garments.length > 0 ? (
            <div className="space-y-3">
              {ticket.garments.map((g) => (
                <GarmentCard key={g.name} garment={g} lines={ticket.lines} />
              ))}
            </div>
          ) : (
            <p className="text-cream-dim/50 italic text-sm">No garments on this ticket</p>
          )}

          {/* Ticket total */}
          <div className="mt-4 flex justify-end">
            <div className="glass-panel rounded-lg px-5 py-3 flex items-center gap-4">
              <span className="text-cream-dim text-sm ui-label">Ticket Total</span>
              <span className="text-brass-shimmer text-xl font-bold">
                {formatCurrency(ticket.ticket_total ?? 0)}
              </span>
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  ticket.payment_status === 'Paid'
                    ? 'bg-emerald-900/40 text-emerald-300'
                    : 'bg-amber-900/40 text-amber-300'
                )}
              >
                {ticket.payment_status}
              </span>
            </div>
          </div>
        </section>

        {/* ── Tailor Assignment ── */}
        <section className="glass-panel rounded-lg p-5 space-y-4">
          <h2 className="ui-label text-cream-dim flex items-center gap-2">
            <User size={14} /> Tailor Assignment
          </h2>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <select
                value={selectedTailor}
                onChange={handleTailorChange}
                className={cn(
                  'w-full bg-forest-raised border border-brass/20 rounded-md px-3 py-2',
                  'text-cream text-sm focus:outline-none focus:ring-1 focus:ring-brass-shimmer/50'
                )}
              >
                <option value="">— Unassigned —</option>
                {tailors?.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleSaveTailor}
              disabled={assignTailorMutation.isPending}
              className={cn(
                'px-4 py-2 rounded-md text-sm font-medium transition-all',
                'bg-brass-shimmer/20 border border-brass/30 text-brass-shimmer',
                'hover:bg-brass-shimmer/30 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {assignTailorMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>

          {ticket.assigned_tailor_name && (
            <p className="text-cream-dim text-xs">
              Currently:{' '}
              <span className="text-brass-light">{ticket.assigned_tailor_name}</span>
            </p>
          )}
          {!ticket.assigned_tailor && (
            <p className="text-cream-dim/50 text-xs italic">No tailor assigned</p>
          )}
        </section>

        {/* ── Status Update ── */}
        <section className="glass-panel rounded-lg p-5 space-y-4">
          <h2 className="ui-label text-cream-dim">Update Status</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {WORKFLOW_STEPS.map((step) => {
              const isActive = ticket.workflow_state === step
              return (
                <button
                  key={step}
                  onClick={() => handleStatusUpdate(step)}
                  disabled={isActive || updateStatusMutation.isPending}
                  className={cn(
                    'px-3 py-2 rounded-md text-sm font-medium border transition-all',
                    isActive
                      ? 'bg-brass-shimmer/25 border-brass-shimmer/60 text-brass-shimmer cursor-default'
                      : 'bg-forest-raised border-brass/20 text-cream-muted hover:border-brass/40 hover:text-cream',
                    'disabled:opacity-70'
                  )}
                >
                  {step}
                </button>
              )
            })}
          </div>
          {updateStatusMutation.isPending && (
            <p className="text-cream-dim text-xs animate-pulse">Updating status…</p>
          )}
        </section>

        {/* ── Actions ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            to={`/orders/alterations/${ticketName}/receipt`}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
              'bg-forest-raised border border-brass/20 text-cream-muted',
              'hover:border-brass/40 hover:text-cream transition-all'
            )}
          >
            <Printer size={15} />
            Print Receipt
          </Link>

          <Link
            to={`/orders/alterations/${ticketName}/tags`}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
              'bg-forest-raised border border-brass/20 text-cream-muted',
              'hover:border-brass/40 hover:text-cream transition-all'
            )}
          >
            <Tag size={15} />
            Print Tags
          </Link>

          <button
            onClick={() => navigate(-1)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm',
              'text-cream-dim hover:text-cream-muted transition-colors ml-auto'
            )}
          >
            <ArrowLeft size={15} />
            Back
          </button>
        </div>

      </div>
    </div>
  )
}
