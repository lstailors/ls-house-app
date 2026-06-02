"use server";
// lib/cart/cart-actions.ts
import { saveCart, listParkedCarts, getParkedCart, deleteParkedCart, commitParkedCart, type CartPayload, type ParkedCart } from "@/lib/cart/parked";
import type { CustomerInput } from "@/lib/erpnext/customer";

export async function saveCartAction(input: { id?: string; createdBy: string; location: string; customer: Partial<CustomerInput>; customerRef?: string | null; cart: CartPayload; }): Promise<ParkedCart> { return saveCart(input); }
export async function listParkedCartsAction(location?: string): Promise<ParkedCart[]> { return listParkedCarts(location); }
export async function resumeCartAction(id: string): Promise<ParkedCart> { return getParkedCart(id); }
export async function commitCartAction(id: string): Promise<{ ticket: string; customer: string }> { return commitParkedCart(id); }
export async function abandonCartAction(id: string): Promise<void> { return deleteParkedCart(id); }
