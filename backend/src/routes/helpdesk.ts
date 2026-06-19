// Helpdesk — ERPNext HD Ticket CRUD + Communications thread.
// Managers (super_admin, store_manager) see all tickets.
// Other staff see only tickets assigned to their email.

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet, erpCreate, erpUpdate } from "../lib/erp";
import {
  HDTicket, HDTicketDetail, HDCommunication,
  NewHDTicketBody, UpdateHDTicketStatusBody, HDTicketReplyBody,
} from "../types";

export const helpdeskRouter = new Hono();

const ERP_TICKET_BASE = "https://erp.lstailors.com/app/hd-ticket";
const DAY_MS = 24 * 60 * 60 * 1000;

function parseAssignees(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toHDTicket(r: any): HDTicket {
  const created = new Date(r.creation).getTime();
  const daysOpen = Number.isFinite(created) ? Math.floor((Date.now() - created) / DAY_MS) : 0;
  const proOrder = r.lsh_mtm_pro_order || null;
  const yzOrderNo = r.lsh_yz_order_no || null;
  const escalate = daysOpen >= 3 && r.status !== "Resolved" && r.status !== "Closed";
  return HDTicket.parse({
    name: r.name,
    subject: r.subject ?? null,
    status: r.status ?? null,
    priority: r.priority ?? null,
    ticketType: r.ticket_type ?? null,
    agentGroup: r.agent_group ?? null,
    proOrder,
    yzOrderNo,
    orderId: proOrder ?? yzOrderNo ?? null,
    creation: r.creation,
    modified: r.modified ?? r.creation,
    assignees: parseAssignees(r._assign),
    daysOpen,
    escalate,
    url: `${ERP_TICKET_BASE}/${encodeURIComponent(r.name)}`,
  });
}

const LIST_FIELDS = [
  "name", "subject", "status", "priority", "ticket_type", "agent_group",
  "lsh_mtm_pro_order", "lsh_yz_order_no", "creation", "modified", "_assign",
];

const isManager = (role: string) => role === "super_admin" || role === "store_manager";

// GET /api/helpdesk/tickets
helpdeskRouter.get("/tickets", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const statusFilter = c.req.query("status");
  const mine = c.req.query("mine") === "1";

  const filters: unknown[] = [["status", "!=", "Deleted"]];
  if (statusFilter && statusFilter !== "all") {
    filters.push(["status", "=", statusFilter]);
  } else if (!isManager(user.role)) {
    // Non-managers see only open/in-progress by default
    filters.push(["status", "not in", ["Closed", "Resolved"]]);
  }

  // Staff without manager role only see their own tickets
  if (!isManager(user.role) || mine) {
    filters.push(["_assign", "like", `%${user.email}%`]);
  }

  const rows = await erpList<any>("HD Ticket", {
    filters,
    fields: LIST_FIELDS,
    order_by: "creation desc",
    limit: 0,
  }).catch(() => []);

  const tickets = rows.map(toHDTicket);
  return c.json({ data: tickets });
});

// GET /api/helpdesk/tickets/:id
helpdeskRouter.get("/tickets/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");

  const [raw, commsRaw] = await Promise.all([
    erpGet<any>("HD Ticket", id),
    erpList<any>("Communication", {
      filters: [
        ["reference_doctype", "=", "HD Ticket"],
        ["reference_name", "=", id],
      ],
      fields: ["name", "sender", "sender_full_name", "content", "sent_or_received", "creation", "communication_type"],
      order_by: "creation asc",
      limit: 0,
    }).catch(() => []),
  ]);

  if (!raw) return c.json({ error: { message: "Ticket not found" } }, 404);

  const base = toHDTicket(raw);
  const communications = commsRaw.map((c: any) =>
    HDCommunication.parse({
      name: c.name,
      sender: c.sender ?? null,
      senderName: c.sender_full_name ?? null,
      content: c.content ?? null,
      sentOrReceived: c.sent_or_received ?? null,
      creation: c.creation,
      communicationType: c.communication_type ?? null,
    })
  );

  const detail = HDTicketDetail.parse({
    ...base,
    description: raw.description ?? null,
    communications,
  });

  return c.json({ data: detail });
});

// PUT /api/helpdesk/tickets/:id/status
helpdeskRouter.put("/tickets/:id/status", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => ({}));
  const parsed = UpdateHDTicketStatusBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: { message: "Invalid body" } }, 400);

  await erpUpdate("HD Ticket", id, { status: parsed.data.status });
  return c.json({ data: { ok: true } });
});

// POST /api/helpdesk/tickets/:id/reply
helpdeskRouter.post("/tickets/:id/reply", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => ({}));
  const parsed = HDTicketReplyBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: { message: "Invalid body" } }, 400);
  const { message } = parsed.data;

  // Create a Communication document linked to the HD Ticket
  await erpCreate("Communication", {
    doctype: "Communication",
    communication_type: "Communication",
    communication_medium: "Email",
    sent_or_received: "Sent",
    reference_doctype: "HD Ticket",
    reference_name: id,
    sender: user.email,
    sender_full_name: user.name,
    content: message,
  });

  return c.json({ data: { ok: true } });
});

// POST /api/helpdesk/tickets
helpdeskRouter.post("/tickets", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const raw = await c.req.json().catch(() => ({}));
  const parsed = NewHDTicketBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: { message: "Invalid body" } }, 400);
  const body = parsed.data;

  const created = await erpCreate<any>("HD Ticket", {
    doctype: "HD Ticket",
    subject: body.subject,
    description: body.description ?? "",
    ticket_type: "Vendor / Factory",
    priority: body.priority,
    agent_group: body.agentGroup ?? "YongZheng",
    raised_by: user.email,
  });

  if (!created) return c.json({ error: { message: "Failed to create ticket" } }, 500);

  return c.json({ data: toHDTicket(created) }, 201);
});

// GET /api/helpdesk/open-count — for sidebar badge + notifications
helpdeskRouter.get("/open-count", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const filters: unknown[] = [
    ["status", "not in", ["Closed", "Resolved"]],
  ];
  if (!isManager(user.role)) {
    filters.push(["_assign", "like", `%${user.email}%`]);
  }

  const rows = await erpList<any>("HD Ticket", {
    filters,
    fields: ["name", "creation", "status", "_assign"],
    limit: 0,
  }).catch(() => []);

  const now = Date.now();
  const escalated = rows.filter((r: any) => {
    const d = Math.floor((now - new Date(r.creation).getTime()) / DAY_MS);
    return d >= 3 && r.status !== "Resolved";
  }).length;

  return c.json({ data: { total: rows.length, escalated } });
});
