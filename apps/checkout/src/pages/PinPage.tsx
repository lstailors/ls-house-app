import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@checkout/lib/api";
import { useSession } from "@checkout/lib/session";
import { PrimaryButton } from "@checkout/components/Chrome";

export default function PinPage() {
  const nav = useNavigate();
  const { setStaff, staff, loading } = useSession();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && staff) nav("/", { replace: true });
  }, [loading, staff, nav]);

  async function submit(code: string) {
    if (code.length !== 4 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.pin(code);
      setStaff(r.staff);
      nav("/", { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "PIN failed");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  function press(d: string) {
    if (busy) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(next);
  }

  function backspace() {
    setPin((p) => p.slice(0, -1));
    setErr(null);
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="checkout-shell">
      <div className="px-5 pt-10 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-[var(--br)] bg-[rgba(176,141,87,0.08)] font-display text-2xl italic text-[var(--bl)]">
          L
        </div>
        <h1 className="display text-[34px] leading-none">Checkout</h1>
        <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cd)]">
          Staff PIN · money desk
        </div>
      </div>

      <div className="flex justify-center gap-4 py-7">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-3.5 w-3.5 rounded-full border-[1.5px] ${
              pin.length > i
                ? "border-[var(--br)] bg-[var(--br)] shadow-[0_0_0_4px_rgba(176,141,87,0.18)]"
                : "border-[rgba(176,141,87,0.45)] bg-transparent"
            }`}
          />
        ))}
      </div>

      <p className="px-7 pb-4 text-center text-xs text-[var(--cm)]">
        4-digit staff code · not open floor
      </p>
      {err ? <p className="px-7 pb-3 text-center text-sm text-red-300">{err}</p> : null}

      <div className="grid flex-1 grid-cols-3 content-start gap-3 px-7">
        {keys.map((k, i) =>
          k === "" ? (
            <div key={i} className="min-h-[68px]" />
          ) : (
            <button
              key={i}
              type="button"
              className={`keypad-key ${k === "⌫" ? "text-sm font-bold uppercase tracking-[0.14em] text-[var(--bl)]" : ""}`}
              onClick={() => (k === "⌫" ? backspace() : press(k))}
              disabled={busy}
            >
              {k}
            </button>
          ),
        )}
      </div>

      <div className="px-5 pb-8 pt-4 text-center">
        <PrimaryButton
          disabled={pin.length !== 4 || busy}
          onClick={() => void submit(pin)}
          label={busy ? "Checking…" : "Unlock"}
        />
        <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cd)]">
          Locked · checkout only
        </div>
      </div>
    </div>
  );
}
