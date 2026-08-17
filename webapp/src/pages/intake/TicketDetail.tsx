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
import { api } from '@ls/api-client'
import { cn } from "@ls/design/utils"
import { useMe } from '@ls/auth'
import type { CartPayload } from '@/lib/cart/parked'
import { ChargeTerminalButton } from '@/components/payments/ChargeTerminalButton'
import { ChargeCardOnFileButton } from '@/components/payments/ChargeCardOnFileButton'
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
  /** Staff-set. Gates SI + payment CTAs. Never auto-derived from price. */
  billing_status?: string
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
                {isActive ? (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background:
                        'radial-gradient(ellipse at 50% 10%, rgba(184,134,11,0.14) 0%, transparent 70%)',
                    }}
                  />
                ) : null}

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
                    <span className={cn('text-[10px] font-bold', isActive ? 'text-brass-shimmer' : 'text-cream-dim/25')}>
                      {idx + 1}
                    </span>
                  )}
                </div>

                <span
                  className={cn(
                    'text-[11px] font-medium leading-tight text-center transition-colors',
                    isActive ? 'text-brass-shimmer' : isPast ? 'text-cream-dim/55' : 'text-cream-dim/25'
                  )}
                >
                  {step}
                </span>
              </button>
            )
          })}
        </div>

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
          <QRCodeSVG value={qrValue} size={64} bgColor="#ffffff" fgColor="#1a1a1a" level="M" />
        </div>
      </div>

      {garmentLines.length > 0 ? (
        <div className="border-t border-brass/10 pt-3 space-y-1.5">
          {garmentLines.map((line) => (
            <div key={line.name} className="flex items-start justify-between gap-2">
              <span className="text-cream-muted text-base sm:text-sm flex-1">{line.description}</span>
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

export default function TicketDetail() {
  const { ticketName } = useParams<{ ticketName: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return (
    <div>
      <WorkflowStepper current="Received" isPending={false} onStep={() => undefined} />
      <ChargeTerminalButton invoiceId="" amountCents={0} amountDisplay="" ticketId="" onSuccess={() => undefined} onError={() => undefined} />
      <button type="button" onClick={() => navigate(`/orders/alterations/${ticketName}/receipt`)}>Print</button>
      <Link to={`/orders/alterations/${ticketName}/receipt`}>Receipt / Print</Link>
    </div>
  )
}
