import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { toast } from "sonner";
import { X, Keyboard, ArrowRight, CameraOff } from "lucide-react";
import { Button } from "@ls/design/ui/button";
import { Input } from "@ls/design/ui/input";
import { cn } from "@ls/design/utils";
import { api } from "@ls/api-client";
import type { ScannerResult, ScannerActionResult } from "@ls/types";
import { ScannerResultSheet } from "@alts/components/scanner/ScannerResultSheet";
import {
  openPathForResult,
  routeForScannerResult,
  routeFromRawScan,
} from "@alts/lib/scanRoutes";

const VIDEO_ID = "ls-scanner-video";
const RESCAN_DEBOUNCE_MS = 1200;

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
    if (navigator.vibrate) navigator.vibrate(40);
  } catch {
    /* ignore */
  }
}

export default function Scanner() {
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startingRef = useRef(false);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const handleDecodeRef = useRef<(decoded: string) => void>(() => {});
  const mountedRef = useRef(true);

  const [result, setResult] = useState<ScannerResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<{ message: string; permission: boolean } | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [statusLine, setStatusLine] = useState("Point at any L&S QR");

  const stopCamera = useCallback(async () => {
    const inst = scannerRef.current;
    scannerRef.current = null;
    startingRef.current = false;
    if (inst) {
      try {
        if (inst.isScanning) await inst.stop();
      } catch {
        /* ignore */
      }
      try {
        inst.clear();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const resolveToken = useCallback(
    async (token: string) => {
      const value = token.trim();
      if (!value) return;
      await stopCamera();
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
      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.value === decoded && now - last.at < RESCAN_DEBOUNCE_MS) return;
      lastScanRef.current = { value: decoded, at: now };

      buzz();
      setStatusLine("Got it — opening…");

      // Instant client routes (thermal ticket /g/ garment / pay / customer) — no network.
      const fast = routeFromRawScan(decoded);
      if (fast.kind === "path") {
        void stopCamera();
        navigate(fast.path, { replace: !!fast.replace });
        return;
      }

      void resolveToken(decoded);
    },
    [resolveToken, navigate, stopCamera],
  );

  // Keep ref current so the camera effect never restarts on callback identity churn.
  handleDecodeRef.current = handleDecode;

  const startCamera = useCallback(async () => {
    if (startingRef.current || scannerRef.current) return;
    if (typeof document !== "undefined" && !document.getElementById(VIDEO_ID)) {
      // Layout not ready — retry next frame.
      requestAnimationFrame(() => {
        void startCamera();
      });
      return;
    }

    startingRef.current = true;
    setCameraError(null);
    setStatusLine("Starting camera…");

    try {
      // One frame for absolute container to get non-zero size (iOS).
      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      const qr = new Html5Qrcode(VIDEO_ID, {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        // Native detector when present — much better on thermal prints / iOS.
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
      scannerRef.current = qr;

      // Full-frame scan box. A tight center crop was missing small thermal QRs
      // held a few inches off the glass.
      const qrbox = (vw: number, vh: number) => {
        const w = Math.max(200, Math.floor(vw * 0.92));
        const h = Math.max(200, Math.floor(vh * 0.92));
        return { width: w, height: h };
      };

      await qr.start(
        { facingMode: "environment" },
        {
          fps: 20,
          qrbox,
          // Let the library pick stream size; forcing 1080p breaks some iPhones.
          disableFlip: false,
        },
        (decoded) => handleDecodeRef.current(decoded),
        () => {
          /* per-frame miss — silent */
        },
      );

      if (mountedRef.current) setStatusLine("Point at any L&S QR");
    } catch (e: unknown) {
      scannerRef.current = null;
      const msg = e instanceof Error ? e.message : String(e ?? "");
      const permission = /permission|notallowed|denied|NotAllowed/i.test(msg);
      setCameraError({
        message: permission
          ? "Camera blocked — allow camera for this site, or type the code."
          : "Camera unavailable — type the code below.",
        permission,
      });
      setShowManual(true);
      setStatusLine("Manual entry");
    } finally {
      startingRef.current = false;
    }
  }, []);

  // Start once on mount. Do NOT depend on startCamera identity churn.
  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      void stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only camera lifecycle
  }, []);

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
    void stopCamera();
    navigate(-1);
  }, [navigate, stopCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-forest-deep overflow-hidden">
      {/*
        Camera host. Do NOT hide the library canvas — zxing fallback needs it.
        Only tone down the default html5-qrcode shaded border via CSS.
      */}
      <div
        id={VIDEO_ID}
        className={cn(
          "absolute inset-0 h-full w-full bg-black",
          "[&>video]:h-full [&>video]:w-full [&>video]:object-cover",
          // Soften library chrome; keep canvas in layout for decode
          "[&_#qr-shaded-region]:border-brass/40",
          "[&_img]:opacity-0",
        )}
      />

      <div className="pointer-events-none absolute inset-0 bg-forest-deep/20" />

      {!sheetOpen ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[min(72vw,22rem)] w-[min(72vw,22rem)]">
            <span className="absolute left-0 top-0 h-12 w-12 border-l-[3px] border-t-[3px] border-brass rounded-tl-2xl" />
            <span className="absolute right-0 top-0 h-12 w-12 border-r-[3px] border-t-[3px] border-brass rounded-tr-2xl" />
            <span className="absolute bottom-0 left-0 h-12 w-12 border-b-[3px] border-l-[3px] border-brass rounded-bl-2xl" />
            <span className="absolute bottom-0 right-0 h-12 w-12 border-b-[3px] border-r-[3px] border-brass rounded-br-2xl" />
          </div>
        </div>
      ) : null}

      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 z-10">
        <button
          onClick={handleClose}
          aria-label="Close scanner"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-brass/25 bg-forest-deep/70 backdrop-blur-md text-cream hover:border-brass/50 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="text-cream/90 text-sm font-medium text-center px-2">{statusLine}</span>
        <button
          onClick={() => setShowManual((v) => !v)}
          aria-label="Enter code manually"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-brass/25 bg-forest-deep/70 backdrop-blur-md text-cream hover:border-brass/50 transition-colors"
        >
          <Keyboard className="h-5 w-5" />
        </button>
      </div>

      {cameraError ? (
        <div className="absolute inset-x-4 top-24 z-10 rounded-2xl border border-signal-amber/30 bg-forest-deep/90 backdrop-blur-md p-4">
          <div className="flex items-start gap-3">
            <CameraOff className="h-5 w-5 text-signal-amber shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-cream text-sm font-medium">{cameraError.message}</div>
              {cameraError.permission ? (
                <div className="text-cream-dim text-xs mt-1">
                  Settings → Safari → Camera → Allow, then reload. Or use the keyboard.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showManual ? (
        <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-3xl border-t border-brass/20 bg-forest-deep/95 backdrop-blur-2xl px-5 pt-5 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-brass/30" />
          <label className="ui-label text-[9px] text-cream-dim mb-2 block">Enter code manually</label>
          <form onSubmit={submitManual} className="flex gap-2">
            <Input
              autoFocus
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="ALT-NYC-… or paste QR URL"
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
