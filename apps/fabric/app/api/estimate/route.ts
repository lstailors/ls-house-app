import { runEstimate, parseEstimateInput } from "@/lib/estimate";
import { fail, ok } from "@/lib/http";
import { requireAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const input = parseEstimateInput(await req.json().catch(() => null));
    return ok(await runEstimate(account, input));
  } catch (e) {
    return fail(e);
  }
}
