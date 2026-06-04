import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Scissors, Package, Truck, Tag, X,
  ChevronRight, Keyboard, CheckCircle2,
  CameraOff, Loader2, FlipHorizontal, RotateCcw,
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

type CameraState = 'starting' | 'active' | 'denied' | 'error'

// ── Resolve scanned value to an action ────────────────────────────────────

const LS_DOMAINS = ['lstailors.com', 'ls-house-app', 'vercel.app']

function resolve(raw: string): ScanAction | null {
  let path = raw.trim()

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

  // Unknown — show as generic
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
  const facingModeRef = useRef<'environment' | 'user'>('environment')
  const didStart = useRef(false)

  const [action, setAction] = useState<ScanAction | null>(null)
  const [cameraState, setCameraState] = useState<CameraState>('starting')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [showManual, setShowManual] = useState(false)
  const [manualVal, setManualVal] = useState('')

  // ── Camera control ────────────────────────────────────────────────────

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch { /* ignore */ }
      try { scannerRef.current.clear() } catch { /* ignore */ }
      scannerRef.current = null
    }
  }, [])

  const startScanner = useCallback(async (mode?: 'environment' | 'user') => {
    if (didStart.current) return
    didStart.current = true
    setCameraState('starting')
    setCameraError(null)

    const facing = mode ?? facingModeRef.current

    try {
      const qr = new Html5Qrcode(videoId, { verbose: false })
      scannerRef.current = qr
      await qr.start(
        { facingMode: facing },
        { fps: 15, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
        (decoded) => {
          const found = resolve(decoded)
          if (found) {
            setAction(found)
            setCameraState('active') // keep active but action card takes over
          }
        },
        () => {},
      )
      setCameraState('active')
    } catch (e: any) {
      scannerRef.current = null
      didStart.current = false
      const msg = (e?.message ?? '').toLowerCase()
      if (msg.includes('permission') || msg.includes('denied') || msg.includes('notallowed')) {
        setCameraState('denied')
        setCameraError('Camera access denied. Allow camera in your browser settings.')
      } else if (msg.includes('notfound') || msg.includes('no camera') || msg.includes('devicenotfound')) {
        setCameraState('error')
        setCameraError('No camera found on this device.')
      } else {
        setCameraState('error')
        setCameraError('Camera failed to start. Please try again.')
      }
    }
  }, [])

  const resetScan = useCallback(async () => {
    setAction(null)
    setCameraState('starting')
    setCameraError(null)
    didStart.current = false
    await stopScanner()
    setTimeout(() => startScanner(), 100)
  }, [startScanner, stopScanner])

  const toggleCamera = useCallback(async () => {
    const newMode = facingModeRef.current === 'environment' ? 'user' : 'environment'
    setFacingMode(newMode)
    facingModeRef.current = newMode
    didStart.current = false
    await stopScanner()
    await startScanner(newMode)
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
    stopScanner()
    if (found?.path) {
      navigate(found.path)
    } else if (manualVal.trim()) {
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

      {/* Dark overlay with viewfinder cutout */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-x-0 top-0 h-[calc(50vh-120px)] bg-black/70" />
        <div className="absolute inset-x-0 bottom-0 top-[calc(50vh+120px)] bg-black/70" />
        <div className="absolute left-0 top-[calc(50vh-120px)] bottom-[calc(50vh-120px)] w-[calc(50vw-120px)] bg-black/70" />
        <div className="absolute right-0 top-[calc(50vh-120px)] bottom-[calc(50vh-120px)] w-[calc(50vw-120px)] bg-black/70" />
      </div>

      {/* Viewfinder frame */}
      <div
        className="absolute"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 240, height: 240 }}
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
        {cameraState === 'active' && !action && (
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
          aria-label="Close scanner"
          className="w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center backdrop-blur-sm"
        >
          <X className="h-5 w-5 text-white" />
        </button>
        <p className="text-white/80 text-sm font-medium">
          {action ? 'Code detected' : cameraState === 'active' ? 'Align code in frame' : ''}
        </p>
        <button
          onClick={() => setShowManual((v) => !v)}
          aria-label="Enter code manually"
          className="w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center backdrop-blur-sm"
        >
          <Keyboard className="h-5 w-5 text-white" />
        </button>
      </div>

      {/* Camera loading state */}
      {cameraState === 'starting' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3" style={{ marginTop: '-60px' }}>
            <Loader2 className="h-8 w-8 text-brass-shimmer animate-spin" />
            <p className="text-white/60 text-sm">Starting camera…</p>
          </div>
        </div>
      )}

      {/* Camera flip button */}
      {cameraState === 'active' && !action && (
        <button
          onClick={toggleCamera}
          aria-label="Switch camera"
          className="absolute top-[calc(50vh+140px)] right-6 w-11 h-11 rounded-full bg-black/60 border border-white/20 flex items-center justify-center backdrop-blur-sm"
        >
          <FlipHorizontal className="h-5 w-5 text-white/80" />
        </button>
      )}

      {/* Error / permission denied states */}
      <AnimatePresence>
        {(cameraState === 'denied' || cameraState === 'error') && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-44 inset-x-6 bg-forest-deep/90 border border-brass/20 rounded-2xl p-5 backdrop-blur-sm text-center"
          >
            <CameraOff className={cn('h-8 w-8 mx-auto mb-3', cameraState === 'denied' ? 'text-red-400' : 'text-amber-400')} />
            <p className={cn('text-sm mb-3', cameraState === 'denied' ? 'text-red-200' : 'text-amber-200')}>
              {cameraError}
            </p>
            {cameraState === 'error' && (
              <button
                onClick={resetScan}
                className="flex items-center gap-1.5 mx-auto px-4 py-2 rounded-xl bg-brass/20 border border-brass/40 text-brass-shimmer text-xs font-medium"
              >
                <RotateCcw className="h-3 w-3" /> Try again
              </button>
            )}
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
      {!action && cameraState === 'active' && !showManual && (
        <div className="absolute bottom-12 inset-x-0 text-center">
          <p className="text-white/40 text-xs">Garment tags · Tickets · Deliveries</p>
        </div>
      )}
    </div>
  )
}
