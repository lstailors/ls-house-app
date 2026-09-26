import { NextResponse } from "next/server";
import { erpLogin } from "@/lib/erp";
import { fail } from "@/lib/http";
import { SID_COOKIE, resolveAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { usr?: string; pwd?: string };
    if (!body.usr || !body.pwd)
      return NextResponse.json({ error: { message: "Email and password required", code: "bad_request" } }, { status: 400 });
    const sid = await erpLogin(body.usr.trim(), body.pwd);
    if (!sid)
      return NextResponse.json({ error: { message: "Incorrect email or password", code: "auth" } }, { status: 401 });
    const account = await resolveAccount(sid); // throws 403 if not linked to a trade account
    if (!account) return NextResponse.json({ error: { message: "Login failed", code: "auth" } }, { status: 401 });
    const res = NextResponse.json({ data: { name: account.customerName } });
    res.cookies.set(SID_COOKIE, sid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 3,
    });
    return res;
  } catch (e) {
    return fail(e);
  }
}
