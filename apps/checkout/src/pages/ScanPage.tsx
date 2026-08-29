import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { api } from "@checkout/lib/api";
import { Chrome } from "@checkout/components/Chrome";
import { LookupBox } from "@checkout/components/LookupBox";

export default function ScanPage() {
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const locked = useRef(false);

  async function resolveScan(raw: string) {
    if (locked.current || busy) return;
    locked.current = true;
    setBusy(true);
    setErr(null);
    try {
      const card = await api.resolve(raw);
      if (card.kind === "search") {
        // Camera rarely returns names — if multi-hit, stay and show message
        if (card.hits?.length === 1 && card.hits[0]?.kind === "ticket") {
          nav(`/t/${encodeURIComponent(card.hits[0].id)}`, { replace: true });
          return;
        }
        if (card.hits?.length === 1 && card.hits[0]?.kind === "invoice") {
          nav(`/i/${encodeURIComponent(card.hits[0].id)}`, { replace: true });
          return;
        }
        setErr(card.hits?.length ? `Multiple matches — type below` : `Nothing for scan`);
        locked.current = false;
        return;
      }
      if (card.kind === "ticket") nav(`/t/${encodeURIComponent(card.id!)}`, { replace: true });
      else if (card.kind === "invoice") nav(`/i/${encodeURIComponent(card.id!)}`, { replace: true });
      else throw new Error("Unknown result");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Scan failed");
      locked.current = false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const id = "checkout-qr-reader";
    const scanner = new Html5Qrcode(id);
    scannerRef.current = scanner;
    let stopped = false;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 8, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          if (stopped) return;
          void resolveScan(decoded);
        },
        () => {},
      )
      .catch(() => {
        setErr("Camera unavailable — type below");
      });

    return () => {
      stopped = true;
      scanner
        .stop()
        .then(() => scanner.clear())
        .catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="checkout-shell">
      <Chrome title="Scan" sub="Ticket or invoice QR" backTo="/" />
      <div className="px-4">
        <div className="scanner-frame">
          <div id="checkout-qr-reader" className="h-full w-full" />
        </div>
      </div>
      {err ? <p className="px-4 pt-3 text-center text-sm text-red-300">{err}</p> : null}
      {busy ? <p className="px-4 pt-2 text-center text-xs text-[var(--cd)]">Looking up…</p> : null}
      <div className="mt-4 px-4 pb-8">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--cd)]">Look up</div>
        <LookupBox />
      </div>
    </div>
  );
}
