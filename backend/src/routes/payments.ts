import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";

export const paymentsRouter = new Hono();

const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? "https://erp.lstailors.com";

function erpHeaders(contentType = "application/json"): Record<string, string> {
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const secret = process.env.ERPNEXT_API_SECRET ?? "";
  return {
    Authorization: `token ${key}:${secret}`,
    Accept: "application/json",
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

  try {
    const result = await callErpMethod("ls_alterations.ls_square.pos.create_payment_link", {
      ...refFor(body.invoice),
      ...(body.amount ? { amount: body.amount } : {}),
    });
    return c.json(normalizePaymentLink(result));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create payment link";
    return c.json({ error: { message } }, 502);
  }
});

// POST /api/payments/terminal-checkout
paymentsRouter.post("/terminal-checkout", async (c) => {
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

  try {
    const result = await callErpMethod("ls_alterations.ls_square.pos.create_checkout", {
      ...(body.ticket ? { ticket: body.ticket } : refFor(body.invoice!)),
      ...(body.amount ? { amount: body.amount } : {}),
    });
    return c.json(normalizeCheckout(result));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create terminal checkout";
    return c.json({ error: { message } }, 502);
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
    checkout?: { id?: string; status?: string; payment_ids?: string[] };
    errors?: Array<{ detail?: string }>;
  };
  if (!squareRes.ok) {
    const message = squareData.errors?.[0]?.detail ?? "Square API error";
    return c.json({ error: { message } }, squareRes.status as 400);
  }

  return c.json({
    ok: true,
    checkout_id: squareData.checkout?.id ?? checkoutId,
    status: squareData.checkout?.status ?? "UNKNOWN",
    payment_ids: squareData.checkout?.payment_ids ?? [],
  });
});

// POST /api/payments/webhook
paymentsRouter.post("/webhook", async (c) => {
  const signature = c.req.header("x-square-hmacsha256-signature") ?? "";
  const raw = await c.req.arrayBuffer();

  try {
    const res = await fetch(
      `${ERP_BASE}/api/method/ls_alterations.ls_square.webhook.receive`,
      {
        method: "POST",
        headers: {
          ...erpHeaders("application/json"),
          ...(signature ? { "x-square-hmacsha256-signature": signature } : {}),
        },
        body: raw,
      },
    );
    const text = await res.text();
    return new Response(text || JSON.stringify({ ok: res.ok }), {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Square webhook proxy failed";
    return c.json({ error: { message } }, 502);
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

async function saveTerminalDeviceId(deviceId: string): Promise<void> {
  // PUT the single Square Integration Settings doc so the live checkout flow
  // (pos.create_checkout) picks up the freshly-paired device.
  await fetch(
    `${ERP_BASE}/api/resource/${encodeURIComponent("Square Integration Settings")}/${encodeURIComponent("Square Integration Settings")}`,
    { method: "PUT", headers: erpHeaders(), body: JSON.stringify({ device_id: deviceId }) },
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
      try { await saveTerminalDeviceId(deviceId); saved = true; } catch { saved = false; }
    }
    return c.json({ ok: true, status, device_id: deviceId, saved });
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : "Pairing check failed" } }, 502);
  }
});
