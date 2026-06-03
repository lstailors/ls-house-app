import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const {
      source_id,
      invoice_id,
      amount_cents,
      verification_token,
      payment_request_id,
    } = body as {
      source_id: string;
      invoice_id: string;
      amount_cents: number;
      verification_token?: string;
      payment_request_id?: string;
    };

    // Auth: try JWT first, then payment_request token
    let userId: string | null = null;
    let paymentRequestRow: Record<string, unknown> | null = null;

    if (authHeader.startsWith("Bearer ")) {
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (user) userId = user.id;
    }

    if (!userId && payment_request_id) {
      const { data: pr, error: prErr } = await supabaseAdmin
        .from("payment_requests")
        .select("*")
        .eq("id", payment_request_id)
        .eq("status", "sent")
        .gt("expires_at", new Date().toISOString())
        .single();

      if (prErr || !pr) {
        return json({ error: "Invalid or expired payment link" }, 401);
      }
      paymentRequestRow = pr as Record<string, unknown>;
    }

    if (!userId && !paymentRequestRow) {
      return json({ error: "Authentication required" }, 401);
    }

    if (!source_id || !invoice_id) {
      return json(
        { error: "source_id and invoice_id are required" },
        400
      );
    }
    if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
      return json(
        { error: "amount_cents must be a positive integer" },
        400
      );
    }

    const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN")!;
    const locationId = Deno.env.get("SQUARE_LOCATION_ID")!;
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

    const squareRes = await fetch(
      "https://connect.squareup.com/v2/payments",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": "2024-12-18",
        },
        body: JSON.stringify(squareBody),
      }
    );

    const squareData = await squareRes.json();

    if (!squareRes.ok) {
      const errors = (squareData.errors ?? [
        { detail: "Unknown error" },
      ]) as Array<{ code?: string; detail?: string }>;
      const code = errors[0].code ?? "";
      const humanMessage =
        ERROR_MAP[code] ??
        "Payment could not be processed. Please try again.";
      return json({ error: humanMessage, square_error_code: code }, 422);
    }

    const payment = squareData.payment as Record<string, any>;

    if (payment.status !== "COMPLETED") {
      return json(
        { error: "Payment was not completed. Please try again." },
        422
      );
    }

    const now = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin
      .from("square_payments")
      .insert({
        square_payment_id: payment.id,
        square_order_id: payment.order_id ?? null,
        square_customer_id: payment.customer_id ?? null,
        square_location_id: payment.location_id ?? null,
        amount_cents: payment.amount_money?.amount ?? amount_cents,
        total_cents:
          payment.total_money?.amount ??
          payment.amount_money?.amount ??
          amount_cents,
        tip_cents: payment.tip_money?.amount ?? 0,
        processing_fee_cents:
          payment.processing_fee?.[0]?.amount_money?.amount ?? 0,
        currency: payment.amount_money?.currency ?? "USD",
        status: payment.status,
        source_type: "ONLINE",
        card_brand: payment.card_details?.card?.card_brand ?? null,
        card_last4: payment.card_details?.card?.last_4 ?? null,
        card_type: payment.card_details?.card?.card_type ?? null,
        entry_method: payment.card_details?.entry_method ?? null,
        receipt_number: payment.receipt_number ?? null,
        receipt_url: payment.receipt_url ?? null,
        square_product: "ONLINE",
        risk_level: payment.risk_evaluation?.risk_level ?? null,
        square_created_at: payment.created_at ?? now,
        square_updated_at: payment.updated_at ?? now,
        raw_data: payment,
        attribution: invoice_id,
      });

    if (insertError) {
      console.error(
        "[square-capture-payment] square_payments insert failed:",
        insertError
      );
    }

    // Record payment in ERPNext (best-effort — do not fail the response if ERP is down)
    const erpBaseUrl = Deno.env.get("ERPNEXT_BASE_URL") ?? "";
    const erpApiKey = Deno.env.get("ERPNEXT_API_KEY") ?? "";
    const erpApiSecret = Deno.env.get("ERPNEXT_API_SECRET") ?? "";

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
              amount: amount_cents / 100,
            }),
          }
        );
        if (!erpRes.ok) {
          const erpErr = await erpRes.text();
          console.error(
            "[square-capture-payment] ERPNext call failed:",
            erpErr
          );
        }
      } catch (erpErr) {
        console.error(
          "[square-capture-payment] ERPNext unreachable:",
          erpErr
        );
      }
    }

    // Mark payment_request as paid if this came from a payment link
    if (paymentRequestRow) {
      await supabaseAdmin
        .from("payment_requests")
        .update({
          status: "paid",
          square_payment_id: payment.id,
          paid_at: now,
        })
        .eq("id", paymentRequestRow.id);
    }

    return json({ status: "success", payment_id: payment.id as string }, 200);
  } catch (err) {
    console.error("[square-capture-payment] unhandled error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
