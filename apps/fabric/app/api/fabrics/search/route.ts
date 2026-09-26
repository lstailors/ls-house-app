// Typeahead scoped to one vendor prefix. Returns descriptive data only — NO price.
import { activeVendors, searchFabrics } from "@/lib/catalog";
import { UserError, fail, ok } from "@/lib/http";
import { requireAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAccount();
    const url = new URL(req.url);
    const code = url.searchParams.get("vendor") ?? "";
    const q = (url.searchParams.get("q") ?? "").slice(0, 60);
    const vendor = (await activeVendors()).find((v) => v.vendor_code === code);
    if (!vendor) throw new UserError("Unknown vendor", "not_found", 404);
    return ok(await searchFabrics(vendor, q));
  } catch (e) {
    return fail(e);
  }
}
