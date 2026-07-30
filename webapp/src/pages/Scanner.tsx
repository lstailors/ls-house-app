import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import { toast } from "sonner";
import { X, Keyboard, ArrowRight, CameraOff, Aperture } from "lucide-react";
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

const RESCAN_DEBOUNCE_MS = 900;
/** How often to poll for a QR (BarcodeDetector path) */
const POLL_MS = 150;
/** Hardware / Bluetooth wedge scanners type fast then hit Enter. */
const WEDGE_IDLE_MS = 45;
const WEDGE_MIN_LEN = 4;

declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts: { formats: string[] }): {
        detect(src: HTMLVideoElement | HTMLCanvasElement | ImageData): Promise<
          Array<{ rawValue: string; format: string }>
        >;
      };
      getSupportedFormats?(): Promise<string[]>;
    };
  }
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
    navigator.vibrate?.(50);
  } catch {
    /* ignore */
  }
}

function forceSwUpdate() {
  try {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const r of regs) void r.update();
    });
  } catch {
    /* ignore */
  }
}

/**
 * v4 — native BarcodeDetector first (iOS 17+, Chrome), jsQR fallback.
 * ZXing removed: too heavy for mobile real-time, CPU-bound on thermal prints.
 *
 * Decode paths:
 *  1) BarcodeDetector (hardware-accelerated on iOS 17+) polled every ~150ms
 *  2) jsQR multi-threshold fallback polled every ~200ms
 *  3) Snap QR — forces a high-res frame through both decoders
 *  4) HID / Bluetooth wedge (keyboard buffer + Enter)
 *  5) Manual text entry
 */
export default function Scanner() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bdRef = useRef<InstanceType<NonNullable<typeof window.BarcodeDetector>> | null>(null);
  const scanningRef = useRef(true);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const handleDecodeRef = useRef<(decoded: string, via: string) => void>(() => {});
  const wedgeBufRef = useRef("");
  const wedgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const attemptsRef = useRef(0);

  const [result, setResult] = useState<ScannerResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<{ message: string; permission: boolean } | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [statusLine, setStatusLine] = useState("Starting camera…");
  const [debugLine, setDebugLine] = useState("v4");
  const [snapping, setSnapping] = useState(false);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const t of stream.getTracks()) {
        try { t.stop(); } catch { /* ignore */ }
      }
    }
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
        v.srcObject = null;
      } catch { /* ignore */ }
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
    (decoded: string, via: string) => {
      const value = decoded.trim();
      if (!value || !scanningRef.current) return;
      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.value === value && now - last.at < RESCAN_DEBOUNCE_MS) return;
      lastScanRef.current = { value, at: now };

      scanningRef.current = false;
      buzz();
      setStatusLine(`Got it (${via}) — opening…`);
      setDebugLine(`hit via ${via}: ${value.slice(0, 48)}`);

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

  /**
   * Draw current video frame to off-screen canvas and run jsQR with multiple
   * contrast passes. Returns decoded string or null.
   */
  const decodeFrameJsQR = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    if (video.readyState < 2) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    // Use a generous resolution — thermal QR codes need detail
    const maxEdge = 1024;
    const scale = Math.min(1, maxEdge / Math.max(vw, vh));
    const cw = Math.max(1, Math.floor(vw * scale));
    const ch = Math.max(1, Math.floor(vh * scale));
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, cw, ch);

    // Pass 1: as-is (handles high-contrast QR)
    let img = ctx.getImageData(0, 0, cw, ch);
    let code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (code?.data) return code.data;

    // Pass 2: binarise at threshold 128 (handles faded thermal ink)
    const d1 = img.data;
    for (let i = 0; i < d1.length; i += 4) {
      const y = 0.299 * d1[i] + 0.587 * d1[i + 1] + 0.114 * d1[i + 2];
      const v = y < 128 ? 0 : 255;
      d1[i] = d1[i + 1] = d1[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    img = ctx.getImageData(0, 0, cw, ch);
    code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (code?.data) return code.data;

    // Pass 3: aggressive threshold 160 (extra-faded / cream paper)
    ctx.drawImage(video, 0, 0, cw, ch);
    img = ctx.getImageData(0, 0, cw, ch);
    const d3 = img.data;
    for (let i = 0; i < d3.length; i += 4) {
      const y = 0.299 * d3[i] + 0.587 * d3[i + 1] + 0.114 * d3[i + 2];
      const v = y < 160 ? 0 : 255;
      d3[i] = d3[i + 1] = d3[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    img = ctx.getImageData(0, 0, cw, ch);
    code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    return code?.data ?? null;
  }, []);

  /**
   * Start the polling loop — BarcodeDetector first, jsQR every other tick.
   * Single RAF-based poll avoids multiple competing timers.
   */
  const startPoll = useCallback(
    (video: HTMLVideoElement) => {
      let tick = 0;
      let bdFail = !bdRef.current; // if no BarcodeDetector, skip its path

      pollRef.current = setInterval(() => {
        if (!scanningRef.current || !mountedRef.current) return;
        if (video.readyState < 2 || !video.videoWidth) return;
        tick++;

        // Every tick: try BarcodeDetector (native, async, non-blocking)
        if (!bdFail && bdRef.current) {
          bdRef.current.detect(video).then((results) => {
            if (!scanningRef.current) return;
            if (results.length > 0 && results[0].rawValue) {
              handleDecodeRef.current(results[0].rawValue, "native");
            }
          }).catch(() => {
            bdFail = true; // BarcodeDetector not working — fall through to jsQR
          });
        }

        // Every other tick: jsQR (sync, ~3ms per frame)
        if (tick % 2 === 0 || bdFail) {
          attemptsRef.current += 1;
          if (attemptsRef.current % 20 === 0) {
            setDebugLine(
              `v4 ${video.videoWidth}x${video.videoHeight} n=${attemptsRef.current} ${bdFail ? "jsqr" : "native+jsqr"}`,
            );
          }
          try {
            const hit = decodeFrameJsQR();
            if (hit) handleDecodeRef.current(hit, "jsqr");
          } catch { /* ignore frame errors */ }
        }
      }, POLL_MS);
    },
    [decodeFrameJsQR],
  );

  const startCamera = useCallback(async () => {
    stopCamera();
    scanningRef.current = true;
    attemptsRef.current = 0;
    setCameraError(null);
    setStatusLine("Starting camera…");
    setDebugLine("v4 starting");
    forceSwUpdate();

    if (!window.isSecureContext && location.hostname !== "localhost") {
      setCameraError({
        message: "Camera needs HTTPS — open https://alts.lstailors.com/scanner",
        permission: false,
      });
      setShowManual(true);
      return;
    }

    const video = videoRef.current;
    if (!video) {
      setCameraError({ message: "Video element missing.", permission: false });
      return;
    }

    // Init BarcodeDetector once
    if (!bdRef.current && window.BarcodeDetector) {
      try {
        bdRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
        setDebugLine("v4 native BarcodeDetector ready");
      } catch {
        bdRef.current = null;
      }
    }

    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.muted = true;
    video.playsInline = true;

    try {
      // Simple camera request — no device enumeration dance that can fail on iOS
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch {
        // Last resort: any camera
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }

      if (!mountedRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      // Wait for real frames (iOS sometimes needs a beat)
      for (let i = 0; i < 60 && (!video.videoWidth || !video.videoHeight); i++) {
        await new Promise((r) => setTimeout(r, 40));
      }

      if (!video.videoWidth) {
        setStatusLine("Camera on — tap Snap if auto-scan doesn't fire");
        setDebugLine(`v4 no frames yet — tap Snap`);
      } else {
        setStatusLine("Point at any L&S QR");
        setDebugLine(`v4 live ${video.videoWidth}x${video.videoHeight}${bdRef.current ? " native" : " jsqr"}`);
      }

      scanningRef.current = true;
      startPoll(video);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      const permission = /permission|notallowed|denied|NotAllowed|SecurityError/i.test(msg);
      setCameraError({
        message: permission
          ? "Camera blocked — Settings → Safari → Camera → Allow for this site."
          : `Camera error: ${msg.slice(0, 80) || "unavailable"}. Type the code or use a wedge scanner.`,
        permission,
      });
      setShowManual(true);
      setStatusLine("Manual / gun entry");
      setDebugLine(`cam err: ${msg.slice(0, 60)}`);
    }
  }, [stopCamera, startPoll]);

  // Mount camera once
  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // HID / Bluetooth barcode wedge — listens even when camera fails
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!scanningRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      if (e.key === "Enter") {
        const buf = wedgeBufRef.current.trim();
        wedgeBufRef.current = "";
        if (wedgeTimerRef.current) {
          clearTimeout(wedgeTimerRef.current);
          wedgeTimerRef.current = null;
        }
        if (buf.length >= WEDGE_MIN_LEN) {
          e.preventDefault();
          handleDecodeRef.current(buf, "wedge");
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        wedgeBufRef.current += e.key;
        if (wedgeTimerRef.current) clearTimeout(wedgeTimerRef.current);
        wedgeTimerRef.current = setTimeout(() => {
          wedgeBufRef.current = "";
        }, WEDGE_IDLE_MS);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (wedgeTimerRef.current) clearTimeout(wedgeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (sheetOpen) scanningRef.current = false;
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

  const snapAndDecode = useCallback(async () => {
    setSnapping(true);
    setStatusLine("Snapping…");
    try {
      await new Promise((r) => setTimeout(r, 120));

      // Try native BarcodeDetector first for Snap too
      const video = videoRef.current;
      if (bdRef.current && video && video.readyState >= 2 && video.videoWidth) {
        try {
          const results = await bdRef.current.detect(video);
          if (results.length > 0 && results[0].rawValue) {
            handleDecodeRef.current(results[0].rawValue, "snap-native");
            return;
          }
        } catch { /* fall through to jsqr */ }
      }

      // jsQR fallback
      const hit = decodeFrameJsQR();
      if (hit) {
        handleDecodeRef.current(hit, "snap");
      } else {
        toast.message("No QR in frame — move closer / better light");
        setStatusLine("No QR in snap — try again");
        setDebugLine(
          `snap miss ${videoRef.current?.videoWidth || 0}x${videoRef.current?.videoHeight || 0}`,
        );
      }
    } finally {
      setSnapping(false);
    }
  }, [decodeFrameJsQR]);

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
          } else toast.error("No payment link on record");
          return;
        }
        case "open":
          if (!goNav(navigate, openPathForResult(result))) toast.error("No page for this record");
          return;
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
      scanningRef.current = true;
      handleDecode(value, "manual");
    },
    [manualValue, handleDecode],
  );

  const handleClose = useCallback(() => {
    stopCamera();
    navigate(-1);
  }, [navigate, stopCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-black overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        autoPlay
      />
      {/*
        Canvas must NOT be display:none — use absolute off-screen position so
        getImageData still works on iOS Safari.
      */}
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: "absolute", left: -9999, top: -9999, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />

      <div className="pointer-events-none absolute inset-0 bg-forest-deep/10" />

      {!sheetOpen ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[min(80vw,26rem)] w-[min(80vw,26rem)]">
            <span className="absolute left-0 top-0 h-14 w-14 border-l-[3px] border-t-[3px] border-brass rounded-tl-2xl" />
            <span className="absolute right-0 top-0 h-14 w-14 border-r-[3px] border-t-[3px] border-brass rounded-tr-2xl" />
            <span className="absolute bottom-0 left-0 h-14 w-14 border-b-[3px] border-l-[3px] border-brass rounded-bl-2xl" />
            <span className="absolute bottom-0 right-0 h-14 w-14 border-b-[3px] border-r-[3px] border-brass rounded-br-2xl" />
            <div className="absolute inset-x-8 top-1/2 h-px bg-brass/60 shadow-[0_0_14px_rgba(176,141,87,0.9)] animate-pulse" />
          </div>
        </div>
      ) : null}

      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close scanner"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brass/25 bg-forest-deep/80 backdrop-blur-md text-cream"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-center min-w-0 flex-1">
          <div className="text-cream text-sm font-medium truncate">{statusLine}</div>
          <div className="text-[10px] tracking-wide text-cream/55 mt-0.5 truncate font-mono">
            {debugLine}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          aria-label="Enter code manually"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brass/25 bg-forest-deep/80 backdrop-blur-md text-cream"
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

      {/* Snap + hint */}
      {!showManual && !sheetOpen ? (
        <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-3">
          <p className="text-center text-cream/75 text-xs">
            Auto-scan on · gun/wedge OK · or tap Snap
          </p>
          <button
            type="button"
            disabled={snapping}
            onClick={() => void snapAndDecode()}
            className="flex items-center gap-2 min-h-[52px] px-8 rounded-full border border-brass/50 bg-brass text-forest-deep font-semibold text-sm shadow-lg active:scale-95 disabled:opacity-60"
          >
            <Aperture className="h-5 w-5" />
            {snapping ? "Reading…" : "Snap QR"}
          </button>
        </div>
      ) : null}

      {showManual ? (
        <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-3xl border-t border-brass/20 bg-forest-deep/96 backdrop-blur-2xl px-5 pt-5 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-brass/30" />
          <label className="ui-label text-[9px] text-cream-dim mb-2 block">
            Code, ALT-…, or paste QR URL
          </label>
          <form onSubmit={submitManual} className="flex gap-2">
            <Input
              autoFocus
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="ALT-NYC-2026-00061"
              className="flex-1 min-h-[44px] bg-forest-raised/60 border-brass/25 text-cream"
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
      ) : null}

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
