// Save Cart (Supabase) -> Resume -> Commit (ERPNext ticket).
import { supabaseAdmin } from "../supabase";
import { upsertCustomerWithAddress, type CustomerInput } from "../erpnext/customer";

export interface CartGarment { garmentId: string; garmentType: string; color?: string; total: number; }
export interface CartLine { garmentRef: string; preset: string; description: string; price: number; }
export interface CartPayload { garments: CartGarment[]; lines: CartLine[]; deliveryMethod?: "Pickup" | "Delivery"; isRush?: boolean; dueDate?: string | null; isTaxable?: boolean; taxTemplate?: string; }
export interface ParkedCart { id: string; location: string; label: string | null; customer_ref: string | null; customer_snapshot: Partial<CustomerInput>; cart: CartPayload; status: "parked" | "committed" | "abandoned"; updated_at: string; }

export async function saveCart(input: { id?: string; createdBy: string; location: string; customer: Partial<CustomerInput>; customerRef?: string | null; cart: CartPayload; }) {
  if (!supabaseAdmin) throw new Error("Supabase not configured");
  const row = { created_by: input.createdBy, location: input.location, label: input.customer.fullName ?? (input.customer as any).name ?? "Walk-in", customer_ref: input.customerRef ?? null, customer_snapshot: input.customer, cart: input.cart, status: "parked" as const };
  const q = input.id ? supabaseAdmin.from("parked_carts").update(row).eq("id", input.id).select().single() : supabaseAdmin.from("parked_carts").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as ParkedCart;
}

export async function listParkedCarts(location?: string) {
  if (!supabaseAdmin) throw new Error("Supabase not configured");
  let q = supabaseAdmin.from("parked_carts").select("*").eq("status", "parked").order("updated_at", { ascending: false });
  if (location) q = q.eq("location", location);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as ParkedCart[];
}

export async function getParkedCart(id: string) {
  if (!supabaseAdmin) throw new Error("Supabase not configured");
  const { data, error } = await supabaseAdmin.from("parked_carts").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as ParkedCart;
}

export async function deleteParkedCart(id: string) {
  if (!supabaseAdmin) throw new Error("Supabase not configured");
  const { error } = await supabaseAdmin.from("parked_carts").update({ status: "abandoned" }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function commitParkedCart(id: string) {
  const cart = await getParkedCart(id);
  let customerName = cart.customer_ref;
  if (!customerName) { const res = await upsertCustomerWithAddress(cart.customer_snapshot as CustomerInput); customerName = res.name; }
  const ERP_URL = process.env.ERPNEXT_BASE_URL ?? process.env.ERP_URL ?? "https://erp.lstailors.com";
  const today = new Date().toISOString().slice(0, 10);
  const ticketDoc = {
    customer: customerName, customer_name: cart.customer_snapshot.fullName ?? customerName,
    origin_location: cart.location, ticket_date: today, due_date: cart.cart.dueDate ?? null,
    is_rush: cart.cart.isRush ? 1 : 0, workflow_state: "Received", delivery_method: cart.cart.deliveryMethod ?? "Pickup", taxes_and_charges: "",
    garments: cart.cart.garments.map((g) => ({ garment_id: g.garmentId, garment_type: g.garmentType, color: g.color ?? "", garment_total: g.total, garment_status: "Received" })),
    lines: cart.cart.lines.map((l) => ({ garment_ref: l.garmentRef, preset: l.preset, description: l.description, price: l.price, line_status: "Pending" })),
  };
  const res = await fetch(`${ERP_URL}/api/resource/Alteration Ticket`, {
    method: "POST",
    headers: { Authorization: `token ${process.env.ERPNEXT_API_KEY ?? process.env.ERP_API_KEY}:${process.env.ERPNEXT_API_SECRET ?? process.env.ERP_API_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify(ticketDoc),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.exception || body?.message || `ERPNext ${res.status}`);
  const ticketName = body.data.name as string;
  if (!supabaseAdmin) throw new Error("Supabase not configured");
  await supabaseAdmin.from("parked_carts").update({ status: "committed", committed_ticket: ticketName }).eq("id", id);
  return { ticket: ticketName, customer: customerName };
}
