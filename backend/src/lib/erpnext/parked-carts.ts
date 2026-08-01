import { erpList, erpGet, erpCreate, erpUpdate, erpRunMethod } from "../erp";
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
  /** Rich intake snapshot from IntakeStepped park — preferred on commit. */
  intake?: Record<string, unknown> | null;
  total?: number;
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

function billingFromIntake(intake: Record<string, unknown>): {
  billing_status?: string;
  included_in_custom?: number;
} {
  const billing = String(intake.billing || "billable");
  if (billing === "on_order") {
    return { billing_status: "Included in Custom Order", included_in_custom: 1 };
  }
  if (billing === "redo") {
    return { billing_status: "Warranty", included_in_custom: 0 };
  }
  return { billing_status: "Billable", included_in_custom: 0 };
}

/** Prefer rich IntakeStepped `cart.intake`; fall back to flattened cart garments/lines. */
function buildCreateTicketPayload(
  cart: ParkedCart,
  customerName: string,
): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const defaultDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const intake = cart.cart.intake && typeof cart.cart.intake === "object" ? cart.cart.intake : null;

  if (intake && (Array.isArray(intake.garments) || Array.isArray(intake.sellItems))) {
    const origin =
      intake.origin === "HOU" || intake.origin === "NYC"
        ? intake.origin
        : cart.location || "NYC";
    const promiseDate =
      (typeof intake.promiseDate === "string" && intake.promiseDate) ||
      cart.cart.dueDate ||
      defaultDue;
    const isRush = Boolean(intake.isRush ?? cart.cart.isRush);
    const billing = billingFromIntake(intake);
    const garments = (Array.isArray(intake.garments) ? intake.garments : []).map((g: any) => ({
      garment_type: g.garmentType || g.garment_type || "Garment",
      garment_description: g.description || g.garmentType || g.garment_type || "",
      color: g.color ?? "",
      fabric_notes: g.notes || "",
    }));
    // Rebuild G1/G2 refs in order so lines map correctly when intake used local refs
    const lines: Array<Record<string, unknown>> = [];
    (Array.isArray(intake.garments) ? intake.garments : []).forEach((g: any, gi: number) => {
      const ref = `G${gi + 1}`;
      for (const l of g.lines || []) {
        lines.push({
          garment_ref: ref,
          preset: l.presetId || l.preset || null,
          description: l.description,
          price: Number(l.price) || 0,
          line_notes: l.notes || undefined,
        });
      }
    });
    // Sell-only carts: create_ticket still needs at least a placeholder garment unless
    // HTTP intake path handles items-only — keep a synthetic garment for ERP create.
    if (garments.length === 0 && Array.isArray(intake.sellItems) && intake.sellItems.length) {
      garments.push({
        garment_type: "Item",
        garment_description: "Retail / sell items",
        color: "",
        fabric_notes: "",
      });
    }

    const payload: Record<string, unknown> = {
      customer: customerName,
      origin_location: origin,
      ticket_date: today,
      due_date: promiseDate,
      promised_date: promiseDate,
      is_rush: isRush ? 1 : 0,
      taxes_and_charges: "",
      garments,
      lines,
      ...billing,
    };
    if (typeof intake.linkedSo === "string" && intake.linkedSo) {
      payload.linked_sales_order = intake.linkedSo;
    }
    const note = typeof intake.parkNote === "string" ? intake.parkNote.trim() : "";
    const ticketNote = typeof intake.ticketNote === "string" ? intake.ticketNote.trim() : "";
    const noteKind = intake.ticketNoteKind === "customer" ? "customer" : "internal";
    const combined = [ticketNote, note].filter(Boolean).join("\n");
    if (combined) {
      if (noteKind === "customer") payload.customer_notes = combined;
      else payload.internal_notes = combined;
    }
    return payload;
  }

  // Legacy flattened cart (pre-intake park shape)
  return {
    customer: customerName,
    origin_location: cart.location || "NYC",
    ticket_date: today,
    due_date: cart.cart.dueDate ?? defaultDue,
    is_rush: cart.cart.isRush ? 1 : 0,
    taxes_and_charges: "",
    garments: cart.cart.garments.map((g) => ({
      garment_type: g.garmentType,
      garment_description: g.garmentType,
      color: g.color ?? "",
    })),
    lines: cart.cart.lines.map((l) => ({
      garment_ref: l.garmentRef,
      preset: l.preset || null,
      description: l.description,
      price: l.price,
    })),
  };
}

export async function commitParkedCart(id: string): Promise<{ ticket: string; customer: string }> {
  const cart = await getParkedCart(id);
  let customerName = cart.customer_ref;
  if (!customerName) {
    const res = await upsertCustomerWithAddress(cart.customer_snapshot as CustomerInput);
    customerName = res.name;
  }

  // Same door as intake: ls_alterations.api.create_ticket (HER-14 / D3).
  // Do NOT raw-POST Alteration Ticket — that bypasses naming series, garment_id
  // assignment, and server-side ticket shape.
  const payload = buildCreateTicketPayload(cart, customerName!);

  const result = (await erpRunMethod("ls_alterations.api.create_ticket", {
    payload: JSON.stringify(payload),
  })) as unknown;

  const ticketName: string | undefined =
    typeof result === "string"
      ? result
      : (result as any)?.name ??
        (result as any)?.ticket_name ??
        (result as any)?.docname ??
        (result as any)?.ticket;

  if (!ticketName) {
    throw new Error(
      `create_ticket returned unexpected shape: ${JSON.stringify(result)}`,
    );
  }

  // Fields create_ticket does not set — patch after (mirrors intake belt-and-suspenders).
  const patch: Record<string, unknown> = { taxes_and_charges: "" };
  if (cart.cart.deliveryMethod) patch.delivery_method = cart.cart.deliveryMethod;
  const intake = cart.cart.intake;
  if (intake && typeof intake === "object") {
    if (typeof intake.promiseTime === "string" && intake.promiseTime) {
      patch.due_time = intake.promiseTime;
    }
    if (intake.billing === "on_order") {
      patch.billing_status = "Included in Custom Order";
      patch.included_in_custom = 1;
    } else if (intake.billing === "redo") {
      patch.billing_status = "Warranty";
      patch.included_in_custom = 0;
    }
    if (typeof intake.linkedSo === "string" && intake.linkedSo) {
      patch.linked_sales_order = intake.linkedSo;
    }
  }
  try {
    await erpUpdate("Alteration Ticket", ticketName, patch);
  } catch {
    /* non-fatal — ticket already exists */
  }

  await erpUpdate(DT.PARKED_CART, id, {
    status: "Committed",
    committed_ticket: ticketName,
  });

  return { ticket: ticketName, customer: customerName! };
}
