export type ErpUpdater = (
  doctype: string,
  name: string,
  values: Record<string, unknown>,
) => Promise<unknown>;

export interface CardOnFileProvenance {
  ticket: string;
  paymentId: string;
}

/**
 * Persist the audit trail for a successful Square card-on-file charge.
 *
 * This intentionally propagates ERP failures. A completed charge without its
 * payment provenance is an integrity failure, not a best-effort annotation.
 */
export async function recordCardOnFileProvenance(
  { ticket, paymentId }: CardOnFileProvenance,
  update: ErpUpdater,
): Promise<void> {
  const updated = await update("Alteration Ticket", ticket, {
    square_transaction_id: paymentId,
    square_payment_method: "Card on File",
  });

  if (updated == null) {
    throw new Error("ERP did not confirm the ticket provenance update");
  }
}
