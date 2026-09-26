import { UserError, fail, ok } from "@/lib/http";
import { getQuote, quotePhoto, splitNotes } from "@/lib/quotes";
import { requireAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const a = await requireAccount();
    const q = await getQuote(a, params.id);
    if (!q) throw new UserError("Quote not found", "not_found", 404);
    const { notes, options } = splitNotes(q.notes);
    const photo = await quotePhoto(a, q);
    return ok({
      name: q.name,
      customer: q.customer,
      end_customer: q.end_customer,
      quote_date: q.quote_date,
      fabric_item: q.fabric_item,
      fabric_vendor: q.fabric_vendor,
      garment_type: q.garment_type,
      make_level: q.make_level,
      yardage: q.yardage,
      cmt_cost: q.cmt_cost,
      fabric_cost: q.fabric_cost,
      shipping_cost: q.shipping_cost,
      alterations_fee: q.alterations_fee,
      total_cost: q.total_cost,
      retail_multiplier: q.retail_multiplier,
      list_price: q.list_price,
      discount_pct: q.discount_pct,
      retail_price: q.retail_price,
      notes,
      options,
      has_photo: !!photo,
    });
  } catch (e) {
    return fail(e);
  }
}
