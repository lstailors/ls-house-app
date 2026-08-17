/**
 * ERP method paths for Epson thermal print.
 * Primary: ls_alterations.api (always importable — same module as create_ticket).
 * Fallbacks: nested ls_thermal package if the bench has it under a different path.
 */
export const THERMAL_PRINT_METHODS = {
  print_ticket: [
    "ls_alterations.api.print_ticket",
    "ls_alterations.ls_thermal.api.print_ticket",
    "ls_alterations.ls_alterations.ls_thermal.api.print_ticket",
  ],
  print_payment_receipt: [
    "ls_alterations.api.print_payment_receipt",
    "ls_alterations.ls_thermal.api.print_payment_receipt",
    "ls_alterations.ls_alterations.ls_thermal.api.print_payment_receipt",
  ],
  print_pay_link: [
    "ls_alterations.api.print_pay_link",
    "ls_alterations.ls_thermal.api.print_pay_link",
    "ls_alterations.ls_alterations.ls_thermal.api.print_pay_link",
  ],
  test_printer: [
    "ls_alterations.api.test_printer",
    "ls_alterations.ls_thermal.api.test_printer",
    "ls_alterations.ls_alterations.ls_thermal.api.test_printer",
  ],
} as const;

export function isMissingErpPrintModule(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /No module named|Failed to get method for command/i.test(msg) ||
    /has no attribute ['"]print_(ticket|payment_receipt|pay_link|test_printer)['"]/i.test(msg) ||
    /Thermal print module is not importable/i.test(msg)
  );
}

/** Staff-facing copy when the bench cannot reach the Epson. */
export function friendlyThermalPrintError(err: unknown): string {
  if (isMissingErpPrintModule(err)) {
    return "Epson thermal is not available on the shop server. Use Browser Print on the receipt page.";
  }
  return err instanceof Error ? err.message : String(err ?? "Print failed");
}
