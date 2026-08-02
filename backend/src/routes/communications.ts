import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import { getCustomersByIds } from "../lib/erpnext/customers";
import { DT } from "../lib/erpnext/doctypes";

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

/**
 * Client communications feed.
 *
 * Primary source: LSH SMS Message (Sofia live book — 3k+ rows).
 * Secondary: ERP Communication with reference_doctype=Customer (often 0 —
 * most Comms are Email on HD Ticket).
 */
communicationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });

  const customerId = c.req.query("customerId");
  const limitParam = parseInt(c.req.query("limit") ?? "200", 10);
  const limit = Math.min(Number.isFinite(limitParam) ? limitParam : 200, 500);

  const smsFilters: unknown[] = [];
  if (customerId) smsFilters.push(["customer", "=", customerId]);

  const [smsRows, erpComms] = await Promise.all([
    erpList<any>(DT.SMS_MESSAGE, {
      filters: smsFilters.length ? smsFilters : undefined,
      fields: [
        "name",
        "client_phone",
        "client_name",
        "customer",
        "direction",
        "content",
        "body",
        "timestamp",
        "status",
        "context_tag",
        "creation",
      ],
      order_by: "timestamp desc",
      limit,
    }).catch(() => []),
    // Optional Customer-linked Communication (rare on this site).
    erpList<any>("Communication", {
      filters: customerId
        ? [
            ["reference_doctype", "=", "Customer"],
            ["reference_name", "=", customerId],
          ]
        : [["reference_doctype", "=", "Customer"]],
      fields: [
        "name",
        "reference_name",
        "communication_medium",
        "sent_or_received",
        "content",
        "subject",
        "communication_date",
        "creation",
      ],
      order_by: "communication_date desc",
      limit: Math.min(limit, 100),
    }).catch(() => []),
  ]);

  const customerIds = [
    ...new Set(
      [
        ...smsRows.map((r: any) => r.customer).filter(Boolean),
        ...erpComms.map((r: any) => r.reference_name).filter(Boolean),
      ] as string[],
    ),
  ];
  const customerMap = customerIds.length
    ? await getCustomersByIds(customerIds).catch(() => new Map())
    : new Map();

  const out: any[] = [];

  for (const r of smsRows) {
    const cust = r.customer ? customerMap.get(r.customer) : undefined;
    out.push({
      id: r.name,
      customerId: r.customer ?? null,
      customer: cust
        ? serializeCustomer(cust)
        : r.client_name || r.client_phone
          ? {
              id: r.customer ?? r.client_phone,
              name: r.client_name || r.client_phone,
              phone: r.client_phone,
              email: null,
              locationId: null,
              createdById: null,
              dossier: { vip: false, preferences: null },
              createdAt: r.creation,
              updatedAt: r.timestamp,
            }
          : undefined,
      locationId: null,
      channel: "sms",
      direction: r.direction === "outbound" ? "outbound" : "inbound",
      transcript: null,
      body: r.content ?? r.body ?? null,
      status: r.status ?? null,
      contextTag: r.context_tag ?? null,
      phone: r.client_phone ?? null,
      createdAt: r.timestamp ?? r.creation,
      source: "LSH SMS Message",
    });
  }

  for (const r of erpComms) {
    out.push({
      id: r.name,
      customerId: r.reference_name,
      customer: r.reference_name
        ? serializeCustomer(customerMap.get(r.reference_name))
        : undefined,
      locationId: null,
      channel: r.communication_medium?.toLowerCase() ?? "email",
      direction: r.sent_or_received === "Sent" ? "outbound" : "inbound",
      transcript: null,
      body: r.content ?? r.subject ?? null,
      createdAt: r.communication_date ?? r.creation,
      source: "Communication",
    });
  }

  out.sort(
    (a, b) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  );

  return c.json({ data: out.slice(0, limit) });
});
