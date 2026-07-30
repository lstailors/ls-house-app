import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import { BrowserMultiFormatReader, BrowserCodeReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
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
const JSQR_EVERY_MS = 120;
/** Hardware / Bluetooth wedge scanners type fast then hit Enter. */
const WEDGE_IDLE_MS = 45;
const WEDGE_MIN_LEN = 4;

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
 * Floor scanner — three concurrent input paths:
 *  1) ZXing continuous camera decode (TRY_HARDER, QR only)
 *  2) jsQR full-frame backup on a timer
 *  3) HID keyboard-wedge / Bluetooth gun (character buffer + Enter)
 * Plus a manual Snap button that freezes one high-res frame.
 */
export default function Scanner() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const jsqrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
  const [debugLine, setDebugLine] = useState("v3");
  const [snapping, setSnapping] = useState(false);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    try {
      zxingControlsRef.current?.stop();
    } catch {
      /* ignore */
    }
    zxingControlsRef.current = null;
    if (jsqrTimerRef.current) {
      clearInterval(jsqrTimerRef.current);
      jsqrTimerRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
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

  /** Single-frame jsQR pass (also used by Snap). */
  const decodeFrameJsQR = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    if (video.readyState < 2) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    // Prefer larger sample for thermal prints; cap for CPU
    const maxEdge = 960;
    const scale = Math.min(1, maxEdge / Math.max(vw, vh));
    const cw = Math.max(1, Math.floor(vw * scale));
    const ch = Math.max(1, Math.floor(vh * scale));
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, cw, ch);

    // Pass 1: as-is
    let img = ctx.getImageData(0, 0, cw, ch);
    let code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (code?.data) return code.data;

    // Pass 2: boost contrast (helps light thermal ink)
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = y < 140 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    img = ctx.getImageData(0, 0, cw, ch);
    code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    return code?.data ?? null;
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    scanningRef.current = true;
    attemptsRef.current = 0;
    setCameraError(null);
    setStatusLine("Starting camera…");
    setDebugLine("v3 starting");
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

    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.muted = true;
    video.playsInline = true;

    try {
      // Pick rear camera if we can list devices (needs prior permission on some iOS).
      let deviceId: string | undefined;
      try {
        const warm = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        for (const t of warm.getTracks()) t.stop();
        const devices = await BrowserCodeReader.listVideoInputDevices();
        const back =
          devices.find((d) => /back|rear|environment/i.test(d.label)) ||
          devices.find((d) => !/front|user|face/i.test(d.label)) ||
          devices[devices.length - 1];
        deviceId = back?.deviceId;
        setDebugLine(`cams=${devices.length} pick=${(back?.label || "default").slice(0, 28)}`);
      } catch {
        deviceId = undefined;
      }

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }

      if (!mountedRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      // Wait for real frames
      for (let i = 0; i < 50 && (!video.videoWidth || !video.videoHeight); i++) {
        await new Promise((r) => setTimeout(r, 40));
      }
      if (!video.videoWidth) {
        setCameraError({
          message: "Camera on but no frames. Tap Snap after a second, or type the code.",
          permission: false,
        });
      }

      setStatusLine("Point at any L&S QR");
      setDebugLine(`live ${video.videoWidth}x${video.videoHeight}`);
      scanningRef.current = true;

      // --- ZXing continuous ---
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      hints.set(DecodeHintType.CHARACTER_SET, "UTF-8");
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 80,
        delayBetweenScanSuccess: 500,
      });

      const controls = await reader.decodeFromStream(stream, video, (zxResult, _err) => {
        if (!scanningRef.current || !mountedRef.current) return;
        attemptsRef.current += 1;
        if (attemptsRef.current % 25 === 0) {
          setDebugLine(
            `zx ${video.videoWidth}x${video.videoHeight} n=${attemptsRef.current}`,
          );
        }
        if (zxResult) {
          const text = zxResult.getText();
          if (text) handleDecodeRef.current(text, "zxing");
        }
      });
      zxingControlsRef.current = controls;

      // --- jsQR backup timer ---
      jsqrTimerRef.current = setInterval(() => {
        if (!scanningRef.current || !mountedRef.current) return;
        try {
          const hit = decodeFrameJsQR();
          if (hit) handleDecodeRef.current(hit, "jsqr");
        } catch {
          /* ignore frame errors */
        }
      }, JSQR_EVERY_MS);
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
  }, [stopCamera, decodeFrameJsQR]);

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
      // Don't steal typing from the manual input
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
          // Slow human typing — drop buffer so we don't mis-fire
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
      // Give autofocus a beat
      await new Promise((r) => setTimeout(r, 120));
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
      <canvas ref={canvasRef} className="hidden" aria-hidden />

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
