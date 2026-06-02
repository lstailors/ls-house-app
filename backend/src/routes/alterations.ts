import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet } from "../lib/erp";
import { sendSms } from "../lib/twilio";

async function callGrok(prompt: string): Promise<string> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) return "Grok API not configured."
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-3-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.4,
    }),
  })
  if (!res.ok) return "Unable to generate brief."
  const data = await res.json() as any
  return data.choices?.[0]?.message?.content ?? "No brief available."
}

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

// GET /api/alterations/:ticketId/garments/:garmentId
alterationsRouter.get("/:ticketId/garments/:garmentId", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const ticket = await erpGet<ErpTicket & {
    garments: Array<{
      name: string; garment_id: string; garment_type: string;
      garment_description: string; color: string; fabric_notes: string;
      garment_status: string; garment_total: number;
    }>;
    lines: Array<{ name: string; garment_ref: string; description: string; price: number; line_status: string }>;
  }>("Alteration Ticket", c.req.param("ticketId"));

  if (!ticket) return c.json({ error: { message: "Not found" } }, 404);

  const garment = ticket.garments?.find((g) => g.garment_id === c.req.param("garmentId"));
  if (!garment) return c.json({ error: { message: "Garment not found" } }, 404);

  const lines = ticket.lines?.filter((l) => l.garment_ref === garment.garment_id) ?? [];

  return c.json({
    data: {
      garment,
      lines,
      ticket: {
        name: ticket.name,
        customer: ticket.customer,
        customerName: ticket.customer_name,
        originLocation: ticket.origin_location,
        workflowState: ticket.workflow_state,
        promisedDate: ticket.promised_date,
        dueDate: ticket.due_date,
      },
    },
  });
});

// PATCH /api/alterations/:ticketId/garments/:garmentId — update status/notes
alterationsRouter.patch("/:ticketId/garments/:garmentId/status", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { garment_status } = await c.req.json() as { garment_status: string };
  const ticketId = c.req.param("ticketId");
  const garmentId = c.req.param("garmentId");

  const { base, key, secret } = {
    base: process.env.ERPNEXT_BASE_URL ?? "",
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };

  // Fetch ticket, update the garment row, and save
  const res = await fetch(`${base}/api/resource/Alteration%20Ticket/${encodeURIComponent(ticketId)}`, {
    headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" },
  });
  if (!res.ok) return c.json({ error: { message: "Ticket not found" } }, 404);

  const { data: ticket } = await res.json() as { data: any };
  const garment = ticket.garments?.find((g: any) => g.garment_id === garmentId);
  if (!garment) return c.json({ error: { message: "Garment not found" } }, 404);

  garment.garment_status = garment_status;

  const saveRes = await fetch(`${base}/api/resource/Alteration%20Ticket/${encodeURIComponent(ticketId)}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${key}:${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(ticket),
  });

  if (!saveRes.ok) {
    const err = await saveRes.json().catch(() => ({})) as any;
    return c.json({ error: { message: err._server_messages || "Save failed" } }, 502);
  }

  return c.json({ data: { garment_id: garmentId, garment_status } });
});

// GET /api/alterations/kpis
alterationsRouter.get("/kpis", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const locationId = c.req.query("locationId");
  const locCode = locationId ?? user.locationCode;
  const today = new Date().toISOString().slice(0, 10);

  const locFilter = (locCode && locCode !== "ALL")
    ? [["origin_location", "=", locCode]]
    : [];

  const notDone = ["Picked Up", "Cancelled"];
  const notDoneFilter = notDone.map(s => ["workflow_state", "!=", s]);

  const [active, dueToday, overdue, rush, unassigned, stellaWip, hugoWip, readyForPickup] = await Promise.all([
    erpList("Alteration Ticket", {
      filters: [...locFilter, ["workflow_state", "in", ["Received", "In Progress"]]],
      fields: ["name"], limit: 500,
    }),
    erpList("Alteration Ticket", {
      filters: [...locFilter, ...notDoneFilter, ["due_date", "=", today]],
      fields: ["name"], limit: 500,
    }),
    erpList("Alteration Ticket", {
      filters: [...locFilter, ["workflow_state", "not in", ["Picked Up", "Ready", "Cancelled"]], ["due_date", "<", today]],
      fields: ["name"], limit: 500,
    }),
    erpList("Alteration Ticket", {
      filters: [...locFilter, ...notDoneFilter, ["is_rush", "=", 1]],
      fields: ["name"], limit: 500,
    }),
    erpList("Alteration Ticket", {
      filters: [...locFilter, ...notDoneFilter, ["assigned_tailor", "=", ""]],
      fields: ["name"], limit: 500,
    }),
    erpList("Alteration Ticket", {
      filters: [...locFilter, ["assigned_tailor", "=", "HR-EMP-00020"], ["workflow_state", "=", "In Progress"]],
      fields: ["name"], limit: 500,
    }),
    erpList("Alteration Ticket", {
      filters: [...locFilter, ["assigned_tailor", "=", "HR-EMP-00021"], ["workflow_state", "=", "In Progress"]],
      fields: ["name"], limit: 500,
    }),
    erpList("Alteration Ticket", {
      filters: [...locFilter, ["workflow_state", "=", "Ready"]],
      fields: ["name"], limit: 500,
    }),
  ]);

  return c.json({ data: {
    active: active.length,
    dueToday: dueToday.length,
    overdue: overdue.length,
    rush: rush.length,
    unassigned: unassigned.length,
    stellaWip: stellaWip.length,
    hugoWip: hugoWip.length,
    readyForPickup: readyForPickup.length,
  }});
});

// POST /api/alterations/brief
alterationsRouter.post("/brief", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json() as {
    period: "morning" | "midday" | "eod";
    kpis: {
      active: number; dueToday: number; overdue: number; rush: number;
      unassigned: number; stellaWip: number; hugoWip: number; readyForPickup: number;
    };
  };

  const periodLabel = body.period === "morning" ? "Morning" : body.period === "midday" ? "Midday" : "EOD";
  const k = body.kpis;

  const prompt = `You are the production manager at L&S Custom Tailors, a luxury bespoke tailoring house in NYC.
Time of day: ${periodLabel}
Analyze today's alteration workload and give a concise brief (4-6 sentences max):
- Tickets due today: ${k.dueToday}
- Overdue: ${k.overdue}
- Rush: ${k.rush}
- Unassigned: ${k.unassigned}
- Stella has ${k.stellaWip} pieces, Hugo has ${k.hugoWip} pieces
- Ready for pickup: ${k.readyForPickup}
Flag any risks. Suggest prioritization. Tone: direct, professional, no fluff.`;

  const brief = await callGrok(prompt);

  return c.json({ data: { brief, period: body.period, generatedAt: new Date().toISOString() } });
});

// ERPNext Server Script calls this when all garments are Ready
alterationsRouter.post("/erp-webhook/ready", async (c) => {
  const secret = process.env.ERP_WEBHOOK_SECRET;
  if (secret && c.req.header("x-webhook-secret") !== secret) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const body = await c.req.json() as {
    ticket: string;
    customer_name: string;
    customer_phone: string;
    origin_location: string;
    garment_count: number;
    delivery_method?: string;
  };

  if (!body.customer_phone) {
    return c.json({ error: { message: "No customer phone" } }, 400);
  }

  const store = body.origin_location === "HOU" ? "Houston" : "New York";
  const message = `Hi ${body.customer_name || "there"}, your alteration${body.garment_count !== 1 ? "s are" : " is"} ready for pickup at our ${store} location! Reply or call us with any questions. — L&S Custom Tailors`;

  await sendSms(body.customer_phone, message);

  return c.json({ data: { sent: true, ticket: body.ticket } });
});
