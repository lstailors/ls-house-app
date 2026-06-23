import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import { getCustomersByIds } from "../lib/erpnext/customers";

export const communicationsRouter = new Hono();

function serializeCustomer(row: any) {
  if (!row) return undefined;
  return {
    id: row.name,
    name: row.customer_name,
    phone: row.mobile_no,
    email: row.email_id,
    locationId: row.custom_lst_division,
    createdById: null,
    dossier: { vip: row.custom_vip_tier !== "Standard", preferences: row.custom_style_preferences || null },
    createdAt: row.creation,
    updatedAt: row.modified,
  };
}

async function fetchCustomerMap(ids: string[]): Promise<Map<string, any>> {
  return getCustomersByIds(ids);
}

function serializeCommunication(row: any, customerRow?: any) {
  return {
    id: row.name,
    customerId: row.reference_name,
    customer: customerRow ? serializeCustomer(customerRow) : undefined,
    locationId: null,
    channel: row.communication_medium?.toLowerCase() ?? "sms",
    direction: row.sent_or_received === "Sent" ? "outbound" : "inbound",
    transcript: null,
    body: row.content ?? row.subject ?? null,
    createdAt: row.communication_date ?? row.creation,
  };
}

communicationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });

  const customerId = c.req.query("customerId");
  const filters: unknown[] = [["reference_doctype", "=", "Customer"]];
  if (customerId) filters.push(["reference_name", "=", customerId]);

  const rows = await erpList<any>("Communication", {
    filters,
    fields: ["name", "reference_name", "communication_medium", "sent_or_received", "content", "subject", "communication_date", "creation"],
    order_by: "communication_date desc",
    limit: 200,
  }).catch(() => []);

  const customerIds = [...new Set(rows.map((r: any) => r.reference_name).filter(Boolean))] as string[];
  const customerMap = await fetchCustomerMap(customerIds);

  return c.json({
    data: rows.map((r: any) => serializeCommunication(r, customerMap.get(r.reference_name))),
  });
});
