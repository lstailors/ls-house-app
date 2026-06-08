import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Scissors, Package, Truck, FileText, Tag, X,
  ChevronRight, Keyboard, CheckCircle2, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────────────────

interface ScanResult {
  type: 'delivery' | 'alteration' | 'sales_order' | 'invoice' | 'unknown'
  name?: string
  customer?: string
  status?: string
  address?: string
  garment_summary?: string
  garments?: string
  lines?: string
  due_date?: string
  delivery_date?: string
  grand_total?: number
  outstanding_amount?: number
  currency?: string
  scheduled_at?: string
  delivered_at?: string
  can_pod?: boolean
  token?: string
  error?: string
  // nav path resolved client-side
  path?: string
}

const ACCENTS: Record<string, string> = {
  delivery:    'from-blue-900/40 to-blue-900/10 border-blue-500/40 text-blue-400',
  alteration:  'from-brass/20 to-brass/5 border-brass/40 text-brass-shimmer',
  sales_order: 'from-emerald-900/40 to-emerald-900/10 border-emerald-500/40 text-emerald-400',
  invoice:     'from-purple-900/30 to-purple-900/10 border-purple-500/30 text-purple-400',
  unknown:     'from-zinc-800/40 to-zinc-800/10 border-zinc-500/30 text-zinc-400',
}

function typeIcon(type: string) {
  if (type === 'delivery')    return <Truck className="h-6 w-6" />
  if (type === 'alteration')  return <Scissors className="h-6 w-6" />
  if (type === 'sales_order') return <Tag className="h-6 w-6" />
  if (type === 'invoice')     return <FileText className="h-6 w-6" />
  return <Package className="h-6 w-6" />
}

function navPath(result: ScanResult): string {
  if (result.type === 'delivery' && result.name)    return `/deliveries/${result.name}`
  if (result.type === 'alteration' && result.name)  return `/orders/alterations/${result.name}`
  if (result.type === 'sales_order' && result.name) return `/sales-orders/${result.name}`
  if (result.type === 'invoice' && result.name)     return `/invoices/${result.name}`
  return ''
}

function resultTitle(r: ScanResult): string {
  if (r.type === 'delivery')    return `Delivery — ${r.name}`
  if (r.type === 'alteration')  return `Alteration — ${r.name}`
  if (r.type === 'sales_order') return `Order — ${r.name}`
  if (r.type === 'invoice')     return `Invoice — ${r.name}`
  return 'Unknown code'
}

function resultDetail(r: ScanResult): string {
  const parts: string[] = []
  if (r.customer)   parts.push(r.customer)
  if (r.status)     parts.push(r.status)
  if (r.address)    parts.push(r.address)
  if (r.garment_summary) parts.push(r.garment_summary)
  if (r.garments)   parts.push(r.garments)
  if (r.due_date)   parts.push(`Due ${r.due_date}`)
  if (r.grand_total) parts.push(`${r.currency ?? 'USD'} ${r.grand_total}`)
  return parts.join(' · ') || r.token || ''
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function QRScanner() {
  const navigate = useNavigate()
  const videoId = 'lst-qr-video'
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(true)
  const [showManual, setShowManual] = useState(false)
  const [manualVal, setManualVal] = useState('')
  const didStart = useRef(false)
  const scannedRef = useRef(false)

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch { /* ignore */ }
      try { scannerRef.current.clear() } catch { /* ignore */ }
      scannerRef.current = null
    }
  }, [])

  const handleToken = useCallback(async (token: string) => {
    if (scannedRef.current) return
    scannedRef.current = true
    setScanning(false)
    await stopScanner()

    // Internal garment tag URL — navigate directly without API lookup
    const garmentMatch = token.match(/\/garments\/([^/?#]+)\/([^/?#]+)/)
    if (garmentMatch) {
      navigate(`/garments/${garmentMatch[1]}/${garmentMatch[2]}`)
      return
    }

    setLoading(true)
    try {
      const data = await api.get<ScanResult>(`/api/scan/${encodeURIComponent(token.trim())}`)
      setResult(data)
    } catch {
      setResult({ type: 'unknown', token, error: 'Could not look up this code.' })
    } finally {
      setLoading(false)
    }
  }, [stopScanner, navigate])

  const startScanner = useCallback(async () => {
    if (didStart.current) return
    didStart.current = true
    setError(null)
    scannedRef.current = false
    try {
      const qr = new Html5Qrcode(videoId, { verbose: false })
      scannerRef.current = qr
      await qr.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: { width: 250, height: 250 } },
        (decoded) => handleToken(decoded),
        () => { /* per-frame failures ignored */ },
      )
    } catch (e: any) {
      setError(e?.message?.includes('Permission')
        ? 'Camera access denied. Allow camera in browser settings.'
        : 'Could not start camera.')
    }
  }, [handleToken])

  const reset = useCallback(async () => {
    setResult(null)
    setError(null)
    setScanning(true)
    setLoading(false)
    didStart.current = false
    scannedRef.current = false
    await stopScanner()
    setTimeout(startScanner, 150)
  }, [startScanner, stopScanner])

  useEffect(() => {
    startScanner()
    return () => { stopScanner() }
  }, [startScanner, stopScanner])

  const handleGo = () => {
    if (!result) return
    const path = navPath(result)
    if (path) navigate(path)
  }

  const handleManual = (e: React.FormEvent) => {
    e.preventDefault()
    const val = manualVal.trim()
    if (val) { setShowManual(false); handleToken(val) }
  }

  return (
    <div className="relative min-h-screen bg-black overflow-hidden">
      {/* Camera feed — Html5Qrcode manages its own scan box overlay */}
      <div
        id={videoId}
        className="absolute inset-0 w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-cover [&>canvas]:hidden [&_#lst-qr-video__dashboard_section_csr]:hidden [&_#lst-qr-video__dashboard_section]:hidden"
        style={{ zIndex: 0 }}
      />

      {/* Loading / success overlay — centered, no competing frame */}
      {(loading || result) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {loading && <Loader2 className="h-12 w-12 text-brass-shimmer animate-spin drop-shadow-lg" />}
          {result && !loading && (
            <motion.div initial={{ scale:0.5, opacity:0 }} animate={{ scale:1, opacity:1 }}
              className="w-20 h-20 rounded-full bg-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            </motion.div>
          )}
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 pt-12 pb-4">
        <button onClick={() => { stopScanner(); navigate(-1) }}
          className="w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center">
          <X className="h-5 w-5 text-white" />
        </button>
        <p className="text-white/80 text-sm font-medium">
          {loading ? 'Looking up…' : result ? 'Code found' : 'Align code in frame'}
        </p>
        <button onClick={() => setShowManual(v => !v)}
          className="w-10 h-10 rounded-full bg-black/50 border border-white/10 flex items-center justify-center">
          <Keyboard className="h-5 w-5 text-white" />
        </button>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }}
            className="absolute bottom-40 inset-x-6 bg-red-900/80 border border-red-500/40 rounded-2xl p-4 text-center">
            <p className="text-red-200 text-sm">{error}</p>
            <button onClick={reset} className="mt-2 text-xs text-red-300 underline">Try again</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result card */}
      <AnimatePresence>
        {result && !loading && (
          <motion.div initial={{ y:120, opacity:0 }} animate={{ y:0, opacity:1 }} exit={{ y:120, opacity:0 }}
            transition={{ type:'spring', damping:22, stiffness:260 }}
            className="absolute bottom-0 inset-x-0 px-4 pb-10 pt-2">
            <div className={cn('rounded-2xl p-5 bg-gradient-to-b border backdrop-blur-xl', ACCENTS[result.type])}>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-black/30 flex items-center justify-center shrink-0">
                  {typeIcon(result.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-base truncate">{resultTitle(result)}</p>
                  <p className="text-white/60 text-sm truncate">{resultDetail(result)}</p>
                </div>
              </div>
              <div className="flex gap-3">
                {navPath(result) ? (
                  <button onClick={handleGo}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/15 border border-white/20 text-white font-medium text-sm hover:bg-white/25 active:scale-95 transition-all">
                    Open <ChevronRight className="h-4 w-4" />
                  </button>
                ) : null}
                <button onClick={reset}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white/70 text-sm hover:bg-black/50 active:scale-95 transition-all">
                  Scan again
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual entry */}
      <AnimatePresence>
        {showManual && (
          <motion.div initial={{ y:200, opacity:0 }} animate={{ y:0, opacity:1 }} exit={{ y:200, opacity:0 }}
            transition={{ type:'spring', damping:24, stiffness:280 }}
            className="absolute bottom-0 inset-x-0 bg-forest-deep/95 border-t border-brass/20 backdrop-blur-xl px-5 pt-5 pb-10 rounded-t-3xl">
            <div className="w-10 h-1 bg-brass/30 rounded-full mx-auto mb-5" />
            <p className="text-cream text-sm font-medium mb-3">Enter code manually</p>
            <form onSubmit={handleManual} className="flex gap-2">
              <input autoFocus type="text" value={manualVal} onChange={e => setManualVal(e.target.value)}
                placeholder="DN-NYC-2026-00082 or ALT-NYC-…"
                className="flex-1 bg-forest-raised border border-brass/20 rounded-xl px-4 py-3 text-cream text-sm placeholder:text-cream-dim/40 focus:outline-none focus:border-brass/50" />
              <button type="submit" disabled={!manualVal.trim()}
                className="px-5 py-3 rounded-xl bg-brass/20 border border-brass/30 text-brass-shimmer text-sm font-medium hover:bg-brass/30 disabled:opacity-40 transition-all">
                Go
              </button>
            </form>
            <button onClick={() => setShowManual(false)} className="mt-3 text-xs text-cream-dim/60 w-full text-center">Cancel</button>
          </motion.div>
        )}
      </AnimatePresence>

      {!result && !error && !loading && !showManual && (
        <div className="absolute bottom-12 inset-x-0 text-center">
          <p className="text-white/40 text-xs">Deliveries · Alterations · Orders · Invoices</p>
        </div>
      )}
    </div>
  )
}
