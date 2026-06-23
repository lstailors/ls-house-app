// Legacy scaffold path — cart CRUD lives in backend /api/carts (ERPNext LSH Parked Cart).
import type { CustomerInput } from "../erpnext/customer";

export interface CartGarment { garmentId: string; garmentType: string; color?: string; total: number; }
export interface CartLine { garmentRef: string; preset: string; description: string; price: number; }
export interface CartPayload {
  garments: CartGarment[];
  lines: CartLine[];
  deliveryMethod?: "Pickup" | "Delivery";
  isRush?: boolean;
  dueDate?: string | null;
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

const msg = "Use backend /api/carts — Supabase removed.";
export async function saveCart(): Promise<ParkedCart> { throw new Error(msg); }
export async function listParkedCarts(): Promise<ParkedCart[]> { throw new Error(msg); }
export async function getParkedCart(): Promise<ParkedCart> { throw new Error(msg); }
export async function deleteParkedCart(): Promise<void> { throw new Error(msg); }
export async function commitParkedCart(): Promise<{ ticket: string; customer: string }> { throw new Error(msg); }
