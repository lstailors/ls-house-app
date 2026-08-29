import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@checkout/lib/api";
import { bagClear, bagList } from "@checkout/lib/bag";
import { Chrome, PrimaryButton, SectionLabel } from "@checkout/components/Chrome";

const OUTS = [
  { id: "Pickup" as const, name: "Pickup", role: "Handed at counter" },
  { id: "Hand" as const, name: "Hand delivery", role: "Staff / driver handoff" },
  { id: "FedEx" as const, name: "FedEx", role: "Courier + ls_carrier=FedEx" },
];

export default function OutPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const ticket = sp.get("ticket") || undefined;
  const invoice = sp.get("invoice") || undefined;
  const [method, setMethod] = useState<"Pickup" | "Hand" | "FedEx">("Pickup");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      const bag = bagList();
      const tickets = [
        ...(ticket ? [ticket] : []),
        ...bag.filter((b) => b.kind === "ticket").map((b) => b.id),
      ].filter((v, i, a) => a.indexOf(v) === i);

      await api.out({
        ticket: tickets[0],
        tickets: tickets.length > 1 ? tickets : undefined,
        invoice,
        method,
      });
      bagClear();
      nav(
        `/receipt?${new URLSearchParams({
          ...(tickets[0] ? { ticket: tickets[0] } : {}),
          ...(invoice ? { invoice } : {}),
          out: method,
        }).toString()}`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Out failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="checkout-shell">
      <Chrome title="Out" sub="How are they leaving?" backTo={ticket ? `/t/${ticket}` : "/"} />
      <SectionLabel>Method</SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        {OUTS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setMethod(o.id)}
            className={`glass flex min-h-[72px] items-center justify-between px-4 text-left ${
              method === o.id ? "border-[var(--br)] ring-1 ring-[var(--br)]" : ""
            }`}
          >
            <div>
              <div className="text-[15px] font-semibold">{o.name}</div>
              <div className="mt-1 text-xs text-[var(--cm)]">{o.role}</div>
            </div>
            <div
              className={`grid h-6 w-6 place-items-center rounded-full border text-xs ${
                method === o.id ? "border-[var(--br)] bg-[var(--br)] text-[var(--fd)]" : "border-[var(--line)]"
              }`}
            >
              ✓
            </div>
          </button>
        ))}
      </div>
      {err ? <p className="px-4 pt-3 text-center text-sm text-red-300">{err}</p> : null}
      <div className="mt-auto px-4 pb-8 pt-6">
        <PrimaryButton disabled={busy || (!ticket && !invoice && !bagList().length)} onClick={() => void confirm()}>
          {busy ? "Saving…" : `Confirm · ${method}`}
        </PrimaryButton>
      </div>
    </div>
  );
}
