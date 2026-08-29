import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { api } from "@checkout/lib/api";
import { Chrome, PrimaryButton } from "@checkout/components/Chrome";

export default function ScanPage() {
  const nav = useNavigate();
  const [manual, setManual] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const locked = useRef(false);

  async function resolveCode(raw: string) {
    if (locked.current || busy) return;
    locked.current = true;
    setBusy(true);
    setErr(null);
    try {
      const card = await api.resolve(raw);
      if (card.kind === "search") {
        nav(`/search?q=${encodeURIComponent(raw)}`);
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
          void resolveCode(decoded);
        },
        () => {},
      )
      .catch(() => {
        setErr("Camera unavailable — type the ticket below");
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
      <div className="mt-4 flex gap-2 px-4">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="ALT-NYC-… or LSTNY-SINV-…"
          className="glass min-h-[48px] flex-1 px-3 text-sm outline-none placeholder:text-[var(--cd)]"
          onKeyDown={(e) => e.key === "Enter" && void resolveCode(manual.trim())}
        />
      </div>
      <div className="mt-3 px-4 pb-8">
        <PrimaryButton
          disabled={!manual.trim() || busy}
          onClick={() => void resolveCode(manual.trim())}
          label={busy ? "Looking up…" : "Look up"}
        />
      </div>
    </div>
  );
}
