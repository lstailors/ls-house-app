/**
 * Checkout + pickup iPhone PWA API (apps/checkout).
 * PIN-gated money desk — not shop floor. Reuses ERP SI outstanding +
 * ls_square.create_checkout + lsh_house.checkout outside tender + ticket Out.
 */
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getAuthedUser } from "../lib/scope";
import { erpGet, erpList, erpRunMethod, erpUpdate } from "../lib/erp";
import { uploadFile } from "../lib/erpnext/files";

function b64url(bytes: Uint8Array | string): string {
  const u8 =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(out);
}

export const checkoutRouter = new Hono();

const COOKIE = "ls_checkout_session";
const SESSION_HOURS = 12;
const FAIL_LIMIT = 5;
const FAIL_LOCK_MS = 60_000;
const failMap = new Map<string, { n: number; until: number }>();

type SessionPayload = {
  v: 1;
  staff: string;
  pinTail: string;
  exp: number;
};

function sessionSecret(): string {
  return (
    process.env.CHECKOUT_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    "checkout-dev-secret-change-me"
  );
}

function staffPins(): Array<{ pin: string; name: string }> {
  const raw = (process.env.CHECKOUT_STAFF_PINS || process.env.CHECKOUT_STAFF_PIN || "").trim();
  if (!raw) {
    // Dev/fallback only — override in Vercel. Not floor operator PINs.
    return [{ pin: "4821", name: "Counter" }];
  }
  // Formats: "4821" | "4821:Carl,2580:Sofia" | JSON [{"pin":"4821","name":"Carl"}]
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw) as Array<{ pin: string; name?: string }>;
      return arr
        .filter((x) => x?.pin)
        .map((x) => ({ pin: String(x.pin).replace(/\D/g, "").slice(0, 4), name: x.name || "Staff" }));
    } catch {
      /* fall through */
    }
  }
  return raw.split(",").map((part) => {
    const [pinRaw, name] = part.split(":").map((s) => s.trim());
    const pin = (pinRaw || "").replace(/\D/g, "").slice(0, 4);
    return { pin, name: name || "Staff" };
  }).filter((x) => x.pin.length > 0);
}

async function hmacSign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function mintSession(staff: string, pin: string): Promise<string> {
  const payload: SessionPayload = {
    v: 1,
    staff,
    pinTail: pin.slice(-2),
    exp: Date.now() + SESSION_HOURS * 3600_000,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = await hmacSign(body);
  return `${body}.${sig}`;
}

async function readSession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = await hmacSign(body);
  if (expect.length !== sig.length) return null;
  let ok = 0;
  for (let i = 0; i < expect.length; i++) ok |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  if (ok !== 0) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body)) as SessionPayload;
    if (payload.v !== 1 || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireCheckout(c: any): Promise<SessionPayload | { error: Response }> {
  const cookie = getCookie(c, COOKIE);
  const sess = await readSession(cookie);
  if (sess) return sess;
  const user = await getAuthedUser(c);
  if (user) {
    return {
      v: 1,
      staff: user.email || user.id || "staff",
      pinTail: "xx",
      exp: Date.now() + SESSION_HOURS * 3600_000,
    };
  }
  return { error: c.json({ error: { message: "PIN session required" } }, 401) };
}

function deviceKey(c: any): string {
  return (
    c.req.header("x-checkout-device") ||
    c.req.header("x-forwarded-for") ||
    c.req.header("cf-connecting-ip") ||
    "unknown"
  );
}

// ─── Auth ────────────────────────────────────────────────────────────────────

checkoutRouter.get("/health", (c) => c.json({ ok: true, app: "checkout" }));

checkoutRouter.post("/pin", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { pin?: string } | null;
  const pin = String(body?.pin || "").replace(/\D/g, "").slice(0, 4);
  const dk = deviceKey(c);
  const lock = failMap.get(dk);
  if (lock && lock.until > Date.now()) {
    return c.json(
      { error: { message: "Too many attempts — wait a minute", lockMs: lock.until - Date.now() } },
      429,
    );
  }
  if (pin.length !== 4) return c.json({ error: { message: "4-digit PIN required" } }, 400);

  const match = staffPins().find((p) => p.pin === pin);
  if (!match) {
    const cur = failMap.get(dk) || { n: 0, until: 0 };
    cur.n += 1;
    if (cur.n >= FAIL_LIMIT) {
      cur.until = Date.now() + FAIL_LOCK_MS;
      cur.n = 0;
    }
    failMap.set(dk, cur);
    return c.json({ error: { message: "Wrong PIN" } }, 401);
  }
  failMap.delete(dk);
  const token = await mintSession(match.name, pin);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return c.json({ data: { ok: true, staff: match.name, hours: SESSION_HOURS } });
});

checkoutRouter.post("/logout", async (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ data: { ok: true } });
});

checkoutRouter.get("/me", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  return c.json({ data: { staff: gate.staff, exp: gate.exp } });
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

checkoutRouter.get("/dashboard", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;

  const [unpaidSi, readyTickets] = await Promise.all([
    erpList("Sales Invoice", {
      fields: ["name", "customer", "customer_name", "outstanding_amount", "grand_total", "status", "modified"],
      filters: [
        ["docstatus", "=", 1],
        ["outstanding_amount", ">", 0],
      ],
      limit: 40,
      order_by: "modified desc",
    }).catch(() => []),
    erpList("Alteration Ticket", {
      fields: [
        "name",
        "customer",
        "customer_name",
        "workflow_state",
        "payment_status",
        "billing_status",
        "ticket_total",
        "sales_invoice",
        "modified",
      ],
      filters: [["workflow_state", "=", "Ready"]],
      limit: 40,
      order_by: "modified desc",
    }).catch(() => []),
  ]);

  const unpaid = (unpaidSi as any[]).map((r) => ({
    kind: "invoice" as const,
    id: r.name,
    customer: r.customer_name || r.customer,
    customerId: r.customer,
    outstanding: Number(r.outstanding_amount) || 0,
    total: Number(r.grand_total) || 0,
    status: r.status,
    label: "Unpaid",
  }));

  const ready = (readyTickets as any[]).map((t) => {
    const pay = String(t.payment_status || "");
    const unpaidT = pay !== "Paid" && pay !== "N/A";
    return {
      kind: "ticket" as const,
      id: t.name,
      customer: t.customer_name || t.customer,
      customerId: t.customer,
      outstanding: unpaidT ? Number(t.ticket_total) || 0 : 0,
      total: Number(t.ticket_total) || 0,
      status: t.workflow_state,
      paymentStatus: pay,
      invoiceId: t.sales_invoice || null,
      label: unpaidT ? "Due" : "Ready",
    };
  });

  const unpaidCount = unpaid.length;
  const readyOut = ready.filter((r) => r.outstanding <= 0.005).length + ready.filter((r) => r.outstanding > 0.005).length;

  return c.json({
    data: {
      staff: gate.staff,
      unpaidCount,
      readyOutCount: ready.length,
      unpaid,
      ready,
      feed: [
        ...ready.slice(0, 8).map((r) => ({
          ...r,
          mark: r.outstanding > 0.005 ? "due" : "ready",
        })),
        ...unpaid
          .filter((u) => !ready.some((r) => r.invoiceId === u.id))
          .slice(0, 6)
          .map((u) => ({ ...u, mark: "due" as const })),
      ].slice(0, 12),
    },
  });
});

// ─── Resolve scan / lookup ───────────────────────────────────────────────────

function looksLikeInvoice(id: string) {
  return /SINV|INV-/i.test(id) || /^LSTNY-SINV/i.test(id);
}
function looksLikeTicket(id: string) {
  return /^ALT-/i.test(id) || /TICKET/i.test(id);
}
function looksLikeSalesOrder(id: string) {
  return /(?:^|-)SO-|\bSO-/i.test(id) || /^LSTNY-SO/i.test(id);
}
/** Exact full docname (not a partial/fuzzy token). */
function looksExactDocName(id: string) {
  return /^(ALT-|LSTNY-SINV-|LSTNY-SO-|SINV-)/i.test(id) && !/\s/.test(id) && id.length >= 12;
}
function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}
function ticketOutstanding(t: { payment_status?: string; ticket_total?: number }) {
  const pay = String(t.payment_status || "");
  if (pay === "Paid" || pay === "N/A") return 0;
  return Number(t.ticket_total) || 0;
}

type ResolveHit = {
  kind: "ticket" | "invoice" | "sales_order" | "custom_order" | "customer";
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

function pushHit(hits: ResolveHit[], seen: Set<string>, hit: ResolveHit) {
  const key = `${hit.kind}:${hit.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  hits.push(hit);
}

async function fuzzyCheckoutResolve(code: string): Promise<ResolveHit[]> {
  const like = `%${code}%`;
  const digits = digitsOnly(code);
  const phoneTail = digits.length >= 7 ? digits.slice(-10) : digits.length >= 4 ? digits : "";
  const hits: ResolveHit[] = [];
  const seen = new Set<string>();
  const customerIds = new Set<string>();

  const ticketFields = [
    "name",
    "customer",
    "customer_name",
    "workflow_state",
    "payment_status",
    "ticket_total",
    "sales_invoice",
    "modified",
  ] as const;

  const mapTicket = (t: any) => {
    pushHit(hits, seen, {
      kind: "ticket",
      id: t.name,
      customer: t.customer_name || t.customer,
      customerId: t.customer,
      status: t.workflow_state,
      outstanding: ticketOutstanding(t),
      total: Number(t.ticket_total) || 0,
      invoiceId: t.sales_invoice || null,
      label: "Ticket",
      subtitle: [t.workflow_state, t.payment_status].filter(Boolean).join(" · "),
    });
    if (t.customer) customerIds.add(String(t.customer));
  };

  const mapInvoice = (inv: any) => {
    pushHit(hits, seen, {
      kind: "invoice",
      id: inv.name,
      customer: inv.customer_name || inv.customer,
      customerId: inv.customer,
      status: inv.status,
      outstanding: Number(inv.outstanding_amount) || 0,
      total: Number(inv.grand_total) || 0,
      invoiceId: inv.name,
      label: "Invoice",
      subtitle: inv.status || undefined,
    });
    if (inv.customer) customerIds.add(String(inv.customer));
  };

  const mapSo = (so: any) => {
    pushHit(hits, seen, {
      kind: "sales_order",
      id: so.name,
      customer: so.customer_name || so.customer,
      customerId: so.customer,
      status: so.status,
      total: Number(so.grand_total) || 0,
      outstanding: Math.max(0, (Number(so.grand_total) || 0) - (Number(so.advance_paid) || 0)),
      label: "Order",
      subtitle: so.status || undefined,
    });
    if (so.customer) customerIds.add(String(so.customer));
  };

  // Parallel primary searches
  const [byTicketName, byTicketCustomer, byInvName, byInvCustomer, bySoName, bySoCustomer, byCustName, byCustPhone] =
    await Promise.all([
      erpList("Alteration Ticket", {
        fields: [...ticketFields],
        filters: [
          ["name", "like", like],
          ["workflow_state", "!=", "Cancelled"],
        ],
        limit: 20,
        order_by: "modified desc",
      }).catch(() => []),
      erpList("Alteration Ticket", {
        fields: [...ticketFields],
        filters: [
          ["customer_name", "like", like],
          ["workflow_state", "!=", "Cancelled"],
        ],
        limit: 40,
        order_by: "modified desc",
      }).catch(() => []),
      erpList("Sales Invoice", {
        fields: ["name", "customer", "customer_name", "outstanding_amount", "grand_total", "status", "docstatus"],
        filters: [
          ["name", "like", like],
          ["docstatus", "=", 1],
        ],
        limit: 15,
        order_by: "modified desc",
      }).catch(() => []),
      erpList("Sales Invoice", {
        fields: ["name", "customer", "customer_name", "outstanding_amount", "grand_total", "status", "docstatus"],
        filters: [
          ["customer_name", "like", like],
          ["docstatus", "=", 1],
          ["outstanding_amount", ">", 0],
        ],
        limit: 25,
        order_by: "modified desc",
      }).catch(() => []),
      erpList("Sales Order", {
        fields: ["name", "customer", "customer_name", "status", "grand_total", "advance_paid", "docstatus"],
        filters: [
          ["name", "like", like],
          ["docstatus", "=", 1],
        ],
        limit: 15,
        order_by: "modified desc",
      }).catch(() => []),
      erpList("Sales Order", {
        fields: ["name", "customer", "customer_name", "status", "grand_total", "advance_paid", "docstatus"],
        filters: [
          ["customer_name", "like", like],
          ["docstatus", "=", 1],
          ["status", "not in", ["Completed", "Closed", "Cancelled"]],
        ],
        limit: 20,
        order_by: "modified desc",
      }).catch(() => []),
      erpList("Customer", {
        fields: ["name", "customer_name", "mobile_no"],
        filters: [["customer_name", "like", like]],
        limit: 25,
        order_by: "modified desc",
      }).catch(() => []),
      phoneTail
        ? erpList("Customer", {
            fields: ["name", "customer_name", "mobile_no"],
            filters: [["mobile_no", "like", `%${phoneTail}%`]],
            limit: 15,
            order_by: "modified desc",
          }).catch(() => [])
        : Promise.resolve([]),
    ]);

  for (const t of byTicketName as any[]) mapTicket(t);
  for (const t of byTicketCustomer as any[]) mapTicket(t);
  for (const inv of byInvName as any[]) mapInvoice(inv);
  for (const inv of byInvCustomer as any[]) mapInvoice(inv);
  for (const so of bySoName as any[]) mapSo(so);
  for (const so of bySoCustomer as any[]) mapSo(so);

  const customers = [...(byCustName as any[]), ...(byCustPhone as any[])];
  const custSeen = new Set<string>();
  for (const cu of customers) {
    if (!cu?.name || custSeen.has(cu.name)) continue;
    custSeen.add(cu.name);
    customerIds.add(String(cu.name));
    // Surface customer row only when we have no docs yet for them (filled after expansion)
    pushHit(hits, seen, {
      kind: "customer",
      id: cu.name,
      customer: cu.customer_name || cu.name,
      customerId: cu.name,
      phone: cu.mobile_no || null,
      label: "Customer",
      subtitle: cu.mobile_no || undefined,
    });
  }

  // Expand matched customers → their non-cancelled tickets + unpaid SI + open SO
  const custList = [...customerIds].slice(0, 20);
  if (custList.length) {
    const [moreTickets, moreInv, moreSo] = await Promise.all([
      Promise.all(
        custList.slice(0, 12).map((cid) =>
          erpList("Alteration Ticket", {
            fields: [...ticketFields],
            filters: [
              ["customer", "=", cid],
              ["workflow_state", "!=", "Cancelled"],
            ],
            limit: 12,
            order_by: "modified desc",
          }).catch(() => []),
        ),
      ),
      Promise.all(
        custList.slice(0, 12).map((cid) =>
          erpList("Sales Invoice", {
            fields: ["name", "customer", "customer_name", "outstanding_amount", "grand_total", "status", "docstatus"],
            filters: [
              ["customer", "=", cid],
              ["docstatus", "=", 1],
              ["outstanding_amount", ">", 0],
            ],
            limit: 8,
            order_by: "modified desc",
          }).catch(() => []),
        ),
      ),
      Promise.all(
        custList.slice(0, 12).map((cid) =>
          erpList("Sales Order", {
            fields: ["name", "customer", "customer_name", "status", "grand_total", "advance_paid", "docstatus"],
            filters: [
              ["customer", "=", cid],
              ["docstatus", "=", 1],
              ["status", "not in", ["Completed", "Closed", "Cancelled"]],
            ],
            limit: 6,
            order_by: "modified desc",
          }).catch(() => []),
        ),
      ),
    ]);
    for (const batch of moreTickets) for (const t of batch as any[]) mapTicket(t);
    for (const batch of moreInv) for (const inv of batch as any[]) mapInvoice(inv);
    for (const batch of moreSo) for (const so of batch as any[]) mapSo(so);
  }

  // LSH Custom Order — optional; DocPerm / empty book should not break resolve
  try {
    const cos = (await erpList("LSH Custom Order", {
      fields: ["name", "customer", "customer_name", "erp_sales_order", "status"],
      filters: [["customer_name", "like", like]],
      limit: 10,
      order_by: "modified desc",
      throwOnError: true,
    })) as any[];
    for (const co of cos) {
      pushHit(hits, seen, {
        kind: "custom_order",
        id: co.name,
        customer: co.customer_name || co.customer,
        customerId: co.customer,
        status: co.status,
        label: "Custom order",
        subtitle: co.erp_sales_order || co.status || undefined,
        invoiceId: co.erp_sales_order || null,
      });
    }
  } catch (e) {
    // Permission or missing doctype — skip silently; note only if zero other hits
    if (hits.length === 0) {
      /* leave empty; UI shows no hits */
    }
  }

  // Drop bare customer rows when they already have tickets/invoices/orders in the list
  const customersWithDocs = new Set(
    hits.filter((h) => h.kind !== "customer" && h.customerId).map((h) => String(h.customerId)),
  );
  const pruned = hits.filter((h) => h.kind !== "customer" || !customersWithDocs.has(String(h.customerId || h.id)));

  // Prefer actionable docs: tickets (Ready/In Progress/unpaid first), then invoices, SO, custom, customers
  const rank = (h: ResolveHit) => {
    if (h.kind === "ticket") {
      const st = String(h.status || "");
      let r = 100;
      if (st === "Ready") r = 10;
      else if (st === "In Progress") r = 20;
      else if (st === "Picked Up") r = 40;
      if ((h.outstanding || 0) > 0.005) r -= 5;
      return r;
    }
    if (h.kind === "invoice") return 50 + ((h.outstanding || 0) > 0 ? 0 : 10);
    if (h.kind === "sales_order") return 70;
    if (h.kind === "custom_order") return 80;
    return 90;
  };
  pruned.sort((a, b) => rank(a) - rank(b) || String(a.customer || "").localeCompare(String(b.customer || "")));
  return pruned.slice(0, 40);
}

async function loadTicketCard(name: string) {
  const t = (await erpGet("Alteration Ticket", name)) as any;
  if (!t?.name) return null;
  let outstanding = 0;
  let invoice: any = null;
  let customerEmail: string | null = t.customer_email || null;
  const invName = t.sales_invoice || null;
  if (invName) {
    try {
      invoice = await erpGet("Sales Invoice", invName);
      outstanding = Number(invoice?.outstanding_amount) || 0;
      customerEmail = invoice?.contact_email || customerEmail;
    } catch {
      outstanding = t.payment_status === "Paid" || t.payment_status === "N/A" ? 0 : Number(t.ticket_total) || 0;
    }
  } else if (t.payment_status !== "Paid" && t.payment_status !== "N/A") {
    outstanding = Number(t.ticket_total) || 0;
  }
  if (!customerEmail && t.customer) {
    try {
      const cust = (await erpGet("Customer", t.customer)) as any;
      customerEmail = cust?.email_id || null;
    } catch {
      /* */
    }
  }
  const garments = Array.isArray(t.garments)
    ? t.garments.map((g: any) => ({
        id: g.garment_id || g.name,
        type: g.garment_type,
        color: g.color,
        total: Number(g.garment_total) || 0,
      }))
    : [];
  const lines = Array.isArray(t.lines)
    ? t.lines.map((l: any) => ({
        description: l.description || l.work_description || l.item_name,
        price: Number(l.price || l.rate || 0) || 0,
      }))
    : [];
  return {
    kind: "ticket" as const,
    id: t.name,
    customer: t.customer_name || t.customer,
    customerId: t.customer,
    phone: t.customer_mobile || t.customer_phone || null,
    email: customerEmail,
    workflowState: t.workflow_state,
    paymentStatus: t.payment_status,
    billingStatus: t.billing_status,
    total: Number(t.ticket_total) || Number(invoice?.grand_total) || 0,
    outstanding,
    invoiceId: invName,
    invoiceStatus: invoice?.status || null,
    payLink: invoice?.lsh_square_payment_link || invoice?.lsh_invoice_web_url || null,
    garments,
    lines,
    deliveryMethod: t.delivery_method || null,
  };
}

async function loadInvoiceCard(name: string) {
  const inv = (await erpGet("Sales Invoice", name)) as any;
  if (!inv?.name) return null;
  let ticketId: string | null = inv.alteration_ticket_ref || null;
  if (!ticketId) {
    const linked = (await erpList("Alteration Ticket", {
      fields: ["name"],
      filters: [["sales_invoice", "=", name]],
      limit: 1,
    }).catch(() => [])) as any[];
    ticketId = linked[0]?.name || null;
  }
  const items = Array.isArray(inv.items)
    ? inv.items.map((it: any) => ({
        description: it.item_name || it.description || it.item_code,
        qty: Number(it.qty) || 1,
        amount: Number(it.amount) || 0,
      }))
    : [];
  return {
    kind: "invoice" as const,
    id: inv.name,
    customer: inv.customer_name || inv.customer,
    customerId: inv.customer,
    phone: inv.contact_mobile || null,
    email: inv.contact_email || inv.customer_email_id || null,
    workflowState: inv.lsh_fulfillment || inv.status,
    paymentStatus: inv.status,
    billingStatus: null,
    total: Number(inv.grand_total) || 0,
    outstanding: Number(inv.outstanding_amount) || 0,
    invoiceId: inv.name,
    invoiceStatus: inv.status,
    ticketId,
    payLink: inv.lsh_square_payment_link || inv.lsh_invoice_web_url || null,
    garments: [],
    lines: items,
    deliveryMethod: null,
    fulfillment: inv.lsh_fulfillment || null,
  };
}

checkoutRouter.get("/resolve", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;

  const q = String(c.req.query("q") || c.req.query("code") || "").trim();
  if (!q) return c.json({ error: { message: "q required" } }, 400);

  // Strip common QR URL prefixes
  let code = q;
  try {
    if (code.includes("http")) {
      const u = new URL(code);
      const parts = u.pathname.split("/").filter(Boolean);
      code = parts[parts.length - 1] || code;
    }
  } catch {
    /* keep raw */
  }
  code = code.replace(/^#/, "").trim();

  try {
    // Exact card only for full docnames (scan / paste full ALT-… / SINV-…)
    if (looksExactDocName(code) || (looksLikeTicket(code) && code.length >= 16) || (looksLikeInvoice(code) && code.length >= 14)) {
      if (looksLikeTicket(code) || /^ALT-/i.test(code)) {
        try {
          const card = await loadTicketCard(code);
          if (card) return c.json({ data: card });
        } catch {
          /* fall through to fuzzy */
        }
      }
      if (looksLikeInvoice(code)) {
        try {
          const card = await loadInvoiceCard(code);
          if (card) return c.json({ data: card });
        } catch {
          /* fall through */
        }
      }
      if (looksLikeSalesOrder(code)) {
        // No SO card page — fuzzy will list the order hit
      }
    }

    // Fuzzy: always a hit list for q length >= 2 (never 404 a known last name)
    if (code.length < 2) {
      return c.json({ error: { message: "Type at least 2 characters" } }, 400);
    }

    const hits = await fuzzyCheckoutResolve(code);
    return c.json({
      data: {
        kind: "search",
        query: code,
        hits,
        count: hits.length,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Resolve failed";
    return c.json({ error: { message } }, 502);
  }
});

checkoutRouter.get("/ticket/:name", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  try {
    const card = await loadTicketCard(c.req.param("name"));
    if (!card) return c.json({ error: { message: "Not found" } }, 404);
    return c.json({ data: card });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "load failed" } }, 502);
  }
});

checkoutRouter.get("/invoice/:name", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  try {
    const card = await loadInvoiceCard(c.req.param("name"));
    if (!card) return c.json({ error: { message: "Not found" } }, 404);
    return c.json({ data: card });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "load failed" } }, 502);
  }
});

/** Same customer open tickets + optional other-customer search for bag add */
checkoutRouter.get("/open-for-customer", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  const customer = String(c.req.query("customer") || "").trim();
  const q = String(c.req.query("q") || "").trim();
  if (!customer && !q) return c.json({ error: { message: "customer or q required" } }, 400);

  const filters: any[] = [["workflow_state", "not in", ["Cancelled", "Picked Up"]]];
  if (customer) filters.push(["customer", "=", customer]);
  if (q && !customer) {
    filters.push(["customer_name", "like", `%${q}%`]);
  }

  const tickets = (await erpList("Alteration Ticket", {
    fields: [
      "name",
      "customer",
      "customer_name",
      "workflow_state",
      "payment_status",
      "ticket_total",
      "sales_invoice",
    ],
    filters,
    limit: 30,
    order_by: "modified desc",
  }).catch(() => [])) as any[];

  const rows = [];
  for (const t of tickets) {
    let outstanding = t.payment_status === "Paid" || t.payment_status === "N/A" ? 0 : Number(t.ticket_total) || 0;
    if (t.sales_invoice) {
      try {
        const inv = (await erpGet("Sales Invoice", t.sales_invoice)) as any;
        outstanding = Number(inv?.outstanding_amount) || 0;
      } catch {
        /* keep */
      }
    }
    rows.push({
      kind: "ticket",
      id: t.name,
      customer: t.customer_name || t.customer,
      customerId: t.customer,
      status: t.workflow_state,
      outstanding,
      total: Number(t.ticket_total) || 0,
      invoiceId: t.sales_invoice || null,
    });
  }
  return c.json({ data: { rows } });
});

// ─── Payments (wrap existing ERP; no live $1 without Carl) ───────────────────

checkoutRouter.post("/pay/terminal", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as {
    invoice?: string;
    ticket?: string;
    /** safety: only true after Carl/Sarto yes in topic 488 */
    allowCharge?: boolean;
  } | null;
  if (!body?.invoice && !body?.ticket) {
    return c.json({ error: { message: "invoice or ticket required" } }, 400);
  }
  if (!body.allowCharge && process.env.CHECKOUT_ALLOW_TERMINAL?.trim() !== "1") {
    return c.json(
      {
        error: {
          message:
            "Terminal charge gated — post plan ack in Atelier 1201; set CHECKOUT_ALLOW_TERMINAL=1 or allowCharge after Carl/Sarto yes",
          gated: true,
        },
      },
      403,
    );
  }
  try {
    const result = await erpRunMethod("ls_alterations.ls_square.pos.create_checkout", {
      ...(body.ticket ? { ticket: body.ticket } : { invoice: body.invoice }),
    });
    return c.json({ data: result });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "Terminal failed" } }, 502);
  }
});

checkoutRouter.post("/pay/outside", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as {
    ticket?: string;
    invoice?: string;
    method?: "cash" | "check" | "square_handheld" | "other";
    amount?: number;
    check_number?: string;
    reference?: string;
  } | null;
  if (!body?.method) return c.json({ error: { message: "method required" } }, 400);
  if (!body.ticket && !body.invoice) {
    return c.json({ error: { message: "ticket or invoice required" } }, 400);
  }
  const method = body.method === "other" ? "cash" : body.method;
  try {
    const result = await erpRunMethod("lsh_house.checkout.record_outside_payment", {
      ...(body.ticket ? { ticket: body.ticket } : {}),
      ...(body.invoice ? { invoice: body.invoice } : {}),
      method,
      ...(body.amount != null ? { amount: body.amount } : {}),
      ...(body.check_number ? { check_number: body.check_number } : {}),
      ...(body.reference
        ? { reference: body.reference }
        : body.method === "other"
          ? { reference: "OTHER-checkout" }
          : {}),
    });
    return c.json({ data: result });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "Outside tender failed" } }, 502);
  }
});

checkoutRouter.get("/pay/outside", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  const ticket = c.req.query("ticket");
  const invoice = c.req.query("invoice");
  try {
    const result = await erpRunMethod("lsh_house.checkout.get_checkout_payment", {
      ...(ticket ? { ticket } : {}),
      ...(invoice ? { invoice } : {}),
    });
    return c.json({ data: result });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "load failed" } }, 502);
  }
});

function extractPayLinkUrl(result: unknown): string | null {
  if (!result) return null;
  if (typeof result === "string" && /^https?:\/\//i.test(result)) return result.trim();
  if (typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const nested =
    r.payment_link && typeof r.payment_link === "object"
      ? (r.payment_link as Record<string, unknown>)
      : null;
  const candidates = [
    r.url,
    r.payment_link_url,
    r.payment_url,
    r.long_url,
    r.link,
    r.checkout_url,
    nested?.url,
    nested?.long_url,
    typeof r.payment_link === "string" ? r.payment_link : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c.trim())) return c.trim();
  }
  return null;
}

checkoutRouter.post("/pay/link", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as { invoice?: string; ticket?: string } | null;
  if (!body?.invoice && !body?.ticket) {
    return c.json({ error: { message: "invoice or ticket required" } }, 400);
  }
  try {
    let result: unknown;
    try {
      result = await erpRunMethod("ls_alterations.ls_square.pos.create_payment_link", {
        ...(body.ticket ? { ticket: body.ticket } : { invoice: body.invoice }),
      });
    } catch {
      result = await erpRunMethod("lsh_house.checkout.create_payment_link", {
        ...(body.ticket ? { ticket: body.ticket } : { invoice: body.invoice }),
      });
    }
    let url = extractPayLinkUrl(result);
    // Prefer already-stamped SI link when mint returns opaque payload
    if (!url) {
      try {
        let invName = body.invoice || undefined;
        if (!invName && body.ticket) {
          const t = (await erpGet("Alteration Ticket", body.ticket)) as any;
          invName = t?.sales_invoice || undefined;
        }
        if (invName) {
          const inv = (await erpGet("Sales Invoice", invName)) as any;
          url =
            String(inv?.lsh_square_payment_link || inv?.lsh_invoice_web_url || "").trim() || null;
          if (url && !/^https?:\/\//i.test(url)) url = null;
        }
      } catch {
        /* keep */
      }
    }
    const payload =
      result && typeof result === "object" ? { ...(result as object), url } : { result, url };
    return c.json({ data: payload });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "Pay link failed" } }, 502);
  }
});

/**
 * Thin paid-loop poll for Pay-link QR (and Open). ERP outstanding is truth —
 * Hosted Square → n8n WF-10 → Payment Entry. Never invent a second Square merchant.
 */
checkoutRouter.get("/pay/status", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  const ticket = String(c.req.query("ticket") || "").trim() || undefined;
  const invoice = String(c.req.query("invoice") || "").trim() || undefined;
  if (!ticket && !invoice) {
    return c.json({ error: { message: "ticket or invoice required" } }, 400);
  }
  try {
    if (ticket) {
      const card = await loadTicketCard(ticket);
      if (!card) return c.json({ error: { message: "Ticket not found" } }, 404);
      const outstanding = Number(card.outstanding) || 0;
      const paymentStatus = String(card.paymentStatus || card.invoiceStatus || "");
      const paid =
        outstanding <= 0.005 ||
        /^paid$/i.test(paymentStatus) ||
        paymentStatus === "N/A";
      return c.json({
        data: {
          paid,
          outstanding,
          paymentStatus: card.paymentStatus ?? null,
          invoiceStatus: card.invoiceStatus ?? null,
          ticketId: card.id,
          invoiceId: card.invoiceId ?? null,
          customer: card.customer ?? null,
          payLink: card.payLink ?? null,
        },
      });
    }
    const card = await loadInvoiceCard(invoice!);
    if (!card) return c.json({ error: { message: "Invoice not found" } }, 404);
    const outstanding = Number(card.outstanding) || 0;
    const paymentStatus = String(card.paymentStatus || card.invoiceStatus || "");
    const paid = outstanding <= 0.005 || /^paid$/i.test(paymentStatus);
    return c.json({
      data: {
        paid,
        outstanding,
        paymentStatus: card.paymentStatus ?? null,
        invoiceStatus: card.invoiceStatus ?? null,
        ticketId: card.ticketId ?? null,
        invoiceId: card.id,
        customer: card.customer ?? null,
        payLink: (card as any).payLink ?? null,
      },
    });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "status failed" } }, 502);
  }
});

/** Photo proof attach → Alteration Ticket (and SI if known) */
checkoutRouter.post("/proof", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ error: { message: "Bad form" } }, 400);
  }
  const rawFile = form["file"];
  const file = (Array.isArray(rawFile) ? rawFile[0] : rawFile) as File | undefined;
  if (!file || !(file instanceof File) || file.size === 0) {
    return c.json({ error: { message: "file required" } }, 400);
  }
  const ticket = String(form["ticket"] || "").trim() || undefined;
  const invoice = String(form["invoice"] || "").trim() || undefined;
  if (!ticket && !invoice) return c.json({ error: { message: "ticket or invoice required" } }, 400);

  const buffer = new Uint8Array(await file.arrayBuffer());
  const filename = `checkout-proof-${Date.now()}-${file.name || "photo.jpg"}`;
  const attached: Array<{ doctype: string; name: string; fileUrl: string }> = [];

  if (ticket) {
    const { fileUrl } = await uploadFile({
      file: buffer,
      filename,
      contentType: file.type || "image/jpeg",
      doctype: "Alteration Ticket",
      docname: ticket,
      isPrivate: true,
    });
    attached.push({ doctype: "Alteration Ticket", name: ticket, fileUrl });
  }
  if (invoice) {
    const { fileUrl } = await uploadFile({
      file: buffer,
      filename,
      contentType: file.type || "image/jpeg",
      doctype: "Sales Invoice",
      docname: invoice,
      isPrivate: true,
    });
    attached.push({ doctype: "Sales Invoice", name: invoice, fileUrl });
  }
  return c.json({ data: { ok: true, attached, staff: gate.staff } });
});

// ─── Out (Pickup / Hand / FedEx) ─────────────────────────────────────────────

checkoutRouter.post("/out", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as {
    ticket?: string;
    invoice?: string;
    method?: "Pickup" | "Hand" | "FedEx" | "pickup" | "hand" | "fedex";
    tickets?: string[];
  } | null;

  const methodRaw = String(body?.method || "Pickup");
  // ERP enum: Pickup | Hand Delivery | Courier. FedEx = Courier + ls_carrier=FedEx.
  const outKind: "Pickup" | "Hand" | "FedEx" = /fedex|ship/i.test(methodRaw)
    ? "FedEx"
    : /hand/i.test(methodRaw)
      ? "Hand"
      : "Pickup";
  const deliveryMethod =
    outKind === "FedEx" ? "Courier" : outKind === "Hand" ? "Hand Delivery" : "Pickup";

  const ticketNames = [
    ...(body?.ticket ? [body.ticket] : []),
    ...(Array.isArray(body?.tickets) ? body.tickets : []),
  ].filter(Boolean);

  if (!ticketNames.length && body?.invoice) {
    const linked = (await erpList("Alteration Ticket", {
      fields: ["name"],
      filters: [["sales_invoice", "=", body.invoice]],
      limit: 5,
    }).catch(() => [])) as any[];
    for (const t of linked) ticketNames.push(t.name);
  }
  if (!ticketNames.length && !body?.invoice) {
    return c.json({ error: { message: "ticket or invoice required" } }, 400);
  }

  const results: any[] = [];
  for (const name of ticketNames) {
    const doc = (await erpGet("Alteration Ticket", name)) as any;
    const patch: Record<string, unknown> = {
      delivery_method: deliveryMethod,
      ...(outKind === "FedEx" ? { ls_carrier: "FedEx" } : {}),
      ...(outKind === "Pickup"
        ? { picked_up_at: new Date().toISOString().slice(0, 19).replace("T", " ") }
        : {}),
    };
    // Prefer workflow Mark Picked Up when Ready
    try {
      if (String(doc.workflow_state) === "Ready" || String(doc.workflow_state) === "Ready for Pickup") {
        try {
          await erpRunMethod("frappe.model.workflow.apply_workflow", {
            doc: { doctype: "Alteration Ticket", name },
            action: "Mark Picked Up",
          });
        } catch {
          await erpUpdate("Alteration Ticket", name, { workflow_state: "Picked Up", ...patch });
        }
      }
      await erpUpdate("Alteration Ticket", name, patch);
    } catch (e) {
      results.push({ ticket: name, ok: false, error: e instanceof Error ? e.message : "out failed" });
      continue;
    }

    const invName = doc.sales_invoice || body?.invoice;
    if (invName) {
      try {
        await erpUpdate("Sales Invoice", invName, {
          lsh_fulfillment:
            outKind === "Pickup" ? "Picked Up" : "Out for Delivery",
          lsh_where_detail:
            outKind === "FedEx"
              ? "FedEx ship — checkout PWA"
              : outKind === "Hand"
                ? "Hand delivery — checkout PWA"
                : "Picked up at store — checkout PWA",
          ...(doc.name ? { alteration_ticket_ref: doc.name } : {}),
        });
      } catch {
        /* non-fatal */
      }
    }
    results.push({
      ticket: name,
      ok: true,
      method: outKind,
      delivery_method: deliveryMethod,
      ls_carrier: outKind === "FedEx" ? "FedEx" : null,
      invoice: invName || null,
    });
  }

  // Invoice-only out (no ticket)
  if (!ticketNames.length && body?.invoice) {
    try {
      await erpUpdate("Sales Invoice", body.invoice, {
        lsh_fulfillment: outKind === "Pickup" ? "Picked Up" : "Out for Delivery",
        lsh_where_detail: `${outKind} — checkout PWA`,
      });
      results.push({ invoice: body.invoice, ok: true, method: outKind });
    } catch (e) {
      results.push({
        invoice: body.invoice,
        ok: false,
        error: e instanceof Error ? e.message : "SI update failed",
      });
    }
  }

  return c.json({ data: { ok: results.every((r) => r.ok), results, staff: gate.staff } });
});

// ─── Receipt draft (do not auto-send SMS) ─────────────────────────────────────

checkoutRouter.post("/receipt/draft", async (c) => {
  const gate = await requireCheckout(c);
  if ("error" in gate) return gate.error;
  const body = (await c.req.json().catch(() => null)) as {
    ticket?: string;
    invoice?: string;
    channel?: "sms" | "email";
  } | null;
  if (!body?.ticket && !body?.invoice) {
    return c.json({ error: { message: "ticket or invoice required" } }, 400);
  }

  let customer = "";
  let phone: string | null = null;
  let email: string | null = null;
  let amount = 0;
  let ref = body.ticket || body.invoice || "";

  if (body.ticket) {
    const t = (await erpGet("Alteration Ticket", body.ticket)) as any;
    customer = t.customer_name || t.customer || "";
    phone = t.customer_mobile || t.customer_phone || null;
    amount = Number(t.ticket_total) || 0;
    if (t.customer) {
      try {
        const cust = (await erpGet("Customer", t.customer)) as any;
        email = cust?.email_id || null;
      } catch {
        /* */
      }
    }
    if (t.sales_invoice) {
      try {
        const inv = (await erpGet("Sales Invoice", t.sales_invoice)) as any;
        email = email || inv.contact_email || null;
        amount = Number(inv.grand_total) || amount;
        ref = `${t.name} / ${t.sales_invoice}`;
      } catch {
        /* */
      }
    }
  } else if (body.invoice) {
    const inv = (await erpGet("Sales Invoice", body.invoice)) as any;
    customer = inv.customer_name || inv.customer || "";
    email = inv.contact_email || inv.customer_email_id || null;
    phone = inv.contact_mobile || null;
    amount = Number(inv.grand_total) || 0;
    ref = inv.name;
    if (!email && inv.customer) {
      try {
        const cust = (await erpGet("Customer", inv.customer)) as any;
        email = cust?.email_id || null;
      } catch {
        /* */
      }
    }
  }

  const first = (customer || "there").split(/\s+/)[0];
  const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount || 0);
  const sms = `Hi ${first}, receipt for your L&S pickup ${ref}: ${dollars}. Thank you — L&S Tailors.`;
  const emailBody = {
    to: email,
    subject: `L&S receipt · ${ref}`,
    text: `Dear ${customer || "Client"},\n\nThank you for your pickup at L&S Tailors.\nReference: ${ref}\nAmount: ${dollars}\n\n— L&S House`,
  };

  return c.json({
    data: {
      channel: body.channel || "sms",
      customer,
      phone,
      email,
      amount,
      ref,
      smsDraft: sms,
      emailDraft: emailBody,
      // gated — do not send unless Carl/Sofia path already approved
      sendAllowed: process.env.CHECKOUT_ALLOW_RECEIPT_SEND === "1",
      note: "Draft only. Sofia client SMS — do not send unless Carl/Sofia path approved.",
    },
  });
});
