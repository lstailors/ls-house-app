// Streams the quote's private swatch photo from ERPNext using the user's own session.
import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { getQuote, isErpFilePath, quotePhoto } from "@/lib/quotes";
import { requireAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const a = await requireAccount();
    const q = await getQuote(a, params.id);
    const url = q ? await quotePhoto(a, q) : null;
    if (!url) return new NextResponse(null, { status: 404 });
    if (/^https?:\/\//.test(url)) return NextResponse.redirect(url);
    if (!isErpFilePath(url)) return new NextResponse(null, { status: 404 });
    const base = (process.env.ERP_BASE_URL ?? "").replace(/\/+$/, "");
    const res = await fetch(base + url, { headers: { Cookie: `sid=${a.sid}` }, cache: "no-store" });
    if (!res.ok || !res.body) return new NextResponse(null, { status: 404 });
    return new NextResponse(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
