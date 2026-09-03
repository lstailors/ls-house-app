function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Select a charge amount from caller intent and the live ERP balance.
 * The caller may request less, but never zero, non-finite, or more than due.
 */
export function selectPaymentAmount(
  requested: number | null | undefined,
  outstanding: number,
): number {
  const due = cents(Number(outstanding));
  if (!Number.isFinite(due) || due <= 0) {
    throw new Error("invoice has nothing outstanding");
  }
  if (requested == null) return due;
  if (!Number.isFinite(requested)) {
    throw new Error("amount must be a finite number");
  }
  const amount = cents(requested);
  if (amount <= 0) {
    throw new Error("amount must be positive");
  }
  if (amount > due) {
    throw new Error(`amount ${amount.toFixed(2)} exceeds outstanding ${due.toFixed(2)}`);
  }
  return amount;
}
