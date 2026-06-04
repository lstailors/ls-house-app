import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Html5Qrcode } from 'html5-qrcode'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, ArrowUp, ArrowDown, CameraOff, Loader2, FlipHorizontal, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

export interface TransferModalProps {
  open: boolean
  onClose: () => void
}

interface Tailor {
  id: string
  name: string
}

interface ScannedTicket {
  ticketId: string
  customerName: string
  garmentType: string
  items: string
  total: number
}

type CameraState = 'idle' | 'starting' | 'active' | 'denied' | 'error'

// ── Component ──────────────────────────────────────────────────────────────

export function TransferModal({ open, onClose }: TransferModalProps) {
  const [direction, setDirection] = useState<'Out' | 'Return'>('Out')
  const [selectedTailor, setSelectedTailor] = useState<Tailor | null>(null)
  const [scannedTickets, setScannedTickets] = useState<ScannedTicket[]>([])
  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [scanFlash, setScanFlash] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [checkAmount, setCheckAmount] = useState('')
  const [checkNumber, setCheckNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ transferName: string; journalEntry: string | null } | null>(null)

  const videoId = 'lst-transfer-qr'
  const scannerRef = useRef<Html5Qrcode | null>(null)
  // Ref-based duplicate tracking — avoids stale closure in scanner callback
  const scannedIdsRef = useRef<Set<string>>(new Set())
  // Per-code debounce: prevents the same QR firing multiple times in rapid succession
  const lastDecodeRef = useRef<{ code: string; time: number } | null>(null)
  const isProcessingRef = useRef(false)
  const facingModeRef = useRef<'environment' | 'user'>('environment')

  // Keep refs in sync with state
  useEffect(() => {
    scannedIdsRef.current = new Set(scannedTickets.map(t => t.ticketId))
  }, [scannedTickets])

  useEffect(() => {
    facingModeRef.current = facingMode
  }, [facingMode])

  const { data: tailors = [] } = useQuery({
    queryKey: ['transfer-tailors'],
    queryFn: () => api.get<Tailor[]>('/api/transfers/tailors'),
    enabled: open,
  })

  // ── Scanner lifecycle ─────────────────────────────────────────────────────

  // Stable decode handler — reads all mutable state through refs, no stale closures
  const handleDecode = useCallback(async (decoded: string) => {
    // Debounce: ignore same code within 2 seconds
    const now = Date.now()
    if (lastDecodeRef.current?.code === decoded && now - lastDecodeRef.current.time < 2000) return
    lastDecodeRef.current = { code: decoded, time: now }

    if (isProcessingRef.current) return

    const ticketMatch = decoded.match(/ALT-[A-Z]+-\d{4}-\d+/)
    if (!ticketMatch) {
      toast.error('Not a valid alteration ticket QR code')
      return
    }
    const ticketId = ticketMatch[0]

    if (scannedIdsRef.current.has(ticketId)) {
      toast.warning(`${ticketId} already queued`)
      return
    }

    isProcessingRef.current = true
    setScanFlash(true)
    setTimeout(() => setScanFlash(false), 500)
    navigator.vibrate?.(80)

    try {
      const ticket = await api.get<any>(`/api/alterations/${ticketId}`)
      const item: ScannedTicket = {
        ticketId,
        customerName: ticket.customer?.name ?? ticketId,
        garmentType: ticket.items?.[0]?.label ?? 'Garment',
        items: ticket.items?.slice(0, 2).map((i: any) => i.label).join(', ') ?? '',
        total: ticket.price ?? 0,
      }
      setScannedTickets(prev => [...prev, item])
      toast.success(`Added ${ticketId}`)
    } catch {
      toast.error('Could not load ticket — scan again')
    } finally {
      isProcessingRef.current = false
    }
  }, []) // No deps — uses refs to read all mutable state

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch { /* ignore */ }
      try { scannerRef.current.clear() } catch { /* ignore */ }
      scannerRef.current = null
    }
    setCameraState('idle')
    setCameraError(null)
  }, [])

  const startScanner = useCallback(async (mode?: 'environment' | 'user') => {
    if (scannerRef.current) return // Already running
    const el = document.getElementById(videoId)
    if (!el) return // DOM not ready yet

    const facing = mode ?? facingModeRef.current
    setCameraState('starting')
    setCameraError(null)

    try {
      const qr = new Html5Qrcode(videoId, { verbose: false })
      scannerRef.current = qr
      await qr.start(
        { facingMode: facing },
        { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
        (decoded) => handleDecode(decoded),
        () => {},
      )
      setCameraState('active')
    } catch (e: any) {
      scannerRef.current = null
      const msg = (e?.message ?? '').toLowerCase()
      if (msg.includes('permission') || msg.includes('denied') || msg.includes('notallowed')) {
        setCameraState('denied')
        setCameraError('Camera access denied. Allow camera in your browser settings, then tap Retry.')
      } else if (msg.includes('notfound') || msg.includes('no camera') || msg.includes('devicenotfound')) {
        setCameraState('error')
        setCameraError('No camera found on this device.')
      } else {
        setCameraState('error')
        setCameraError('Camera failed to start. Tap Retry to try again.')
      }
    }
  }, [handleDecode])

  const retryCamera = useCallback(async () => {
    await stopScanner()
    await startScanner()
  }, [stopScanner, startScanner])

  const toggleCamera = useCallback(async () => {
    const newMode = facingModeRef.current === 'environment' ? 'user' : 'environment'
    setFacingMode(newMode)
    facingModeRef.current = newMode
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch {}
      try { scannerRef.current.clear() } catch {}
      scannerRef.current = null
    }
    await startScanner(newMode)
  }, [startScanner])

  // Auto-start camera when tailor is selected; stop when deselected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    if (selectedTailor) {
      // Stop any existing stream first, then start fresh
      const init = async () => {
        if (scannerRef.current) {
          try { await scannerRef.current.stop() } catch {}
          try { scannerRef.current.clear() } catch {}
          scannerRef.current = null
        }
        await startScanner()
      }
      init()
    } else {
      stopScanner()
    }
  }, [selectedTailor, open]) // intentionally excludes startScanner/stopScanner to avoid extra deps

  // Full reset when modal closes
  useEffect(() => {
    if (!open) {
      stopScanner()
      setDirection('Out')
      setSelectedTailor(null)
      setScannedTickets([])
      setCameraState('idle')
      setCameraError(null)
      setFacingMode('environment')
      setScanFlash(false)
      setShowPayment(false)
      setCheckAmount('')
      setCheckNumber('')
      setSubmitting(false)
      setResult(null)
      scannedIdsRef.current = new Set()
      lastDecodeRef.current = null
      isProcessingRef.current = false
    }
  }, [open, stopScanner])

  const removeTicket = (ticketId: string) => {
    setScannedTickets(prev => prev.filter(t => t.ticketId !== ticketId))
  }

  const chargedTotal = scannedTickets.reduce((s, t) => s + t.total, 0)
  const margin = chargedTotal - (parseFloat(checkAmount) || 0)

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!selectedTailor || scannedTickets.length === 0) return
    if (direction === 'Return' && !showPayment) {
      setShowPayment(true)
      return
    }
    setSubmitting(true)
    try {
      const res = await api.post<{ transferName: string; journalEntry: string | null }>('/api/transfers', {
        direction,
        tailor: selectedTailor.id,
        tailorName: selectedTailor.name,
        items: scannedTickets.map(t => ({
          ticketId: t.ticketId,
          customerName: t.customerName,
          garmentType: t.garmentType,
        })),
        ...(direction === 'Return' ? {
          checkAmount: parseFloat(checkAmount) || 0,
          checkNumber,
        } : {}),
      })
      setResult(res)
      await stopScanner()
      toast.success(
        `${scannedTickets.length} ${scannedTickets.length === 1 ? 'piece' : 'pieces'} ${direction === 'Out' ? 'transferred to' : 'returned from'} ${selectedTailor.name}`
      )
    } catch (e: any) {
      toast.error(e.message || 'Transfer failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  // ── Screen 3: Success ──────────────────────────────────────────────────

  if (result) {
    return (
      <div className="fixed inset-0 z-50 bg-forest-deep flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 16, stiffness: 200 }}
          className="w-24 h-24 rounded-full bg-emerald-900/40 border-2 border-emerald-500/50 flex items-center justify-center mb-6"
        >
          <CheckCircle2 className="h-12 w-12 text-emerald-400" />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <p className="text-cream text-2xl font-semibold mb-2">
            {scannedTickets.length} {scannedTickets.length === 1 ? 'piece' : 'pieces'}{' '}
            {direction === 'Out' ? 'transferred to' : 'returned from'} {selectedTailor?.name}
          </p>
          <p className="text-cream-muted text-sm mb-1">
            Transfer: <span className="text-brass-shimmer font-mono">{result.transferName}</span>
          </p>
          {result.journalEntry && (
            <p className="text-cream-muted text-sm">
              Journal Entry: <span className="text-brass-shimmer font-mono">{result.journalEntry}</span>
            </p>
          )}
        </motion.div>

        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          onClick={onClose}
          className="mt-10 px-10 py-4 rounded-2xl bg-brass/20 border border-brass/40 text-brass-shimmer font-semibold text-lg min-h-[52px] hover:bg-brass/30 transition-colors"
        >
          Done
        </motion.button>
      </div>
    )
  }

  // ── Screen 2: Return Payment ───────────────────────────────────────────

  if (showPayment && direction === 'Return') {
    return (
      <div className="fixed inset-0 z-50 bg-forest-deep flex flex-col">
        <div className="flex items-center gap-3 px-5 pt-12 pb-4 border-b border-brass/10">
          <button
            onClick={() => setShowPayment(false)}
            className="w-10 h-10 rounded-full bg-forest-raised/80 border border-brass/20 flex items-center justify-center shrink-0"
          >
            <X className="h-5 w-5 text-cream" />
          </button>
          <div>
            <p className="text-cream font-semibold">Return Payment</p>
            <p className="text-cream-muted text-xs">
              Returning {scannedTickets.length} {scannedTickets.length === 1 ? 'piece' : 'pieces'} from {selectedTailor?.name}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {scannedTickets.map(item => (
            <div key={item.ticketId} className="flex items-center justify-between py-2 border-b border-brass/10">
              <div>
                <p className="text-brass-shimmer font-mono text-sm font-medium">{item.ticketId}</p>
                <p className="text-cream-muted text-xs">{item.customerName} · {item.garmentType}</p>
              </div>
              <p className="text-cream text-sm font-semibold">${item.total.toFixed(2)}</p>
            </div>
          ))}
        </div>

        <div className="px-5 pb-10 pt-4 border-t border-brass/10 bg-forest-deep space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-cream-muted text-sm">Charged Total</p>
            <p className="text-brass-shimmer text-2xl font-bold">${chargedTotal.toFixed(2)}</p>
          </div>

          <div>
            <p className="text-cream-muted text-xs mb-1 uppercase tracking-widest">Check Amount</p>
            <input
              type="number"
              value={checkAmount}
              onChange={e => setCheckAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-transparent border-b-2 border-brass/40 text-brass-shimmer text-4xl font-bold text-center py-4 focus:outline-none focus:border-brass-shimmer placeholder:text-brass/30"
            />
          </div>

          <div>
            <p className="text-cream-muted text-xs mb-1 uppercase tracking-widest">Check Number</p>
            <input
              type="text"
              value={checkNumber}
              onChange={e => setCheckNumber(e.target.value)}
              placeholder="e.g. 1042"
              className="w-full bg-forest-raised border border-brass/20 rounded-xl px-4 py-3 text-cream text-sm placeholder:text-cream-muted/40 focus:outline-none focus:border-brass/50"
            />
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-brass/5 border border-brass/15">
            <p className="text-cream-muted text-sm">Margin</p>
            <p className={cn('text-sm font-semibold', margin >= 0 ? 'text-brass-shimmer' : 'text-red-400')}>
              ${margin.toFixed(2)}
            </p>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-4 rounded-2xl bg-brass/20 border border-brass/40 text-brass-shimmer font-semibold text-base min-h-[52px] hover:bg-brass/30 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Confirming…' : 'Confirm & Pay'}
          </button>
        </div>
      </div>
    )
  }

  // ── Screen 1: Setup + Scan ─────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-forest-deep flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-12 pb-4 shrink-0">
        <button
          onClick={() => { stopScanner(); onClose() }}
          className="w-10 h-10 rounded-full bg-forest-raised/80 border border-brass/20 flex items-center justify-center"
          aria-label="Close"
        >
          <X className="h-5 w-5 text-cream" />
        </button>

        {/* Direction toggle */}
        <div className="flex rounded-2xl bg-forest-raised/60 border border-brass/15 p-1 gap-1">
          {(['Out', 'Return'] as const).map(dir => (
            <button
              key={dir}
              onClick={() => setDirection(dir)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all min-h-[40px]',
                direction === dir
                  ? 'bg-brass/30 border border-brass/50 text-brass-shimmer'
                  : 'text-cream-muted hover:text-cream',
              )}
            >
              {dir === 'Out' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              {dir.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="w-10" />
      </div>

      {/* Tailor selector */}
      <div className="px-5 pb-3 shrink-0">
        <p className="text-cream-muted text-xs uppercase tracking-widest mb-2">Tailor</p>
        <div className="flex gap-2 flex-wrap">
          {tailors.length === 0 ? (
            <p className="text-cream-muted text-sm italic">Loading tailors…</p>
          ) : (
            tailors.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedTailor(selectedTailor?.id === t.id ? null : t)}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-medium border transition-all min-h-[40px]',
                  selectedTailor?.id === t.id
                    ? 'bg-brass border-brass text-forest-deep font-semibold'
                    : 'bg-forest-raised/60 border-brass/20 text-cream hover:border-brass/40',
                )}
              >
                {t.name}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Camera viewfinder */}
      <div className="shrink-0 flex flex-col items-center px-5 pb-2">
        <div className="relative" style={{ width: 260, height: 260 }}>
          {selectedTailor ? (
            /* Camera feed container — must be in DOM before Html5Qrcode attaches */
            <div
              id={videoId}
              className="w-full h-full rounded-2xl overflow-hidden bg-black [&>video]:w-full [&>video]:h-full [&>video]:object-cover [&>canvas]:hidden"
            />
          ) : (
            <div className="w-full h-full rounded-2xl bg-forest-raised/40 border border-brass/10 flex items-center justify-center">
              <p className="text-cream-muted text-sm text-center px-6">Select a tailor above to start scanning</p>
            </div>
          )}

          {/* Corner brackets */}
          {selectedTailor && (
            <>
              {[
                'top-0 left-0 border-t-2 border-l-2',
                'top-0 right-0 border-t-2 border-r-2',
                'bottom-0 left-0 border-b-2 border-l-2',
                'bottom-0 right-0 border-b-2 border-r-2',
              ].map((cls, i) => (
                <div key={i} className={cn('absolute w-7 h-7 border-brass-shimmer rounded-sm z-10 pointer-events-none', cls)} />
              ))}
            </>
          )}

          {/* Animated scan line — only when actively scanning */}
          {cameraState === 'active' && (
            <motion.div
              className="absolute inset-x-4 h-px bg-gradient-to-r from-transparent via-brass-shimmer to-transparent z-10 pointer-events-none"
              animate={{ top: ['12%', '88%', '12%'] }}
              transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
            />
          )}

          {/* Green flash on successful scan */}
          <AnimatePresence>
            {scanFlash && (
              <motion.div
                key="flash"
                initial={{ opacity: 0.7 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="absolute inset-0 rounded-2xl bg-emerald-500/50 z-20 pointer-events-none"
              />
            )}
          </AnimatePresence>

          {/* Camera flip button */}
          {cameraState === 'active' && (
            <button
              onClick={toggleCamera}
              aria-label="Switch camera"
              className="absolute bottom-3 right-3 z-20 w-9 h-9 rounded-full bg-black/60 border border-white/20 flex items-center justify-center backdrop-blur-sm touch-manipulation"
            >
              <FlipHorizontal className="h-4 w-4 text-white/80" />
            </button>
          )}

          {/* Initializing overlay */}
          {cameraState === 'starting' && (
            <div className="absolute inset-0 rounded-2xl bg-black/75 flex flex-col items-center justify-center z-20">
              <Loader2 className="h-8 w-8 text-brass-shimmer animate-spin mb-2" />
              <p className="text-cream-muted text-xs">Starting camera…</p>
            </div>
          )}

          {/* Permission denied overlay */}
          {cameraState === 'denied' && (
            <div className="absolute inset-0 rounded-2xl bg-black/85 flex flex-col items-center justify-center z-20 px-4 text-center">
              <CameraOff className="h-8 w-8 text-red-400 mb-2" />
              <p className="text-red-300 text-xs leading-relaxed mb-3">{cameraError}</p>
              <button
                onClick={retryCamera}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brass/20 border border-brass/40 text-brass-shimmer text-xs font-medium"
              >
                <RotateCcw className="h-3 w-3" /> Retry
              </button>
            </div>
          )}

          {/* Generic error overlay */}
          {cameraState === 'error' && (
            <div className="absolute inset-0 rounded-2xl bg-black/85 flex flex-col items-center justify-center z-20 px-4 text-center">
              <CameraOff className="h-8 w-8 text-amber-400 mb-2" />
              <p className="text-amber-300 text-xs leading-relaxed mb-3">{cameraError}</p>
              <button
                onClick={retryCamera}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brass/20 border border-brass/40 text-brass-shimmer text-xs font-medium"
              >
                <RotateCcw className="h-3 w-3" /> Retry
              </button>
            </div>
          )}
        </div>

        {/* Status hint below viewfinder */}
        {scannedTickets.length > 0 && selectedTailor ? (
          <p className="text-brass text-xs mt-2 font-medium">
            {scannedTickets.length} {scannedTickets.length === 1 ? 'piece' : 'pieces'} queued for {selectedTailor.name}
          </p>
        ) : cameraState === 'active' && selectedTailor ? (
          <p className="text-cream-muted text-xs mt-2">Aim at an alteration ticket QR code</p>
        ) : null}
      </div>

      {/* Scanned queue */}
      <div className="flex-1 overflow-y-auto px-5">
        <AnimatePresence>
          {scannedTickets.map(item => (
            <motion.div
              key={item.ticketId}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              className="flex items-center gap-3 py-3 border-b border-brass/10"
            >
              <div className="w-8 h-8 rounded-full bg-emerald-900/40 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-brass-shimmer font-mono text-sm font-medium">{item.ticketId}</p>
                <p className="text-cream text-xs truncate">{item.customerName} · {item.garmentType}</p>
              </div>
              <button
                onClick={() => removeTicket(item.ticketId)}
                aria-label={`Remove ${item.ticketId}`}
                className="text-cream-muted hover:text-red-400 transition-colors p-1 min-h-[40px] min-w-[40px] flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Bottom action */}
      <div className="px-5 pb-10 pt-3 border-t border-brass/10 shrink-0">
        <button
          onClick={handleSubmit}
          disabled={!selectedTailor || scannedTickets.length === 0 || submitting}
          className="w-full py-4 rounded-2xl bg-brass/20 border border-brass/40 text-brass-shimmer font-semibold text-base min-h-[52px] hover:bg-brass/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting
            ? 'Submitting…'
            : direction === 'Out'
              ? `Transfer Out${scannedTickets.length > 0 ? ` (${scannedTickets.length})` : ''}`
              : `Confirm Return${scannedTickets.length > 0 ? ` (${scannedTickets.length})` : ''}`
          }
        </button>
      </div>
    </div>
  )
}
