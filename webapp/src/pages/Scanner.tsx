import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import { toast } from "sonner";
import { X, Keyboard, ArrowRight, CameraOff } from "lucide-react";
import { Button } from "@ls/design/ui/button";
import { Input } from "@ls/design/ui/input";
import { api } from "@/lib/api";
import type { ScannerResult, ScannerActionResult } from "@ls/types";
import { ScannerResultSheet } from "@/components/scanner/ScannerResultSheet";
import {
  openPathForResult,
  routeForScannerResult,
  routeFromRawScan,
} from "@/lib/scanRoutes";

const RESCAN_DEBOUNCE_MS = 1000;
const SCAN_INTERVAL_MS = 80; // ~12.5 fps continuous

function printUrl(doctype: string | undefined, name: string): string {
  const params = new URLSearchParams({
    doctype: doctype ?? "",
    name,
    format: "Garment Tag",
    trigger_print: "1",
  });
  return `https://erp.lstailors.com/printview?${params.toString()}`;
}

function goNav(
  navigate: ReturnType<typeof useNavigate>,
  nav: ReturnType<typeof routeForScannerResult>,
) {
  if (nav.kind === "path") {
    navigate(nav.path, { replace: !!nav.replace });
    return true;
  }
  if (nav.kind === "external") {
    window.open(nav.url, "_blank", "noopener");
    return true;
  }
  return false;
}

const ADVANCE_STATE: Record<string, string> = {
  mark_in_progress: "In Progress",
  mark_ready: "Ready",
  mark_picked_up: "Picked Up",
};

function buzz() {
  try {
    navigator.vibrate?.(40);
  } catch {
    /* ignore */
  }
}

type BD = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string; rawValueBytes?: Uint8Array }>>;
};

function getBarcodeDetector(): BD | null {
  try {
    const BDCtor = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => BD })
      .BarcodeDetector;
    if (!BDCtor) return null;
    return new BDCtor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/**
 * Native camera scanner — no html5-qrcode.
 * Continuous full-frame decode via BarcodeDetector (when present) + jsQR fallback.
 * Thermal ticket /g/ /pay URLs route client-side instantly.
 */
export default function Scanner() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanningRef = useRef(true);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const handleDecodeRef = useRef<(decoded: string) => void>(() => {});
  const detectorRef = useRef<BD | null>(null);
  const mountedRef = useRef(true);

  const [result, setResult] = useState<ScannerResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<{ message: string; permission: boolean } | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [statusLine, setStatusLine] = useState("Starting camera…");
  const [engine, setEngine] = useState<string>("");

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
    }
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
        v.srcObject = null;
      } catch {
        /* ignore */
      }
    }
  }, []);

  const resolveToken = useCallback(
    async (token: string) => {
      const value = token.trim();
      if (!value) return;
      scanningRef.current = false;
      stopCamera();
      setResult(null);
      setSheetOpen(true);
      setResolving(true);
      setStatusLine("Looking up…");
      try {
        const data = await api.post<ScannerResult>("/api/scanner/resolve", { token: value });
        const dest = routeForScannerResult(data);
        if (dest.kind === "path") {
          navigate(dest.path, { replace: !!dest.replace });
          return;
        }
        setResult(data);
      } catch {
        setResult({
          ok: false,
          reason: "Lookup failed — check your connection and try again.",
          raw: value,
        });
      } finally {
        if (mountedRef.current) setResolving(false);
      }
    },
    [stopCamera, navigate],
  );

  const handleDecode = useCallback(
    (decoded: string) => {
      const value = decoded.trim();
      if (!value) return;
      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.value === value && now - last.at < RESCAN_DEBOUNCE_MS) return;
      lastScanRef.current = { value, at: now };

      // Pause loop immediately so we don't multi-fire while navigating.
      scanningRef.current = false;
      buzz();
      setStatusLine("Got it — opening…");

      const fast = routeFromRawScan(value);
      if (fast.kind === "path") {
        stopCamera();
        navigate(fast.path, { replace: !!fast.replace });
        return;
      }

      void resolveToken(value);
    },
    [resolveToken, navigate, stopCamera],
  );

  handleDecodeRef.current = handleDecode;

  const tickDecode = useCallback(async () => {
    if (!scanningRef.current || !mountedRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return; // HAVE_CURRENT_DATA

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // 1) Native BarcodeDetector (fast on supporting browsers)
    const detector = detectorRef.current;
    if (detector) {
      try {
        const codes = await detector.detect(video);
        if (!scanningRef.current) return;
        for (const c of codes) {
          const raw = (c.rawValue || "").trim();
          if (raw) {
            handleDecodeRef.current(raw);
            return;
          }
        }
      } catch {
        /* fall through to jsQR */
      }
    }

    // 2) jsQR full-frame (works everywhere, including older iOS)
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Downscale large frames for speed while keeping QR legible
    const maxW = 720;
    const scale = vw > maxW ? maxW / vw : 1;
    const cw = Math.max(1, Math.floor(vw * scale));
    const ch = Math.max(1, Math.floor(vh * scale));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, cw, ch);
    let image: ImageData;
    try {
      image = ctx.getImageData(0, 0, cw, ch);
    } catch {
      return;
    }
    const code = jsQR(image.data, image.width, image.height, {
      inversionAttempts: "attemptBoth",
    });
    if (code?.data && scanningRef.current) {
      handleDecodeRef.current(code.data);
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    scanningRef.current = true;
    setCameraError(null);
    setStatusLine("Starting camera…");

    if (!window.isSecureContext && location.hostname !== "localhost") {
      setCameraError({
        message: "Camera needs HTTPS. Open https://alts.lstailors.com/scanner",
        permission: false,
      });
      setShowManual(true);
      return;
    }

    detectorRef.current = getBarcodeDetector();
    setEngine(detectorRef.current ? "native+jsQR" : "jsQR");

    try {
      // Prefer rear camera; fall back to any camera.
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }

      if (!mountedRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        for (const t of stream.getTracks()) t.stop();
        setCameraError({ message: "Video element missing.", permission: false });
        return;
      }

      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.muted = true;
      video.srcObject = stream;
      await video.play();

      // Wait until dimensions are known (iOS sometimes reports 0 initially).
      const waitReady = async () => {
        for (let i = 0; i < 40; i++) {
          if (video.videoWidth > 0 && video.videoHeight > 0) return true;
          await new Promise((r) => setTimeout(r, 50));
        }
        return video.videoWidth > 0;
      };
      const ready = await waitReady();
      if (!ready) {
        setCameraError({
          message: "Camera started but no frames yet. Try again or type the code.",
          permission: false,
        });
        setShowManual(true);
      }

      if (mountedRef.current) {
        setStatusLine("Point at any L&S QR");
        scanningRef.current = true;
        // Interval is more reliable than rAF when tab is slightly throttled
        timerRef.current = setInterval(() => {
          void tickDecode();
        }, SCAN_INTERVAL_MS);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      const permission = /permission|notallowed|denied|NotAllowed|SecurityError/i.test(msg);
      setCameraError({
        message: permission
          ? "Camera blocked — allow camera for alts.lstailors.com, or type the code."
          : "Camera unavailable — type the code below.",
        permission,
      });
      setShowManual(true);
      setStatusLine("Manual entry");
    }
  }, [stopCamera, tickDecode]);

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
    // mount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause decode while result sheet is open
  useEffect(() => {
    if (sheetOpen) {
      scanningRef.current = false;
    }
  }, [sheetOpen]);

  const scanAgain = useCallback(() => {
    setSheetOpen(false);
    setResult(null);
    setResolving(false);
    setPendingAction(null);
    lastScanRef.current = null;
    setStatusLine("Point at any L&S QR");
    void startCamera();
  }, [startCamera]);

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

  const handleAction = useCallback(
    (key: string) => {
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
        case "open": {
          if (!goNav(navigate, openPathForResult(result))) {
            toast.error("No page available for this record");
          }
          return;
        }
        case "print_tag":
        case "print_tags":
          window.open(printUrl(result.doctype, name), "_blank", "noopener");
          return;
        case "send_sms":
          if (result.type === "lsh_delivery" && name) {
            navigate(`/deliveries/${encodeURIComponent(name)}`);
            return;
          }
          toast.message("Use the delivery screen to send SMS");
          return;
        default:
          toast.error(`Unsupported action: ${key}`);
      }
    },
    [result, runBackendAction, navigate],
  );

  const submitManual = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const value = manualValue.trim();
      if (!value) return;
      setShowManual(false);
      handleDecode(value);
    },
    [manualValue, handleDecode],
  );

  const handleClose = useCallback(() => {
    stopCamera();
    navigate(-1);
  }, [navigate, stopCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-black overflow-hidden">
      {/* Live camera — full bleed, playsInline on iOS */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {/* Offscreen canvas for jsQR sampling */}
      <canvas ref={canvasRef} className="hidden" aria-hidden />

      <div className="pointer-events-none absolute inset-0 bg-forest-deep/15" />

      {!sheetOpen ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[min(78vw,24rem)] w-[min(78vw,24rem)]">
            <span className="absolute left-0 top-0 h-14 w-14 border-l-[3px] border-t-[3px] border-brass rounded-tl-2xl" />
            <span className="absolute right-0 top-0 h-14 w-14 border-r-[3px] border-t-[3px] border-brass rounded-tr-2xl" />
            <span className="absolute bottom-0 left-0 h-14 w-14 border-b-[3px] border-l-[3px] border-brass rounded-bl-2xl" />
            <span className="absolute bottom-0 right-0 h-14 w-14 border-b-[3px] border-r-[3px] border-brass rounded-br-2xl" />
            {/* scan sweep hint */}
            <div className="absolute inset-x-6 top-1/2 h-px bg-brass/50 shadow-[0_0_12px_rgba(176,141,87,0.8)] animate-pulse" />
          </div>
        </div>
      ) : null}

      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close scanner"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-brass/25 bg-forest-deep/75 backdrop-blur-md text-cream"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-center px-2 min-w-0">
          <div className="text-cream text-sm font-medium truncate">{statusLine}</div>
          {engine ? (
            <div className="text-[10px] uppercase tracking-widest text-cream/50 mt-0.5">{engine}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          aria-label="Enter code manually"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-brass/25 bg-forest-deep/75 backdrop-blur-md text-cream"
        >
          <Keyboard className="h-5 w-5" />
        </button>
      </div>

      {cameraError ? (
        <div className="absolute inset-x-4 top-24 z-10 rounded-2xl border border-signal-amber/30 bg-forest-deep/92 backdrop-blur-md p-4">
          <div className="flex items-start gap-3">
            <CameraOff className="h-5 w-5 text-signal-amber shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-cream text-sm font-medium">{cameraError.message}</div>
              {cameraError.permission ? (
                <div className="text-cream-dim text-xs mt-1">
                  iPhone: Settings → Safari → Camera → Allow, then reload this page.
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void startCamera()}
                className="mt-3 text-xs uppercase tracking-widest text-brass-light"
              >
                Retry camera
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showManual ? (
        <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-3xl border-t border-brass/20 bg-forest-deep/96 backdrop-blur-2xl px-5 pt-5 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-brass/30" />
          <label className="ui-label text-[9px] text-cream-dim mb-2 block">Enter code or paste QR URL</label>
          <form onSubmit={submitManual} className="flex gap-2">
            <Input
              autoFocus
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="ALT-NYC-… or https://alts…/t/…"
              className="flex-1 min-h-[44px] bg-forest-raised/60 border-brass/25 text-cream placeholder:text-cream-dim/50"
            />
            <Button type="submit" disabled={!manualValue.trim()} className="btn-brass min-h-[44px] gap-1.5">
              Go <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setShowManual(false)}
            className="mt-3 w-full text-center text-xs text-cream-dim"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 z-10 pb-[max(1.5rem,env(safe-area-inset-bottom))] px-5 pointer-events-none">
          <p className="text-center text-cream/70 text-xs">
            Hold steady 6–10&quot; from the slip · whole QR in frame
          </p>
        </div>
      )}

      <ScannerResultSheet
        open={sheetOpen}
        result={result}
        resolving={resolving}
        pendingAction={pendingAction}
        onAction={handleAction}
        onScanAgain={scanAgain}
        onOpenChange={(o) => {
          if (!o) scanAgain();
        }}
      />
    </div>
  );
}
