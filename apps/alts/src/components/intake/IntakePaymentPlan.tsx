import { cn } from "@ls/design/utils";
import {
  resolveIntakePaymentAmount,
  type IntakePaymentMethod,
  type IntakePaymentTiming,
} from "@alts/lib/intakePayment";

const METHODS: Array<{
  id: IntakePaymentMethod;
  label: string;
  hint: string;
  mark: string;
}> = [
  { id: "counter_terminal", label: "Counter Terminal", hint: "Square at the desk", mark: "T" },
  { id: "mobile_terminal", label: "Mobile Terminal", hint: "Handheld reader", mark: "M" },
  { id: "card_on_file", label: "Card on file", hint: "Saved Square card", mark: "••" },
  { id: "cash", label: "Cash", hint: "Posts Payment Entry", mark: "$" },
  { id: "check", label: "Check", hint: "Requires check number", mark: "#" },
  { id: "square_handheld", label: "Square handheld", hint: "Already taken in POS", mark: "HH" },
  { id: "pay_link", label: "Pay link / QR", hint: "Customer phone · Apple Pay", mark: "QR" },
];

type Props = {
  total: number;
  timing: IntakePaymentTiming;
  partialAmount: string;
  method: IntakePaymentMethod;
  onTimingChange: (timing: IntakePaymentTiming) => void;
  onPartialAmountChange: (amount: string) => void;
  onMethodChange: (method: IntakePaymentMethod) => void;
};

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

export default function IntakePaymentPlan({
  total,
  timing,
  partialAmount,
  method,
  onTimingChange,
  onPartialAmountChange,
  onMethodChange,
}: Props) {
  const selection = resolveIntakePaymentAmount(timing, partialAmount, total);

  return (
    <section className="mt-5 rounded-[17px] border border-brass/35 bg-black/30 p-4" aria-labelledby="payment-today-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="payment-today-title" className="display text-[21px] italic text-cream">
            Payment today
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-cream-dim">
            Choose now. The charge is confirmed after Finish creates the invoice.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-cream-dim">
            Ticket total
          </div>
          <div className="display text-[24px] leading-tight text-brass-light">{money(total)}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(
          [
            ["later", "Pay later", "Leave full balance"],
            ["full", "Pay in full", money(total)],
            ["partial", "Partial payment", "Enter any amount"],
          ] as const
        ).map(([id, label, hint]) => {
          const selected = timing === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              onClick={() => onTimingChange(id)}
              className={cn(
                "min-h-[64px] rounded-xl border px-3 py-2.5 text-left transition-colors",
                selected
                  ? "border-brass bg-brass/18 shadow-[0_0_0_1px_rgba(176,141,87,0.18)]"
                  : "border-brass/20 bg-white/[0.025] hover:border-brass/45",
              )}
            >
              <span className="block text-[13px] font-semibold text-cream">{label}</span>
              <span className="mt-0.5 block text-[10.5px] text-cream-dim">{hint}</span>
            </button>
          );
        })}
      </div>

      {timing === "partial" && (
        <label className="mt-3 block text-[10px] font-bold uppercase tracking-[0.14em] text-brass-light">
          Partial amount
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-lg text-brass-light">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={partialAmount}
              onChange={(event) => onPartialAmountChange(event.target.value)}
              placeholder="0.00"
              aria-invalid={Boolean(selection.error)}
              className={cn(
                "h-14 w-full rounded-xl border bg-black/40 pl-9 pr-4 text-[20px] tabular-nums text-cream outline-none",
                selection.error
                  ? "border-signal-amber focus:border-signal-amber"
                  : "border-brass/35 focus:border-brass",
              )}
            />
          </div>
          {selection.error && (
            <span className="mt-1.5 block normal-case tracking-normal text-[11px] font-medium text-signal-amber">
              {selection.error}
            </span>
          )}
        </label>
      )}

      {timing !== "later" && (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brass-light">
              Payment method
            </div>
            <div className="text-[12px] font-semibold text-cream">
              Collect {selection.error ? "—" : money(selection.amount)}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {METHODS.map((option) => {
              const selected = method === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onMethodChange(option.id)}
                  className={cn(
                    "min-h-[58px] rounded-xl border px-3 py-2.5 flex items-center gap-3 text-left transition-colors",
                    selected
                      ? "border-brass bg-brass/16"
                      : "border-brass/20 bg-white/[0.025] hover:border-brass/45",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-full border text-[10px] font-bold",
                      selected
                        ? "border-brass bg-brass text-forest-deep"
                        : "border-brass/35 bg-forest-raised text-brass-light",
                    )}
                  >
                    {option.mark}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-cream">{option.label}</span>
                    <span className="mt-0.5 block text-[10.5px] text-cream-dim">{option.hint}</span>
                  </span>
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full border text-[10px]",
                      selected
                        ? "border-brass bg-brass text-forest-deep"
                        : "border-brass/30 text-transparent",
                    )}
                  >
                    ✓
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
