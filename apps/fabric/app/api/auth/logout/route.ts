import { NextResponse } from "next/server";
import { erpLogout } from "@/lib/erp";
import { SID_COOKIE, forgetSid, sessionSid } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const sid = sessionSid();
  if (sid) {
    forgetSid(sid);
    await erpLogout(sid);
  }
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(SID_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
