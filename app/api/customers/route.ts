// app/api/customers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { upsertCustomerWithAddress, type CustomerInput } from "@/lib/erpnext/customer";

function parseBody(raw: any): CustomerInput {
  return {
    name: raw.name ?? raw.erpnextName ?? undefined,
    fullName: raw.fullName ?? raw.customerName ?? raw.name_display ?? "",
    firstName: raw.firstName,
    lastName: raw.lastName,
    phone: raw.phone ?? raw.mobile,
    email: raw.email,
    notes: raw.notes,
    customerGroup: raw.customerGroup,
    territory: raw.territory,
    address: raw.address ?? {
      line1: raw.streetLine1, line2: raw.streetLine2, city: raw.city,
      state: raw.state, zip: raw.zip, country: raw.country,
    },
  };
}

async function handle(req: NextRequest) {
  let input: CustomerInput;
  try { input = parseBody(await req.json()); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!input.fullName?.trim()) return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
  try {
    const result = await upsertCustomerWithAddress(input);
    return NextResponse.json({ ok: true, customer: result.name });
  } catch (e: any) {
    const status = e?.status && e.status >= 400 && e.status < 500 ? 422 : 500;
    console.error("[customers] upsert failed:", e?.message, e);
    return NextResponse.json({ error: e?.message ?? "Failed to save customer" }, { status });
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function PUT(req: NextRequest) { return handle(req); }
