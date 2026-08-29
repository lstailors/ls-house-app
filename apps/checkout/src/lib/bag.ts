import type { CheckoutCard } from "./api";

const KEY = "ls-checkout-bag-v1";

export type BagItem = {
  kind: "ticket" | "invoice";
  id: string;
  customer?: string;
  customerId?: string;
  outstanding: number;
  total: number;
  invoiceId?: string | null;
  ticketId?: string | null;
};

function read(): BagItem[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(items: BagItem[]) {
  sessionStorage.setItem(KEY, JSON.stringify(items));
}

export function bagList(): BagItem[] {
  return read();
}

export function bagClear() {
  write([]);
}

export function bagAdd(card: CheckoutCard) {
  if (!card.id || card.kind === "search") return;
  const items = read();
  const id = card.kind === "ticket" ? card.id : card.id;
  if (items.some((x) => x.id === id)) return;
  items.push({
    kind: card.kind,
    id,
    customer: card.customer,
    customerId: card.customerId,
    outstanding: Number(card.outstanding) || 0,
    total: Number(card.total) || 0,
    invoiceId: card.invoiceId || (card.kind === "invoice" ? card.id : null),
    ticketId: card.kind === "ticket" ? card.id : card.ticketId || null,
  });
  write(items);
}

export function bagRemove(id: string) {
  write(read().filter((x) => x.id !== id));
}

export function bagTotalDue(): number {
  return read().reduce((s, x) => s + (Number(x.outstanding) || 0), 0);
}

export function bagFromCard(card: CheckoutCard): BagItem[] {
  bagClear();
  bagAdd(card);
  return bagList();
}
