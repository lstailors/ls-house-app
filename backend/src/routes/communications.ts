import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser } from "../lib/scope";

export const communicationsRouter = new Hono();

// ── Helpers ─────────────────────────────────────────────────────────────────

function serializeCustomer(row: any) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.full_name,
    phone: row.phone,
    email: row.email,
    locationId: row.division,
    createdById: null,
    dossier: { vip: row.vip_tier !== "Standard", preferences: row.style_preferences || null },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchCustomerMap(ids: string[]): Promise<Map<string, any>> {
  if (!ids.length || !supabaseAdmin) return new Map();
  const { data } = await supabaseAdmin
    .from("customers")
    .select("id,full_name,phone,email,division,vip_tier,style_preferences,created_at,updated_at")
    .in("id", ids);
  return new Map((data ?? []).map((r: any) => [r.id, r]));
}

function serializeCommunication(row: any, customerRow?: any) {
  return {
    id: row.id,
    customerId: row.customer_id,
    customer: customerRow ? serializeCustomer(customerRow) : undefined,
    locationId: null,
    channel: row.channel ?? "sms",
    direction: row.direction ?? "inbound",
    transcript: row.call_transcript ?? null,
    body: row.body_text ?? row.call_summary ?? null,
    createdAt: row.comm_date ?? row.created_at,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

communicationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (user.role === "driver") return c.json({ data: [] });
  if (!supabaseAdmin) return c.json({ data: [] });

  const customerId = c.req.query("customerId");

  let q = supabaseAdmin
    .from("customer_communications")
    .select("*")
    .order("comm_date", { ascending: false })
    .limit(200);

  if (customerId) q = q.eq("customer_id", customerId);

  const { data, error } = await q;
  if (error) {
    console.error("communications list error:", error);
    return c.json({ data: [] });
  }
  const rows = data ?? [];

  const customerIds = [...new Set(rows.map((r: any) => r.customer_id).filter(Boolean))] as string[];
  const customerMap = await fetchCustomerMap(customerIds);

  return c.json({
    data: rows.map((r: any) => serializeCommunication(r, customerMap.get(r.customer_id))),
  });
});
