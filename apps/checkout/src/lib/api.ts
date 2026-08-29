const BASE = (import.meta.env.VITE_BACKEND_URL as string | undefined) || "";

export type CheckoutHit = {
  kind: "ticket" | "invoice" | "sales_order" | "custom_order" | "customer" | string;
  id: string;
  customer?: string;
  customerId?: string;
  status?: string;
  outstanding?: number;
  total?: number;
  invoiceId?: string | null;
  phone?: string | null;
  label?: string;
  subtitle?: string;
};

export type CheckoutCard = {
  kind: "ticket" | "invoice" | "search";
  id?: string;
  customer?: string;
  customerId?: string;
  phone?: string | null;
  email?: string | null;
  workflowState?: string;
  paymentStatus?: string;
  billingStatus?: string | null;
  total?: number;
  outstanding?: number;
  invoiceId?: string | null;
  invoiceStatus?: string | null;
  ticketId?: string | null;
  payLink?: string | null;
  garments?: Array<{ id: string; type?: string; color?: string; total?: number }>;
  lines?: Array<{ description?: string; price?: number; qty?: number; amount?: number }>;
  deliveryMethod?: string | null;
  query?: string;
  count?: number;
  hits?: CheckoutHit[];
};

async function req<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.json !== undefined) headers.set("Content-Type", "application/json");
  headers.set("X-Checkout-Device", localStorage.getItem("checkout-device") || "iphone");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || res.statusText || "Request failed";
    const err = new Error(msg) as Error & { status?: number; gated?: boolean; body?: unknown };
    err.status = res.status;
    err.gated = !!body?.error?.gated;
    err.body = body;
    throw err;
  }
  return (body?.data ?? body) as T;
}

export const api = {
  health: () => req<{ ok: boolean }>("/api/checkout/health"),
  pin: (pin: string) => req<{ ok: boolean; staff: string; hours: number }>("/api/checkout/pin", {
    method: "POST",
    json: { pin },
  }),
  logout: () => req("/api/checkout/logout", { method: "POST", json: {} }),
  me: () => req<{ staff: string; exp: number }>("/api/checkout/me"),
  dashboard: () =>
    req<{
      staff: string;
      unpaidCount: number;
      readyOutCount: number;
      unpaid: any[];
      ready: any[];
      feed: any[];
    }>("/api/checkout/dashboard"),
  resolve: (q: string) =>
    req<CheckoutCard>(`/api/checkout/resolve?q=${encodeURIComponent(q)}`),
  ticket: (name: string) => req<CheckoutCard>(`/api/checkout/ticket/${encodeURIComponent(name)}`),
  invoice: (name: string) =>
    req<CheckoutCard>(`/api/checkout/invoice/${encodeURIComponent(name)}`),
  openForCustomer: (opts: { customer?: string; q?: string }) => {
    const p = new URLSearchParams();
    if (opts.customer) p.set("customer", opts.customer);
    if (opts.q) p.set("q", opts.q);
    return req<{ rows: any[] }>(`/api/checkout/open-for-customer?${p}`);
  },
  payTerminal: (body: { invoice?: string; ticket?: string; allowCharge?: boolean }) =>
    req("/api/checkout/pay/terminal", { method: "POST", json: body }),
  payOutside: (body: {
    ticket?: string;
    invoice?: string;
    method: "cash" | "check" | "square_handheld" | "other";
    amount?: number;
    check_number?: string;
    reference?: string;
  }) => req("/api/checkout/pay/outside", { method: "POST", json: body }),
  payLink: (body: { invoice?: string; ticket?: string }) =>
    req<{
      url?: string | null;
      payment_link?: string | null;
      link?: string | null;
      [k: string]: unknown;
    }>("/api/checkout/pay/link", { method: "POST", json: body }),
  /** ERP outstanding / paid poll for Pay-link QR loop (WF-10 truth). */
  payStatus: (opts: { ticket?: string; invoice?: string }) => {
    const p = new URLSearchParams();
    if (opts.ticket) p.set("ticket", opts.ticket);
    if (opts.invoice) p.set("invoice", opts.invoice);
    return req<{
      paid: boolean;
      outstanding: number;
      paymentStatus?: string | null;
      invoiceStatus?: string | null;
      ticketId?: string | null;
      invoiceId?: string | null;
      customer?: string | null;
      payLink?: string | null;
    }>(`/api/checkout/pay/status?${p}`);
  },
  proof: async (file: File, meta: { ticket?: string; invoice?: string }) => {
    const fd = new FormData();
    fd.append("file", file);
    if (meta.ticket) fd.append("ticket", meta.ticket);
    if (meta.invoice) fd.append("invoice", meta.invoice);
    const res = await fetch(`${BASE}/api/checkout/proof`, {
      method: "POST",
      credentials: "include",
      body: fd,
      headers: { "X-Checkout-Device": localStorage.getItem("checkout-device") || "iphone" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || "Proof upload failed");
    return body.data ?? body;
  },
  out: (body: {
    ticket?: string;
    invoice?: string;
    tickets?: string[];
    method: "Pickup" | "Hand" | "FedEx";
  }) => req("/api/checkout/out", { method: "POST", json: body }),
  receiptDraft: (body: { ticket?: string; invoice?: string; channel?: "sms" | "email" }) =>
    req<{
      channel: string;
      customer: string;
      phone: string | null;
      email: string | null;
      amount: number;
      ref: string;
      smsDraft: string;
      emailDraft: { to: string | null; subject: string; text: string };
      sendAllowed: boolean;
      note: string;
    }>("/api/checkout/receipt/draft", { method: "POST", json: body }),
};
