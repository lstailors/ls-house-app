import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpGet, erpUpdate, erpRunMethod, erpSubmit, erpCreate, erpList } from "../lib/erp";
import { recordCardOnFileProvenance } from "../lib/paymentProvenance";
import {
  humanizeSquareTerminalError,
  isMissingLsSquareModule,
  squareErpMethods,
} from "../lib/square-checkout";

export const paymentsRouter = new Hono();

const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? "https://erp.lstailors.com";

function erpHeaders(contentType = "application/json"): Record<string, string> {
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const secret = process.env.ERPNEXT_API_SECRET ?? "";
  return {
    Authorization: `token ${key}:${secret}`,
    Accept: "application/json",
    // Same UA as erp.ts — CF tunnel returns 1010 without a browser UA.
    "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0; +https://app.lstailors.com)",
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const obj = payload as Record<string, any>;
  if (typeof obj.message === "string") return obj.message;
  if (typeof obj.error === "string") return obj.error;
  if (obj.error?.message) return String(obj.error.message);
  if (typeof obj.exception === "string") return obj.exception;
  if (typeof obj._server_messages === "string") return obj._server_messages;
  return fallback;
}

async function callErpMethod<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const secret = process.env.ERPNEXT_API_SECRET ?? "";
  if (!ERP_BASE || !key || !secret) {
    throw new Error("ERPNext API credentials are not configured");
  }

  const res = await fetch(`${ERP_BASE}/api/method/${method}`, {
    method: "POST",
    headers: erpHeaders(),
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(errorMessage(payload, `ERPNext method failed: ${res.status}`));
  }
  return ((payload as any).message ?? payload) as T;
}

async function callErpMethodFirst<T>(
  methods: string[],
  body: Record<string, unknown>,
): Promise<T> {
  let lastErr: unknown;
  for (const method of methods) {
    try {
      return await callErpMethod<T>(method, body);
    } catch (err) {
      lastErr = err;
      if (!isMissingLsSquareModule(err)) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("ERPNext method failed");
}

function normalizePaymentLink(result: any) {
  const data = result?.data ?? result ?? {};
  const url = data.url ?? data.payment_url ?? data.long_url ?? data.order?.checkout_page_url;
  const paymentLinkId = data.payment_link_id ?? data.id ?? data.payment_link?.id ?? data.order?.id;
  if (!url) throw new Error("ERPNext did not return a Square payment URL");
  return {
    ok: true,
    url: String(url),
    payment_link_id: paymentLinkId ? String(paymentLinkId) : "",
  };
}

function normalizeCheckout(result: any) {
  const data = result?.data ?? result ?? {};
  const checkoutId = data.checkout_id ?? data.id ?? data.checkout?.id;
  if (!checkoutId) throw new Error("ERPNext did not return a Square checkout ID");
  return { ok: true, checkout_id: String(checkoutId) };
}

// An alteration ticket name (ALT-...) is NOT a Sales Invoice. Route it to the
// ERP method as `ticket` so ERPNext resolves it to the ticket's linked invoice;
// pass a real Sales Invoice name straight through as `invoice`. Without this,
// charging from a ticket fails with "Sales Invoice ALT-... not found".
function refFor(id: string): { ticket: string } | { invoice: string } {
  return /^ALT/i.test(id) ? { ticket: id } : { invoice: id };
}

// POST /api/payments/link
// Prefer ERP ls_square when deployed; fall back to direct Square API so FOH
// checkout works even when the bench module is missing / workers not reloaded.
paymentsRouter.post("/link", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    invoice?: string;
    amount?: number;
  } | null;
  if (!body?.invoice) {
    return c.json({ error: { message: "invoice is required" } }, 400);
  }

  const rawId = body.invoice.trim();

  // 1) Try ERP wrappers (api.*) then nested ls_square.pos
  try {
    const result = await callErpMethodFirst(
      squareErpMethods("create_payment_link"),
      {
        ...refFor(rawId),
        ...(body.amount ? { amount: body.amount } : {}),
      },
    );
    return c.json(normalizePaymentLink(result));
  } catch (erpErr) {
    const erpMsg = erpErr instanceof Error ? erpErr.message : String(erpErr);
    // Only fall through for missing-module / method; other ERP errors may be real
    if (!isMissingLsSquareModule(erpErr)) {
      return c.json({ error: { message: erpMsg || "Could not create payment link" } }, 502);
    }

    // 2) Hub-side Square mint
    try {
      const link = await mintPaymentLinkDirect(rawId, body.amount);
      return c.json(link);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create payment link";
      return c.json({ error: { message } }, 502);
    }
  }
});

/**
 * Direct Square Online Checkout payment link.
 * Resolves ALT ticket → SI, reuses existing link, submits draft SI when needed.
 */
async function mintPaymentLinkDirect(
  rawId: string,
  amountOverride?: number,
): Promise<{ ok: true; url: string; payment_link_id: string }> {
  const token = process.env.SQUARE_ACCESS_TOKEN ?? "";
  const locationId = process.env.SQUARE_LOCATION_ID ?? "";
  if (!token) throw new Error("Square not configured (SQUARE_ACCESS_TOKEN)");
  if (!locationId) throw new Error("Square not configured (SQUARE_LOCATION_ID)");

  let invoiceName = rawId;
  let customerName = "";
  let outstanding = 0;

  if (/^ALT/i.test(rawId)) {
    const t = await erpGet<Record<string, unknown>>("Alteration Ticket", rawId);
    if (!t) throw new Error(`Ticket ${rawId} not found`);
    const si = String(t.sales_invoice ?? "").trim();
    if (!si) throw new Error(`Ticket ${rawId} has no Sales Invoice yet`);
    invoiceName = si;
    customerName = String(t.customer_name ?? "");
    outstanding = Number(t.ticket_total ?? 0) || 0;
  }

  let inv = await erpGet<Record<string, unknown>>("Sales Invoice", invoiceName);
  if (!inv) throw new Error(`Sales Invoice ${invoiceName} not found`);

  // Reuse existing Square link on SI
  const prior = String(inv.lsh_square_payment_link ?? "").trim();
  if (prior.startsWith("http")) {
    return { ok: true, url: prior, payment_link_id: "" };
  }

  let docstatus = Number(inv.docstatus ?? 0);
  customerName = customerName || String(inv.customer_name ?? inv.customer ?? "");
  outstanding =
    amountOverride && amountOverride > 0
      ? amountOverride
      : Number(inv.outstanding_amount ?? inv.grand_total ?? outstanding) || 0;

  if (docstatus === 2) throw new Error(`Invoice ${invoiceName} is cancelled`);
  if (docstatus === 0) {
    // Submit draft so AR is real; pdf_on_submit can OSError — retry after stripping SI from PDF settings is heavy,
    // so try submit; if it fails with OSError/pdf, force-save dates and retry once via client.submit.
    try {
      await erpSubmit("Sales Invoice", invoiceName);
      docstatus = 1;
    } catch (subErr) {
      const sm = subErr instanceof Error ? subErr.message : String(subErr);
      // Re-fetch — sometimes submit partially completed
      inv = (await erpGet<Record<string, unknown>>("Sales Invoice", invoiceName)) || inv;
      docstatus = Number(inv.docstatus ?? 0);
      if (docstatus !== 1) {
        // Last resort: set docstatus via frappe.client.submit after refreshing full doc
        try {
          const full = await erpGet<Record<string, unknown>>("Sales Invoice", invoiceName);
          if (!full) throw new Error(sm);
          await callErpMethod("frappe.client.submit", { doc: full });
          docstatus = 1;
        } catch (e2) {
          const m2 = e2 instanceof Error ? e2.message : String(e2);
          throw new Error(`Could not submit draft invoice ${invoiceName}: ${m2 || sm}`);
        }
      }
    }
    inv = (await erpGet<Record<string, unknown>>("Sales Invoice", invoiceName)) || inv;
    outstanding =
      amountOverride && amountOverride > 0
        ? amountOverride
        : Number(inv.outstanding_amount ?? inv.grand_total ?? outstanding) || 0;
  }

  if (outstanding <= 0) throw new Error(`Invoice ${invoiceName} has nothing outstanding`);

  const amountCents = Math.round(outstanding * 100);
  const idempotencyKey = `lsh-hub-${invoiceName}-${amountCents}`.slice(0, 45);

  const sqRes = await fetch(`${SQUARE_API}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: squareHeaders(token),
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      quick_pay: {
        name: `L&S Invoice ${invoiceName}`,
        price_money: { amount: amountCents, currency: "USD" },
        location_id: locationId,
      },
      payment_note: `${invoiceName} - ${customerName}`.slice(0, 500),
      description: `L&S Custom Tailors — ${invoiceName}`,
    }),
  });
  const sqData = (await sqRes.json().catch(() => ({}))) as {
    payment_link?: { id?: string; url?: string; long_url?: string };
    errors?: Array<{ detail?: string; code?: string }>;
  };
  if (!sqRes.ok) {
    throw new Error(sqData.errors?.[0]?.detail || sqData.errors?.[0]?.code || `Square HTTP ${sqRes.status}`);
  }
  const pl = sqData.payment_link ?? {};
  const url = String(pl.url || pl.long_url || "").trim();
  if (!url) throw new Error("Square did not return a payment URL");

  // Stamp SI for pay page + email
  const appPay = `https://app.lstailors.com/pay/${encodeURIComponent(invoiceName)}`;
  try {
    await erpUpdate("Sales Invoice", invoiceName, {
      lsh_square_payment_link: url,
      lsh_invoice_web_url: appPay,
    });
  } catch {
    /* field stamp best-effort */
  }

  return {
    ok: true,
    url,
    payment_link_id: String(pl.id ?? ""),
  };
}

// POST /api/payments/terminal-checkout
// Prefer ERP ls_square when deployed; fall back to direct Square Terminal API
// so FOH checkout works even when the bench module is missing.
// Never forward client `amount` to ERP — live create_checkout() does not
// accept it (TypeError), and HER-63 says outstanding comes from the SI.
paymentsRouter.post("/terminal-checkout", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    invoice?: string;
    ticket?: string;
    amount?: number;
    device?: "counter" | "mobile" | "handheld" | "reader";
    device_id?: string;
  } | null;
  if (!body?.invoice && !body?.ticket) {
    return c.json({ error: { message: "invoice or ticket is required" } }, 400);
  }

  const rawId = (body.ticket || body.invoice || "").trim();
  const device = body.device || undefined;
  const deviceId = (body.device_id || "").trim() || undefined;

  try {
    const result = await callErpMethodFirst(
      squareErpMethods("create_checkout"),
      {
        ...(body.ticket ? { ticket: body.ticket } : refFor(body.invoice!)),
        ...(device ? { device } : {}),
        ...(deviceId ? { device_id: deviceId } : {}),
      },
    );
    return c.json(normalizeCheckout(result));
  } catch (erpErr) {
    if (!isMissingLsSquareModule(erpErr)) {
      const message = humanizeSquareTerminalError(erpErr);
      return c.json({ error: { message } }, 502);
    }
    try {
      const checkout = await mintTerminalCheckoutDirect(rawId, { device, deviceId });
      return c.json(checkout);
    } catch (e) {
      const message = humanizeSquareTerminalError(e);
      return c.json({ error: { message } }, 502);
    }
  }
});

// POST /api/payments/cash — record cash against SI outstanding
paymentsRouter.post("/cash", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    invoice?: string;
    ticket?: string;
    amount?: number;
  } | null;
  if (!body?.invoice && !body?.ticket) {
    return c.json({ error: { message: "invoice or ticket is required" } }, 400);
  }

  const rawId = (body.ticket || body.invoice || "").trim();
  try {
    const result = await callErpMethodFirst(squareErpMethods("record_cash_payment"), {
      ...(body.ticket ? { ticket: body.ticket } : refFor(body.invoice!)),
      ...(body.amount ? { amount: body.amount } : {}),
    });
    return c.json(result);
  } catch (erpErr) {
    if (!isMissingLsSquareModule(erpErr)) {
      const message = erpErr instanceof Error ? erpErr.message : "Could not record cash";
      return c.json({ error: { message } }, 502);
    }
    try {
      const recorded = await recordCashDirect(rawId, body.amount);
      return c.json(recorded);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not record cash";
      return c.json({ error: { message } }, 502);
    }
  }
});


// POST /api/payments/outside — Cash / Check / Square handheld (already collected)
// Records PE via lsh_house.checkout so drawer/check/handheld can be matched later.
paymentsRouter.post("/outside", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    invoice?: string;
    ticket?: string;
    method?: string;
    amount?: number;
    check_number?: string;
    reference?: string;
  } | null;
  if (!body?.invoice && !body?.ticket) {
    return c.json({ error: { message: "invoice or ticket is required" } }, 400);
  }
  const method = String(body.method || "").trim().toLowerCase();
  if (!method) {
    return c.json({ error: { message: "method is required (cash|check|square_handheld)" } }, 400);
  }

  try {
    const result = await callErpMethodFirst(
      [
        "lsh_house.checkout.record_outside_payment",
        "ls_alterations.api.record_cash_payment",
        "ls_alterations.ls_square.pos.record_cash_payment",
      ],
      {
        ...(body.ticket ? { ticket: body.ticket } : refFor(body.invoice!)),
        method,
        ...(body.amount != null ? { amount: body.amount } : {}),
        ...(body.check_number ? { check_number: body.check_number } : {}),
        ...(body.reference ? { reference: body.reference } : {}),
      },
    );
    return c.json(result);
  } catch (e) {
    // Cash-only ERP fallback for method=cash when lsh_house missing
    if (method === "cash") {
      try {
        const result = await callErpMethodFirst(squareErpMethods("record_cash_payment"), {
          ...(body.ticket ? { ticket: body.ticket } : refFor(body.invoice!)),
          ...(body.amount != null ? { amount: body.amount } : {}),
        });
        return c.json(result);
      } catch {
        /* fall through */
      }
    }
    const message = e instanceof Error ? e.message : "Could not record payment";
    return c.json({ error: { message } }, 502);
  }
});

// GET /api/payments/outside — outstanding + method options + void eligibility
paymentsRouter.get("/outside", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  const ticket = c.req.query("ticket") || undefined;
  const invoice = c.req.query("invoice") || undefined;
  if (!ticket && !invoice) {
    return c.json({ error: { message: "ticket or invoice is required" } }, 400);
  }
  try {
    const result = await callErpMethod("lsh_house.checkout.get_checkout_payment", {
      ...(ticket ? { ticket } : {}),
      ...(invoice ? { invoice } : {}),
    });
    return c.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load checkout payment";
    return c.json({ error: { message } }, 502);
  }
});

// POST /api/payments/outside/void — cancel PE + unstamp ticket (undo mistake)
paymentsRouter.post("/outside/void", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    invoice?: string;
    ticket?: string;
    payment_entry?: string;
    confirm?: number | boolean | string;
  } | null;
  if (!body?.invoice && !body?.ticket) {
    return c.json({ error: { message: "invoice or ticket is required" } }, 400);
  }
  try {
    const result = await callErpMethod("lsh_house.checkout.void_outside_payment", {
      ...(body.ticket ? { ticket: body.ticket } : {}),
      ...(body.invoice ? { invoice: body.invoice } : {}),
      ...(body.payment_entry ? { payment_entry: body.payment_entry } : {}),
      confirm: body.confirm ?? 1,
    });
    return c.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not void payment";
    return c.json({ error: { message } }, 502);
  }
});

// GET /api/payments/terminals — counter + mobile device ids
paymentsRouter.get("/terminals", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const result = await callErpMethodFirst(squareErpMethods("list_terminals"), {});
    return c.json(result);
  } catch {
    try {
      const settings = await erpGet<Record<string, unknown>>(
        "Square Integration Settings",
        "Square Integration Settings",
      );
      const counter = String(settings?.device_id ?? "").trim();
      const mobile = String(settings?.mobile_device_id ?? "").trim();
      return c.json({
        ok: true,
        terminals: [
          { id: "counter", label: "Counter Terminal", device_id: counter, configured: Boolean(counter) },
          { id: "mobile", label: "Mobile Terminal", device_id: mobile, configured: Boolean(mobile) },
        ],
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not list terminals";
      return c.json({ error: { message } }, 502);
    }
  }
});

// GET /api/payments/terminal-checkout/:checkoutId
paymentsRouter.get("/terminal-checkout/:checkoutId", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const checkoutId = c.req.param("checkoutId");
  const accessToken = process.env.SQUARE_ACCESS_TOKEN ?? "";
  if (!accessToken) return c.json({ error: { message: "Square not configured" } }, 500);

  const squareRes = await fetch(
    `https://connect.squareup.com/v2/terminals/checkouts/${encodeURIComponent(checkoutId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": "2024-12-18",
      },
    },
  );
  const squareData = (await squareRes.json().catch(() => ({}))) as {
    checkout?: SquareTerminalCheckout;
    errors?: Array<{ detail?: string }>;
  };
  if (!squareRes.ok) {
    const message = squareData.errors?.[0]?.detail ?? "Square API error";
    return c.json({ error: { message } }, squareRes.status as 400);
  }

  const checkout = squareData.checkout;
  if ((checkout?.status ?? "").toUpperCase() === "COMPLETED") {
    // Webhook may 500 while ls_square is missing — record the PE here too.
    void applyCompletedSquareCheckout(checkout).catch((err) => {
      console.error("[terminal-checkout poll] apply payment:", err instanceof Error ? err.message : err);
    });
  }

  return c.json({
    ok: true,
    checkout_id: checkout?.id ?? checkoutId,
    status: checkout?.status ?? "UNKNOWN",
    payment_ids: checkout?.payment_ids ?? [],
  });
});

// POST /api/payments/webhook
paymentsRouter.post("/webhook", async (c) => {
  const signature = c.req.header("x-square-hmacsha256-signature") ?? "";
  const raw = await c.req.arrayBuffer();

  try {
    let res: Response | null = null;
    let lastText = "";
    for (const method of squareErpMethods("receive")) {
      res = await fetch(`${ERP_BASE}/api/method/${method}`, {
        method: "POST",
        headers: {
          ...erpHeaders("application/json"),
          ...(signature ? { "x-square-hmacsha256-signature": signature } : {}),
        },
        body: raw,
      });
      lastText = await res.text();
      if (res.ok || !isMissingLsSquareModule(lastText)) break;
    }
    const text = lastText;
    const missing = Boolean(res && !res.ok && isMissingLsSquareModule(text));
    if (!missing && res) {
      return new Response(text || JSON.stringify({ ok: res.ok }), {
        status: res.status,
        headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
      });
    }
  } catch (e) {
    if (!isMissingLsSquareModule(e)) {
      const message = e instanceof Error ? e.message : "Square webhook proxy failed";
      return c.json({ error: { message } }, 502);
    }
  }

  // Bench ls_square is not deployed — reconcile from Square's confirmed objects.
  try {
    const outcome = await handleSquareWebhookDirect(raw);
    return c.json(outcome);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Square webhook fallback failed";
    console.error("[payments/webhook] fallback:", message);
    return c.json({ ok: false, error: message }, 500);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Square Terminal pairing (Terminal API device codes)
//
// A Square Terminal only receives app-driven checkouts once it is PAIRED to
// this application via a device code. The "Device ID" on the terminal's About
// screen is not enough. Flow:
//   1. POST /api/payments/terminal/pair       -> creates a device code
//   2. staff type that code into the Terminal (Sign in > use a device code)
//   3. GET  /api/payments/terminal/pair/:id    -> poll until PAIRED; on success
//      we save the returned device_id into Square Integration Settings.
// ───────────────────────────────────────────────────────────────────────────

const SQUARE_VERSION = "2024-12-18";

async function saveTerminalDeviceId(
  deviceId: string,
  target: "counter" | "mobile" = "counter",
): Promise<void> {
  // PUT the single Square Integration Settings doc so the live checkout flow
  // (pos.create_checkout) picks up the freshly-paired device.
  const field = target === "mobile" ? "mobile_device_id" : "device_id";
  await fetch(
    `${ERP_BASE}/api/resource/${encodeURIComponent("Square Integration Settings")}/${encodeURIComponent("Square Integration Settings")}`,
    { method: "PUT", headers: erpHeaders(), body: JSON.stringify({ [field]: deviceId }) },
  );
}

// POST /api/payments/terminal/pair — start pairing, returns a code to enter on the device.
paymentsRouter.post("/terminal/pair", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const accessToken = process.env.SQUARE_ACCESS_TOKEN ?? "";
  const locationId = process.env.SQUARE_LOCATION_ID ?? "";
  if (!accessToken) return c.json({ error: { message: "Square not configured" } }, 500);

  try {
    const squareRes = await fetch("https://connect.squareup.com/v2/devices/codes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        device_code: {
          name: "L&S House App",
          product_type: "TERMINAL_API",
          ...(locationId ? { location_id: locationId } : {}),
        },
      }),
    });
    const data = (await squareRes.json().catch(() => ({}))) as {
      device_code?: { id?: string; code?: string; status?: string };
      errors?: Array<{ detail?: string }>;
    };
    if (!squareRes.ok) {
      return c.json({ error: { message: data.errors?.[0]?.detail ?? "Square device code error" } }, 502);
    }
    const dc = data.device_code ?? {};
    return c.json({ ok: true, id: dc.id, code: dc.code, status: dc.status });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "Could not start pairing" } }, 502);
  }
});

// GET /api/payments/terminal/pair/:id — poll a device code; saves device_id when PAIRED.
paymentsRouter.get("/terminal/pair/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const accessToken = process.env.SQUARE_ACCESS_TOKEN ?? "";
  if (!accessToken) return c.json({ error: { message: "Square not configured" } }, 500);

  try {
    const squareRes = await fetch(
      `https://connect.squareup.com/v2/devices/codes/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": SQUARE_VERSION } },
    );
    const data = (await squareRes.json().catch(() => ({}))) as {
      device_code?: { status?: string; device_id?: string };
      errors?: Array<{ detail?: string }>;
    };
    if (!squareRes.ok) {
      return c.json({ error: { message: data.errors?.[0]?.detail ?? "Square API error" } }, 502);
    }
    const dc = data.device_code ?? {};
    const status = dc.status ?? "UNKNOWN";
    const deviceId = dc.device_id ?? null;
    let saved = false;
    if (status === "PAIRED" && deviceId) {
      const target = c.req.query("target") === "mobile" ? "mobile" : "counter";
      try { await saveTerminalDeviceId(deviceId, target); saved = true; } catch { saved = false; }
    }
    return c.json({ ok: true, status, device_id: deviceId, saved });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "Pairing check failed" } }, 502);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Card on file (HER-79) — staff-confirm only. Never auto-bill.
// Prefer ERP ls_square.pos methods when deployed; fall back to direct Square
// + ERP REST so alts can ship without waiting on a bench migrate.
// ───────────────────────────────────────────────────────────────────────────

const SQUARE_API = "https://connect.squareup.com";

function squareHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Square-Version": SQUARE_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

type SquareTerminalCheckout = {
  id?: string;
  status?: string;
  payment_ids?: string[];
  reference_id?: string;
  amount_money?: { amount?: number; currency?: string };
};

/**
 * Push a Terminal Checkout via Square when ERP ls_square is not on the bench.
 * Amount is always the SI outstanding (ignore any client-sent figure).
 */
async function mintTerminalCheckoutDirect(
  rawId: string,
  opts: { device?: string; deviceId?: string } = {},
): Promise<{ ok: true; checkout_id: string }> {
  const token = process.env.SQUARE_ACCESS_TOKEN ?? "";
  if (!token) throw new Error("Square not configured (SQUARE_ACCESS_TOKEN)");

  let invoiceName = rawId;
  let customerName = "";
  let ticketName = "";

  if (/^ALT/i.test(rawId)) {
    const t = await erpGet<Record<string, unknown>>("Alteration Ticket", rawId);
    if (!t) throw new Error(`Ticket ${rawId} not found`);
    const si = String(t.sales_invoice ?? "").trim();
    if (!si) throw new Error(`Ticket ${rawId} has no Sales Invoice yet`);
    invoiceName = si;
    customerName = String(t.customer_name ?? "");
    ticketName = rawId;
  }

  let inv = await erpGet<Record<string, unknown>>("Sales Invoice", invoiceName);
  if (!inv) throw new Error(`Sales Invoice ${invoiceName} not found`);

  let docstatus = Number(inv.docstatus ?? 0);
  if (docstatus === 2) throw new Error(`Invoice ${invoiceName} is cancelled`);
  if (docstatus === 0) {
    try {
      await erpSubmit("Sales Invoice", invoiceName);
    } catch (subErr) {
      const sm = subErr instanceof Error ? subErr.message : String(subErr);
      inv = (await erpGet<Record<string, unknown>>("Sales Invoice", invoiceName)) || inv;
      docstatus = Number(inv.docstatus ?? 0);
      if (docstatus !== 1) {
        throw new Error(`Could not submit draft invoice ${invoiceName}: ${sm}`);
      }
    }
    inv = (await erpGet<Record<string, unknown>>("Sales Invoice", invoiceName)) || inv;
  }

  customerName = customerName || String(inv.customer_name ?? inv.customer ?? "");
  const outstanding = Number(inv.outstanding_amount ?? inv.grand_total ?? 0) || 0;
  if (outstanding <= 0) throw new Error(`Invoice ${invoiceName} has nothing outstanding`);

  const wantsSpecific =
    Boolean(opts.deviceId) ||
    ["mobile", "handheld", "reader"].includes((opts.device || "").toLowerCase());

  if (!wantsSpecific) {
    try {
      const open = await erpList<Record<string, unknown>>("Square Checkout", {
        filters: [
          ["invoice", "=", invoiceName],
          ["kind", "=", "Terminal"],
          ["status", "=", "Created"],
        ],
        fields: ["name", "checkout_id", "amount"],
        order_by: "creation desc",
        limit: 10,
      });
      const reused = open.find((r) => String(r.checkout_id ?? "").trim());
      if (reused?.checkout_id) {
        return { ok: true, checkout_id: String(reused.checkout_id) };
      }
    } catch {
      /* listing is best-effort */
    }
  }

  const settings = await erpGet<Record<string, unknown>>(
    "Square Integration Settings",
    "Square Integration Settings",
  );
  const mobileId = String(settings?.mobile_device_id ?? process.env.SQUARE_MOBILE_DEVICE_ID ?? "").trim();
  const counterId =
    String(settings?.device_id ?? "").trim() ||
    (process.env.SQUARE_TERMINAL_DEVICE_ID ?? "").trim();
  const deviceId =
    (opts.deviceId || "").trim() ||
    (wantsSpecific ? mobileId : counterId);
  if (!deviceId) {
    throw new Error(
      wantsSpecific
        ? "No Square mobile terminal configured. Set Mobile Device ID on Square Integration Settings."
        : "No Square Terminal device_id configured. Pair the terminal from Settings.",
    );
  }

  const amountCents = Math.round(outstanding * 100);
  const sqRes = await fetch(`${SQUARE_API}/v2/terminals/checkouts`, {
    method: "POST",
    headers: squareHeaders(token),
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      checkout: {
        amount_money: { amount: amountCents, currency: "USD" },
        reference_id: invoiceName.slice(0, 40),
        note: `L&S ${invoiceName} - ${customerName}`.slice(0, 500),
        device_options: { device_id: deviceId },
      },
    }),
  });
  const sqData = (await sqRes.json().catch(() => ({}))) as {
    checkout?: SquareTerminalCheckout;
    errors?: Array<{ detail?: string; code?: string }>;
  };
  if (!sqRes.ok) {
    throw new Error(
      sqData.errors?.[0]?.detail || sqData.errors?.[0]?.code || `Square HTTP ${sqRes.status}`,
    );
  }
  const checkoutId = String(sqData.checkout?.id ?? "").trim();
  if (!checkoutId) throw new Error("Square did not return a terminal checkout ID");

  try {
    await erpCreate("Square Checkout", {
      invoice: invoiceName,
      ticket: ticketName || undefined,
      kind: "Terminal",
      amount: outstanding,
      status: "Created",
      checkout_id: checkoutId,
    });
  } catch {
    /* mapping is convenience — webhook/poll can still resolve via reference_id */
  }

  return { ok: true, checkout_id: checkoutId };
}

async function recordCashDirect(
  rawId: string,
  amountOverride?: number,
): Promise<{
  ok: true;
  status: string;
  method: "cash";
  invoice: string;
  amount: number;
  payment_entry?: string;
}> {
  let invoiceName = rawId;
  let ticketName = "";
  if (/^ALT/i.test(rawId)) {
    const t = await erpGet<Record<string, unknown>>("Alteration Ticket", rawId);
    if (!t) throw new Error(`Ticket ${rawId} not found`);
    const si = String(t.sales_invoice ?? "").trim();
    if (!si) throw new Error(`Ticket ${rawId} has no Sales Invoice yet`);
    invoiceName = si;
    ticketName = rawId;
  }

  let inv = await erpGet<Record<string, unknown>>("Sales Invoice", invoiceName);
  if (!inv) throw new Error(`Sales Invoice ${invoiceName} not found`);
  if (Number(inv.docstatus ?? 0) === 2) throw new Error(`Invoice ${invoiceName} is cancelled`);
  if (Number(inv.docstatus ?? 0) === 0) {
    await erpSubmit("Sales Invoice", invoiceName);
    inv = (await erpGet<Record<string, unknown>>("Sales Invoice", invoiceName)) || inv;
  }

  const outstanding = Number(inv.outstanding_amount ?? inv.grand_total ?? 0) || 0;
  if (outstanding <= 0) {
    return { ok: true, status: "already_paid", method: "cash", invoice: invoiceName, amount: 0 };
  }
  const amount =
    amountOverride && amountOverride > 0 && amountOverride <= outstanding + 0.02
      ? amountOverride
      : outstanding;

  const pe = await erpCreate<Record<string, unknown>>("Payment Entry", {
    payment_type: "Receive",
    party_type: "Customer",
    party: inv.customer,
    paid_amount: amount,
    received_amount: amount,
    paid_to_account_currency: inv.currency ?? "USD",
    company: inv.company,
    mode_of_payment: "Cash",
    reference_no: `CASH-${invoiceName}`.slice(0, 140),
    reference_date: new Date().toISOString().slice(0, 10),
    references: [
      {
        reference_doctype: "Sales Invoice",
        reference_name: invoiceName,
        allocated_amount: amount,
      },
    ],
    docstatus: 1,
  });

  if (ticketName) {
    try {
      await erpUpdate("Alteration Ticket", ticketName, {
        square_payment_method: "Cash",
        square_transaction_id: pe?.name ? String(pe.name) : `CASH-${invoiceName}`,
        paid_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      });
    } catch {
      /* ticket stamp is best-effort; PE is the source of truth */
    }
  }

  return {
    ok: true,
    status: "cash_recorded",
    method: "cash",
    invoice: invoiceName,
    amount,
    payment_entry: pe?.name ? String(pe.name) : undefined,
  };
}

async function applyCompletedSquareCheckout(
  checkout: SquareTerminalCheckout | undefined,
): Promise<void> {
  if (!checkout) return;
  if ((checkout.status ?? "").toUpperCase() !== "COMPLETED") return;
  const invoice = String(checkout.reference_id ?? "").trim();
  if (!invoice) return;
  const paymentId = String(checkout.payment_ids?.[0] ?? checkout.id ?? "").trim();
  const amountCents = Number(checkout.amount_money?.amount ?? 0);
  const amount = amountCents > 0 ? amountCents / 100 : 0;
  await applySquarePaymentToInvoice({
    invoice,
    paymentId,
    amount,
    checkoutId: checkout.id,
  });
}

async function applySquarePaymentToInvoice(opts: {
  invoice: string;
  paymentId: string;
  amount: number;
  checkoutId?: string;
}): Promise<{ ok: true; status: string; payment_entry?: string }> {
  const { invoice, paymentId, checkoutId } = opts;
  if (!invoice) throw new Error("invoice is required");

  const existing = paymentId
    ? await erpList<Record<string, unknown>>("Payment Entry", {
        filters: [
          ["reference_no", "=", paymentId],
          ["docstatus", "=", 1],
        ],
        fields: ["name"],
        limit: 1,
      })
    : [];
  if (existing[0]?.name) {
    return { ok: true, status: "duplicate", payment_entry: String(existing[0].name) };
  }

  const inv = await erpGet<Record<string, unknown>>("Sales Invoice", invoice);
  if (!inv) throw new Error(`Sales Invoice ${invoice} not found`);
  if (Number(inv.docstatus ?? 0) !== 1) {
    throw new Error(`Invoice ${invoice} is not submitted`);
  }

  const outstanding = Number(inv.outstanding_amount ?? 0) || 0;
  if (outstanding <= 0.02) {
    return { ok: true, status: "already_paid" };
  }

  const amount = opts.amount > 0 && opts.amount <= outstanding + 0.02 ? opts.amount : outstanding;

  const pe = await erpCreate<Record<string, unknown>>("Payment Entry", {
    payment_type: "Receive",
    party_type: "Customer",
    party: inv.customer,
    paid_amount: amount,
    received_amount: amount,
    paid_to_account_currency: inv.currency ?? "USD",
    company: inv.company,
    mode_of_payment: "Square",
    reference_no: paymentId || "SQUARE",
    reference_date: new Date().toISOString().slice(0, 10),
    references: [
      {
        reference_doctype: "Sales Invoice",
        reference_name: invoice,
        allocated_amount: amount,
      },
    ],
    docstatus: 1,
  });

  if (checkoutId) {
    try {
      const rows = await erpList<Record<string, unknown>>("Square Checkout", {
        filters: [["checkout_id", "=", checkoutId]],
        fields: ["name"],
        limit: 1,
      });
      if (rows[0]?.name) {
        await erpUpdate("Square Checkout", String(rows[0].name), {
          status: "Completed",
          payment_id: paymentId,
        });
      }
    } catch {
      /* mapping close is best-effort */
    }
  }

  return {
    ok: true,
    status: "processed",
    payment_entry: pe?.name ? String(pe.name) : undefined,
  };
}

async function handleSquareWebhookDirect(
  raw: ArrayBuffer,
): Promise<{ ok: boolean; status: string }> {
  let body: Record<string, any>;
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as Record<string, any>;
  } catch {
    return { ok: false, status: "bad_json" };
  }

  const eventType = String(body.type ?? "");
  if (
    eventType !== "payment.updated" &&
    eventType !== "payment.created" &&
    eventType !== "terminal.checkout.updated"
  ) {
    return { ok: true, status: "ignored" };
  }

  const obj = body.data?.object ?? {};
  const token = process.env.SQUARE_ACCESS_TOKEN ?? "";
  if (!token) throw new Error("Square not configured");

  if (obj.checkout?.id) {
    const confirmed = await fetch(
      `${SQUARE_API}/v2/terminals/checkouts/${encodeURIComponent(obj.checkout.id)}`,
      { headers: squareHeaders(token) },
    );
    const data = (await confirmed.json().catch(() => ({}))) as { checkout?: SquareTerminalCheckout };
    await applyCompletedSquareCheckout(data.checkout ?? obj.checkout);
    return { ok: true, status: "processed" };
  }

  if (obj.payment?.id) {
    const confirmed = await fetch(
      `${SQUARE_API}/v2/payments/${encodeURIComponent(obj.payment.id)}`,
      { headers: squareHeaders(token) },
    );
    const data = (await confirmed.json().catch(() => ({}))) as {
      payment?: {
        id?: string;
        status?: string;
        reference_id?: string;
        amount_money?: { amount?: number };
      };
    };
    const p = data.payment ?? obj.payment;
    if ((p.status ?? "").toUpperCase() !== "COMPLETED") {
      return { ok: true, status: "ignored" };
    }
    const invoice = String(p.reference_id ?? "").trim();
    if (!invoice) return { ok: true, status: "ignored_unmapped" };
    const amountCents = Number(p.amount_money?.amount ?? 0);
    await applySquarePaymentToInvoice({
      invoice,
      paymentId: String(p.id ?? ""),
      amount: amountCents > 0 ? amountCents / 100 : 0,
    });
    return { ok: true, status: "processed" };
  }

  return { ok: true, status: "ignored" };
}

type PublicCard = {
  id: string;
  brand: string;
  last4: string;
  exp_month?: number | null;
  exp_year?: number | null;
  enabled: boolean;
  expired: boolean;
  cardholder_name?: string;
};

/** Square keeps expired cards enabled=true; end of exp month is last valid. */
function isCardExpired(expMonth?: number | null, expYear?: number | null): boolean {
  if (expMonth == null || expYear == null) return false;
  const m = Number(expMonth);
  const y = Number(expYear);
  if (!Number.isFinite(m) || !Number.isFinite(y) || m < 1 || m > 12) return false;
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  return y < cy || (y === cy && m < cm);
}

function toPublicCard(c: Record<string, unknown>): PublicCard {
  const exp_month = (c.exp_month as number | null | undefined) ?? null;
  const exp_year = (c.exp_year as number | null | undefined) ?? null;
  return {
    id: String(c.id ?? ""),
    brand: String(c.card_brand ?? c.card_type ?? "CARD"),
    last4: String(c.last_4 ?? ""),
    exp_month,
    exp_year,
    enabled: c.enabled !== false,
    expired: isCardExpired(exp_month, exp_year),
    cardholder_name: String(c.cardholder_name ?? ""),
  };
}

async function squareFetch(path: string, init?: RequestInit): Promise<any> {
  const token = process.env.SQUARE_ACCESS_TOKEN ?? "";
  if (!token) throw new Error("Square not configured");
  const res = await fetch(`${SQUARE_API}${path}`, {
    ...init,
    headers: { ...squareHeaders(token), ...(init?.headers as Record<string, string> | undefined) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      (data as any)?.errors?.[0]?.detail ||
      (data as any)?.errors?.[0]?.code ||
      `Square HTTP ${res.status}`;
    throw new Error(String(detail));
  }
  return data;
}

async function resolveCustomerContext(opts: {
  invoice?: string;
  ticket?: string;
  customer?: string;
  /** When true, draft SI is auto-submitted and missing SI errors hard. */
  forCharge?: boolean;
}): Promise<{
  invoice: string | null;
  invoiceDocstatus: number | null;
  customer: string | null;
  customerName: string | null;
  outstanding: number;
  ticketTotal: number;
  mobile: string | null;
  ticket: string | null;
}> {
  let invoice = opts.invoice?.trim() || null;
  let customer = opts.customer?.trim() || null;
  let outstanding = 0;
  let ticketTotal = 0;
  let customerName: string | null = null;
  let mobile: string | null = null;
  let invoiceDocstatus: number | null = null;
  let ticketName: string | null = opts.ticket?.trim() || null;

  if (opts.ticket) {
    const t = await erpGet<Record<string, unknown>>("Alteration Ticket", opts.ticket);
    if (!t) throw new Error(`Ticket ${opts.ticket} not found`);
    invoice = invoice || (t.sales_invoice as string) || null;
    customer = customer || (t.customer as string) || null;
    customerName = (t.customer_name as string) || null;
    mobile = (t.customer_mobile as string) || (t.customer_phone as string) || null;
    ticketTotal = Number(t.ticket_total ?? 0) || 0;
  }

  if (invoice) {
    const inv = await erpGet<Record<string, unknown>>("Sales Invoice", invoice);
    if (!inv) throw new Error(`Sales Invoice ${invoice} not found`);
    invoiceDocstatus = Number(inv.docstatus ?? 0);
    customer = customer || (inv.customer as string) || null;
    customerName = customerName || (inv.customer_name as string) || null;
    // Prefer SI amounts when present (even draft has grand_total / outstanding)
    outstanding = Number(inv.outstanding_amount ?? inv.grand_total ?? 0) || 0;

    if (opts.forCharge && invoiceDocstatus === 0) {
      // Alts often keeps SI draft until pickup — staff charge must finalize it.
      try {
        await erpSubmit("Sales Invoice", invoice);
        invoiceDocstatus = 1;
        const refreshed = await erpGet<Record<string, unknown>>("Sales Invoice", invoice);
        if (refreshed) {
          outstanding = Number(refreshed.outstanding_amount ?? refreshed.grand_total ?? outstanding) || 0;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "submit failed";
        throw new Error(`Could not submit draft invoice ${invoice}: ${msg}`);
      }
    }

    if (opts.forCharge && invoiceDocstatus !== 1) {
      throw new Error(`Invoice ${invoice} is not submitted (docstatus=${invoiceDocstatus})`);
    }
  } else if (opts.forCharge) {
    throw new Error(
      ticketName
        ? `Ticket ${ticketName} has no Sales Invoice yet — open full ticket / mint SI first`
        : "Sales Invoice required to charge",
    );
  } else if (!customer) {
    // list-only path needs at least a customer
    throw new Error("Could not resolve customer for card on file");
  }

  // List path: fall back outstanding to ticket total when SI missing/draft unpaid
  if (!opts.forCharge && outstanding <= 0 && ticketTotal > 0) {
    outstanding = ticketTotal;
  }

  if (customer && !mobile) {
    const cust = await erpGet<Record<string, unknown>>("Customer", customer);
    mobile = (cust?.mobile_no as string) || null;
    customerName = customerName || (cust?.customer_name as string) || null;
  }

  return {
    invoice,
    invoiceDocstatus,
    customer,
    customerName,
    outstanding,
    ticketTotal,
    mobile,
    ticket: ticketName,
  };
}

async function resolveSquareCustomerId(
  erpCustomer: string,
  mobile: string | null,
): Promise<string | null> {
  const cust = await erpGet<Record<string, unknown>>("Customer", erpCustomer);
  if (!cust) return null;
  let sid = String(cust.square_customer_id ?? "").trim();
  if (sid) return sid;

  const phone = mobile || String(cust.mobile_no ?? "");
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  const candidates = [`+1${last10}`, last10, `1${last10}`];

  for (const exact of candidates) {
    try {
      const data = await squareFetch("/v2/customers/search", {
        method: "POST",
        body: JSON.stringify({
          query: { filter: { phone_number: { exact } } },
          limit: 5,
        }),
      });
      const hit = (data.customers || [])[0];
      if (hit?.id) {
        sid = String(hit.id);
        try {
          await erpUpdate("Customer", erpCustomer, {
            square_customer_id: sid,
            last_square_sync_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          });
        } catch {
          /* link is best-effort */
        }
        return sid;
      }
    } catch {
      /* try next format */
    }
  }
  return null;
}

async function listSquareCards(squareCustomerId: string): Promise<PublicCard[]> {
  const cards: PublicCard[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({
      customer_id: squareCustomerId,
      include_disabled: "false",
    });
    if (cursor) q.set("cursor", cursor);
    const data = await squareFetch(`/v2/cards?${q.toString()}`);
    for (const c of data.cards || []) {
      if (c?.id) cards.push(toPublicCard(c));
    }
    cursor = data.cursor;
    if (!cursor) break;
  }
  return cards.filter((c) => c.enabled && c.id);
}

// GET /api/payments/cards?ticket= | ?invoice= | ?customer=
paymentsRouter.get("/cards", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!["super_admin", "store_manager", "salesperson"].includes(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const ticket = c.req.query("ticket") || undefined;
  const invoice = c.req.query("invoice") || undefined;
  const customer = c.req.query("customer") || undefined;
  if (!ticket && !invoice && !customer) {
    return c.json({ error: { message: "ticket, invoice, or customer is required" } }, 400);
  }

  // Prefer ERP method when deployed — but never block on draft-SI failures
  try {
    const result = await erpRunMethod("ls_alterations.ls_square.pos.list_cards", {
      ...(ticket ? { ticket } : {}),
      ...(invoice ? { invoice } : {}),
      ...(customer ? { customer } : {}),
    });
    if (result && typeof result === "object" && (result as any).ok !== undefined) {
      return c.json(result);
    }
  } catch {
    /* fall through to direct Square path */
  }

  try {
    // List path must NOT require submitted SI — customer comes from ticket/SI draft.
    const ctx = await resolveCustomerContext({ ticket, invoice, customer, forCharge: false });
    if (!ctx.customer) {
      return c.json({ ok: false, error: "no_customer", cards: [] }, 400);
    }
    const sqId = await resolveSquareCustomerId(ctx.customer, ctx.mobile);
    if (!sqId) {
      return c.json({
        ok: true,
        customer: ctx.customer,
        customer_name: ctx.customerName,
        square_customer_id: null,
        invoice: ctx.invoice,
        cards: [],
        message:
          "No Square customer linked for this client. Save a card in Square POS first, or match phone.",
      });
    }
    const cards = await listSquareCards(sqId);
    const usable = cards.filter((card) => !card.expired);
    try {
      await erpUpdate("Customer", ctx.customer, {
        // has_stored_card = usable (non-expired) only — expired vault noise is not floor-ready
        has_stored_card: usable.length > 0 ? 1 : 0,
        last_square_sync_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      });
    } catch {
      /* flag is convenience */
    }
    return c.json({
      ok: true,
      customer: ctx.customer,
      customer_name: ctx.customerName,
      square_customer_id: sqId,
      invoice: ctx.invoice,
      invoice_docstatus: ctx.invoiceDocstatus,
      outstanding: ctx.outstanding,
      cards,
      usable_count: usable.length,
      expired_count: cards.length - usable.length,
      message:
        cards.length > 0 && usable.length === 0
          ? "Cards on file are expired. Update the card in Square POS, or use Terminal / Pay Link."
          : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not list cards";
    return c.json({ error: { message } }, 502);
  }
});

// POST /api/payments/card-on-file
// body: { card_id, ticket? | invoice?, amount? }  amount in dollars (optional)
paymentsRouter.post("/card-on-file", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!["super_admin", "store_manager", "salesperson"].includes(user.role)) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = (await c.req.json().catch(() => null)) as {
    card_id?: string;
    invoice?: string;
    ticket?: string;
    amount?: number;
    idempotency_key?: string;
  } | null;

  if (!body?.card_id) {
    return c.json({ error: { message: "card_id is required" } }, 400);
  }
  if (!body.invoice && !body.ticket) {
    return c.json({ error: { message: "invoice or ticket is required" } }, 400);
  }

  // Prefer ERP when deployed
  try {
    const result = await erpRunMethod("ls_alterations.ls_square.pos.charge_card_on_file", {
      card_id: body.card_id,
      ...(body.ticket ? { ticket: body.ticket } : {}),
      ...(body.invoice ? { invoice: body.invoice } : {}),
      ...(body.amount != null ? { amount: body.amount } : {}),
      ...(body.idempotency_key ? { idempotency_key: body.idempotency_key } : {}),
    });
    if (result && typeof result === "object" && (result as any).ok !== undefined) {
      return c.json(result);
    }
  } catch {
    /* fall through — ERP may reject draft SI; TS path submits draft */
  }

  try {
    const ctx = await resolveCustomerContext({
      ticket: body.ticket,
      invoice: body.invoice,
      forCharge: true,
    });
    if (!ctx.invoice) {
      return c.json({ error: { message: "Could not resolve Sales Invoice" } }, 400);
    }
    if (ctx.outstanding <= 0) {
      return c.json({ ok: false, status: "already_paid", invoice: ctx.invoice });
    }
    if (!ctx.customer) {
      return c.json({ error: { message: "Invoice has no customer" } }, 400);
    }

    const chargeAmt =
      body.amount != null && Number.isFinite(body.amount) ? Number(body.amount) : ctx.outstanding;
    if (chargeAmt <= 0) {
      return c.json({ error: { message: "amount must be positive" } }, 400);
    }
    if (chargeAmt - ctx.outstanding > 0.02) {
      return c.json(
        { error: { message: `amount ${chargeAmt} exceeds outstanding ${ctx.outstanding}` } },
        400,
      );
    }

    const sqId = await resolveSquareCustomerId(ctx.customer, ctx.mobile);
    if (!sqId) {
      return c.json({ error: { message: "Customer has no Square account linked" } }, 400);
    }

    const cards = await listSquareCards(sqId);
    const match = cards.find((card) => card.id === body.card_id);
    if (!match) {
      return c.json({ error: { message: "Card not found on customer's Square vault" } }, 400);
    }
    if (match.expired || isCardExpired(match.exp_month, match.exp_year)) {
      const exp =
        match.exp_month && match.exp_year
          ? `${String(match.exp_month).padStart(2, "0")}/${String(match.exp_year).slice(-2)}`
          : "unknown";
      return c.json(
        {
          error: {
            message: `Card ····${match.last4} expired ${exp}. Update card in Square POS, or use Terminal / Pay Link.`,
          },
        },
        400,
      );
    }

    const amountCents = Math.round(chargeAmt * 100);
    const locationId = process.env.SQUARE_LOCATION_ID ?? "";
    if (!locationId) {
      return c.json({ error: { message: "SQUARE_LOCATION_ID not configured" } }, 500);
    }

    const idem =
      body.idempotency_key ||
      `cof-${ctx.invoice}-${body.card_id.slice(-8)}-${amountCents}`;

    const data = await squareFetch("/v2/payments", {
      method: "POST",
      body: JSON.stringify({
        idempotency_key: idem,
        source_id: body.card_id,
        autocomplete: true,
        customer_id: sqId,
        location_id: locationId,
        amount_money: { amount: amountCents, currency: "USD" },
        // Webhook resolves SI via reference_id — keep under 40 chars
        reference_id: ctx.invoice.slice(0, 40),
        note: `L&S COF ${ctx.invoice} - ${ctx.customerName || ctx.customer}`.slice(0, 500),
      }),
    });

    const payment = data.payment || {};
    const status = String(payment.status || "UNKNOWN").toUpperCase();
    const paymentId = payment.id ? String(payment.id) : null;

    const chargeSucceeded = status === "COMPLETED" || status === "APPROVED";

    // A completed charge without ticket provenance is an integrity failure.
    // Return the payment id so staff can reconcile it without charging again.
    if (chargeSucceeded && body.ticket && paymentId) {
      try {
        await recordCardOnFileProvenance(
          { ticket: body.ticket, paymentId },
          erpUpdate,
        );
      } catch (error) {
        const provenanceError =
          error instanceof Error ? error.message : "Unknown ERP provenance error";
        console.error("Card-on-file provenance update failed", {
          ticket: body.ticket,
          paymentId,
          error: provenanceError,
        });
        return c.json(
          {
            error: {
              message:
                "Card was charged, but ERP did not record the payment provenance. Do not charge again; reconcile this payment id.",
            },
            charged: true,
            payment_id: paymentId,
            payment_status: status,
            provenance_recorded: false,
          },
          502,
        );
      }
    }

    return c.json({
      ok: chargeSucceeded,
      status,
      method: "card_on_file",
      invoice: ctx.invoice,
      amount: chargeAmt,
      payment_id: paymentId,
      provenance_recorded: Boolean(chargeSucceeded && body.ticket && paymentId),
      card: match,
      receipt_url: payment.receipt_url ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Card-on-file charge failed";
    return c.json({ error: { message } }, 502);
  }
});
