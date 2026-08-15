import { Hono } from "hono";
import { getAuthedUser, canReadCustomer } from "../lib/scope";
import {
  searchCustomers,
  listCustomers,
  getCustomer,
  getCustomerSpend,
  createCustomer,
  updateCustomer,
  upsertCustomerDossier,
  archiveCustomer,
  setCustomerImage,
} from "../lib/erpnext/customers";
import { PciFieldRejected } from "../lib/pci-guard";
import { collectQualityReport, mergeCustomers, invalidateQualityCache } from "../lib/customer-hygiene";
import { uploadFile, erpFileAbsoluteUrl, attachFileUrl } from "../lib/erpnext/files";

export const customersRouter = new Hono();

customersRouter.get("/search", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 1) return c.json({ data: [], total: 0 });
  const limit = Math.min(parseInt(c.req.query("limit") ?? "40", 10) || 40, 100);

  try {
    const data = await searchCustomers(q, limit);
    return c.json({ data, total: data.length });
  } catch {
    return c.json({ data: [], total: 0 });
  }
});

customersRouter.get("/data-quality", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  try {
    const force = c.req.query("refresh") === "1";
    const report = await collectQualityReport(force);
    return c.json({ data: report });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Data-quality scan failed" } }, 500);
  }
});

customersRouter.post("/merge", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin" && user.role !== "store_manager") {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { primaryId?: string; duplicateId?: string };
  try {
    const data = await mergeCustomers(String(body.primaryId || ""), String(body.duplicateId || ""));
    return c.json({ data });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Merge failed" } }, 400);
  }
});

customersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [], total: 0 });

  const q = (c.req.query("q") ?? "").trim();
  const locationFilter = c.req.query("location") ?? "";
  const vipFilter = c.req.query("vip") ?? "";
  const casaFilter = c.req.query("casa") ?? "";
  const statusFilter = c.req.query("status") ?? "Active";
  // Browse page size; search uses multi-field fuzzy inside listCustomers
  const limit = Math.min(
    parseInt(c.req.query("limit") ?? (q ? "50" : "100"), 10) || 100,
    q ? 100 : 500,
  );
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;

  const opts: Parameters<typeof listCustomers>[0] = {
    q,
    vip: vipFilter || undefined,
    casa: casaFilter || undefined,
    status: statusFilter,
    limit,
    offset,
  };

  if (user.role !== "super_admin" && !user.canViewAllLocations) {
    if (user.locationCode) opts.location = user.locationCode;
  } else if (locationFilter) {
    opts.location = locationFilter;
  }

  try {
    const result = await listCustomers(opts);
    return c.json({ data: result.data, total: result.total, mode: (result as any).mode });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to list customers" } }, 500);
  }
});

customersRouter.get("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  try {
    const row = await getCustomer(c.req.param("id"));
    if (!row) return c.json({ error: { message: "Not found" } }, 404);
    if (!canReadCustomer(user, { division: row.locationId ?? undefined, locationId: row.locationId ?? undefined })) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }
    return c.json({ data: row });
  } catch {
    return c.json({ error: { message: "Not found" } }, 404);
  }
});

/**
 * GET /api/customers/:id/spend
 * Lifetime spend, outstanding AR, avg order, and recent SI history from ERP.
 * FOH-readable (not finance-only) — counter staff need AR on the client card.
 */
customersRouter.get("/:id/spend", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ error: { message: "Forbidden" } }, 403);

  const id = decodeURIComponent(c.req.param("id"));
  const limit = Math.min(parseInt(c.req.query("limit") ?? "40", 10) || 40, 100);

  try {
    const cust = await getCustomer(id);
    if (!cust) return c.json({ error: { message: "Not found" } }, 404);
    if (!canReadCustomer(user, { division: cust.locationId ?? undefined, locationId: cust.locationId ?? undefined })) {
      return c.json({ error: { message: "Forbidden" } }, 403);
    }

    const customerKey = String(cust.erpnextCustomerId || cust.id || id);
    const spend = await getCustomerSpend(customerKey, limit);
    return c.json({
      data: {
        ...spend,
        // UI aliases — lifetime spend = total billed (not just paid)
        lifetimeSpend: spend.lifetimeInvoiced,
        lifetimeBilled: spend.lifetimeInvoiced,
        lifetimePaid: spend.lifetimePaid,
        openInvoiceCount: spend.unpaidCount,
        lastInvoiceDate: spend.lastPurchaseDate,
        erpLifetimeValue: Number(cust.lifetimeValue ?? 0),
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e?.message ?? "Failed to load spend" } }, 500);
  }
});

customersRouter.post("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json()) as any;
  if (!body.full_name && !body.fullName && !body.customer_name) {
    return c.json({ error: { message: "full_name is required" } }, 400);
  }

  try {
    const data = await createCustomer(body, { division: user.locationCode ?? "NYC" });
    invalidateQualityCache();
    return c.json({ data }, 201);
  } catch (e: any) {
    if (e instanceof PciFieldRejected) {
      return c.json({ error: { message: e.message, code: "pci_rejected", field: e.field } }, 422);
    }
    return c.json({ error: { message: e.message ?? "Failed to create customer" } }, 500);
  }
});

customersRouter.patch("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const body = (await c.req.json()) as any;

  const allowed = [
    "full_name",
    "first_name",
    "last_name",
    "preferred_name",
    "email",
    "phone",
    "company",
    "title_role",
    "profession",
    "pronouns",
    "address",
    "city",
    "state",
    "zip_code",
    "division",
    "vip_tier",
    "vip_flag",
    "status",
    "style_preferences",
    "fit_notes",
    "lifestyle_notes",
    "notes",
    "birthday",
    "anniversary",
    "tags",
    "communication_pref",
    "preferred_contact",
    "sms_opted_out",
    "sms_opt_in",
    "payment_preference",
    "credit_terms",
    "casa_tier",
    "source_channel",
    "referral_code",
    "measurements",
    "lsh_chest",
    "lsh_seat",
    "lsh_back_length",
    "lsh_outseam",
    "image",
    "phones",
    "emails",
    "addresses",
  ];

  const update: Record<string, any> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  // Always pass contact-book arrays even if other fields empty
  if (body.phones !== undefined) update.phones = body.phones;
  if (body.emails !== undefined) update.emails = body.emails;
  if (body.addresses !== undefined) update.addresses = body.addresses;

  if (Object.keys(update).length === 0) {
    return c.json({ error: { message: "No fields to update" } }, 400);
  }

  try {
    const data = await updateCustomer(id, update);
    invalidateQualityCache();
    return c.json({ data });
  } catch (e: any) {
    if (e instanceof PciFieldRejected) {
      return c.json({ error: { message: e.message, code: "pci_rejected", field: e.field } }, 422);
    }
    return c.json({ error: { message: e.message ?? "Failed to update customer" } }, 500);
  }
});

/** POST /:id/image — multipart profile photo → Customer.image */
customersRouter.post("/:id/image", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return c.json({ error: { message: "file required" } }, 400);

  try {
    const existing = await getCustomer(id);
    if (!existing) return c.json({ error: { message: "Not found" } }, 404);

    const buffer = new Uint8Array(await file.arrayBuffer());
    const ext = (file.name || "photo.jpg").split(".").pop() || "jpg";
    const filename = `customer-${id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}-${Date.now()}.${ext}`;

    const { fileUrl } = await uploadFile({
      file: buffer,
      filename,
      contentType: file.type || "image/jpeg",
      doctype: "Customer",
      docname: id,
      isPrivate: false,
    });

    await attachFileUrl("Customer", id, "image", fileUrl);
    const data = await setCustomerImage(id, fileUrl);
    return c.json({
      data: {
        ...data,
        image: erpFileAbsoluteUrl(fileUrl),
      },
    });
  } catch (e: any) {
    return c.json({ error: { message: e?.message ?? "Upload failed" } }, 500);
  }
});

customersRouter.patch("/:id/dossier", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const id = c.req.param("id");
  const body = (await c.req.json()) as any;

  try {
    const data = await upsertCustomerDossier(id, body);
    return c.json({ data });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to update dossier" } }, 500);
  }
});

customersRouter.delete("/:id", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden — super_admin only" } }, 403);

  try {
    await archiveCustomer(c.req.param("id"));
    invalidateQualityCache();
    return c.json({ data: { ok: true } });
  } catch (e: any) {
    return c.json({ error: { message: e.message ?? "Failed to archive customer" } }, 500);
  }
});
