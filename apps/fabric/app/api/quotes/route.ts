import { todayISO } from "@/lib/catalog";
import { erpCreate, erpUpdate, erpUploadFile } from "@/lib/erp";
import { parseEstimateInput, runEstimate } from "@/lib/estimate";
import { UserError, fail, ok } from "@/lib/http";
import { type QuoteDoc, listQuotes, notesWithOptions, sessionAuth } from "@/lib/quotes";
import { requireAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const a = await requireAccount();
    if (!a.customer && !a.isInternal) return ok([]);
    return ok(await listQuotes(a));
  } catch (e) {
    return fail(e);
  }
}

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const a = await requireAccount();
    const form = await req.formData().catch(() => null);
    if (!form) throw new UserError("Bad request", "bad_request");
    const payload = JSON.parse(String(form.get("payload") ?? "{}")) as Record<string, unknown>;
    const input = parseEstimateInput(payload);
    const endCustomer = String(payload.end_customer ?? "").trim().slice(0, 140);
    const notes = String(payload.notes ?? "").slice(0, 2000);
    if (!endCustomer) throw new UserError("Add the client's name", "bad_request");

    const customer = input.as_customer && a.isInternal ? input.as_customer : a.customer;
    if (!customer) throw new UserError("This login has no trade account to save quotes under", "not_configured", 422);

    // Never trust client numbers: re-price on the server at save time.
    const est = await runEstimate(a, input);

    const doc = await erpCreate<QuoteDoc>(
      "Fabric Quote",
      {
        customer,
        end_customer: endCustomer,
        quote_date: todayISO(),
        fabric_item: est.fabric.item_code,
        fabric_vendor: est.fabric.vendor_name,
        garment_type: est.garment_type,
        make_level: est.make_level,
        yardage: est.totals.yardage,
        cmt_cost: est.totals.cmt,
        fabric_cost: est.totals.fabric,
        shipping_cost: est.totals.shipping,
        alterations_fee: est.totals.alterations_fee,
        total_cost: est.totals.unit_cost,
        ...(est.retail
          ? {
              retail_multiplier: est.retail.multiplier,
              list_price: est.retail.list_price,
              discount_pct: est.retail.discount_pct,
              retail_price: est.retail.retail_price,
            }
          : {}),
        notes: notesWithOptions(notes, input.options),
      },
      sessionAuth(a),
    );

    const photo = form.get("photo");
    let photoSaved = false;
    if (photo instanceof Blob && photo.size > 0) {
      if (photo.size > MAX_PHOTO_BYTES || !photo.type.startsWith("image/")) {
        return ok({ name: doc.name, photo_saved: false, warning: "Quote saved, but the photo was too large or not an image." });
      }
      try {
        const ext = photo.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
        const file = await erpUploadFile(a.sid, photo, `${doc.name}-swatch.${ext}`, {
          doctype: "Fabric Quote",
          docname: doc.name,
        });
        photoSaved = true;
        // swatch_image may not exist on older Fabric Quote schemas; the File stays attached regardless.
        await erpUpdate("Fabric Quote", doc.name, { swatch_image: file.file_url }, sessionAuth(a)).catch(() => undefined);
      } catch (e) {
        console.error("[fabric-estimator] swatch upload failed", e);
        return ok({ name: doc.name, photo_saved: false, warning: "Quote saved, but the photo upload failed." });
      }
    }
    return ok({ name: doc.name, photo_saved: photoSaved });
  } catch (e) {
    return fail(e);
  }
}
