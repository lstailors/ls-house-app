/**
 * Customer portal API — authenticated client surfaces (my.lstailors.com).
 * Resolves ERP Customer via login email/phone; contact book writes go through
 * Contact + Address (two-way). Never expose staff-only fields on GET.
 */
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import {
  findCustomerIdForPortalUser,
  getCustomer,
  getCustomerSpend,
  updateCustomerContactBook,
} from "../lib/erpnext/customers";

export const portalRouter = new Hono();

async function resolveOwnCustomerId(user: {
  email: string;
  id?: string;
}): Promise<string | null> {
  return findCustomerIdForPortalUser({
    email: user.email,
    phone: null,
  });
}

/** Client-safe projection — no VIP internals, sync IDs, measurements dump. */
function portalCustomerView(row: any) {
  const people = Array.isArray(row.people) ? row.people : [];
  const primaryPerson = people.find((p: any) => p.isPrimary) || people[0];
  const primaryContactId = primaryPerson?.id;

  // Only primary contact's phones/emails — avoid assistants' numbers in self-serve
  let phones = row.phones || [];
  let emails = row.emails || [];
  if (primaryContactId) {
    const pPhones = phones.filter((p: any) => !p.contactId || p.contactId === primaryContactId);
    const pEmails = emails.filter((e: any) => !e.contactId || e.contactId === primaryContactId);
    if (pPhones.length) phones = pPhones;
    if (pEmails.length) emails = pEmails;
  }

  return {
    id: row.id || row.erpnextCustomerId,
    name: row.name,
    preferredName: row.preferredName || null,
    firstName: row.firstName || null,
    lastName: row.lastName || null,
    phone: row.phone || phones.find((p: any) => p.isPrimary)?.number || phones[0]?.number || null,
    email: row.email || emails.find((e: any) => e.isPrimary)?.email || emails[0]?.email || null,
    phones,
    emails,
    addresses: row.addresses || [],
    people: people.map((p: any) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      phone: p.phone || "",
      email: p.email || "",
      isPrimary: !!p.isPrimary,
    })),
    preferredContact: row.preferredContact || "SMS",
    smsOptIn: row.smsOptIn !== false && !row.smsOptedOut,
    paymentPreference: row.paymentPreference || null,
    address: row.address || null,
    city: row.city || null,
    state: row.state || null,
    zipCode: row.zipCode || null,
    image: row.image || null,
  };
}

// GET /api/portal/me — linked customer + contact book
portalRouter.get("/me", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const customerId = await resolveOwnCustomerId(user);
    if (!customerId) {
      return c.json({
        data: {
          linked: false,
          accountEmail: user.email,
          customer: null,
        },
      });
    }
    const row = await getCustomer(customerId);
    if (!row) {
      return c.json({
        data: { linked: false, accountEmail: user.email, customer: null },
      });
    }
    return c.json({
      data: {
        linked: true,
        accountEmail: user.email,
        customer: portalCustomerView(row),
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Failed to load profile" } }, 500);
  }
});

// PATCH /api/portal/me — update own phones / emails / addresses / prefs
portalRouter.patch("/me", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const customerId = await resolveOwnCustomerId(user);
  if (!customerId) {
    return c.json({ error: { message: "No customer record linked to this login" } }, 404);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  // Strict allow-list — no VIP, notes, measurements, money fields
  const patch: Parameters<typeof updateCustomerContactBook>[1] = {};
  if (body.preferred_name !== undefined || body.preferredName !== undefined) {
    patch.preferred_name = String(body.preferred_name ?? body.preferredName ?? "");
  }
  if (body.preferred_contact !== undefined || body.preferredContact !== undefined) {
    patch.preferred_contact = String(body.preferred_contact ?? body.preferredContact ?? "");
  }
  if (body.sms_opt_in !== undefined || body.smsOptIn !== undefined) {
    patch.sms_opt_in = !!(body.sms_opt_in ?? body.smsOptIn);
  }
  if (body.phone !== undefined) patch.phone = String(body.phone ?? "");
  if (body.email !== undefined) patch.email = String(body.email ?? "");
  if (Array.isArray(body.phones)) patch.phones = body.phones as any;
  if (Array.isArray(body.emails)) patch.emails = body.emails as any;
  if (Array.isArray(body.addresses)) patch.addresses = body.addresses as any;
  if (body.address && typeof body.address === "object") {
    patch.address = body.address as any;
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: { message: "No fields to update" } }, 400);
  }

  try {
    const row = await updateCustomerContactBook(customerId, patch);
    return c.json({ data: { linked: true, customer: portalCustomerView(row) } });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Failed to save profile" } }, 500);
  }
});

// GET /api/portal/invoices — own open/recent invoices (read-only)
portalRouter.get("/invoices", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const customerId = await resolveOwnCustomerId(user);
  if (!customerId) return c.json({ data: [] });

  try {
    const spend = await getCustomerSpend(customerId, 30);
    const history = (spend as any).history || [];
    return c.json({
      data: {
        customerId,
        lifetimeInvoiced: (spend as any).lifetimeInvoiced ?? 0,
        outstanding: (spend as any).outstanding ?? 0,
        invoices: Array.isArray(history)
          ? history.map((inv: any) => ({
              id: inv.id || inv.name,
              status: inv.status,
              grandTotal: inv.total ?? inv.grand_total ?? inv.grandTotal,
              outstanding: inv.outstandingAmount ?? inv.outstanding_amount ?? inv.outstanding,
              postingDate: inv.postingDate ?? inv.posting_date,
              dueDate: inv.dueDate ?? inv.due_date,
              payUrl: `https://app.lstailors.com/pay/${encodeURIComponent(inv.id || inv.name)}`,
            }))
          : [],
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e?.message || "Failed to load invoices" } }, 500);
  }
});
