import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase.js";
import { getAuthedUser, canSeeFinancials } from "../lib/scope.js";
import { erpList } from "../lib/erp.js";

export const searchRouter = new Hono();

// Universal fuzzy search — ERPNext is the primary source of truth for all
// business entities. Supabase is used for tasks/sms/intelligence/fabrics.
// All ERP queries run in parallel for speed.

searchRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 1) return c.json({ data: { results: [], query: q } });

  const like = `%${q}%`;
  const results: any[] = [];

  // ── ERPNext: run all 5 queries in parallel ─────────────────
  const [customers, altTickets, salesOrders, invoices] = await Promise.allSettled([

    // 1. Customers (fuzzy via search_link + phone fallback)
    (async () => {
      const base = process.env.ERPNEXT_BASE_URL ?? '';
      const key  = process.env.ERPNEXT_API_KEY   ?? '';
      const sec  = process.env.ERPNEXT_API_SECRET ?? '';
      if (!base || !key || !sec) return [];

      const auth = { Authorization: `token ${key}:${sec}`, Accept: 'application/json' };

      // ERPNext search_link — same fuzzy engine as the ERP UI
      const res = await fetch(
        `${base}/api/method/frappe.desk.search.search_link?txt=${encodeURIComponent(q)}&doctype=Customer&page_length=6`,
        { headers: auth }
      );
      let hits: { value: string }[] = [];
      if (res.ok) {
        const j: any = await res.json();
        hits = j.results ?? j.message ?? [];
      }

      // Also search by phone if query looks like a number
      if (q.replace(/\D/g, '').length >= 4) {
        const phone = q.replace(/\D/g, '');
        const pr = await fetch(
          `${base}/api/resource/Customer?filters=${encodeURIComponent(JSON.stringify([['mobile_no','like',`%${phone}%`]]))}&fields=${encodeURIComponent(JSON.stringify(['name','customer_name']))}&limit_page_length=4`,
          { headers: auth }
        );
        if (pr.ok) {
          const pj: any = await pr.json();
          const seen = new Set(hits.map((h: any) => h.value));
          for (const r of (pj.data ?? [])) {
            if (!seen.has(r.name)) hits.push({ value: r.name });
          }
        }
      }

      // Enrich top 6 with contact details
      return Promise.all(hits.slice(0, 6).map(async (hit: any) => {
        let phone = '', email = '';
        try {
          const cr = await fetch(
            `${base}/api/resource/Contact?filters=${encodeURIComponent(JSON.stringify([['Dynamic Link','link_doctype','=','Customer'],['Dynamic Link','link_name','=',hit.value]]))}&fields=${encodeURIComponent(JSON.stringify(['mobile_no','email_id']))}&limit_page_length=1`,
            { headers: auth }
          );
          if (cr.ok) { const cj: any = await cr.json(); const ct = cj.data?.[0]; if (ct) { phone = ct.mobile_no || ''; email = ct.email_id || ''; } }
          // Also try getting phone from customer record directly
          if (!phone) {
            const custR = await fetch(`${base}/api/resource/Customer/${encodeURIComponent(hit.value)}?fields=${encodeURIComponent(JSON.stringify(['customer_name','mobile_no','email_id']))}`, { headers: auth });
            if (custR.ok) { const cj2: any = await custR.json(); phone = cj2.message?.mobile_no || ''; email = email || cj2.message?.email_id || ''; }
          }
        } catch {}
        return {
          type: 'customer',
          id: hit.value,
          title: hit.value, // will be refined below with clean name
          subtitle: [phone, email].filter(Boolean).join(' · ') || null,
          meta: null,
          href: `/customers/${hit.value}`,
          _raw: hit,
        };
      }));
    })(),

    // 2. Alteration Tickets
    erpList<any>('Alteration Ticket', {
      filters: [
        ['workflow_state', '!=', 'Cancelled'],
        ['customer_name', 'like', like],
      ],
      fields: ['name', 'customer_name', 'workflow_state', 'ticket_total', 'ticket_date', 'origin_location'],
      limit: 6,
      order_by: 'modified desc',
    }).catch(() => []),

    // 3. Sales Orders (LSTNY-SO-*)
    erpList<any>('Sales Order', {
      filters: [['name', 'like', like]],
      fields: ['name', 'customer_name', 'status', 'grand_total', 'transaction_date'],
      limit: 5,
      order_by: 'modified desc',
    }).then(r => r.length ? r : erpList<any>('Sales Order', {
      filters: [['customer_name', 'like', like]],
      fields: ['name', 'customer_name', 'status', 'grand_total', 'transaction_date'],
      limit: 5,
      order_by: 'modified desc',
    })).catch(() => []),

    // 4. Sales Invoices (LSTNY-SINV-*) — search by name or customer
    erpList<any>('Sales Invoice', {
      filters: [['name', 'like', like], ['docstatus', '!=', 2]],
      fields: ['name', 'customer_name', 'status', 'grand_total', 'outstanding_amount', 'alteration_ticket_ref', 'posting_date'],
      limit: 5,
      order_by: 'modified desc',
    }).then(r => r.length ? r : erpList<any>('Sales Invoice', {
      filters: [['customer_name', 'like', like], ['docstatus', '!=', 2]],
      fields: ['name', 'customer_name', 'status', 'grand_total', 'outstanding_amount', 'alteration_ticket_ref', 'posting_date'],
      limit: 5,
      order_by: 'modified desc',
    })).catch(() => []),
  ]);

  // ── Assemble ERP results ───────────────────────────────────

  // Customers
  if (customers.status === 'fulfilled') {
    for (const c of customers.value ?? []) {
      results.push({
        type: 'customer',
        id: c.id,
        title: c.id,        // ERPNext name IS the customer name (e.g. "Calogero Cristiano - 1")
        subtitle: c.subtitle,
        meta: null,
        href: `/customers/${c.id}`,
      });
    }
  }

  // Alteration Tickets
  if (altTickets.status === 'fulfilled') {
    // Also search by ticket name (ALT-NYC-...)
    let tickets = altTickets.value as any[];
    if (q.toUpperCase().includes('ALT')) {
      const byName = await erpList<any>('Alteration Ticket', {
        filters: [['name', 'like', like], ['workflow_state', '!=', 'Cancelled']],
        fields: ['name', 'customer_name', 'workflow_state', 'ticket_total', 'ticket_date'],
        limit: 5,
        order_by: 'modified desc',
      }).catch(() => []);
      const seen = new Set(tickets.map((t: any) => t.name));
      tickets = [...tickets, ...byName.filter((t: any) => !seen.has(t.name))];
    }
    for (const t of tickets.slice(0, 6)) {
      results.push({
        type: 'alteration',
        id: t.name,
        title: t.name,
        subtitle: t.customer_name,
        meta: t.workflow_state,
        amount: t.ticket_total,
        href: `/orders/alterations/${t.name}`,
      });
    }
  }

  // Sales Orders
  if (salesOrders.status === 'fulfilled') {
    for (const o of salesOrders.value ?? []) {
      results.push({
        type: 'sales_order',
        id: o.name,
        title: o.name,
        subtitle: o.customer_name,
        meta: o.status,
        amount: o.grand_total,
        href: `/sales-orders`,
      });
    }
  }

  // Invoices
  if (invoices.status === 'fulfilled') {
    for (const i of invoices.value ?? []) {
      results.push({
        type: 'invoice',
        id: i.name,
        title: i.name,
        subtitle: i.alteration_ticket_ref
          ? `${i.customer_name} · ALT ticket`
          : i.customer_name,
        meta: i.status,
        amount: i.grand_total,
        outstanding: i.outstanding_amount,
        href: `/invoices`,
      });
    }
  }

  // ── Supabase: secondary sources (keep as-is) ──────────────
  const like2 = `%${q}%`;

  // Fabrics
  try {
    const { data: fabrics } = await supabaseAdmin
      ?.from("fabrics")
      .select("id, fabric_name, fabric_number, mill_brand")
      .or(`fabric_name.ilike.${like2},fabric_number.ilike.${like2},mill_brand.ilike.${like2}`)
      .limit(4) ?? { data: [] };

    for (const f of fabrics ?? []) {
      results.push({ type: "fabric", id: f.id, title: f.fabric_name, subtitle: f.mill_brand ?? null, meta: f.fabric_number ? `#${f.fabric_number}` : null, href: `/reference/fabrics` });
    }
  } catch {}

  // Tasks
  try {
    const { data: tasks } = await supabaseAdmin
      ?.from("ls_tasks")
      .select("id, task_no, title, status, priority, assigned_to_name")
      .or(`title.ilike.${like2},assigned_to_name.ilike.${like2}`)
      .neq("status", "completed")
      .neq("status", "cancelled")
      .limit(4) ?? { data: [] };

    for (const t of tasks ?? []) {
      results.push({ type: "task", id: t.id, title: t.title, subtitle: t.assigned_to_name ? `Assigned to ${t.assigned_to_name}` : null, meta: t.priority, href: `/tasks` });
    }
  } catch {}

  // Brain / Intelligence
  try {
    const { data: notes } = await supabaseAdmin
      ?.from("brain_entries")
      .select("id, summary, entry_type, agent_slug, created_at")
      .ilike("summary", like2)
      .order("created_at", { ascending: false })
      .limit(3) ?? { data: [] };

    for (const n of notes ?? []) {
      results.push({ type: "intelligence", id: n.id, title: n.summary, subtitle: `${n.agent_slug} · ${n.entry_type}`, meta: n.created_at ? new Date(n.created_at).toLocaleDateString() : null, href: `/comms` });
    }
  } catch {}

  // SMS
  try {
    const { data: sms } = await supabaseAdmin
      ?.from("sms_messages")
      .select("id, content, client_phone, direction, timestamp")
      .ilike("content", like2)
      .order("timestamp", { ascending: false })
      .limit(3) ?? { data: [] };

    for (const s of sms ?? []) {
      results.push({ type: "sms", id: s.id, title: s.content?.slice(0, 80) + (s.content?.length > 80 ? "…" : ""), subtitle: s.client_phone, meta: s.direction, href: `/sofia` });
    }
  } catch {}

  return c.json({ data: { results, query: q } });
});
