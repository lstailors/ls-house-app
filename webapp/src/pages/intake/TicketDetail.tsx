import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowLeft,
  Printer,
  Tag,
  Truck,
  User,
  AlertTriangle,
  Copy,
  Check,
  MessageSquare,
  Mail,
  MapPin,
  Pencil,
  Bell,
  Mic,
  CheckCircle2,
  ShoppingCart,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from "@ls/design/utils"
import { useMe } from '@/lib/session'
import type { CartPayload } from '@/lib/cart/parked'
import { ChargeTerminalButton } from '@/components/payments/ChargeTerminalButton'
import { EditTicketDrawer } from '@/components/alterations/EditTicketDrawer'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@ls/design/ui/dialog"
import { Textarea } from "@ls/design/ui/textarea"
import { Button } from "@ls/design/ui/button"
import { Input } from "@ls/design/ui/input"

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
  notes?: string
  customer_mobile?: string
  customer_email?: string
  notified_ready_at?: string
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

interface PaymentLinkResult {
  ok: boolean
  url: string
  payment_link_id: string
}

// ── Constants ──────────────────────────────────────────────────────────────

const WORKFLOW_STEPS = ['Received', 'In Progress', 'Ready', 'Picked Up'] as const
type WorkflowStep = typeof WORKFLOW_STEPS[number]

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

// ── WorkflowStepper ────────────────────────────────────────────────────────

function WorkflowStepper({
  current,
  isPending,
  onStep,
}: {
  current: string
  isPending: boolean
  onStep: (step: string) => void
}) {
  const currentIdx = stepIndex(current)
  const isCancelled = current === 'Cancelled'

  if (isCancelled) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 mb-6 text-center">
        <p className="text-red-400 text-sm flex items-center justify-center gap-2">
          <AlertTriangle size={14} /> This ticket has been cancelled
        </p>
      </div>
    )
  }

  const progressPct =
    WORKFLOW_STEPS.length <= 1 ? 0 : (currentIdx / (WORKFLOW_STEPS.length - 1)) * 100

  return (
    <div className="mb-6">
      <div
        className="rounded-2xl overflow-hidden border border-white/[0.06]"
        style={{ background: 'rgba(10,20,12,0.65)', backdropFilter: 'blur(18px)' }}
      >
        <div className="flex">
          {WORKFLOW_STEPS.map((step, idx) => {
            const isPast = idx < currentIdx
            const isActive = idx === currentIdx

            return (
              <button
                key={step}
                onClick={() => !isActive && !isPending && onStep(step)}
                disabled={isPending}
                className={cn(
                  'flex-1 flex flex-col items-center gap-2 py-4 px-2 relative transition-all duration-200',
                  'border-r border-white/[0.04] last:border-r-0',
                  isActive ? 'cursor-default' : 'cursor-pointer hover:bg-white/[0.03] active:bg-white/[0.06]'
                )}
              >
                {/* Active glow behind step */}
                {isActive ? (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background:
                        'radial-gradient(ellipse at 50% 10%, rgba(184,134,11,0.14) 0%, transparent 70%)',
                    }}
                  />
                ) : null}

                {/* Node */}
                <div
                  className={cn(
                    'relative w-7 h-7 rounded-full flex items-center justify-center border transition-all duration-300',
                    isActive
                      ? 'border-brass-shimmer/80 bg-brass-shimmer/20 scale-110'
                      : isPast
                        ? 'border-brass-light/40 bg-brass-light/10'
                        : 'border-white/10 bg-white/[0.03]'
                  )}
                  style={isActive ? { boxShadow: '0 0 12px rgba(184,134,11,0.45)' } : undefined}
                >
                  {isPast ? (
                    <Check size={12} className="text-brass-light" />
                  ) : (
                    <span
                      className={cn(
                        'text-[10px] font-bold',
                        isActive ? 'text-brass-shimmer' : 'text-cream-dim/25'
                      )}
                    >
                      {idx + 1}
                    </span>
                  )}
                </div>

                {/* Label */}
                <span
                  className={cn(
                    'text-[11px] font-medium leading-tight text-center transition-colors',
                    isActive
                      ? 'text-brass-shimmer'
                      : isPast
                        ? 'text-cream-dim/55'
                        : 'text-cream-dim/25'
                  )}
                >
                  {step}
                </span>
              </button>
            )
          })}
        </div>

        {/* Progress bar */}
        <div className="h-px bg-white/[0.05] relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 transition-all duration-700 ease-out"
            style={{
              width: `${progressPct}%`,
              background: 'linear-gradient(90deg, rgba(120,90,0,0.8), #DAA520)',
            }}
          />
        </div>
      </div>

      {isPending ? (
        <p className="text-center text-cream-dim/60 text-xs mt-2 animate-pulse">
          Updating status…
        </p>
      ) : null}
    </div>
  )
}

// ── GarmentCard ────────────────────────────────────────────────────────────

function GarmentCard({
  garment,
  lines,
  ticketName,
}: {
  garment: NonNullable<AlterationTicketDoc['garments']>[0]
  lines: AlterationTicketDoc['lines']
  ticketName: string
}) {
  const garmentLines = lines?.filter((l) => l.garment_ref === garment.name) ?? []
  const garmentTotal = garmentLines.reduce((sum, l) => sum + (l.price ?? 0), 0)
  const qrValue = window.location.origin + '/garments/' + ticketName + '/' + garment.garment_id

  return (
    <div className="glass-panel rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-brass-shimmer font-semibold text-sm">
              {garment.garment_type}
            </span>
            {garment.color ? (
              <span className="text-xs text-cream-dim border border-brass/20 rounded px-1.5 py-0.5">
                {garment.color}
              </span>
            ) : null}
          </div>
          <p className="text-cream-muted text-sm mt-0.5">{garment.garment_description}</p>
          <p className="text-cream-dim text-xs mt-1 font-mono">ID: {garment.garment_id}</p>
        </div>
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

      {garmentLines.length > 0 ? (
        <div className="border-t border-brass/10 pt-3 space-y-1.5">
          {garmentLines.map((line) => (
            <div key={line.name} className="flex items-start justify-between gap-2">
              <span className="text-cream-muted text-sm flex-1">{line.description}</span>
              <span className="text-brass-light text-sm font-medium shrink-0">
                {formatCurrency(line.price)}
              </span>
            </div>
          ))}
          {garmentLines.length > 1 ? (
            <div className="flex justify-end pt-1 border-t border-brass/10">
              <span className="text-cream-dim text-xs">
                Subtotal: {formatCurrency(garmentTotal)}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-cream-dim/50 text-xs italic">No alteration lines</p>
      )}
    </div>
  )
}

// ── CustomerCard ───────────────────────────────────────────────────────────

function CustomerCard({
  ticket,
  ticketName,
}: {
  ticket: AlterationTicketDoc
  ticketName: string
}) {
  const [smsOpen, setSmsOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [smsIncludeQr, setSmsIncludeQr] = useState(true)

  const firstName = ticket.customer_name?.split(' ')[0] ?? ticket.customer_name
  const dueFormatted = formatDate(ticket.due_date)
  const totalFormatted = formatCurrency(ticket.ticket_total ?? 0)

  const eTicketUrl = `${window.location.origin}/e-ticket/${ticket.name}`
  const defaultSmsMsg = `Hi ${firstName}, your alteration at L&S is ${ticket.workflow_state}. Total: ${totalFormatted}. Due: ${dueFormatted}. View your e-ticket: ${eTicketUrl}`
  const defaultEmailSubject = `Your alteration ticket ${ticket.name} update`
  const defaultEmailBody = `Hi ${firstName},\n\nYour alteration ticket ${ticket.name} is currently: ${ticket.workflow_state}.\n\nTotal: ${totalFormatted}\nDue: ${dueFormatted}\n\nPlease contact us if you have any questions.\n\nThank you,\nL&S Tailors`

  const [smsMsg, setSmsMsg] = useState(defaultSmsMsg)
  const [emailSubject, setEmailSubject] = useState(defaultEmailSubject)
  const [emailBody, setEmailBody] = useState(defaultEmailBody)

  const smsMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/intake-alterations/tickets/${ticketName}/sms`, {
        phone: ticket.customer_mobile,
        message: smsMsg,
        includeQr: smsIncludeQr,
      }),
    onSuccess: () => {
      toast.success('SMS sent!')
      setSmsOpen(false)
    },
    onError: () => toast.error('Failed to send SMS'),
  })

  const emailMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/intake-alterations/tickets/${ticketName}/email`, {
        to_email: ticket.customer_email,
        subject: emailSubject,
        message: emailBody,
      }),
    onSuccess: () => {
      toast.success('Email sent!')
      setEmailOpen(false)
    },
    onError: () => toast.error('Failed to send email'),
  })

  return (
    <section className="glass-panel rounded-lg p-5 space-y-3">
      <h2 className="ui-label text-cream-dim flex items-center gap-2">
        <User size={14} /> Customer
      </h2>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <p className="text-cream text-lg font-semibold">{ticket.customer_name}</p>
          {ticket.customer_mobile ? (
            <p className="text-cream-muted text-sm">{ticket.customer_mobile}</p>
          ) : (
            <p className="text-cream-dim/40 text-sm italic">No phone on file</p>
          )}
          {ticket.customer_email ? (
            <p className="text-cream-muted text-sm">{ticket.customer_email}</p>
          ) : (
            <p className="text-cream-dim/40 text-sm italic">No email on file</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSmsOpen(true)}
            disabled={!ticket.customer_mobile}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all',
              'bg-forest-raised border-brass/20 text-cream-muted',
              'hover:border-brass/40 hover:text-cream',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            <MessageSquare size={13} />
            SMS
          </button>
          <button
            onClick={() => setEmailOpen(true)}
            disabled={!ticket.customer_email}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all',
              'bg-forest-raised border-brass/20 text-cream-muted',
              'hover:border-brass/40 hover:text-cream',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            <Mail size={13} />
            Email
          </button>
        </div>
      </div>

      {/* SMS Dialog */}
      <Dialog open={smsOpen} onOpenChange={setSmsOpen}>
        <DialogContent className="bg-forest-raised border-brass/20 text-cream">
          <DialogHeader>
            <DialogTitle className="text-brass-shimmer">Send SMS to {firstName}</DialogTitle>
          </DialogHeader>
          <p className="text-cream-dim text-xs">To: {ticket.customer_mobile}</p>
          <Textarea
            value={smsMsg}
            onChange={(e) => setSmsMsg(e.target.value)}
            rows={5}
            className="bg-forest-deep border-brass/20 text-cream text-sm resize-none"
          />
          <button
            onClick={() => setSmsIncludeQr(!smsIncludeQr)}
            className={cn(
              'flex items-center gap-2 text-xs px-3 py-2 rounded-lg border w-full transition-all',
              smsIncludeQr
                ? 'bg-brass-shimmer/10 border-brass/30 text-brass-light'
                : 'bg-white/5 border-white/10 text-cream-dim/50'
            )}
          >
            <span className={cn(
              'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all',
              smsIncludeQr ? 'bg-brass-shimmer/30 border-brass-shimmer/60' : 'border-white/20'
            )}>
              {smsIncludeQr ? <Check size={10} className="text-brass-shimmer" /> : null}
            </span>
            Attach e-ticket QR code image (MMS)
          </button>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSmsOpen(false)}
              className="border-brass/20 text-cream-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={() => smsMutation.mutate()}
              disabled={smsMutation.isPending || !smsMsg.trim()}
              className="bg-brass-shimmer/20 border border-brass/30 text-brass-shimmer hover:bg-brass-shimmer/30"
            >
              {smsMutation.isPending ? 'Sending…' : smsIncludeQr ? 'Send MMS + QR' : 'Send SMS'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Dialog */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="bg-forest-raised border-brass/20 text-cream">
          <DialogHeader>
            <DialogTitle className="text-brass-shimmer">Send Email to {firstName}</DialogTitle>
          </DialogHeader>
          <p className="text-cream-dim text-xs">To: {ticket.customer_email}</p>
          <div className="space-y-2">
            <Input
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Subject"
              className="bg-forest-deep border-brass/20 text-cream text-sm"
            />
            <Textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={7}
              className="bg-forest-deep border-brass/20 text-cream text-sm resize-none"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEmailOpen(false)}
              className="border-brass/20 text-cream-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={() => emailMutation.mutate()}
              disabled={emailMutation.isPending || !emailBody.trim()}
              className="bg-brass-shimmer/20 border border-brass/30 text-brass-shimmer hover:bg-brass-shimmer/30"
            >
              {emailMutation.isPending ? 'Sending…' : 'Send Email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── TailorSection ─────────────────────────────────────────────────────────

function TailorSection({
  ticket,
  tailors,
  ticketName,
}: {
  ticket: AlterationTicketDoc
  tailors: TailorDoc[] | undefined
  ticketName: string
}) {
  const queryClient = useQueryClient()
  const [selectedTailor, setSelectedTailor] = useState(ticket.assigned_tailor ?? '')

  useEffect(() => {
    setSelectedTailor(ticket.assigned_tailor ?? '')
  }, [ticket.assigned_tailor])

  const assignTailorMutation = useMutation({
    mutationFn: (tailorId: string) =>
      api.patch(`/api/intake-alterations/tickets/${ticketName}/tailor`, { tailorId }),
    onSuccess: () => {
      toast.success('Tailor assigned')
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketName] })
    },
    onError: () => toast.error('Failed to assign tailor'),
  })

  function handleTailorChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    setSelectedTailor(val)
    assignTailorMutation.mutate(val)
  }

  const currentTailor = tailors?.find((t) => t.name === selectedTailor)

  return (
    <section className="glass-panel rounded-lg p-5 space-y-3">
      <h2 className="ui-label text-cream-dim flex items-center gap-2">
        <User size={14} /> Tailor Assignment
      </h2>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <select
            value={selectedTailor}
            onChange={handleTailorChange}
            disabled={assignTailorMutation.isPending}
            className={cn(
              'w-full bg-forest-raised border border-brass/20 rounded-md px-3 py-2',
              'text-cream text-sm focus:outline-none focus:ring-1 focus:ring-brass-shimmer/50',
              'disabled:opacity-60'
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

        {assignTailorMutation.isPending ? (
          <span className="text-cream-dim text-xs animate-pulse">Saving…</span>
        ) : null}
      </div>

      {currentTailor ? (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brass-shimmer/10 border border-brass/20 text-brass-light text-xs">
          <User size={11} />
          {currentTailor.full_name}
        </div>
      ) : (
        <p className="text-cream-dim/40 text-xs italic">No tailor assigned</p>
      )}
    </section>
  )
}

// ── TransferSection ───────────────────────────────────────────────────────

const TRANSFER_OPTIONS = [
  { id: 'NYC', label: 'NYC Store', sub: 'New York City location' },
  { id: 'HOU', label: 'HOU Store', sub: 'Houston location' },
] as const

function TransferSection({
  ticket,
  ticketName,
}: {
  ticket: AlterationTicketDoc
  ticketName: string
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const transferMutation = useMutation({
    mutationFn: (location: string) =>
      api.patch(`/api/intake-alterations/tickets/${ticketName}/transfer`, { location }),
    onSuccess: (_, location) => {
      toast.success(`Ticket transferred to ${location}`)
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketName] })
      setOpen(false)
    },
    onError: () => toast.error('Transfer failed'),
  })

  return (
    <section className="glass-panel rounded-lg p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="ui-label text-cream-dim flex items-center gap-2 mb-1">
            <MapPin size={14} /> Location
          </h2>
          <p className="text-cream-muted text-sm">{ticket.origin_location ?? '—'}</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all',
            'bg-forest-raised border-brass/20 text-cream-muted',
            'hover:border-brass/40 hover:text-cream'
          )}
        >
          <MapPin size={13} />
          Transfer
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-forest-raised border-brass/20 text-cream">
          <DialogHeader>
            <DialogTitle className="text-brass-shimmer">Transfer Location</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {TRANSFER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => transferMutation.mutate(opt.id)}
                disabled={transferMutation.isPending || ticket.origin_location === opt.id}
                className={cn(
                  'flex flex-col items-start p-4 rounded-lg border text-left transition-all',
                  ticket.origin_location === opt.id
                    ? 'border-brass-shimmer/60 bg-brass-shimmer/10 cursor-default'
                    : 'border-brass/20 bg-forest-deep hover:border-brass/40 hover:bg-forest-raised',
                  'disabled:opacity-60'
                )}
              >
                <span className={cn(
                  'font-semibold text-sm',
                  ticket.origin_location === opt.id ? 'text-brass-shimmer' : 'text-cream'
                )}>
                  {opt.label}
                  {ticket.origin_location === opt.id ? ' (current)' : ''}
                </span>
                <span className="text-cream-dim text-xs mt-0.5">{opt.sub}</span>
              </button>
            ))}
          </div>
          {transferMutation.isPending ? (
            <p className="text-cream-dim text-xs animate-pulse text-center">Transferring…</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ── NotifySection ─────────────────────────────────────────────────────────

function NotifySection({
  ticket,
  ticketName,
  autoNotify,
  onToggle,
}: {
  ticket: AlterationTicketDoc
  ticketName: string
  autoNotify: boolean
  onToggle: (v: boolean) => void
}) {
  const hasPhone = !!ticket.customer_mobile

  return (
    <section className="glass-panel rounded-lg p-5 space-y-4">
      <h2 className="ui-label text-cream-dim flex items-center gap-2">
        <Bell size={14} /> Notifications
      </h2>

      {/* Auto-notify SMS row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-medium', hasPhone ? 'text-cream' : 'text-cream-dim/50')}>
            Auto-notify when Ready
          </p>
          <p className="text-cream-dim/50 text-xs mt-0.5 leading-tight">
            {hasPhone
              ? 'Send SMS automatically when status changes to "Ready"'
              : 'No phone on file — add a phone number to enable'}
          </p>
        </div>
        <button
          onClick={() => hasPhone && onToggle(!autoNotify)}
          disabled={!hasPhone}
          aria-checked={autoNotify}
          role="switch"
          className={cn(
            'relative w-10 h-5 rounded-full border transition-all duration-200 shrink-0',
            autoNotify
              ? 'bg-brass-shimmer/25 border-brass-shimmer/50'
              : 'bg-white/5 border-white/10',
            !hasPhone && 'opacity-30 cursor-not-allowed'
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 bottom-0.5 aspect-square rounded-full transition-all duration-200',
              autoNotify
                ? 'right-0.5 left-auto bg-brass-shimmer shadow-[0_0_6px_rgba(184,134,11,0.5)]'
                : 'left-0.5 right-auto bg-cream-dim/40'
            )}
          />
        </button>
      </div>

      {/* Notified badge */}
      {ticket.notified_ready_at ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-900/20 border border-emerald-500/20">
          <Check size={13} className="text-emerald-400 shrink-0" />
          <p className="text-emerald-300 text-xs">
            {'Notified via SMS · '}
            {new Date(ticket.notified_ready_at).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </div>
      ) : null}

      {/* Sofia voice — coming soon */}
      <div className="flex items-center justify-between gap-4 opacity-35 pointer-events-none select-none">
        <div>
          <p className="text-cream text-sm font-medium flex items-center gap-1.5">
            <Mic size={13} />
            Sofia AI Voice Call
          </p>
          <p className="text-cream-dim/50 text-xs mt-0.5">
            Automated voice call when garment is ready
          </p>
        </div>
        <span className="text-[10px] border border-cream-dim/20 text-cream-dim/50 rounded-full px-2 py-0.5 shrink-0">
          Coming soon
        </span>
      </div>
    </section>
  )
}

// ── InlineDueDate ─────────────────────────────────────────────────────────

function InlineDueDate({
  ticket,
  ticketName,
}: {
  ticket: AlterationTicketDoc
  ticketName: string
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(ticket.due_date ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValue(ticket.due_date ?? '')
  }, [ticket.due_date])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [editing])

  const dueDateMutation = useMutation({
    mutationFn: (due_date: string) =>
      api.patch(`/api/intake-alterations/tickets/${ticketName}/due-date`, { due_date }),
    onSuccess: () => {
      toast.success('Due date updated')
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketName] })
      setEditing(false)
    },
    onError: () => {
      toast.error('Failed to update due date')
      setEditing(false)
    },
  })

  function handleSave() {
    if (value && value !== ticket.due_date) {
      dueDateMutation.mutate(value)
    } else {
      setEditing(false)
    }
  }

  return (
    <div className="text-right shrink-0">
      <p className="text-cream-dim text-xs ui-label">Ticket Date</p>
      <p className="text-cream-muted text-sm">{formatDate(ticket.ticket_date)}</p>
      <p className="text-cream-dim text-xs ui-label mt-2">Due</p>
      {editing ? (
        <input
          ref={inputRef}
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="text-cream text-sm bg-forest-raised border border-brass/30 rounded px-1.5 py-0.5 w-36 focus:outline-none focus:ring-1 focus:ring-brass-shimmer/50"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1 text-cream-muted text-sm hover:text-cream transition-colors group ml-auto"
        >
          {formatDate(ticket.due_date)}
          <Pencil size={11} className="text-cream-dim/40 group-hover:text-brass-light transition-colors" />
        </button>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function TicketDetail() {
  const { ticketName } = useParams<{ ticketName: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [copiedPayLink, setCopiedPayLink] = useState(false)
  const [paymentLinkOpen, setPaymentLinkOpen] = useState(false)
  const [paymentLink, setPaymentLink] = useState<PaymentLinkResult | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const { data: me } = useMe()

  const [autoNotify, setAutoNotify] = useState<boolean>(() => {
    try { return localStorage.getItem(`notify-ready-${ticketName}`) === 'true' } catch { return false }
  })

  function handleToggleNotify(val: boolean) {
    setAutoNotify(val)
    try { localStorage.setItem(`notify-ready-${ticketName}`, String(val)) } catch { /* ignore */ }
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  const {
    data: ticket,
    isLoading,
    isError,
  } = useQuery<AlterationTicketDoc>({
    queryKey: ['ticket', ticketName],
    queryFn: () => api.get<AlterationTicketDoc>('/api/intake-alterations/tickets/' + ticketName),
    enabled: !!ticketName,
  })

  const { data: tailors } = useQuery<TailorDoc[]>({
    queryKey: ['tailors'],
    queryFn: () => api.get<TailorDoc[]>('/api/intake-alterations/tailors'),
  })

  // ── Mutations ────────────────────────────────────────────────────────────

  const buildDeliveryPayload = () => {
    const garmentSummary = ticket?.lines && ticket.lines.length > 0
      ? ticket.lines.map((l: any) => l.description).filter(Boolean).join(', ')
      : ticket?.garments && ticket.garments.length > 0
        ? ticket.garments.map((g: any) => g.garment_type).join(', ')
        : 'Alteration';
    return {
      alteration_ticket: ticketName,
      customer_name: ticket?.customer_name ?? 'Walk-in',
      customer_phone: ticket?.customer_mobile ?? null,
      customer_erp_name: ticket?.customer ?? null,
      notify_phone: ticket?.customer_mobile ?? null,
      garment_summary: garmentSummary,
      garment_count: ticket?.lines?.length ?? ticket?.garments?.length ?? 1,
      location: ticket?.origin_location ?? 'NYC',
    };
  };

  const openInIntakeMutation = useMutation({
    mutationFn: async () => {
      if (!ticket) throw new Error('No ticket')
      const cartPayload: CartPayload = {
        garments: (ticket.garments ?? []).map((g) => ({
          id: g.garment_id,
          ref: g.garment_id,
          garmentType: g.garment_type,
          description: g.garment_description,
          color: g.color ?? '',
          notes: '',
          lines: (ticket.lines ?? [])
            .filter((l) => l.garment_ref === g.garment_id)
            .map((l) => ({
              preset: l.preset ?? '',
              description: l.description,
              price: l.price,
              estMinutes: null,
            })),
        })),
        lines: [],
      }
      return api.post<{ id: string }>('/api/carts', {
        createdBy: me?.user?.email ?? '',
        location: ticket.origin_location ?? 'NYC',
        customer: {
          name: ticket.customer_name ?? '',
          phone: ticket.customer_mobile ?? '',
          email: '',
        },
        customerRef: ticket.customer ?? null,
        cart: cartPayload,
      })
    },
    onSuccess: () => {
      toast.success('Cart created — open Saved Carts in intake')
      navigate('/intake/alterations')
    },
    onError: () => toast.error('Could not create cart'),
  })

  const createDeliveryMutation = useMutation({
    mutationFn: async () => api.post<{ id: string; qrToken: string }>('/api/deliveries/from-order', buildDeliveryPayload()),
    onSuccess: (result) => {
      toast.success('Delivery created — opening label');
      navigate(`/deliveries/${result.id}/label`);
    },
    onError: () => toast.error('Could not create delivery'),
  });

  const handDeliverMutation = useMutation({
    mutationFn: async () => {
      // Create delivery as already Delivered (in-store hand-off)
      const delivery = await api.post<{ id: string }>('/api/deliveries/from-order', {
        ...buildDeliveryPayload(),
        hand_deliver: true,
        method: 'Hand Delivery',
      });
      // Also mark ticket as Picked Up
      await api.patch(`/api/intake-alterations/tickets/${ticketName}/status`, { status: 'Picked Up' });
      return delivery;
    },
    onSuccess: (result) => {
      toast.success('Marked hand delivered — opening label');
      navigate(`/deliveries/${result.id}/label`);
    },
    onError: () => toast.error('Could not mark hand delivered'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) =>
      api.patch<{ ok: boolean; unpaid_release_sms?: { sent?: boolean; reason?: string } }>(
        `/api/intake-alterations/tickets/${ticketName}/status`,
        { status },
      ),
    onSuccess: async (data, status) => {
      toast.success(`Status updated to "${status}"`)
      const sms = data?.unpaid_release_sms
      if (status === 'Picked Up' && sms?.sent) {
        toast.success('Unpaid release SMS sent (balance + pay link)')
      } else if (status === 'Picked Up' && sms && !sms.sent && sms.reason && sms.reason !== 'paid_or_na' && sms.reason !== 'zero_balance' && sms.reason !== 'invoice_paid') {
        toast.error(`Released — SMS not sent (${sms.reason})`)
      }
      // Immediately update the progress bar without waiting for refetch
      queryClient.setQueryData(['ticket', ticketName], (old: any) =>
        old ? { ...old, workflow_state: status } : old
      )
      if (status === 'Ready' && autoNotify && ticket?.customer_mobile) {
        const firstName = ticket.customer_name?.split(' ')[0] ?? 'there'
        const eTicketUrl = `${window.location.origin}/e-ticket/${ticketName}`
        const msg = `Hi ${firstName}, your alteration at L&S Tailors is ready for pickup! Total: ${formatCurrency(ticket.ticket_total ?? 0)}. View your e-ticket & bring it in: ${eTicketUrl}`
        try {
          await api.post(`/api/intake-alterations/tickets/${ticketName}/notify-ready`, {
            phone: ticket.customer_mobile,
            message: msg,
          })
          toast.success('Customer notified via SMS!')
        } catch {
          toast.error('Status updated but SMS notification failed')
        }
      }
      // Delay refetch — ERPNext workflow state takes a moment to propagate
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['ticket', ticketName] })
      }, 3000)
    },
    onError: () => {
      toast.error('Failed to update status')
    },
  })

  const printTicketMutation = useMutation({
    mutationFn: async () => {
      const res = await api.raw('/api/print/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_name: ticketName }),
      })
      const result = await res.json().catch(() => ({}))
      if (!result.ok) throw new Error(result.error?.message ?? result.error ?? 'Print failed')
      return result
    },
    onSuccess: () => toast.success('✓ Printed'),
    onError: (e: Error) => toast.error(e.message),
  })

  const printReceiptMutation = useMutation({
    mutationFn: async () => {
      const res = await api.raw('/api/print/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice: ticket?.name }),
      })
      const result = await res.json().catch(() => ({}))
      if (!result.ok) throw new Error(result.error?.message ?? result.error ?? 'Receipt print failed')
      return result
    },
    onSuccess: () => toast.success('✓ Printed'),
    onError: (e: Error) => toast.error(e.message),
  })

  const createPaymentLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await api.raw('/api/payments/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice: ticket?.name }),
      })
      const result = await res.json().catch(() => ({})) as PaymentLinkResult | { error?: { message?: string } }
      if (!res.ok || !(result as PaymentLinkResult).url) {
        throw new Error((result as any)?.error?.message ?? 'Could not create payment link')
      }
      return result as PaymentLinkResult
    },
    onSuccess: (result) => {
      setPaymentLink(result)
      setPaymentLinkOpen(true)
      navigator.clipboard?.writeText(result.url).catch(() => undefined)
      toast.success('Payment link created')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const sendPaymentLinkSmsMutation = useMutation({
    mutationFn: async () => {
      if (!ticket?.customer_mobile || !paymentLink?.url) throw new Error('Missing phone or payment link')
      const firstName = ticket.customer_name?.split(' ')[0] ?? 'there'
      const message = `Hi ${firstName}, here is your secure L&S payment link for ${ticket.name}: ${paymentLink.url}`
      return api.post(`/api/intake-alterations/tickets/${ticketName}/sms`, {
        phone: ticket.customer_mobile,
        message,
        includeQr: false,
      })
    },
    onSuccess: () => toast.success('Payment link SMS sent'),
    onError: (e: Error) => toast.error(e.message || 'Failed to send SMS'),
  })

  const printPaymentLinkMutation = useMutation({
    mutationFn: async () => {
      if (!paymentLink?.url) throw new Error('Create a payment link first')
      const res = await api.raw('/api/print/payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: paymentLink.url,
          invoice: ticket?.name,
          amount: ticket?.ticket_total ?? 0,
          customer_name: ticket?.customer_name ?? '',
        }),
      })
      const result = await res.json().catch(() => ({}))
      if (!result.ok) throw new Error(result.error?.message ?? result.error ?? 'QR slip print failed')
      return result
    },
    onSuccess: () => toast.success('✓ Printed'),
    onError: (e: Error) => toast.error(e.message),
  })

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
              {ticket.is_rush === 1 ? (
                <span className="bg-red-900/50 text-red-300 border border-red-500/30 text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Rush
                </span>
              ) : null}
            </div>
            <p className="text-cream-muted text-lg">{ticket.customer_name}</p>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-zinc-800/60 text-zinc-300 border-zinc-500/30">
                {ticket.workflow_state}
              </span>
              <span className="text-cream-dim text-sm">{ticket.origin_location}</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openInIntakeMutation.mutate()}
                disabled={openInIntakeMutation.isPending}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all',
                  'bg-forest-raised border-brass/25 text-cream-muted',
                  'hover:border-brass/50 hover:text-cream',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                <ShoppingCart size={12} />
                {openInIntakeMutation.isPending ? 'Creating…' : 'Open in Intake'}
              </button>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all',
                  'bg-forest-raised border-brass/25 text-cream-muted',
                  'hover:border-brass/50 hover:text-cream'
                )}
              >
                <Pencil size={12} />
                Edit
              </button>
            </div>
            <InlineDueDate ticket={ticket} ticketName={ticketName!} />
          </div>
        </div>

        {/* ── Workflow Stepper ── */}
        <WorkflowStepper
          current={ticket.workflow_state}
          isPending={updateStatusMutation.isPending}
          onStep={(step) => {
            if (step !== ticket.workflow_state) {
              const unpaid =
                step === 'Picked Up' &&
                ticket.payment_status !== 'Paid' &&
                ticket.payment_status !== 'N/A' &&
                (ticket.ticket_total ?? 0) > 0
              if (unpaid) {
                const ok = window.confirm(
                  'Release without payment?\n\nClient can pick up now. An SMS will be sent that the work was released with balance due + pay link.',
                )
                if (!ok) return
              }
              updateStatusMutation.mutate(step)
            }
          }}
        />

        {/* ── Customer Card ── */}
        <CustomerCard ticket={ticket} ticketName={ticketName!} />

        {/* ── Notifications ── */}
        <NotifySection
          ticket={ticket}
          ticketName={ticketName!}
          autoNotify={autoNotify}
          onToggle={handleToggleNotify}
        />

        {/* ── Garments ── */}
        <section>
          <h2 className="ui-label text-cream-dim mb-3">
            Garments ({ticket.garments?.length ?? 0})
          </h2>
          {ticket.garments && ticket.garments.length > 0 ? (
            <div className="space-y-3">
              {ticket.garments.map((g) => (
                <GarmentCard
                  key={g.name}
                  garment={g}
                  lines={ticket.lines}
                  ticketName={ticketName!}
                />
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

          {ticket.payment_status === 'Paid' ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 justify-end">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-900/30 px-3 py-1.5 text-sm text-emerald-300">
                <CheckCircle2 size={14} /> Paid ✓
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => printReceiptMutation.mutate()}
                disabled={printReceiptMutation.isPending}
                className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream"
              >
                {printReceiptMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Printer className="h-4 w-4 mr-1.5" />}
                Print Receipt
              </Button>
            </div>
          ) : ticket.payment_status !== 'Paid' && (ticket.ticket_total ?? 0) > 0 ? (
            <div className="mt-3 flex flex-col items-stretch gap-2">
              <p className="text-xs text-cream-dim text-right">
                Pickup allowed unpaid — client gets balance SMS on release.
              </p>
              <div className="flex flex-wrap items-center gap-3 justify-end">
              <ChargeTerminalButton
                invoiceId={ticket.name}
                amountCents={Math.round((ticket.ticket_total ?? 0) * 100)}
                amountDisplay={formatCurrency(ticket.ticket_total ?? 0)}
                onSuccess={() => {
                  toast.success('Payment captured — refreshing…')
                  queryClient.invalidateQueries({ queryKey: ['ticket', ticketName] })
                }}
                onError={(msg) => toast.error(msg)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => createPaymentLinkMutation.mutate()}
                disabled={createPaymentLinkMutation.isPending}
                className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream"
              >
                {createPaymentLinkMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                )}
                Send Payment Link
              </Button>
              {(ticket.workflow_state === 'Picked Up' || ticket.workflow_state === 'Ready') && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await api.post(`/api/intake-alterations/tickets/${ticketName}/notify-unpaid-release`, {})
                      toast.success('Unpaid release SMS sent')
                    } catch {
                      toast.error('Could not send unpaid release SMS')
                    }
                  }}
                  className="border-amber-500/30 text-amber-200 hover:bg-amber-900/20"
                >
                  SMS unpaid balance
                </Button>
              )}
              </div>
            </div>
          ) : null}
        </section>

        {/* ── Tailor Assignment ── */}
        <TailorSection ticket={ticket} tailors={tailors} ticketName={ticketName!} />

        {/* ── Transfer Location ── */}
        <TransferSection ticket={ticket} ticketName={ticketName!} />

        {/* ── Actions ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => createDeliveryMutation.mutate()}
            disabled={createDeliveryMutation.isPending}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
              'bg-forest-raised border border-brass/20 text-cream-muted',
              'hover:border-brass/40 hover:text-cream transition-all',
              'disabled:opacity-60 disabled:cursor-not-allowed'
            )}
          >
            <Truck size={15} />
            {createDeliveryMutation.isPending ? 'Creating…' : 'Create Delivery'}
          </button>

          {/* Hand Delivered — shown when ticket is Ready */}
          {(ticket?.workflow_state === 'Ready' || ticket?.workflow_state === 'Complete') && (
            <button
              type="button"
              onClick={() => {
                const unpaid =
                  ticket.payment_status !== 'Paid' &&
                  ticket.payment_status !== 'N/A' &&
                  (ticket.ticket_total ?? 0) > 0
                if (unpaid) {
                  const ok = window.confirm(
                    'Hand deliver without payment?\n\nClient takes the garment now. SMS will note release + unpaid balance + pay link.',
                  )
                  if (!ok) return
                }
                handDeliverMutation.mutate()
              }}
              disabled={handDeliverMutation.isPending}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
                'bg-signal-emerald/10 border border-signal-emerald/40 text-signal-emerald',
                'hover:bg-signal-emerald/20 hover:border-signal-emerald/60 transition-all',
                'disabled:opacity-60 disabled:cursor-not-allowed'
              )}
            >
              <CheckCircle2 size={15} />
              {handDeliverMutation.isPending ? 'Processing…' : 'Mark Hand Delivered'}
            </button>
          )}

          <button
            type="button"
            onClick={() => printTicketMutation.mutate()}
            disabled={printTicketMutation.isPending}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
              'bg-forest-raised border border-brass/20 text-cream-muted',
              'hover:border-brass/40 hover:text-cream transition-all',
              'disabled:opacity-60 disabled:cursor-not-allowed'
            )}
          >
            {printTicketMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer size={15} />}
            {printTicketMutation.isPending ? 'Printing…' : 'Print Ticket'}
          </button>

          <Link
            to={`/orders/alterations/${ticketName}/receipt`}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
              'bg-forest-raised border border-brass/20 text-cream-muted',
              'hover:border-brass/40 hover:text-cream transition-all'
            )}
          >
            <Printer size={15} />
            View Ticket
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

          <Link
            to={`/orders/alterations/${ticketName}/photos`}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
              'bg-forest-raised border border-brass/20 text-cream-muted',
              'hover:border-brass/40 hover:text-cream transition-all'
            )}
          >
            Photos
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

      <Dialog open={paymentLinkOpen} onOpenChange={setPaymentLinkOpen}>
        <DialogContent className="bg-forest-raised border-brass/20 text-cream">
          <DialogHeader>
            <DialogTitle className="text-brass-shimmer">Square payment link</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-brass/20 bg-forest-deep p-3">
              <p className="text-xs text-cream-dim mb-1">Secure URL</p>
              <p className="break-all font-mono text-xs text-cream-muted">{paymentLink?.url}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream"
                onClick={() => {
                  if (!paymentLink?.url) return
                  navigator.clipboard.writeText(paymentLink.url).then(() => {
                    setCopiedPayLink(true)
                    toast.success('Payment link copied')
                    setTimeout(() => setCopiedPayLink(false), 2500)
                  })
                }}
              >
                {copiedPayLink ? <Check className="h-4 w-4 mr-1.5 text-signal-emerald" /> : <Copy className="h-4 w-4 mr-1.5" />}
                {copiedPayLink ? 'Copied' : 'Copy URL'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!ticket.customer_mobile || sendPaymentLinkSmsMutation.isPending}
                onClick={() => sendPaymentLinkSmsMutation.mutate()}
                className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream"
              >
                {sendPaymentLinkSmsMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <MessageSquare className="h-4 w-4 mr-1.5" />}
                SMS to Client
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={printPaymentLinkMutation.isPending}
                onClick={() => printPaymentLinkMutation.mutate()}
                className="border-brass/20 text-cream-muted hover:bg-brass/10 hover:text-cream"
              >
                {printPaymentLinkMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Printer className="h-4 w-4 mr-1.5" />}
                Print QR Slip
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <EditTicketDrawer
        open={editOpen}
        onOpenChange={setEditOpen}
        ticketName={ticketName!}
        initialGarments={ticket.garments ?? []}
        initialLines={ticket.lines ?? []}
      />
    </div>
  )
}
