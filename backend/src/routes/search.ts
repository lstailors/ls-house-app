import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser, canSeeFinancials } from "../lib/scope";

export const searchRouter = new Hono();

// Universal fuzzy search across all core tables.
// Returns categorized results, max ~6 per category, sorted by relevance.

searchRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ results: [] });

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ results: [] });

  const like = `%${q}%`;
  const results: any[] = [];

  // ── Customers ─────────────────────────────────────────────
  try {
    const { data: customers } = await supabaseAdmin
      .from("customers")
      .select("id, full_name, email, phone, customer_number")
      .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like},customer_number.ilike.${like}`)
      .limit(6);

    for (const c of customers ?? []) {
      results.push({
        type: "customer",
        id: c.id,
        title: c.full_name,
        subtitle: [c.phone, c.email].filter(Boolean).join(" · "),
        meta: c.customer_number ? `#${c.customer_number}` : null,
        href: `/customers/${c.id}`,
      });
    }
  } catch {}

  // ── Sales Orders ───────────────────────────────────────────
  if (canSeeFinancials(user.role)) {
    try {
      const { data: orders } = await supabaseAdmin
        .from("erp_sales_orders")
        .select("id, erp_name, erp_customer, end_customer, status, grand_total, transaction_date")
        .or(`erp_name.ilike.${like},erp_customer.ilike.${like},end_customer.ilike.${like}`)
        .limit(5);

      for (const o of orders ?? []) {
        results.push({
          type: "sales_order",
          id: o.id,
          title: o.erp_name,
          subtitle: o.end_customer ?? o.erp_customer,
          meta: o.status,
          amount: o.grand_total,
          href: `/sales-orders`,
        });
      }
    } catch {}

    // ── Invoices ───────────────────────────────────────────
    try {
      const { data: invoices } = await supabaseAdmin
        .from("erp_sales_invoices")
        .select("id, erp_name, erp_customer, end_customer, status, grand_total, outstanding_amount")
        .or(`erp_name.ilike.${like},erp_customer.ilike.${like},end_customer.ilike.${like}`)
        .limit(5);

      for (const i of invoices ?? []) {
        results.push({
          type: "invoice",
          id: i.id,
          title: i.erp_name,
          subtitle: i.end_customer ?? i.erp_customer,
          meta: i.status,
          amount: i.grand_total,
          outstanding: i.outstanding_amount,
          href: `/invoices`,
        });
      }
    } catch {}
  }

  // ── Fabrics ────────────────────────────────────────────────
  try {
    const { data: fabrics } = await supabaseAdmin
      .from("fabrics")
      .select("id, fabric_name, fabric_number, mill_brand")
      .or(`fabric_name.ilike.${like},fabric_number.ilike.${like},mill_brand.ilike.${like}`)
      .limit(4);

    for (const f of fabrics ?? []) {
      results.push({
        type: "fabric",
        id: f.id,
        title: f.fabric_name,
        subtitle: f.mill_brand ?? null,
        meta: f.fabric_number ? `#${f.fabric_number}` : null,
        href: `/reference/fabrics`,
      });
    }
  } catch {}

  // ── Tasks ──────────────────────────────────────────────────
  try {
    const { data: tasks } = await supabaseAdmin
      .from("ls_tasks")
      .select("id, task_no, title, status, priority, assigned_to_name, due_at")
      .or(`title.ilike.${like},description.ilike.${like},assigned_to_name.ilike.${like}`)
      .neq("status", "completed")
      .neq("status", "cancelled")
      .limit(4);

    for (const t of tasks ?? []) {
      results.push({
        type: "task",
        id: t.id,
        title: t.title,
        subtitle: t.assigned_to_name ? `Assigned to ${t.assigned_to_name}` : null,
        meta: t.priority,
        status: t.status,
        href: `/tasks`,
      });
    }
  } catch {}

  // ── Brain entries (intelligence notes) ────────────────────
  try {
    const { data: notes } = await supabaseAdmin
      .from("brain_entries")
      .select("id, summary, entry_type, agent_slug, created_at")
      .ilike("summary", like)
      .order("created_at", { ascending: false })
      .limit(3);

    for (const n of notes ?? []) {
      results.push({
        type: "intelligence",
        id: n.id,
        title: n.summary,
        subtitle: `${n.agent_slug} · ${n.entry_type}`,
        meta: n.created_at ? new Date(n.created_at).toLocaleDateString() : null,
        href: `/comms`,
      });
    }
  } catch {}

  // ── SMS messages ───────────────────────────────────────────
  try {
    const { data: sms } = await supabaseAdmin
      .from("sms_messages")
      .select("id, content, client_phone, direction, timestamp")
      .ilike("content", like)
      .order("timestamp", { ascending: false })
      .limit(3);

    for (const s of sms ?? []) {
      results.push({
        type: "sms",
        id: s.id,
        title: s.content?.slice(0, 80) + (s.content?.length > 80 ? "…" : ""),
        subtitle: s.client_phone,
        meta: s.direction,
        href: `/sofia`,
      });
    }
  } catch {}

  return c.json({ results, query: q });
});
