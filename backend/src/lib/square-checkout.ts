/**
 * Square Terminal helpers shared by /api/payments/*.
 * Live ERP `ls_alterations` (May 2026) does not ship `ls_square` — House
 * must detect that and talk to Square directly.
 */

export function isMissingLsSquareModule(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /No module named ['"]ls_alterations\.ls_square['"]/i.test(msg) ||
    /has no attribute ['"]create_(checkout|payment_link)['"]/i.test(msg) ||
    /has no attribute ['"]receive['"]/i.test(msg) ||
    /has no attribute ['"]record_cash_payment['"]/i.test(msg) ||
    /Failed to get method for command/i.test(msg)
  );
}

/** Try stable ls_alterations.api wrappers first, then the nested ls_square path. */
export function squareErpMethods(name: "create_checkout" | "create_payment_link" | "checkout_status" | "list_terminals" | "record_cash_payment" | "receive"): string[] {
  if (name === "receive") {
    return [
      "ls_alterations.api.receive_square_webhook",
      "ls_alterations.ls_square.webhook.receive",
    ];
  }
  return [
    `ls_alterations.api.${name}`,
    `ls_alterations.ls_square.pos.${name}`,
  ];
}

export function humanizeSquareTerminalError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const upper = msg.toUpperCase();
  if (
    /DEVICE_NOT_FOUND|DEVICE_UNPAIRED/.test(upper) ||
    (/DEVICE/.test(upper) && /NOT[_ ]FOUND|UNPAIRED|UNKNOWN/.test(upper))
  ) {
    return "Square Terminal is not paired. Power it on and pair it from Settings → Terminal.";
  }
  if (/DEVICE_BUSY/.test(upper)) {
    return "Square Terminal is busy. Cancel the current prompt on the device, then retry.";
  }
  if (
    /DEVICE_UNAVAILABLE|DEVICE_OFFLINE/.test(upper) ||
    (/TERMINAL/.test(upper) && /OFFLINE|UNAVAILABLE/.test(upper))
  ) {
    return "Square Terminal is offline. Turn it on, wait for the home screen, then retry.";
  }
  return msg || "Could not send to Square Terminal";
}
