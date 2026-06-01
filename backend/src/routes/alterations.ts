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

interface ErpTicket {
  name: string;
  customer: string;
  customer_name: string | null;
  origin_location: string;
  workflow_state: string;
  ticket_date: string;
  due_date: string;
  ticket_total: number;
  payment_status: string | null;
  is_rush: 0 | 1;
  internal_notes: string | null;
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
    tailorId: null,
    tailor: null,
    dueDate: t.due_date ?? null,
    notes: t.internal_notes ?? null,
    createdById: "system",
    createdAt: t.creation ?? t.ticket_date,
    updatedAt: t.modified ?? t.ticket_date,
  };
}

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
    fields: [
      "name", "customer", "customer_name", "origin_location",
      "workflow_state", "ticket_date", "due_date", "ticket_total",
      "payment_status", "is_rush", "internal_notes", "modified", "creation",
    ],
    limit: 200,
    order_by: "modified desc",
  });

  return c.json({ data: tickets.map(serialize) });
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

alterationsRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  return c.json({ error: { message: "Update tickets via intake.lstailors.com" } }, 501);
});
