import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";

export const squareRouter = new Hono();

const SQUARE_VERSION = "2024-12-18";

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

// HER-63 P1-2: amount-trusted routes disabled.
// Both trusted caller `amount_cents` into Square with no server-side invoice
// lookup. No in-repo callers. Prefer /api/payments/* → ls_square.pos (amount
// from outstanding). Do not re-enable without server-side amount from SI.
squareRouter.post("/terminal-checkout", async (c) => {
  return c.json(
    {
      error:
        "Disabled (HER-63 P1-2). Use POST /api/payments/terminal-checkout — amount comes from the invoice outstanding, not the caller.",
      code: "SQUARE_AMOUNT_TRUSTED_ROUTE_DISABLED",
    },
    410,
  );
});

// HER-63 P1-2: see terminal-checkout note above.
squareRouter.post("/capture-payment", async (c) => {
  return c.json(
    {
      error:
        "Disabled (HER-63 P1-2). Use Square hosted checkout / payments link path; caller amount_cents is not trusted.",
      code: "SQUARE_AMOUNT_TRUSTED_ROUTE_DISABLED",
    },
    410,
  );
});
