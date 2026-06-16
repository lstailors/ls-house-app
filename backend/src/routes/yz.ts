// Open YongZheng (YZ) Helpdesk tickets from ERPNext (HD Ticket doctype).
// Reads tickets assigned to the YongZheng agent group, computes days-open and
// escalation server-side, and returns them for the dashboard widget.

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import { YZTicket } from "../types";

export const yzRouter = new Hono();

const ERP_TICKET_BASE = "https://erp.lstailors.com/app/hd-ticket";

interface ErpHdTicket {
  name: string;
  subject: string | null;
  status: string | null;
  priority: string | null;
  lsh_mtm_pro_order: string | null;
  lsh_yz_order_no: string | null;
  creation: string;
  _assign: string | null;
}

// ERPNext stores _assign as a JSON-array string, e.g. '["a@x.com","b@x.com"]'.
function parseAssignees(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

yzRouter.get("/open-tickets", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const rows = await erpList<ErpHdTicket>("HD Ticket", {
    filters: [
      ["agent_group", "=", "YongZheng"],
      ["status", "!=", "Closed"],
    ],
    fields: ["name", "subject", "status", "priority", "lsh_mtm_pro_order", "lsh_yz_order_no", "creation", "_assign"],
    order_by: "creation asc",
    limit: 0,
  }).catch(() => []);

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const tickets = rows.map((r) => {
    const created = new Date(r.creation).getTime();
    const daysOpen = Number.isFinite(created) ? Math.floor((now - created) / DAY_MS) : 0;
    const proOrder = r.lsh_mtm_pro_order || null;
    const yzOrderNo = r.lsh_yz_order_no || null;
    const escalate = daysOpen >= 3 && r.status !== "Resolved";

    return YZTicket.parse({
      name: r.name,
      subject: r.subject ?? null,
      status: r.status ?? null,
      priority: r.priority ?? null,
      orderId: proOrder ?? yzOrderNo ?? null,
      proOrder,
      yzOrderNo,
      creation: r.creation,
      assignees: parseAssignees(r._assign),
      daysOpen,
      escalate,
      url: `${ERP_TICKET_BASE}/${encodeURIComponent(r.name)}`,
    });
  });

  return c.json({ data: tickets });
});
