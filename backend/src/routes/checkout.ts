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
    const [pin, name] = part.split(":").map((s) => s.trim());
    return { pin: pin.replace(/\D/g, "").slice(0, 4), name: name || "Staff" };
  });
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
    if (looksLikeTicket(code)) {
      const card = await loadTicketCard(code);
      if (!card) return c.json({ error: { message: `Ticket ${code} not found` } }, 404);
      return c.json({ data: card });
    }
    if (looksLikeInvoice(code)) {
      const card = await loadInvoiceCard(code);
      if (!card) return c.json({ error: { message: `Invoice ${code} not found` } }, 404);
      return c.json({ data: card });
    }
    // Try ticket then invoice
    try {
      const card = await loadTicketCard(code);
      if (card) return c.json({ data: card });
    } catch {
      /* */
    }
    try {
      const card = await loadInvoiceCard(code);
      if (card) return c.json({ data: card });
    } catch {
      /* */
    }
    // Customer name search → open tickets/invoices
    const tickets = (await erpList("Alteration Ticket", {
      fields: ["name", "customer_name", "workflow_state", "payment_status", "ticket_total", "sales_invoice"],
      filters: [
        ["customer_name", "like", `%${code}%`],
        ["workflow_state", "!=", "Cancelled"],
      ],
      limit: 10,
      order_by: "modified desc",
    }).catch(() => [])) as any[];
    if (tickets.length === 1) {
      const card = await loadTicketCard(tickets[0].name);
      return c.json({ data: card });
    }
    if (tickets.length > 1) {
      return c.json({
        data: {
          kind: "search",
          query: code,
          hits: tickets.map((t) => ({
            kind: "ticket",
            id: t.name,
            customer: t.customer_name,
            status: t.workflow_state,
            outstanding: t.payment_status === "Paid" ? 0 : Number(t.ticket_total) || 0,
            invoiceId: t.sales_invoice,
          })),
        },
      });
    }
    return c.json({ error: { message: `Nothing found for ${code}` } }, 404);
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
  if (!body.allowCharge && process.env.CHECKOUT_ALLOW_TERMINAL !== "1") {
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
    return c.json({ data: result });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "Pay link failed" } }, 502);
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
