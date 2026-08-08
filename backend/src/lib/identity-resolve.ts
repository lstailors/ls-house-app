/**
 * Single identity resolver for Comms / Intelligence / Sofia.
 * ERPNext Customer is canonical. All pipelines must call this — no private fuzzy matchers.
 *
 * Phase 0 (Sofia+Comms unification) — 2026-08-08
 */
import {
  normalizePhoneDigits,
  normalizeEmail,
  resolveExistingCustomer,
} from "./erpnext/customers";

export type IdentityHit = {
  /** ERPNext Customer.name (e.g. CUST-2024-…) */
  erpnext_customer_id: string;
  customer_name: string;
  match: "email" | "phone" | "name";
  confidence: number;
  phone_digits?: string | null;
  row?: any;
};

export { normalizePhoneDigits, normalizeEmail };

/**
 * Resolve phone/email/name → ERP Customer id.
 * Prefer phone (comms identity). Never invent a customer.
 */
export async function resolveIdentity(opts: {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
}): Promise<IdentityHit | null> {
  const hit = await resolveExistingCustomer({
    phone: opts.phone,
    email: opts.email,
    name: opts.name,
  });
  if (!hit?.name) return null;

  const conf = hit.match === "phone" ? 0.99 : hit.match === "email" ? 0.95 : 0.8;
  return {
    erpnext_customer_id: hit.name,
    customer_name: String(hit.row?.customer_name || hit.name),
    match: hit.match,
    confidence: conf,
    phone_digits: normalizePhoneDigits(opts.phone),
    row: hit.row,
  };
}

/** Phone-only shortcut used by call/SMS writers. */
export async function resolveCustomerByPhone(
  phone: string | null | undefined,
  nameHint?: string | null,
): Promise<{ id: string; name: string } | null> {
  const hit = await resolveIdentity({ phone, name: nameHint });
  if (!hit) return null;
  return { id: hit.erpnext_customer_id, name: hit.customer_name };
}
