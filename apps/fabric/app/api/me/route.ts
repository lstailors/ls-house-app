import { fail, ok } from "@/lib/http";
import { requireAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const a = await requireAccount();
    return ok({
      user: a.user,
      account: a.customerName,
      is_internal: a.isInternal,
      default_make_level: a.defaultMake,
      default_discount_pct: a.defaultDiscount,
      retail_multiplier: a.terms.retailMultiplier,
      can_save: !!a.customer,
    });
  } catch (e) {
    return fail(e);
  }
}
