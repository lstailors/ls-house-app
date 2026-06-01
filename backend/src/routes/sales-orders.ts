import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList, erpGet } from "../lib/erp";

export const salesOrdersRouter = new Hono();

// ERPNext Sales Order status → app status
function mapStatus(erpStatus: string): string {
  switch (erpStatus) {
    case "Draft":              return "quote";
    case "To Deliver and Bill":
    case "To Bill":
    case "To Deliver":         return "in_production";
    case "Completed":          return "delivered";
    case "Cancelled":          return "cancelled";
    default:                   return "quote";
  }
}

interface ErpSalesOrder {
  name: string;
  customer: string;
  customer_name: string | null;
  status: string;
  transaction_date: string;
  grand_total: number;
  company: string;
  modified: string;
  creation: string;
}

function serialize(so: ErpSalesOrder) {
  const locationId = so.company?.includes("NY") ? "NYC" : "HOU";
  return {
    id: so.name,
    customOrderId: null,
    locationId,
    erpnextId: so.name,
    status: mapStatus(so.status),
    total: so.grand_total ?? 0,
    payload: {},
    createdAt: so.transaction_date ?? so.creation,
    customer: {
      id: so.customer,
      name: so.customer_name ?? so.customer,
      phone: "",
      email: null,
      locationId,
      createdById: null,
      dossier: { vip: false, preferences: null },
      createdAt: so.creation ?? so.transaction_date,
      updatedAt: so.modified ?? so.transaction_date,
    },
  };
}

// GET /api/sales-orders — pull live from ERPNext
salesOrdersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const locationCode = c.req.query("locationId") ?? user.locationCode;

  const filters: unknown[] = [["docstatus", "!=", 2]]; // exclude deleted
  if (locationCode && locationCode !== "ALL") {
    // Map locationCode (NYC/HOU) to company name fragment
    const companyFragment = locationCode === "HOU" ? "TX" : "NY";
    filters.push(["company", "like", `%${companyFragment}%`]);
  }

  const orders = await erpList<ErpSalesOrder>("Sales Order", {
    filters,
    fields: [
      "name", "customer", "customer_name", "status",
      "transaction_date", "grand_total", "company", "modified", "creation",
    ],
    limit: 200,
    order_by: "modified desc",
  });

  return c.json({ data: orders.map(serialize) });
});

salesOrdersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const so = await erpGet<ErpSalesOrder>("Sales Order", c.req.param("id"));
  if (!so) return c.json({ error: { message: "Not found" } }, 404);

  return c.json({ data: serialize(so) });
});
