import { activeVendors } from "@/lib/catalog";
import { fail, ok } from "@/lib/http";
import { requireAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAccount();
    const vendors = await activeVendors();
    // price_list/currency are internal plumbing — not needed by the browser.
    return ok(vendors.map((v) => ({ code: v.vendor_code, name: v.vendor_name, provisional: v.provisional })));
  } catch (e) {
    return fail(e);
  }
}
