import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet } from "../lib/erp";

export const invoicesRouter = new Hono();

// ERPNext Sales Invoice status → app status
function mapStatus(s: string): string {
  switch (s) {
    case "Paid":     return "paid";
    case "Unpaid":   return "sent";
    case "Overdue":  return "sent";   // treat overdue as outstanding/sent
    case "Draft":    return "draft";
    case "Cancelled":
    case "Return":   return "void";
    default:         return "draft";
  }
}

interface ErpInvoice {
  name: string;
  customer: string;
  customer_name: string | null;
  status: string;
  posting_date: string;
  due_date: string | null;
  grand_total: number;
  outstanding_amount: number;
  alteration_ticket_ref: string | null;
  company: string;
  modified: string;
  creation: string;
}

function serialize(inv: ErpInvoice) {
  const locationId = inv.company?.includes("TX") ? "HOU" : "NYC";
  return {
    id: inv.name,
    salesOrderId: null,
    alterationTicketRef: inv.alteration_ticket_ref ?? null,
    locationId,
    erpnextId: inv.name,
    // Keep the raw ERPNext status string so the UI can show Overdue/Unpaid/Paid
    status: inv.status,
    appStatus: mapStatus(inv.status),
    total: inv.grand_total ?? 0,
    outstanding: inv.outstanding_amount ?? 0,
    dueDate: inv.due_date ?? null,
    pdfUrl: null,
    createdAt: inv.posting_date ?? inv.creation,
    customer: {
      id: inv.customer,
      name: inv.customer_name ?? inv.customer,
      phone: "",
      email: null,
      locationId,
      createdById: null,
      dossier: { vip: false, preferences: null },
      createdAt: inv.creation ?? inv.posting_date,
      updatedAt: inv.modified ?? inv.posting_date,
    },
  };
}

invoicesRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const locationCode = c.req.query("locationId") ?? user.locationCode;

  const filters: unknown[] = [["docstatus", "!=", 2]];
  if (locationCode && locationCode !== "ALL") {
    const frag = locationCode === "HOU" ? "TX" : "NY";
    filters.push(["company", "like", `%${frag}%`]);
  }

  const invoices = await erpList<ErpInvoice>("Sales Invoice", {
    filters,
    fields: [
      "name", "customer", "customer_name", "status",
      "posting_date", "due_date", "grand_total", "outstanding_amount",
      "alteration_ticket_ref", "company", "modified", "creation",
    ],
    limit: 300,
    order_by: "modified desc",
  });

  return c.json({ data: invoices.map(serialize) });
});

invoicesRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const inv = await erpGet<ErpInvoice>("Sales Invoice", c.req.param("id"));
  if (!inv) return c.json({ error: { message: "Not found" } }, 404);

  return c.json({ data: serialize(inv) });
});
