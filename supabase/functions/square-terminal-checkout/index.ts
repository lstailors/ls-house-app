import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing or invalid authorization" }, 401);
    }

    // Validate JWT via user-scoped client
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } =
      await supabaseUser.auth.getUser();
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { invoice_id, amount_cents, device_id, supabase_invoice_row_id } =
      body as {
        invoice_id: string;
        amount_cents: number;
        device_id: string;
        supabase_invoice_row_id?: string;
      };

    if (!invoice_id || !device_id) {
      return json({ error: "invoice_id and device_id are required" }, 400);
    }
    if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
      return json(
        { error: "amount_cents must be a positive integer" },
        400
      );
    }

    const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN")!;
    const idempotencyKey = crypto.randomUUID();

    const squareRes = await fetch(
      "https://connect.squareup.com/v2/terminals/checkouts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": "2024-12-18",
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
      }
    );

    const squareData = await squareRes.json();

    if (!squareRes.ok) {
      const errors = (squareData.errors ?? [
        { detail: "Unknown Square error" },
      ]) as Array<{ code?: string; detail?: string }>;
      return json(
        {
          error: errors[0].detail ?? "Square API error",
          square_error_code: errors[0].code,
          square_errors: errors,
        },
        squareRes.status
      );
    }

    const checkout = squareData.checkout as { id: string };
    const checkoutId = checkout.id;

    const { error: logError } = await supabaseAdmin
      .from("square_sync_log")
      .insert({
        resource: "terminal_checkout",
        square_id: checkoutId,
        phase: "created",
        status: "pending",
        erpnext_doctype: "Sales Invoice",
        erpnext_name: invoice_id,
        message: `Terminal checkout created for ${invoice_id}`,
        payload: {
          invoice_id,
          amount_cents,
          device_id,
          supabase_invoice_row_id: supabase_invoice_row_id ?? null,
          idempotency_key: idempotencyKey,
          requested_by: user.id,
        },
      });

    if (logError) {
      console.error(
        "[square-terminal-checkout] log write failed:",
        logError
      );
    }

    return json({ checkout_id: checkoutId, status: "pending" }, 200);
  } catch (err) {
    console.error("[square-terminal-checkout] unhandled error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
