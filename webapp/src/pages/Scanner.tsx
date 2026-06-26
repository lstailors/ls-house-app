import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { toast } from "sonner";
import { X, Keyboard, ArrowRight, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { ScannerResult, ScannerActionResult } from "@/lib/types";
import { ScannerResultSheet } from "@/components/scanner/ScannerResultSheet";

const VIDEO_ID = "ls-scanner-video";
const RESCAN_DEBOUNCE_MS = 2000;

// doctype → Frappe desk slug (lowercase, spaces → hyphens)
function slugifyDoctype(doctype?: string): string {
  return (doctype ?? "").trim().toLowerCase().replace(/\s+/g, "-");
}

function deskUrl(doctype: string | undefined, name: string): string {
  return `https://erp.lstailors.com/app/${slugifyDoctype(doctype)}/${encodeURIComponent(name)}`;
}

function printUrl(doctype: string | undefined, name: string): string {
  const params = new URLSearchParams({
    doctype: doctype ?? "",
    name,
    format: "Garment Tag",
    trigger_print: "1",
  });
  return `https://erp.lstailors.com/printview?${params.toString()}`;
}

// to_state per advance-status action key
const ADVANCE_STATE: Record<string, string> = {
  mark_in_progress: "In Progress",
  mark_ready: "Ready",
  mark_picked_up: "Picked Up",
};

export default function Scanner() {
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startingRef = useRef(false);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

  const [result, setResult] = useState<ScannerResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<{ message: string; permission: boolean } | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState("");

  const stopCamera = useCallback(async () => {
    const inst = scannerRef.current;
    scannerRef.current = null;
    startingRef.current = false;
    if (inst) {
      try { await inst.stop(); } catch { /* ignore */ }
      try { inst.clear(); } catch { /* ignore */ }
    }
  }, []);

  // Resolve a scanned/typed token via the backend.
  const resolveToken = useCallback(async (token: string) => {
    const value = token.trim();
    if (!value) return;
    await stopCamera();
    setResult(null);
    setSheetOpen(true);
    setResolving(true);
    try {
      const data = await api.post<ScannerResult>("/api/scanner/resolve", { token: value });
      setResult(data);
    } catch {
      setResult({
        ok: false,
        reason: "Lookup failed — check your connection and try again.",
        raw: value,
      });
    } finally {
      setResolving(false);
    }
  }, [stopCamera]);

  const handleDecode = useCallback((decoded: string) => {
    const now = Date.now();
    const last = lastScanRef.current;
    // Debounce: ignore identical consecutive scans within the window.
    if (last && last.value === decoded && now - last.at < RESCAN_DEBOUNCE_MS) return;
    lastScanRef.current = { value: decoded, at: now };
    void resolveToken(decoded);
  }, [resolveToken]);

  const startCamera = useCallback(async () => {
    if (startingRef.current || scannerRef.current) return;
    startingRef.current = true;
    setCameraError(null);
    try {
      const qr = new Html5Qrcode(VIDEO_ID, {
        verbose: false,
        // Use the device's native BarcodeDetector when available (iOS 16+/
        // modern Android). It is dramatically faster and more reliable at
        // reading real-world printed tags than the JS (zxing) fallback.
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
      scannerRef.current = qr;
      // Responsive scan box: ~80% of the smaller video edge, so the QR only
      // has to be roughly within the frame (a fixed 250px box is a tiny center
      // crop on a full-screen feed, which is why nothing was decoding).
      const qrbox = (vw: number, vh: number) => {
        const size = Math.floor(Math.min(vw, vh) * 0.8);
        return { width: size, height: size };
      };
      // .start() rejects ASYNCHRONOUSLY when camera is denied/unavailable
      // (common in iOS in-app webviews) — this await catches that rejection.
      await qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox },
        (decoded) => handleDecode(decoded),
        () => { /* per-frame decode failures are noise — ignore */ },
      );
    } catch (e: unknown) {
      scannerRef.current = null;
      const msg = e instanceof Error ? e.message : String(e ?? "");
      const permission = /permission|notallowed|denied/i.test(msg);
      setCameraError({
        message: "Camera unavailable — you can still type a code below.",
        permission,
      });
      setShowManual(true);
    } finally {
      startingRef.current = false;
    }
  }, [handleDecode]);

  // Start on mount, stop on unmount.
  useEffect(() => {
    void startCamera();
    return () => { void stopCamera(); };
  }, [startCamera, stopCamera]);

  const scanAgain = useCallback(() => {
    setSheetOpen(false);
    setResult(null);
    setResolving(false);
    setPendingAction(null);
    lastScanRef.current = null;
    void startCamera();
  }, [startCamera]);

  // Run an in-app backend action, toast on success, then reset to scan again.
  const runBackendAction = useCallback(
    async (key: string, endpoint: string, body: Record<string, unknown>) => {
      setPendingAction(key);
      try {
        const res = await api.post<ScannerActionResult>(endpoint, body);
        if (res.ok) {
          toast.success(res.message ?? "Done");
          scanAgain();
        } else {
          toast.error(res.message ?? "Action failed");
          setPendingAction(null);
        }
      } catch {
        toast.error("Action failed — please try again");
        setPendingAction(null);
      }
    },
    [scanAgain],
  );

  const handleAction = useCallback((key: string) => {
    if (!result) return;
    const name = result.name ?? "";

    switch (key) {
      case "mark_paid":
        void runBackendAction(key, "/api/scanner/mark-paid", { invoice_name: name });
        return;
      case "mark_delivered":
        void runBackendAction(key, "/api/scanner/mark-delivered", { delivery_name: name });
        return;
      case "mark_in_progress":
      case "mark_ready":
      case "mark_picked_up":
        void runBackendAction(key, "/api/scanner/advance-status", {
          ticket_name: name,
          to_state: ADVANCE_STATE[key],
        });
        return;
      case "confirm_receipt":
        void runBackendAction(key, "/api/scanner/confirm-transfer", { transfer_name: name });
        return;
      case "open_payment_link": {
        const link = result.meta?.square_payment_link;
        if (typeof link === "string" && link.length > 0) {
          window.open(link, "_blank", "noopener");
        } else {
          toast.error("No payment link on record");
        }
        return;
      }
      case "open":
        window.open(deskUrl(result.doctype, name), "_blank", "noopener");
        return;
      case "print_tag":
      case "print_tags":
        window.open(printUrl(result.doctype, name), "_blank", "noopener");
        return;
      case "send_sms":
        toast.message("Use the delivery screen to send SMS");
        return;
      default:
        toast.error(`Unsupported action: ${key}`);
    }
  }, [result, runBackendAction]);

  const submitManual = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const value = manualValue.trim();
    if (!value) return;
    setShowManual(false);
    void resolveToken(value);
  }, [manualValue, resolveToken]);

  const handleClose = useCallback(() => {
    void stopCamera();
    navigate(-1);
  }, [navigate, stopCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-forest-deep overflow-hidden">
      {/* Camera feed — html5-qrcode injects its <video> here */}
      <div
        id={VIDEO_ID}
        className={cn(
          "absolute inset-0 h-full w-full",
          "[&>video]:h-full [&>video]:w-full [&>video]:object-cover",
          "[&>canvas]:hidden [&_img]:hidden",
        )}
      />

      {/* Forest tint over the feed */}
      <div className="pointer-events-none absolute inset-0 bg-forest-deep/30" />

      {/* Brass aim frame */}
      {!sheetOpen ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-64 w-64 max-w-[70vw] max-h-[70vw]">
            <span className="absolute left-0 top-0 h-10 w-10 border-l-2 border-t-2 border-brass rounded-tl-xl" />
            <span className="absolute right-0 top-0 h-10 w-10 border-r-2 border-t-2 border-brass rounded-tr-xl" />
            <span className="absolute bottom-0 left-0 h-10 w-10 border-b-2 border-l-2 border-brass rounded-bl-xl" />
            <span className="absolute bottom-0 right-0 h-10 w-10 border-b-2 border-r-2 border-brass rounded-br-xl" />
          </div>
        </div>
      ) : null}

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <button
          onClick={handleClose}
          aria-label="Close scanner"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-brass/25 bg-forest-deep/70 backdrop-blur-md text-cream hover:border-brass/50 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="text-cream/80 text-sm font-medium">
          {resolving ? "Looking up…" : "Align code in frame"}
        </span>
        <button
          onClick={() => setShowManual((v) => !v)}
          aria-label="Enter code manually"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-brass/25 bg-forest-deep/70 backdrop-blur-md text-cream hover:border-brass/50 transition-colors"
        >
          <Keyboard className="h-5 w-5" />
        </button>
      </div>

      {/* Camera-unavailable card (non-blocking) */}
      {cameraError ? (
        <div className="absolute inset-x-4 top-24 rounded-2xl border border-signal-amber/30 bg-forest-deep/90 backdrop-blur-md p-4">
          <div className="flex items-start gap-3">
            <CameraOff className="h-5 w-5 text-signal-amber shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-cream text-sm font-medium">{cameraError.message}</div>
              {cameraError.permission ? (
                <div className="text-cream-dim text-xs mt-1">
                  Camera access was blocked. Open this page in Safari to allow the camera.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Manual entry */}
      {showManual ? (
        <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-3xl border-t border-brass/20 bg-forest-deep/95 backdrop-blur-2xl px-5 pt-5 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-brass/30" />
          <label className="ui-label text-[9px] text-cream-dim mb-2 block">Enter code manually</label>
          <form onSubmit={submitManual} className="flex gap-2">
            <Input
              autoFocus
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="DN-NYC-2026-00082 or ALT-NYC-…"
              className="flex-1 min-h-[44px] bg-forest-raised/60 border-brass/25 text-cream placeholder:text-cream-dim/50 focus-visible:ring-brass/40"
            />
            <Button type="submit" disabled={!manualValue.trim()} className="btn-brass min-h-[44px] gap-1.5">
              Go <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
          <button
            onClick={() => setShowManual(false)}
            className="mt-3 w-full text-center text-xs text-cream-dim hover:text-cream transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {/* Result / resolving sheet */}
      <ScannerResultSheet
        open={sheetOpen}
        result={result}
        resolving={resolving}
        pendingAction={pendingAction}
        onAction={handleAction}
        onScanAgain={scanAgain}
        onOpenChange={(o) => { if (!o) scanAgain(); }}
      />
    </div>
  );
}
