// Session → Account resolution. Every route calls requireAccount(); the
// customer is always re-derived from the ERPNext session, never from the client.
import "server-only";
import { cookies } from "next/headers";
import { erpWhoAmI, serviceGet, serviceList } from "./erp";
import type { AccountTerms, MakeLevel } from "./pricing";
import { MAKE_LEVELS } from "./pricing";

export const SID_COOKIE = "lsfe_sid";
const INTERNAL_ROLES = ["System Manager"];
const DEFAULT_PRICE_LIST = "Wholesale - Private Label";

export interface Account {
  user: string;
  sid: string;
  isInternal: boolean;
  customer: string | null;
  customerName: string;
  priceList: string;
  terms: AccountTerms;
  defaultMake: MakeLevel;
  defaultDiscount: number;
}

interface CustomerDoc {
  name: string;
  customer_name: string;
  custom_fabric_multiplier?: number | null;
  custom_shipping_pct_of_cmt?: number | null;
  custom_default_make_level?: string | null;
  custom_retail_multiplier?: number | null;
  custom_default_client_discount?: number | null;
  default_price_list?: string | null;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

const cache = new Map<string, { at: number; account: Account }>();
const TTL_MS = 60_000;

export function sessionSid(): string | null {
  return cookies().get(SID_COOKIE)?.value ?? null;
}

export function forgetSid(sid: string) {
  cache.delete(sid);
}

async function customerForUser(email: string): Promise<string | null> {
  const portal = await serviceList<{ parent: string }>("Portal User", {
    filters: [
      ["user", "=", email],
      ["parenttype", "=", "Customer"],
    ],
    fields: ["parent"],
    parent: "Customer",
    limit: 1,
  }).catch(() => []);
  if (portal[0]?.parent) return portal[0].parent;

  const contacts = await serviceList<{ name: string }>("Contact", {
    filters: [["user", "=", email]],
    fields: ["name"],
    limit: 5,
  }).catch(() => []);
  for (const c of contacts) {
    const doc = await serviceGet<{ links?: { link_doctype: string; link_name: string }[] }>("Contact", c.name);
    const link = doc?.links?.find((l) => l.link_doctype === "Customer");
    if (link) return link.link_name;
  }
  return null;
}

async function isInternalUser(email: string): Promise<boolean> {
  if (email === "Administrator") return true;
  const user = await serviceGet<{ roles?: { role: string }[]; user_type?: string }>("User", email);
  if (!user || user.user_type === "Website User") return false;
  return !!user.roles?.some((r) => INTERNAL_ROLES.includes(r.role));
}

function num(v: number | null | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function termsFromCustomer(c: CustomerDoc | null, internal: boolean) {
  const make = MAKE_LEVELS.includes(c?.custom_default_make_level as MakeLevel)
    ? (c!.custom_default_make_level as MakeLevel)
    : "Fatto a Mano";
  const retail = num(c?.custom_retail_multiplier, 0);
  return {
    customerName: c?.customer_name ?? "L&S (internal)",
    priceList: c?.default_price_list || (internal ? DEFAULT_PRICE_LIST : ""),
    terms: {
      fabricMultiplier: num(c?.custom_fabric_multiplier, 1),
      shippingPctOfCmt: num(c?.custom_shipping_pct_of_cmt, 0),
      // Internal view shows true cost; a 0 retail multiplier would render $0, so use 1×.
      retailMultiplier: retail > 0 ? retail : internal ? 1 : 0,
    },
    defaultMake: make,
    defaultDiscount: num(c?.custom_default_client_discount, 0),
  };
}

export async function loadCustomer(name: string): Promise<CustomerDoc | null> {
  return serviceGet<CustomerDoc>("Customer", name);
}

export async function resolveAccount(sid: string): Promise<Account | null> {
  const hit = cache.get(sid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.account;

  const user = await erpWhoAmI(sid);
  if (!user) {
    cache.delete(sid);
    return null;
  }
  const isInternal = await isInternalUser(user);
  const customer = (await customerForUser(user)) ?? (isInternal ? process.env.INTERNAL_CUSTOMER || null : null);
  if (!customer && !isInternal) throw new AuthError("This login is not linked to a trade account. Contact L&S.", 403);

  const doc = customer ? await loadCustomer(customer) : null;
  const account: Account = {
    user,
    sid,
    isInternal,
    customer: doc?.name ?? null,
    ...termsFromCustomer(doc, isInternal),
  };
  cache.set(sid, { at: Date.now(), account });
  return account;
}

export async function requireAccount(): Promise<Account> {
  const sid = sessionSid();
  if (!sid) throw new AuthError("Not signed in");
  const account = await resolveAccount(sid);
  if (!account) throw new AuthError("Session expired — please sign in again");
  return account;
}
