import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet, erpCreate, erpUpdate, erpRunMethod } from "../lib/erp";
import { sendSms } from "../lib/twilio";
import { CompleteGarmentRequest } from "../types";

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
  assigned_tailor: string | null;
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
    tailorId: t.assigned_tailor ?? null,
    tailor: t.assigned_tailor ? { id: t.assigned_tailor, name: t.assigned_tailor } : null,
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

// NOTE: "lines" is deliberately NOT in this list. ERPNext's generic list
// endpoint (/api/resource/<doctype>) does not expand Table (child-table)
// fields — asking for "lines" here silently returns [] for every row, which
// is why the Alterations list previously showed "0 items" on every ticket
// despite valid data existing. Child rows are fetched separately in bulk
// via fetchLinesByTicket() below (same pattern alterations-board.ts already
// uses for garments) and merged onto each ticket before serialize().
const LIST_FIELDS = [
  "name", "customer", "customer_name", "origin_location",
  "workflow_state", "ticket_date", "due_date", "promised_date",
  "ticket_total", "payment_status", "billing_status",
  "is_rush", "internal_notes", "customer_notes",
  "sales_invoice", "linked_sales_order", "included_in_custom",
  "delivery_method", "notified_ready_at", "picked_up_at",
  "modified", "creation", "assigned_tailor",
];

// Batch-fetch Alteration Ticket Line child rows for a set of ticket names in
// one call, keyed by parent. Mirrors loadAlterationRows()'s garment fetch in
// alterations-data.ts — the generic child-table doctype ("Alteration Ticket
// Line") is queryable directly with a `parent in [...]` filter.
async function fetchLinesByTicket(
  ticketNames: string[],
): Promise<Map<string, Array<{ description: string; price: number; garment_ref: string }>>> {
  const byTicket = new Map<string, Array<{ description: string; price: number; garment_ref: string }>>();
  if (!ticketNames.length) return byTicket;

  // `parent` query param is required — without it Frappe returns only `name`
  // on child doctypes and every ticket looks like "0 items".
  const lines = await erpList<{ parent: string; description: string; price: number; garment_ref: string }>(
    "Alteration Ticket Line",
    {
      parent: "Alteration Ticket",
      filters: [["parent", "in", ticketNames]],
      fields: ["parent", "description", "price", "garment_ref"],
      limit: 2000,
    },
  ).catch(() => []);

  for (const l of lines) {
    const arr = byTicket.get(l.parent) ?? [];
    arr.push({ description: l.description, price: l.price, garment_ref: l.garment_ref });
    byTicket.set(l.parent, arr);
  }
  return byTicket;
}

// GET /api/alterations/kpis — must be before /:id
alterationsRouter.get("/kpis", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const locationId = c.req.query("locationId");
  const locCode = locationId ?? user.locationCode;
  const today = new Date().toISOString().slice(0, 10);

  const locFilter: unknown[] = (locCode && locCode !== "ALL")
    ? [["origin_location", "=", locCode]]
    : [];

  const notDoneFilter: unknown[] = [["workflow_state", "not in", ["Picked Up", "Cancelled"]]];

  // Tailor WIP: look up Active Tailor/Master Tailor employees (same SoT as /transfers/tailors + /garment/workers)
  const tailors = await erpList<{ name: string; employee_name: string }>("Employee", {
    filters: [
      ["status", "=", "Active"],
      ["designation", "in", ["Tailor", "Master Tailor"]],
    ],
    fields: ["name", "employee_name"],
    limit: 50,
  }).catch(() => [] as Array<{ name: string; employee_name: string }>);

  const [active, dueToday, overdue, rush, unassigned, readyForPickup, ...tailorWipLists] = await Promise.all([
    erpList("Alteration Ticket", { filters: [...locFilter, ["workflow_state", "in", ["Received", "In Progress"]]], fields: ["name"], limit: 500 }).catch(() => []),
    erpList("Alteration Ticket", { filters: [...locFilter, ...notDoneFilter, ["due_date", "=", today]], fields: ["name"], limit: 500 }).catch(() => []),
    erpList("Alteration Ticket", { filters: [...locFilter, ["workflow_state", "not in", ["Picked Up", "Ready", "Cancelled"]], ["due_date", "<", today]], fields: ["name"], limit: 500 }).catch(() => []),
    erpList("Alteration Ticket", { filters: [...locFilter, ...notDoneFilter, ["is_rush", "=", 1]], fields: ["name"], limit: 500 }).catch(() => []),
    erpList("Alteration Ticket", { filters: [...locFilter, ...notDoneFilter, ["assigned_tailor", "in", ["", null]]], fields: ["name"], limit: 500 }).catch(() => []),
    erpList("Alteration Ticket", { filters: [...locFilter, ["workflow_state", "=", "Ready"]], fields: ["name"], limit: 500 }).catch(() => []),
    ...tailors.map((t) =>
      erpList("Alteration Ticket", {
        filters: [...locFilter, ["assigned_tailor", "=", t.name], ["workflow_state", "=", "In Progress"]],
        fields: ["name"],
        limit: 500,
      }).catch(() => []),
    ),
  ]);

  // Keep legacy stellaWip/hugoWip keys for any UI still reading them; prefer tailorWip[]
  const byName = (want: string) => {
    const idx = tailors.findIndex((t) => (t.employee_name || "").toLowerCase() === want);
    if (idx < 0) return 0;
    return (tailorWipLists[idx] as unknown[] | undefined)?.length ?? 0;
  };

  const tailorWip = tailors.map((t, i) => ({
    id: t.name,
    name: t.employee_name || t.name,
    wip: (tailorWipLists[i] as unknown[] | undefined)?.length ?? 0,
  }));

  return c.json({ data: {
    active: active.length,
    dueToday: dueToday.length,
    overdue: overdue.length,
    rush: rush.length,
    unassigned: unassigned.length,
    stellaWip: byName("stella"),
    hugoWip: byName("hugo"),
    readyForPickup: readyForPickup.length,
    tailorWip,
  }});
});

// POST /api/alterations/brief — must be before /:id
alterationsRouter.post("/brief", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json() as {
    period: "morning" | "midday" | "eod";
    kpis: { active: number; dueToday: number; overdue: number; rush: number; unassigned: number; stellaWip: number; hugoWip: number; readyForPickup: number };
  };

  const periodLabel = body.period === "morning" ? "Morning" : body.period === "midday" ? "Midday" : "EOD";
  const k = body.kpis;
  const prompt = `You are the production manager at L&S Custom Tailors, a luxury bespoke tailoring house in NYC.\nTime of day: ${periodLabel}\nAnalyze today's alteration workload and give a concise brief (4-6 sentences max):\n- Tickets due today: ${k.dueToday}\n- Overdue: ${k.overdue}\n- Rush: ${k.rush}\n- Unassigned: ${k.unassigned}\n- Stella has ${k.stellaWip} pieces, Hugo has ${k.hugoWip} pieces\n- Ready for pickup: ${k.readyForPickup}\nFlag any risks. Suggest prioritization. Tone: direct, professional, no fluff.`;

  const brief = await callGrok(prompt);
  return c.json({ data: { brief, period: body.period, generatedAt: new Date().toISOString() } });
});

// POST /api/alterations/complete-garment — thin proxy to the ERPNext
// `complete_garment` method. ALL completion logic (start work if still
// Received, mark the garment Ready, fire the pickup SMS once every garment is
// Ready) lives in ERPNext — this route only validates input, forwards with the
// server-side ERP credentials, and relays ERP's result (or its error message).
// Must be registered before "/:id" so the literal path wins.
alterationsRouter.post("/complete-garment", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const parsed = CompleteGarmentRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: { message: parsed.error.issues[0]?.message ?? "Invalid request" } },
      400,
    );
  }

  const { ticket, garment_id, worker, actual_minutes } = parsed.data;

  try {
    const result = await erpRunMethod("complete_garment", {
      ticket,
      garment_id,
      worker,
      ...(actual_minutes != null ? { actual_minutes } : {}),
    });
    return c.json({ data: result });
  } catch (e: any) {
    // erpRunMethod throws with the Frappe error message (e.g. "Garment G2 not
    // found on ALT-..."). Surface it verbatim so staff see what went wrong.
    return c.json({ error: { message: e?.message || "Failed to complete garment" } }, 502);
  }
});

alterationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const locationCode = c.req.query("location") ?? user.locationCode;
  const filterCustomer = c.req.query("customer"); // ERPNext customer ID
  const limitParam = parseInt(c.req.query("limit") ?? "200");
  const limit = Math.min(isNaN(limitParam) ? 200 : limitParam, 500);

  const filters: unknown[] = [["workflow_state", "!=", "Cancelled"]];
  if (locationCode && locationCode !== "ALL" && !filterCustomer) {
    filters.push(["origin_location", "=", locationCode]);
  }
  if (filterCustomer) {
    filters.push(["customer", "=", filterCustomer]);
  }

  const tickets = await erpList<ErpTicket>("Alteration Ticket", {
    filters,
    fields: LIST_FIELDS,
    limit,
    order_by: "modified desc",
  });

  const linesByTicket = await fetchLinesByTicket(tickets.map((t) => t.name));
  const withLines = tickets.map((t) => ({ ...t, lines: linesByTicket.get(t.name) ?? [] }));

  return c.json({ data: withLines.map(serialize) });
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

  const body = await c.req.json() as {
    customer: string;
    due_date?: string | null;
    promised_date?: string | null;
    origin_location?: string;
    is_rush?: boolean;
    internal_notes?: string | null;
    customer_notes?: string | null;
    delivery_method?: string | null;
    assigned_tailor?: string | null;
    lines?: Array<{ description: string; price: number; garment_ref?: string }>;
  };

  if (!body.customer) {
    return c.json({ error: { message: "customer is required" } }, 400);
  }

  const doc: Record<string, unknown> = {
    customer: body.customer,
    origin_location: body.origin_location ?? user.locationCode ?? "",
    ticket_date: new Date().toISOString().slice(0, 10),
  };
  if (body.due_date != null)       doc.due_date = body.due_date;
  if (body.promised_date != null)  doc.promised_date = body.promised_date;
  if (body.is_rush != null)        doc.is_rush = body.is_rush ? 1 : 0;
  if (body.internal_notes != null) doc.internal_notes = body.internal_notes;
  if (body.customer_notes != null) doc.customer_notes = body.customer_notes;
  if (body.delivery_method != null) doc.delivery_method = body.delivery_method;
  if (body.assigned_tailor != null) doc.assigned_tailor = body.assigned_tailor;
  if (body.lines?.length)          doc.lines = body.lines;

  const created = await erpCreate<ErpTicket>("Alteration Ticket", doc);
  if (!created) {
    return c.json({ error: { message: "Failed to create ticket in ERPNext" } }, 502);
  }

  return c.json({ data: serialize(created) }, 201);
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

  const id = c.req.param("id");
  const body = await c.req.json() as {
    dueDate?: string | null;
    promisedDate?: string | null;
    isRush?: boolean;
    internalNotes?: string | null;
    customerNotes?: string | null;
    deliveryMethod?: string | null;
    tailorId?: string | null;
  };

  const { base, key, secret } = {
    base: process.env.ERPNEXT_BASE_URL ?? "",
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };

  // Build only the fields that were provided
  const updates: Record<string, unknown> = {};
  if (body.dueDate !== undefined)      updates.due_date = body.dueDate ?? null;
  if (body.promisedDate !== undefined) updates.promised_date = body.promisedDate ?? null;
  if (body.isRush !== undefined)       updates.is_rush = body.isRush ? 1 : 0;
  if (body.internalNotes !== undefined) updates.internal_notes = body.internalNotes ?? "";
  if (body.customerNotes !== undefined) updates.customer_notes = body.customerNotes ?? "";
  if (body.deliveryMethod !== undefined) updates.delivery_method = body.deliveryMethod ?? "";
  if (body.tailorId !== undefined) updates.assigned_tailor = body.tailorId ?? "";

  if (Object.keys(updates).length === 0) {
    return c.json({ error: { message: "No fields to update" } }, 400);
  }

  const res = await fetch(
    `${base}/api/resource/Alteration%20Ticket/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { Authorization: `token ${key}:${secret}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(updates),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    return c.json({ error: { message: err._server_messages || err.exception || "Update failed" } }, 502);
  }

  const data = await res.json() as { data: unknown };
  return c.json({ data: data.data ?? {} });
});

// PATCH /api/alterations/:id/full — replace garments + lines child tables
alterationsRouter.patch("/:id/full", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const body = await c.req.json() as {
    garments: Array<{
      garment_id: string;
      garment_type: string;
      garment_description: string;
      color?: string;
      fabric_notes?: string;
      garment_status?: string;
    }>;
    lines: Array<{
      garment_ref: string;
      description: string;
      price: number;
      preset?: string | null;
      line_notes?: string | null;
      notes?: string | null;
      estimated_minutes?: number | null;
      est_minutes?: number | null;
      line_status?: string | null;
      tailor?: string | null;
      line_photos?: string | null;
      client_line_key?: string | null;
      name?: string;
    }>;
  };

  const { base, key, secret } = {
    base: process.env.ERPNEXT_BASE_URL ?? "",
    key: process.env.ERPNEXT_API_KEY ?? "",
    secret: process.env.ERPNEXT_API_SECRET ?? "",
  };

  // Load existing ticket so we can preserve line metadata the drawer didn't send
  // and keep garment_status / line_photos when rows are recreated.
  let existing: any = null;
  try {
    const getRes = await fetch(
      `${base}/api/resource/Alteration%20Ticket/${encodeURIComponent(id)}`,
      { headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" } },
    );
    if (getRes.ok) {
      const got = await getRes.json() as { data: any };
      existing = got.data;
    }
  } catch { /* continue with body-only */ }

  const prevLines: any[] = Array.isArray(existing?.lines) ? existing.lines : [];
  const prevGarments: any[] = Array.isArray(existing?.garments) ? existing.garments : [];

  function matchPrevLine(l: (typeof body.lines)[number]): any | null {
    if (l.name) {
      const byName = prevLines.find((p) => p.name === l.name);
      if (byName) return byName;
    }
    if (l.client_line_key) {
      const byKey = prevLines.find((p) => p.client_line_key === l.client_line_key);
      if (byKey) return byKey;
    }
    return (
      prevLines.find(
        (p) =>
          p.garment_ref === l.garment_ref &&
          String(p.description || "") === String(l.description || "") &&
          Number(p.price) === Number(l.price),
      ) ||
      prevLines.find(
        (p) =>
          p.garment_ref === l.garment_ref &&
          String(p.description || "") === String(l.description || ""),
      ) ||
      null
    );
  }

  const garmentsOut = (body.garments || []).map((g) => {
    const prev = prevGarments.find((p) => p.garment_id === g.garment_id);
    return {
      garment_id: g.garment_id,
      garment_type: g.garment_type,
      garment_description: g.garment_description,
      color: g.color ?? prev?.color ?? "",
      fabric_notes: g.fabric_notes ?? prev?.fabric_notes ?? "",
      garment_status: g.garment_status ?? prev?.garment_status ?? "Received",
    };
  });

  const linesOut = (body.lines || []).map((l) => {
    const prev = matchPrevLine(l);
    const minutes =
      l.estimated_minutes ??
      l.est_minutes ??
      prev?.estimated_minutes ??
      prev?.est_minutes ??
      15;
    return {
      garment_ref: l.garment_ref,
      description: l.description,
      price: l.price,
      preset: l.preset !== undefined ? l.preset : (prev?.preset ?? null),
      line_notes:
        l.line_notes !== undefined
          ? l.line_notes
          : l.notes !== undefined
            ? l.notes
            : (prev?.line_notes ?? null),
      estimated_minutes: Number(minutes) || 15,
      line_status: l.line_status ?? prev?.line_status ?? "Pending",
      tailor: l.tailor !== undefined ? l.tailor : (prev?.tailor ?? null),
      line_photos: l.line_photos ?? prev?.line_photos ?? null,
      client_line_key: l.client_line_key ?? prev?.client_line_key ?? null,
    };
  });

  const res = await fetch(
    `${base}/api/resource/Alteration%20Ticket/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${key}:${secret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        garments: garmentsOut,
        lines: linesOut,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    return c.json({ error: { message: err._server_messages || err.exception || "Update failed" } }, 502);
  }

  const updated = await res.json() as { data: ErpTicket };

  // Billable tickets: rebuild SI so invoice lines match edited work (P2-9)
  const billing = (updated.data as any)?.billing_status || existing?.billing_status;
  if (billing === "Billable") {
    try {
      await erpRunMethod(
        "ls_alterations.ls_alterations.api.invoices.prepare_alteration_invoice",
        { ticket: id },
      ).catch(() => null);
    } catch { /* non-fatal */ }
  }

  return c.json({ data: serialize(updated.data) });
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


// ERPNext Server Script calls this when all garments are Ready
alterationsRouter.post("/erp-webhook/ready", async (c) => {
  // D9 (HER-22): fail closed if secret unset or mismatch.
  const secret = (process.env.ERP_WEBHOOK_SECRET ?? "").trim();
  if (!secret || c.req.header("x-webhook-secret") !== secret) {
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

  const store = "New York";
  const message = `Hi ${body.customer_name || "there"}, your alteration${body.garment_count !== 1 ? "s are" : " is"} ready for pickup at our ${store} location! Reply or call us with any questions. — L&S Custom Tailors`;

  await sendSms(body.customer_phone, message);

  return c.json({ data: { sent: true, ticket: body.ticket } });
});
