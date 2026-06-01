import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet } from "../lib/erp";

export const alterationsRouter = new Hono();

// ERPNext workflow_state → app OrderStatus
function mapStatus(workflowState: string): string {
  switch (workflowState) {
    case "Received":    return "intake";
    case "In Progress": return "in_progress";
    case "Ready":       return "ready";
    case "Picked Up":   return "picked_up";
    case "Cancelled":   return "cancelled";
    default:            return "intake";
  }
}

type Transition = { action: string; next_state: string; label: string };

function getTransitions(state: string, isSalesManager: boolean): Transition[] {
  switch (state) {
    case "Received":
      return [
        { action: "start_work", next_state: "In Progress", label: "Start Work" },
        ...(isSalesManager ? [{ action: "cancel", next_state: "Cancelled", label: "Cancel" }] : []),
      ];
    case "In Progress":
      return [
        { action: "mark_ready", next_state: "Ready", label: "Mark Ready" },
        ...(isSalesManager ? [{ action: "cancel", next_state: "Cancelled", label: "Cancel" }] : []),
      ];
    case "Ready":
      return [
        { action: "mark_picked_up", next_state: "Picked Up", label: "Mark Picked Up" },
        ...(isSalesManager ? [{ action: "cancel", next_state: "Cancelled", label: "Cancel" }] : []),
      ];
    case "Picked Up":
      return [];
    case "Cancelled":
      return isSalesManager
        ? [{ action: "reopen", next_state: "Received", label: "Reopen" }]
        : [];
    default:
      return [];
  }
}

interface ErpTicket {
  name: string;
  customer: string;
  customer_name: string | null;
  origin_location: string;
  workflow_state: string;
  ticket_date: string;
  due_date: string | null;
  promised_date: string | null;
  ticket_total: number;
  payment_status: string | null;
  billing_status: string | null;
  is_rush: 0 | 1;
  internal_notes: string | null;
  customer_notes: string | null;
  sales_invoice: string | null;
  linked_sales_order: string | null;
  included_in_custom: 0 | 1 | null;
  delivery_method: string | null;
  notified_ready_at: string | null;
  picked_up_at: string | null;
  modified: string;
  creation: string;
  lines?: Array<{ description: string; price: number; garment_ref: string }>;
}

function serialize(t: ErpTicket) {
  const items = (t.lines ?? []).map((l) => ({
    label: l.description ?? "",
    price: l.price ?? 0,
  }));

  return {
    id: t.name,
    customerId: t.customer,
    customer: {
      id: t.customer,
      name: t.customer_name ?? t.customer,
      phone: "",
      email: null,
      locationId: t.origin_location,
      createdById: null,
      dossier: { vip: false, preferences: null },
      createdAt: t.creation ?? t.ticket_date,
      updatedAt: t.modified ?? t.ticket_date,
    },
    locationId: t.origin_location,
    items,
    price: t.ticket_total ?? 0,
    status: mapStatus(t.workflow_state),
    workflow_state: t.workflow_state,
    tailorId: null,
    tailor: null,
    ticketDate: t.ticket_date ?? null,
    dueDate: t.due_date ?? null,
    promisedDate: t.promised_date ?? null,
    isRush: t.is_rush === 1,
    billingStatus: t.billing_status ?? null,
    paymentStatus: t.payment_status ?? null,
    salesInvoice: t.sales_invoice ?? null,
    linkedSalesOrder: t.linked_sales_order ?? null,
    includedInCustom: t.included_in_custom === 1,
    deliveryMethod: t.delivery_method ?? null,
    notifiedReadyAt: t.notified_ready_at ?? null,
    pickedUpAt: t.picked_up_at ?? null,
    notes: t.internal_notes ?? null,
    customerNotes: t.customer_notes ?? null,
    createdById: "system",
    createdAt: t.creation ?? t.ticket_date,
    updatedAt: t.modified ?? t.ticket_date,
  };
}

const LIST_FIELDS = [
  "name", "customer", "customer_name", "origin_location",
  "workflow_state", "ticket_date", "due_date", "promised_date",
  "ticket_total", "payment_status", "billing_status",
  "is_rush", "internal_notes", "customer_notes",
  "sales_invoice", "linked_sales_order", "included_in_custom",
  "delivery_method", "notified_ready_at", "picked_up_at",
  "modified", "creation",
];

alterationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const locationCode = c.req.query("location") ?? user.locationCode;

  const filters: unknown[] = [["workflow_state", "!=", "Cancelled"]];
  if (locationCode && locationCode !== "ALL") {
    filters.push(["origin_location", "=", locationCode]);
  }

  const tickets = await erpList<ErpTicket>("Alteration Ticket", {
    filters,
    fields: LIST_FIELDS,
    limit: 200,
    order_by: "modified desc",
  });

  return c.json({ data: tickets.map(serialize) });
});

alterationsRouter.get("/:id/transitions", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const ticket = await erpGet<{ name: string; workflow_state: string }>(
    "Alteration Ticket",
    c.req.param("id")
  );
  if (!ticket) return c.json({ error: { message: "Not found" } }, 404);

  const isSalesManager = ["super_admin", "store_manager"].includes(user.role);
  const transitions = getTransitions(ticket.workflow_state, isSalesManager);
  return c.json({ data: transitions });
});

alterationsRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const ticket = await erpGet<ErpTicket>("Alteration Ticket", c.req.param("id"));
  if (!ticket) return c.json({ error: { message: "Not found" } }, 404);

  return c.json({ data: serialize(ticket) });
});

alterationsRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  return c.json({ error: { message: "Create tickets via intake.lstailors.com" } }, 501);
});

alterationsRouter.patch("/:id/state", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { action } = await c.req.json() as { action: string };
  const id = c.req.param("id");

  const base = process.env.ERPNEXT_BASE_URL ?? "";
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const secret = process.env.ERPNEXT_API_SECRET ?? "";

  const res = await fetch(`${base}/api/method/frappe.model.workflow.apply_workflow`, {
    method: "POST",
    headers: {
      Authorization: `token ${key}:${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      doc: JSON.stringify({ doctype: "Alteration Ticket", name: id }),
      action,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    return c.json(
      { error: { message: (err._server_messages as string) || "Workflow action failed" } },
      502
    );
  }

  const data = await res.json() as { message?: unknown };
  return c.json({ data: data.message ?? {} });
});

alterationsRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  return c.json({ error: { message: "Update tickets via intake.lstailors.com" } }, 501);
});
