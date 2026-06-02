import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Scissors, Package, Truck, Tag, X, Flashlight,
  ChevronRight, Keyboard, CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

type ScanAction = {
  type: 'alteration' | 'garment' | 'delivery' | 'unknown'
  title: string
  subtitle: string
  path: string
  icon: React.ReactNode
}

// ── Resolve scanned value to an action ────────────────────────────────────

const LS_DOMAINS = ['lstailors.com', 'ls-house-app', 'vercel.app']

function resolve(raw: string): ScanAction | null {
  let path = raw.trim()

  // Extract internal path from a full URL
  try {
    const url = new URL(raw)
    const isInternal = LS_DOMAINS.some((d) => url.hostname.includes(d)) ||
      url.hostname === window.location.hostname
    if (isInternal) path = url.pathname + url.search
  } catch {
    // not a URL — use raw value as path hint
  }

  // /garments/:ticketId/:garmentId
  const garmentMatch = path.match(/\/garments\/([^/]+)\/([^/?]+)/)
  if (garmentMatch) {
    return {
      type: 'garment',
      title: `Garment ${garmentMatch[2]}`,
      subtitle: garmentMatch[1],
      path,
      icon: <Tag className="h-6 w-6" />,
    }
  }

  // /orders/alterations/:id or raw ALT-* ticket name
  const altMatch = path.match(/(?:\/orders\/alterations\/|^)(ALT-[A-Z]+-\d{4}-\d+)/)
  if (altMatch) {
    return {
      type: 'alteration',
      title: altMatch[1],
      subtitle: 'Alteration ticket',
      path: `/orders/alterations/${altMatch[1]}`,
      icon: <Scissors className="h-6 w-6" />,
    }
  }

  // /deliveries/:id
  const deliveryMatch = path.match(/\/deliveries\/([^/?]+)/)
  if (deliveryMatch) {
    return {
      type: 'delivery',
      title: `Delivery ${deliveryMatch[1]}`,
      subtitle: 'Open delivery',
      path,
      icon: <Truck className="h-6 w-6" />,
    }
  }

  // /scan/:id (legacy garment scan paths)
  const scanMatch = path.match(/\/scan\/(.+)/)
  if (scanMatch) {
    return {
      type: 'garment',
      title: scanMatch[1],
      subtitle: 'Scanned item',
      path,
      icon: <Tag className="h-6 w-6" />,
    }
  }

  // Raw ticket-like strings
  if (/^ALT-[A-Z]+-\d{4}-\d+/.test(path)) {
    return {
      type: 'alteration',
      title: path,
      subtitle: 'Alteration ticket',
      path: `/orders/alterations/${path}`,
      icon: <Scissors className="h-6 w-6" />,
    }
  }

  // Delivery-like IDs
  if (/^DEL-/.test(path)) {
    return {
      type: 'delivery',
      title: path,
      subtitle: 'Delivery',
      path: `/deliveries/${path}`,
      icon: <Truck className="h-6 w-6" />,
    }
  }

  // Unknown — show as generic with the raw value
  if (path.length < 120) {
    return {
      type: 'unknown',
      title: 'Unknown code',
      subtitle: path.slice(0, 60),
      path: '',
      icon: <Package className="h-6 w-6" />,
    }
  }

  return null
}

// ── Accent colors per action type ─────────────────────────────────────────

const ACCENTS: Record<string, string> = {
  alteration: 'from-brass/20 to-brass/5 border-brass/40 text-brass-shimmer',
  garment:    'from-emerald-900/40 to-emerald-900/10 border-emerald-500/40 text-emerald-400',
  delivery:   'from-blue-900/30 to-blue-900/10 border-blue-500/30 text-blue-400',
  unknown:    'from-zinc-800/40 to-zinc-800/10 border-zinc-500/30 text-zinc-400',
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function QRScanner() {
  const navigate = useNavigate()
  const videoId = 'lst-qr-video'
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [action, setAction] = useState<ScanAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(true)
  const [showManual, setShowManual] = useState(false)
  const [manualVal, setManualVal] = useState('')
  const didStart = useRef(false)

  // ── Start camera ──────────────────────────────────────────────────────

  const startScanner = useCallback(async () => {
    if (didStart.current) return
    didStart.current = true
    setError(null)

    try {
      const qr = new Html5Qrcode(videoId, { verbose: false })
      scannerRef.current = qr

      await qr.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
        (decoded) => {
          const found = resolve(decoded)
          if (found) {
            setAction(found)
            setScanning(false)
          }
        },
        () => { /* ignore per-frame failures */ },
      )
    } catch (e: any) {
      setError(e?.message?.includes('Permission')
        ? 'Camera access denied. Please allow camera in your browser settings.'
        : 'Could not start camera.')
    }
  }, [])

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch { /* ignore */ }
      try { scannerRef.current.clear() } catch { /* ignore */ }
      scannerRef.current = null
    }
  }, [])

  const resetScan = useCallback(async () => {
    setAction(null)
    setError(null)
    setScanning(true)
    didStart.current = false
    await stopScanner()
    setTimeout(startScanner, 100)
  }, [startScanner, stopScanner])

  useEffect(() => {
    startScanner()
    return () => { stopScanner() }
  }, [startScanner, stopScanner])

  // ── Navigate on action ────────────────────────────────────────────────

  const handleGo = () => {
    if (action?.path) {
      stopScanner()
      navigate(action.path)
    }
  }

  const handleManual = (e: React.FormEvent) => {
    e.preventDefault()
    const found = resolve(manualVal.trim())
    if (found && found.path) {
      stopScanner()
      navigate(found.path)
    } else if (manualVal.trim()) {
      stopScanner()
      navigate(`/orders/alterations/${manualVal.trim()}`)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen bg-black overflow-hidden">

      {/* Camera feed — always mounted so Html5Qrcode can attach */}
      <div
        id={videoId}
        className="absolute inset-0 w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-cover [&>canvas]:hidden"
      />

      {/* Dark overlay with cutout */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top */}
        <div className="absolute inset-x-0 top-0 h-[calc(50vh-120px)] bg-black/70" />
        {/* Bottom */}
        <div className="absolute inset-x-0 bottom-0 top-[calc(50vh+120px)] bg-black/70" />
        {/* Left */}
        <div className="absolute left-0 top-[calc(50vh-120px)] bottom-[calc(50vh-120px)] w-[calc(50vw-120px)] bg-black/70" />
        {/* Right */}
        <div className="absolute right-0 top-[calc(50vh-120px)] bottom-[calc(50vh-120px)] w-[calc(50vw-120px)] bg-black/70" />
      </div>

      {/* Viewfinder frame */}
      <div
        className="absolute"
        style={{
          left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 240, height: 240,
        }}
      >
        {/* Corner brackets */}
        {[
          'top-0 left-0 border-t-2 border-l-2',
          'top-0 right-0 border-t-2 border-r-2',
          'bottom-0 left-0 border-b-2 border-l-2',
          'bottom-0 right-0 border-b-2 border-r-2',
        ].map((cls, i) => (
          <div key={i} className={cn('absolute w-8 h-8 border-brass-shimmer rounded-sm', cls)} />
        ))}

        {/* Animated scan line */}
        {scanning && !action && (
          <motion.div
            className="absolute inset-x-2 h-px bg-gradient-to-r from-transparent via-brass-shimmer to-transparent"
            animate={{ top: ['10%', '90%', '10%'] }}
            transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
          />
        )}

        {/* Success flash */}
        <AnimatePresence>
          {action && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-emerald-500/20 rounded-sm"
            >
              <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 pt-12 pb-4">
        <button
          onClick={() => { stopScanner(); navigate(-1) }}
          className="w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center backdrop-blur-sm"
        >
          <X className="h-5 w-5 text-white" />
        </button>
        <p className="text-white/80 text-sm font-medium">
          {action ? 'Code detected' : 'Align code in frame'}
        </p>
        <button
          onClick={() => setShowManual((v) => !v)}
          className="w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center backdrop-blur-sm"
        >
          <Keyboard className="h-5 w-5 text-white" />
        </button>
      </div>

      {/* Error state */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-40 inset-x-6 bg-red-900/80 border border-red-500/40 rounded-2xl p-4 backdrop-blur-sm text-center"
          >
            <p className="text-red-200 text-sm">{error}</p>
            <button onClick={resetScan} className="mt-2 text-xs text-red-300 underline">Try again</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action card */}
      <AnimatePresence>
        {action && (
          <motion.div
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 260 }}
            className="absolute bottom-0 inset-x-0 px-4 pb-10 pt-2"
          >
            <div className={cn(
              'rounded-2xl p-5 bg-gradient-to-b border backdrop-blur-xl',
              ACCENTS[action.type],
            )}>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-black/30 flex items-center justify-center shrink-0">
                  {action.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-base truncate">{action.title}</p>
                  <p className="text-white/60 text-sm truncate">{action.subtitle}</p>
                </div>
              </div>

              <div className="flex gap-3">
                {action.path ? (
                  <button
                    onClick={handleGo}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/15 border border-white/20 text-white font-medium text-sm hover:bg-white/25 transition-all active:scale-95"
                  >
                    Open <ChevronRight className="h-4 w-4" />
                  </button>
                ) : null}
                <button
                  onClick={resetScan}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white/70 text-sm hover:bg-black/50 transition-all active:scale-95"
                >
                  Scan again
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual entry drawer */}
      <AnimatePresence>
        {showManual && (
          <motion.div
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 280 }}
            className="absolute bottom-0 inset-x-0 bg-forest-deep/95 border-t border-brass/20 backdrop-blur-xl px-5 pt-5 pb-10 rounded-t-3xl"
          >
            <div className="w-10 h-1 bg-brass/30 rounded-full mx-auto mb-5" />
            <p className="text-cream text-sm font-medium mb-3">Enter ID manually</p>
            <form onSubmit={handleManual} className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={manualVal}
                onChange={(e) => setManualVal(e.target.value)}
                placeholder="ALT-NYC-2026-00036 or G1"
                className="flex-1 bg-forest-raised border border-brass/20 rounded-xl px-4 py-3 text-cream text-sm placeholder:text-cream-dim/40 focus:outline-none focus:border-brass/50"
              />
              <button
                type="submit"
                disabled={!manualVal.trim()}
                className="px-5 py-3 rounded-xl bg-brass/20 border border-brass/30 text-brass-shimmer text-sm font-medium hover:bg-brass/30 disabled:opacity-40 transition-all"
              >
                Go
              </button>
            </form>
            <button
              onClick={() => setShowManual(false)}
              className="mt-3 text-xs text-cream-dim/60 w-full text-center"
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hint text */}
      {!action && !error && !showManual && (
        <div className="absolute bottom-12 inset-x-0 text-center">
          <p className="text-white/40 text-xs">Garment tags · Tickets · Deliveries</p>
        </div>
      )}
    </div>
  )
}
