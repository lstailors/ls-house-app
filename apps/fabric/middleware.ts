// Cheap cookie-presence gate for pages; every API route re-validates the session with ERPNext.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const has = !!req.cookies.get("lsfe_sid")?.value;
  const { pathname } = req.nextUrl;
  if (!has && pathname !== "/login") return NextResponse.redirect(new URL("/login", req.url));
  if (pathname === "/") return NextResponse.redirect(new URL(has ? "/estimate" : "/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/", "/estimate", "/quotes/:path*"] };
