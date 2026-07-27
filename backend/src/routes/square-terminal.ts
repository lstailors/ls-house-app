import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";

export const squareRouter = new Hono();

const SQUARE_VERSION = "2024-12-18";

const ERROR_MAP: Record<string, string> = {
  CARD_DECLINED:
    "Your card was declined. Please try a different payment method.",
  VERIFY_CVV_FAILURE: "CVV did not match. Please check your card details.",
  VERIFY_AVS_FAILURE:
    "Address verification failed. Please check your billing address.",
  INSUFFICIENT_FUNDS: "Insufficient funds.",
  INVALID_EXPIRATION: "Card expiration date is invalid.",
  PAYMENT_LIMIT_EXCEEDED:
    "Payment amount exceeds limit. Please contact us.",
  CARD_TOKEN_USED: "This payment token has already been used.",
  CARD_EXPIRED: "This card has expired. Please use a different card.",
};

function squareToken() {
  return process.env.SQUARE_ACCESS_TOKEN ?? "";
}

// GET /api/square/terminal-checkout/:checkoutId — poll checkout status
squareRouter.get("/terminal-checkout/:checkoutId", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const checkoutId = c.req.param("checkoutId");
  const accessToken = squareToken();
  if (!accessToken) return c.json({ error: "Square not configured" }, 500);

  const squareRes = await fetch(
    `https://connect.squareup.com/v2/terminals/checkouts/${checkoutId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": SQUARE_VERSION,
      },
    },
  );

  const squareData = (await squareRes.json().catch(() => ({}))) as {
    checkout?: { id?: string; status?: string };
    errors?: Array<{ code?: string; detail?: string }>;
  };

  if (!squareRes.ok) {
    const detail = squareData.errors?.[0]?.detail ?? "Square API error";
    return c.json({ error: detail }, (squareRes.status || 500) as any);
  }

  const checkout = squareData.checkout ?? {};
  return c.json({
    data: {
      checkout_id: checkout.id ?? checkoutId,
      status: checkout.status ?? "UNKNOWN",
    },
  });
});

// POST /api/square/terminal-checkout
squareRouter.post("/terminal-checkout", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    invoice_id?: string;
    amount_cents?: number;
    device_id?: string;
  } | null;

  const { invoice_id, amount_cents, device_id } = body ?? {};

  if (!invoice_id || !device_id) {
    return c.json({ error: "invoice_id and device_id are required" }, 400);
  }
  if (!Number.isInteger(amount_cents) || (amount_cents ?? 0) <= 0) {
    return c.json({ error: "amount_cents must be a positive integer" }, 400);
  }

  const accessToken = squareToken();
  if (!accessToken) return c.json({ error: "Square not configured" }, 500);

  const idempotencyKey = crypto.randomUUID();
  const squareRes = await fetch(
    "https://connect.squareup.com/v2/terminals/checkouts",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": SQUARE_VERSION,
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        checkout: {
          amount_money: { amount: amount_cents, currency: "USD" },
          reference_id: invoice_id,
          note: `L&S Custom Tailors — ${invoice_id}`,
          device_options: {
            device_id,
            skip_receipt_screen: true,
            collect_signature: false,
          },
          payment_type: "CARD_PRESENT",
        },
      }),
    },
  );

  const squareData = (await squareRes.json().catch(() => ({}))) as {
    checkout?: { id?: string };
    errors?: Array<{ code?: string; detail?: string }>;
  };

  if (!squareRes.ok) {
    const errors = squareData.errors ?? [{ detail: "Unknown Square error" }];
    return c.json(
      {
        error: errors[0].detail ?? "Square API error",
        square_error_code: errors[0].code,
        square_errors: errors,
      },
      squareRes.status as 400,
    );
  }

  const checkoutId = squareData.checkout?.id;
  if (!checkoutId) {
    return c.json({ error: "No checkout ID returned" }, 500);
  }

  return c.json({ checkout_id: checkoutId, status: "pending" });
});

// POST /api/square/capture-payment
squareRouter.post("/capture-payment", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: "Authentication required" }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    source_id?: string;
    invoice_id?: string;
    amount_cents?: number;
    verification_token?: string;
  } | null;

  const { source_id, invoice_id, amount_cents, verification_token } = body ?? {};

  if (!source_id || !invoice_id) {
    return c.json({ error: "source_id and invoice_id are required" }, 400);
  }
  if (!Number.isInteger(amount_cents) || (amount_cents ?? 0) <= 0) {
    return c.json({ error: "amount_cents must be a positive integer" }, 400);
  }

  const accessToken = squareToken();
  const locationId = process.env.SQUARE_LOCATION_ID ?? "";
  if (!accessToken || !locationId) {
    return c.json({ error: "Square not configured" }, 500);
  }

  const idempotencyKey = crypto.randomUUID();
  const squareBody: Record<string, unknown> = {
    idempotency_key: idempotencyKey,
    source_id,
    amount_money: { amount: amount_cents, currency: "USD" },
    reference_id: invoice_id,
    note: `L&S Custom Tailors — ${invoice_id}`,
    location_id: locationId,
  };
  if (verification_token) {
    squareBody.verification_token = verification_token;
  }

  const squareRes = await fetch("https://connect.squareup.com/v2/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    body: JSON.stringify(squareBody),
  });

  const squareData = (await squareRes.json().catch(() => ({}))) as {
    payment?: Record<string, unknown>;
    errors?: Array<{ code?: string; detail?: string }>;
  };

  if (!squareRes.ok) {
    const code = squareData.errors?.[0]?.code ?? "";
    const humanMessage =
      ERROR_MAP[code] ??
      "Payment could not be processed. Please try again.";
    return c.json({ error: humanMessage, square_error_code: code }, 422);
  }

  const payment = squareData.payment ?? {};
  if (payment.status !== "COMPLETED") {
    return c.json(
      { error: "Payment was not completed. Please try again." },
      422,
    );
  }

  // Record payment in ERPNext (best-effort)
  const erpBaseUrl = process.env.ERPNEXT_BASE_URL ?? "";
  const erpApiKey = process.env.ERPNEXT_API_KEY ?? "";
  const erpApiSecret = process.env.ERPNEXT_API_SECRET ?? "";

  if (erpBaseUrl && erpApiKey) {
    try {
      const erpRes = await fetch(
        `${erpBaseUrl}/api/method/square_integration.api.record_square_payment`,
        {
          method: "POST",
          headers: {
            Authorization: `token ${erpApiKey}:${erpApiSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            invoice_id,
            square_payment_id: payment.id,
            amount: (amount_cents ?? 0) / 100,
          }),
        },
      );
      if (!erpRes.ok) {
        console.error(
          "[square-capture-payment] ERPNext call failed:",
          await erpRes.text(),
        );
      }
    } catch (erpErr) {
      console.error("[square-capture-payment] ERPNext unreachable:", erpErr);
    }
  }

  return c.json({ status: "success", payment_id: payment.id as string });
});
