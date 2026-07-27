import { erpList, erpGet, erpCreate, erpUpdate } from "../erp";
import { upsertCustomerWithAddress, type CustomerInput } from "./customer";
import { DT } from "./doctypes";

export interface CartGarment { garmentId: string; garmentType: string; color?: string; total: number; }
export interface CartLine { garmentRef: string; preset: string; description: string; price: number; }
export interface CartPayload {
  garments: CartGarment[];
  lines: CartLine[];
  deliveryMethod?: "Pickup" | "Delivery";
  isRush?: boolean;
  dueDate?: string | null;
  isTaxable?: boolean;
  taxTemplate?: string;
}

export interface ParkedCart {
  id: string;
  location: string;
  label: string | null;
  customer_ref: string | null;
  customer_snapshot: Partial<CustomerInput>;
  cart: CartPayload;
  status: "parked" | "committed" | "abandoned";
  updated_at: string;
}

function rowToCart(row: any): ParkedCart {
  let cart: CartPayload = { garments: [], lines: [] };
  try {
    cart = typeof row.cart_json === "string" ? JSON.parse(row.cart_json) : (row.cart_json ?? cart);
  } catch { /* keep default */ }
  let snapshot: Partial<CustomerInput> = {};
  try {
    snapshot = typeof row.customer_snapshot === "string"
      ? JSON.parse(row.customer_snapshot)
      : (row.customer_snapshot ?? {});
  } catch { /* keep default */ }

  return {
    id: row.name,
    location: row.location ?? "",
    label: row.label ?? null,
    customer_ref: row.customer_ref ?? null,
    customer_snapshot: snapshot,
    cart,
    status: (row.status ?? "parked").toLowerCase() as ParkedCart["status"],
    updated_at: row.modified ?? row.creation ?? new Date().toISOString(),
  };
}

export async function saveCart(input: {
  id?: string;
  createdBy: string;
  location: string;
  customer: Partial<CustomerInput>;
  customerRef?: string | null;
  cart: CartPayload;
}): Promise<ParkedCart> {
  const doc = {
    location: input.location,
    created_by: input.createdBy,
    label: input.customer.fullName ?? (input.customer as any).name ?? "Walk-in",
    customer_ref: input.customerRef ?? null,
    customer_snapshot: JSON.stringify(input.customer),
    cart_json: JSON.stringify(input.cart),
    status: "Parked",
  };

  if (input.id) {
    const updated = await erpUpdate<any>(DT.PARKED_CART, input.id, doc);
    if (!updated) throw new Error("Failed to update cart");
    return rowToCart(updated);
  }

  const created = await erpCreate<any>(DT.PARKED_CART, doc);
  if (!created) throw new Error("Failed to save cart");
  return rowToCart(created);
}

export async function listParkedCarts(location?: string): Promise<ParkedCart[]> {
  const filters: unknown[] = [["status", "=", "Parked"]];
  if (location) filters.push(["location", "=", location]);
  const rows = await erpList<any>(DT.PARKED_CART, {
    filters,
    fields: ["name", "location", "label", "customer_ref", "customer_snapshot", "cart_json", "status", "creation", "modified"],
    order_by: "modified desc",
    limit: 100,
  });
  return rows.map(rowToCart);
}

export async function getParkedCart(id: string): Promise<ParkedCart> {
  const row = await erpGet<any>(DT.PARKED_CART, id);
  if (!row) throw new Error("Cart not found");
  return rowToCart(row);
}

export async function deleteParkedCart(id: string): Promise<void> {
  await erpUpdate(DT.PARKED_CART, id, { status: "Abandoned" });
}

export async function commitParkedCart(id: string): Promise<{ ticket: string; customer: string }> {
  const cart = await getParkedCart(id);
  let customerName = cart.customer_ref;
  if (!customerName) {
    const res = await upsertCustomerWithAddress(cart.customer_snapshot as CustomerInput);
    customerName = res.name;
  }

  const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? "https://erp.lstailors.com";
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const sec = process.env.ERPNEXT_API_SECRET ?? "";
  const today = new Date().toISOString().slice(0, 10);

  const ticketDoc = {
    customer: customerName,
    customer_name: cart.customer_snapshot.fullName ?? customerName,
    origin_location: cart.location,
    ticket_date: today,
    due_date: cart.cart.dueDate ?? null,
    is_rush: cart.cart.isRush ? 1 : 0,
    workflow_state: "Received",
    delivery_method: cart.cart.deliveryMethod ?? "Pickup",
    taxes_and_charges: "",
    garments: cart.cart.garments.map((g) => ({
      garment_id: g.garmentId,
      garment_type: g.garmentType,
      color: g.color ?? "",
      garment_total: g.total,
      garment_status: "Received",
    })),
    lines: cart.cart.lines.map((l) => ({
      garment_ref: l.garmentRef,
      preset: l.preset,
      description: l.description,
      price: l.price,
      line_status: "Pending",
    })),
  };

  const res = await fetch(`${ERP_BASE}/api/resource/Alteration Ticket`, {
    method: "POST",
    headers: {
      Authorization: `token ${key}:${sec}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(ticketDoc),
  });
  const body = await res.json() as any;
  if (!res.ok) throw new Error(body?.exception || body?.message || `ERPNext ${res.status}`);
  const ticketName = body.data.name as string;

  await erpUpdate(DT.PARKED_CART, id, {
    status: "Committed",
    committed_ticket: ticketName,
  });

  return { ticket: ticketName, customer: customerName };
}
