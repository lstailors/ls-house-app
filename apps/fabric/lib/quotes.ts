import "server-only";
import { type Auth, erpFetch, erpGet, erpList } from "./erp";
import type { EstimateInput } from "./estimate";
import type { Account } from "./session";

export const OPTION_LABELS: Record<keyof EstimateInput["options"], string> = {
  narrow_cloth: "Narrow cloth",
  large_check: "Large check",
  stripe_plaid: "Stripe/plaid",
  tall: "Tall",
};

const OPTIONS_RE = /\n*Options: ([^\n]*)\s*$/;

/** Toggles have no Fabric Quote field, so they ride on a readable last line of notes. */
export function notesWithOptions(notes: string, options: EstimateInput["options"]): string {
  const on = (Object.keys(OPTION_LABELS) as (keyof typeof OPTION_LABELS)[]).filter((k) => options[k]);
  const base = notes.trim();
  if (!on.length) return base;
  return `${base}${base ? "\n\n" : ""}Options: ${on.map((k) => OPTION_LABELS[k]).join(", ")}`;
}

export function splitNotes(notes: string | null): { notes: string; options: EstimateInput["options"] } {
  const raw = notes ?? "";
  const m = OPTIONS_RE.exec(raw);
  const labels = m ? m[1].split(",").map((s) => s.trim()) : [];
  const options = Object.fromEntries(
    (Object.keys(OPTION_LABELS) as (keyof typeof OPTION_LABELS)[]).map((k) => [k, labels.includes(OPTION_LABELS[k])]),
  ) as EstimateInput["options"];
  return { notes: m ? raw.slice(0, m.index).trim() : raw.trim(), options };
}

export interface QuoteDoc {
  name: string;
  owner: string;
  customer: string;
  end_customer: string | null;
  quote_date: string | null;
  fabric_item: string | null;
  fabric_vendor: string | null;
  garment_type: string | null;
  make_level: string | null;
  yardage: number | null;
  cmt_cost: number | null;
  fabric_cost: number | null;
  shipping_cost: number | null;
  alterations_fee: number | null;
  total_cost: number | null;
  retail_multiplier: number | null;
  list_price: number | null;
  discount_pct: number | null;
  retail_price: number | null;
  notes: string | null;
  swatch_image?: string | null;
  creation: string;
}

export const sessionAuth = (a: Account): Auth => ({ kind: "session", sid: a.sid });

/** Own-only, enforced here as well as by ERPNext permissions. */
export function canSee(a: Account, q: Pick<QuoteDoc, "customer" | "owner">): boolean {
  return a.isInternal ? true : !!a.customer && q.customer === a.customer;
}

export async function listQuotes(a: Account) {
  const filters: unknown[] = a.isInternal ? [["owner", "=", a.user]] : [["customer", "=", a.customer]];
  return erpList<QuoteDoc>("Fabric Quote", sessionAuth(a), {
    filters,
    fields: [
      "name",
      "customer",
      "end_customer",
      "quote_date",
      "fabric_item",
      "fabric_vendor",
      "garment_type",
      "make_level",
      "total_cost",
      "retail_price",
      "creation",
    ],
    order_by: "creation desc",
    limit: 200,
  });
}

export async function getQuote(a: Account, id: string): Promise<QuoteDoc | null> {
  const q = await erpGet<QuoteDoc>("Fabric Quote", id, sessionAuth(a));
  return q && canSee(a, q) ? q : null;
}

export async function quotePhoto(a: Account, q: QuoteDoc): Promise<string | null> {
  if (q.swatch_image) return q.swatch_image;
  const files = await erpList<{ file_url: string }>("File", sessionAuth(a), {
    filters: [
      ["attached_to_doctype", "=", "Fabric Quote"],
      ["attached_to_name", "=", q.name],
    ],
    fields: ["file_url"],
    order_by: "creation desc",
    limit: 1,
  }).catch(() => []);
  return files[0]?.file_url ?? null;
}

export function isErpFilePath(fileUrl: string): boolean {
  return /^\/(private\/)?files\/[^?#]+$/.test(fileUrl) && !fileUrl.includes("..");
}
