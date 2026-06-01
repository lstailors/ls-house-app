import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5QrcodeScanner } from 'html5-qrcode'
import { Camera, Search, RotateCcw, ArrowRight, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Constants ──────────────────────────────────────────────────────────────

const SCANNER_ELEMENT_ID = 'qr-scanner-container'
const LS_DOMAINS = ['lstailors.com', 'ls-house-app']

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Given a scanned string, try to extract a navigable internal path.
 * Returns null if it can't be parsed as something useful.
 */
function resolveScannedText(text: string): { path: string; label: string } | null {
  // Try URL parse
  try {
    const url = new URL(text)
    const isLsDomain = LS_DOMAINS.some((d) => url.hostname.includes(d))
    const isLocal =
      url.hostname === window.location.hostname ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1'

    if (isLsDomain || isLocal) {
      // Navigate internally to the path + search
      const internalPath = url.pathname + url.search + url.hash
      return { path: internalPath, label: internalPath }
    }
  } catch {
    // Not a valid URL — fall through
  }

  // Looks like a garment ID or ticket name — attempt direct navigation
  const trimmed = text.trim()

  // garment_id embedded in path like /scan/GAR-0001
  const scanMatch = trimmed.match(/\/scan\/(.+)/)
  if (scanMatch) {
    return { path: '/scan/' + scanMatch[1], label: scanMatch[1] }
  }

  // Looks like a ticket name (ALT-XXXX) or garment id
  if (/^[A-Z]{2,6}-\d{4,}/.test(trimmed)) {
    // Could be a ticket or garment — send to alterations detail
    return { path: '/orders/alterations/' + trimmed, label: trimmed }
  }

  return null
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function QRScanner() {
  const navigate = useNavigate()
  const [result, setResult] = useState<string | null>(null)
  const [manualInput, setManualInput] = useState('')
  const scannerRef = useRef<Html5QrcodeScanner | null>(null)
  const mountedRef = useRef(false)

  // ── Scanner lifecycle ────────────────────────────────────────────────────

  function startScanner() {
    if (scannerRef.current) {
      try { scannerRef.current.clear() } catch { /* ignore */ }
      scannerRef.current = null
    }

    const scanner = new Html5QrcodeScanner(
      SCANNER_ELEMENT_ID,
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        rememberLastUsedCamera: true,
      },
      false
    )

    scanner.render(
      (decodedText: string) => {
        try { scanner.clear() } catch { /* ignore */ }
        scannerRef.current = null
        setResult(decodedText)

        // Attempt auto-navigation for known patterns
        const resolved = resolveScannedText(decodedText)
        if (resolved) {
          navigate(resolved.path)
        }
      },
      (_error: string) => {
        // Suppress per-frame scan errors — normal for QR scanning
      }
    )

    scannerRef.current = scanner
  }

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true

    // Small delay so the DOM element is available
    const timer = setTimeout(() => {
      startScanner()
    }, 100)

    return () => {
      clearTimeout(timer)
      if (scannerRef.current) {
        try { scannerRef.current.clear() } catch { /* ignore */ }
        scannerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleScanAnother() {
    setResult(null)
    mountedRef.current = false
    // Re-run scanner after state reset
    setTimeout(() => {
      mountedRef.current = true
      startScanner()
    }, 150)
  }

  function handleManualEntry(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = manualInput.trim()
    if (!trimmed) return
    // Navigate to alterations ticket (works for both ticket names and garment IDs)
    navigate('/orders/alterations/' + trimmed)
  }

  function handleSearchResult() {
    if (!result) return
    const resolved = resolveScannedText(result)
    if (resolved) {
      navigate(resolved.path)
    } else {
      // Try treating the raw text as a ticket name
      navigate('/orders/alterations/' + result.trim())
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const resolved = result ? resolveScannedText(result) : null

  return (
    <div className="min-h-screen bg-forest-deep text-cream">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brass-shimmer/15 border border-brass/30 flex items-center justify-center">
            <Camera className="text-brass-shimmer" size={20} />
          </div>
          <div>
            <h1 className="text-cream text-xl font-bold">QR Scanner</h1>
            <p className="text-cream-dim text-sm">Scan a garment tag or delivery label</p>
          </div>
        </div>

        {/* ── Scanner or Result ── */}
        {!result ? (
          <div className={cn('glass-panel rounded-xl overflow-hidden')}>
            {/* The html5-qrcode library injects its UI into this div */}
            <div id={SCANNER_ELEMENT_ID} className="w-full" />
          </div>
        ) : (
          <div className="glass-panel rounded-xl p-5 space-y-4">
            {/* Result header */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-900/40 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                <Camera className="text-emerald-400" size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-cream-dim text-xs ui-label mb-1">Scanned Value</p>
                <p className="text-cream text-sm break-all font-mono bg-forest-raised border border-brass/10 rounded px-3 py-2">
                  {result}
                </p>
              </div>
            </div>

            {/* Navigation hint */}
            {resolved ? (
              <div className="flex items-center gap-2 text-emerald-400 text-sm">
                <ArrowRight size={14} />
                <span>Navigating to <span className="font-mono text-xs">{resolved.label}</span>…</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-amber-400 text-sm">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>Could not auto-resolve this code. Use the button below to search.</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleSearchResult}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
                  'bg-brass-shimmer/20 border border-brass/30 text-brass-shimmer',
                  'hover:bg-brass-shimmer/30 transition-all'
                )}
              >
                <Search size={14} />
                Search
              </button>

              <button
                onClick={handleScanAnother}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
                  'bg-forest-raised border border-brass/20 text-cream-muted',
                  'hover:border-brass/40 hover:text-cream transition-all'
                )}
              >
                <RotateCcw size={14} />
                Scan Another
              </button>
            </div>
          </div>
        )}

        {/* ── Manual Entry ── */}
        <div className="glass-panel rounded-xl p-5 space-y-3">
          <h2 className="ui-label text-cream-dim flex items-center gap-2">
            <Search size={13} /> Manual Entry
          </h2>
          <form onSubmit={handleManualEntry} className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Ticket or garment ID (e.g. ALT-0042)"
              className={cn(
                'flex-1 bg-forest-raised border border-brass/20 rounded-md px-3 py-2',
                'text-cream text-sm placeholder:text-cream-dim/40',
                'focus:outline-none focus:ring-1 focus:ring-brass-shimmer/50',
                'transition-all'
              )}
            />
            <button
              type="submit"
              disabled={!manualInput.trim()}
              className={cn(
                'px-4 py-2 rounded-md text-sm font-medium transition-all',
                'bg-brass-shimmer/20 border border-brass/30 text-brass-shimmer',
                'hover:bg-brass-shimmer/30 disabled:opacity-40 disabled:cursor-not-allowed'
              )}
            >
              Go
            </button>
          </form>
          <p className="text-cream-dim/50 text-xs">
            Press Enter or tap Go to open the ticket directly.
          </p>
        </div>

      </div>
    </div>
  )
}
