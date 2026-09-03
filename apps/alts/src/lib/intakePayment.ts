export type IntakePaymentTiming = "later" | "full" | "partial";

export type IntakePaymentMethod =
  | "counter_terminal"
  | "mobile_terminal"
  | "card_on_file"
  | "cash"
  | "check"
  | "square_handheld"
  | "pay_link";

export type IntakePaymentIntent = {
  timing: IntakePaymentTiming;
  method: IntakePaymentMethod;
  amount: number;
};

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

/** Prefer a requested partial amount, but never seed an overpayment. */
export function preferredTenderAmount(requested: number, outstanding: number): number {
  const due = cents(Number(outstanding) || 0);
  const wanted = cents(Number(requested) || 0);
  if (due <= 0) return 0;
  return wanted > 0 && wanted <= due ? wanted : due;
}

export function resolveIntakePaymentAmount(
  timing: IntakePaymentTiming,
  rawAmount: string,
  ticketTotal: number,
): { amount: number; error: string | null } {
  const total = cents(Number(ticketTotal) || 0);
  if (timing === "later") return { amount: 0, error: null };
  if (timing === "full") {
    return total > 0
      ? { amount: total, error: null }
      : { amount: 0, error: "Ticket has no amount to collect" };
  }

  const trimmed = rawAmount.trim();
  if (!trimmed || !/^\d+(?:\.\d{0,2})?$/.test(trimmed)) {
    return { amount: 0, error: "Enter a valid partial payment amount" };
  }
  const amount = cents(Number(trimmed));
  if (amount <= 0) {
    return { amount: 0, error: "Enter a partial payment above $0.00" };
  }
  if (amount > total) {
    return { amount, error: `Partial payment cannot exceed ${usd(total)}` };
  }
  return { amount, error: null };
}
