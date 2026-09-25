import "server-only";
import { NextResponse } from "next/server";
import { ErpError } from "./erp";
import { AuthError } from "./session";

export class UserError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const ok = <T>(data: T, init?: ResponseInit) => NextResponse.json({ data }, init);

export function fail(e: unknown) {
  if (e instanceof UserError)
    return NextResponse.json({ error: { message: e.message, code: e.code } }, { status: e.status });
  if (e instanceof AuthError)
    return NextResponse.json({ error: { message: e.message, code: "auth" } }, { status: e.status });
  if (e instanceof ErpError && (e.status === 401 || e.status === 403))
    return NextResponse.json({ error: { message: "Not permitted", code: "forbidden" } }, { status: 403 });
  console.error("[fabric-estimator]", e);
  return NextResponse.json(
    { error: { message: "Something went wrong reaching L&S. Please try again.", code: "server" } },
    { status: 502 },
  );
}
