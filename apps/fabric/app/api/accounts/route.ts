// Internal only: trade accounts an internal user may price as (Margin view).
import { serviceList } from "@/lib/erp";
import { UserError, fail, ok } from "@/lib/http";
import { requireAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const a = await requireAccount();
    if (!a.isInternal) throw new UserError("Not permitted", "forbidden", 403);
    const rows = await serviceList<{ name: string; customer_name: string }>("Customer", {
      filters: [
        ["custom_retail_multiplier", ">", 0],
        ["default_price_list", "is", "set"],
        ["disabled", "=", 0],
      ],
      fields: ["name", "customer_name"],
      order_by: "customer_name asc",
      limit: 200,
    });
    return ok(rows.map((r) => ({ id: r.name, name: r.customer_name })));
  } catch (e) {
    return fail(e);
  }
}
