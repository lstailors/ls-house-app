import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, Clock, Loader2, PartyPopper } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { CompleteGarmentResult } from '../../../../backend/src/types'

// ── Types ──────────────────────────────────────────────────────────────────

interface Worker {
  id: string
  name: string
}

export interface CompleteGarmentModalProps {
  open: boolean
  onClose: () => void
  ticketId: string
  garmentId: string
  /** Human label for the garment, e.g. "G1 · Jacket" */
  garmentLabel?: string
  /** Called after a successful completion so the caller can refresh its view. */
  onCompleted?: (result: CompleteGarmentResult) => void
}

// ── Component ──────────────────────────────────────────────────────────────

export function CompleteGarmentModal({
  open,
  onClose,
  ticketId,
  garmentId,
  garmentLabel,
  onCompleted,
}: CompleteGarmentModalProps) {
  const [worker, setWorker] = useState<Worker | null>(null)
  const [minutes, setMinutes] = useState('')
  const [done, setDone] = useState<CompleteGarmentResult | null>(null)

  // Worker picker — reuses the existing tailor reference endpoint.
  const { data: workers = [] } = useQuery({
    queryKey: ['complete-garment-workers'],
    queryFn: () => api.get<Worker[]>('/api/reference/tailors'),
    enabled: open,
  })

  // Reset local state whenever the modal is (re)opened or closed.
  useEffect(() => {
    if (!open) {
      setWorker(null)
      setMinutes('')
      setDone(null)
    }
  }, [open])

  const completeMutation = useMutation({
    mutationFn: () => {
      const parsedMinutes = minutes.trim() === '' ? undefined : Number(minutes)
      return api.post<CompleteGarmentResult>('/api/alterations/complete-garment', {
        ticket: ticketId,
        garment_id: garmentId,
        worker: worker!.id,
        ...(parsedMinutes != null && !Number.isNaN(parsedMinutes)
          ? { actual_minutes: parsedMinutes }
          : {}),
      })
    },
    onSuccess: (result) => {
      setDone(result)
      onCompleted?.(result)
      if (result.all_garments_ready) {
        toast.success('Order complete — customer notified for pickup')
      } else {
        toast.success(`${garmentId} marked ready`)
      }
    },
    onError: (e: Error) => toast.error(e.message || 'Could not complete garment'),
  })

  if (!open) return null

  const minutesValue = minutes.trim() === '' ? null : Number(minutes)
  const minutesInvalid = minutesValue != null && (Number.isNaN(minutesValue) || minutesValue < 0)
  const canSubmit = !!worker && !minutesInvalid && !completeMutation.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => (!completeMutation.isPending ? onClose() : undefined)}
      />

      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 22, stiffness: 240 }}
        className="relative w-full sm:max-w-md bg-forest-deep border-t sm:border border-brass/20 sm:rounded-2xl rounded-t-2xl p-5 space-y-5 max-h-[92vh] overflow-y-auto"
      >
        <AnimatePresence mode="wait">
          {done ? (
            // ── Success state ───────────────────────────────────────────────
            <motion.div
              key="success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center text-center py-4 space-y-4"
            >
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', damping: 16, stiffness: 200 }}
                className={cn(
                  'w-20 h-20 rounded-full border-2 flex items-center justify-center',
                  done.all_garments_ready
                    ? 'bg-brass/20 border-brass/50'
                    : 'bg-emerald-900/40 border-emerald-500/50',
                )}
              >
                {done.all_garments_ready ? (
                  <PartyPopper className="h-10 w-10 text-brass-shimmer" />
                ) : (
                  <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                )}
              </motion.div>

              {done.all_garments_ready ? (
                <div className="space-y-1">
                  <p className="text-cream text-xl font-semibold">Order complete</p>
                  <p className="text-cream-muted text-sm">
                    Every garment on {done.ticket} is ready — the customer has been texted for pickup.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-cream text-xl font-semibold">Garment ready</p>
                  <p className="text-cream-muted text-sm">
                    {garmentId} is marked {done.garment_status}. Remaining garments are still in progress.
                  </p>
                </div>
              )}

              <button
                onClick={onClose}
                className="mt-2 w-full py-3.5 rounded-xl bg-brass/20 border border-brass/40 text-brass-shimmer font-semibold text-sm min-h-[48px] hover:bg-brass/30 transition-colors"
              >
                Done
              </button>
            </motion.div>
          ) : (
            // ── Form state ──────────────────────────────────────────────────
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
              {/* Header */}
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <h2 className="text-cream text-lg font-semibold">Mark Complete</h2>
                  <p className="text-cream-muted text-sm">{garmentLabel ?? garmentId}</p>
                </div>
                <button
                  onClick={onClose}
                  disabled={completeMutation.isPending}
                  className="w-9 h-9 rounded-full bg-forest-raised border border-brass/20 flex items-center justify-center hover:border-brass/40 transition-all disabled:opacity-50"
                >
                  <X size={16} className="text-cream-muted" />
                </button>
              </div>

              {/* Worker picker */}
              <div className="space-y-2">
                <p className="text-cream-dim text-xs uppercase tracking-widest">Who did the work?</p>
                {workers.length === 0 ? (
                  <p className="text-cream-muted text-sm italic">Loading workers…</p>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {workers.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => setWorker(worker?.id === w.id ? null : w)}
                        className={cn(
                          'px-4 py-2 rounded-full text-sm font-medium border transition-all min-h-[40px]',
                          worker?.id === w.id
                            ? 'bg-brass border-brass text-forest-deep font-semibold'
                            : 'bg-forest-raised/60 border-brass/20 text-cream hover:border-brass/40',
                        )}
                      >
                        {w.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Optional minutes */}
              <div className="space-y-2">
                <p className="text-cream-dim text-xs uppercase tracking-widest flex items-center gap-1.5">
                  <Clock size={12} className="text-brass-shimmer/60" /> Actual minutes
                  <span className="text-cream-dim/50 normal-case tracking-normal">(optional)</span>
                </p>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="e.g. 45"
                  className="w-full bg-forest-raised border border-brass/20 rounded-xl px-4 py-3 text-cream text-sm placeholder:text-cream-muted/40 focus:outline-none focus:border-brass/50"
                />
                {minutesInvalid ? (
                  <p className="text-red-400 text-xs">Enter a non-negative number of minutes.</p>
                ) : null}
              </div>

              {/* Submit */}
              <button
                onClick={() => completeMutation.mutate()}
                disabled={!canSubmit}
                className={cn(
                  'w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 min-h-[48px]',
                  'bg-emerald-700/80 border border-emerald-500/40 text-emerald-100',
                  'hover:bg-emerald-600/80 disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                {completeMutation.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Completing…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} /> Mark Complete
                  </>
                )}
              </button>
              <p className="text-cream-dim/60 text-xs text-center leading-relaxed">
                Completing the last garment on the ticket texts the customer that their order is ready.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
