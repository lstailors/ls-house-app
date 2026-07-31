import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpList } from "../lib/erp";
import { listFabrics } from "../lib/erpnext/reference";
import { listBrainEntriesFiltered, listSmsMessagesFiltered } from "../lib/erpnext/agents";

export const searchRouter = new Hono();

type SearchHit = {
  type: string;
  id: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  amount?: number | null;
  outstanding?: number | null;
  href: string;
};

function moneyish(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/**
 * Universal fuzzy search for alts FOH + app dashboard.
 * ERPNext is primary SoT. All entity queries run in parallel.
 * Returns deep-link hrefs that work on alts.lstailors.com.
 */
searchRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 1) return c.json({ data: { results: [] as SearchHit[], query: q } });

  const like = `%${q}%`;
  const qUpper = q.toUpperCase();
  const digits = q.replace(/\D/g, "");
  const results: SearchHit[] = [];

  const looksLikeTicket =
    /ALT[-/]?/i.test(q) || /^A\d{4,}$/i.test(q) || qUpper.startsWith("ALT");
  const looksLikeInvoice = /SINV|INV-/i.test(q) || qUpper.includes("LSTNY-SINV");
  const looksLikeSo = /(?:^|[\s-])SO[-/]|^LSTNY-SO/i.test(q) || qUpper.includes("LSTNY-SO");
  const looksLikeDelivery = /DELIV|LSH-DEL|DLV/i.test(q);

  const [
    customers,
    ticketsByCustomer,
    ticketsByName,
    ticketsByPhone,
    salesOrders,
    invoices,
    deliveries,
  ] = await Promise.allSettled([
    // 1. Customers — ERP search_link + phone
    (async () => {
      const base = process.env.ERPNEXT_BASE_URL ?? "";
      const key = process.env.ERPNEXT_API_KEY ?? "";
      const sec = process.env.ERPNEXT_API_SECRET ?? "";
      if (!base || !key || !sec) return [] as SearchHit[];

      const auth = { Authorization: `token ${key}:${sec}`, Accept: "application/json" };

      const res = await fetch(
        `${base}/api/method/frappe.desk.search.search_link?txt=${encodeURIComponent(q)}&doctype=Customer&page_length=8`,
        { headers: auth },
      );
      let hits: { value: string; description?: string }[] = [];
      if (res.ok) {
        const j: any = await res.json();
        hits = j.results ?? j.message ?? [];
      }

      if (digits.length >= 4) {
        const pr = await fetch(
          `${base}/api/resource/Customer?filters=${encodeURIComponent(
            JSON.stringify([["mobile_no", "like", `%${digits}%`]]),
          )}&fields=${encodeURIComponent(JSON.stringify(["name", "customer_name", "mobile_no"]))}&limit_page_length=5`,
          { headers: auth },
        );
        if (pr.ok) {
          const pj: any = await pr.json();
          const seen = new Set(hits.map((h) => h.value));
          for (const r of pj.data ?? []) {
            if (!seen.has(r.name)) hits.push({ value: r.name, description: r.mobile_no });
          }
        }
      }

      // Name-like also via customer_name
      if (q.length >= 2 && hits.length < 4) {
        const nr = await fetch(
          `${base}/api/resource/Customer?filters=${encodeURIComponent(
            JSON.stringify([["customer_name", "like", like]]),
          )}&fields=${encodeURIComponent(JSON.stringify(["name", "customer_name", "mobile_no"]))}&limit_page_length=6`,
          { headers: auth },
        );
        if (nr.ok) {
          const nj: any = await nr.json();
          const seen = new Set(hits.map((h) => h.value));
          for (const r of nj.data ?? []) {
            if (!seen.has(r.name)) hits.push({ value: r.name, description: r.mobile_no });
          }
        }
      }

      return Promise.all(
        hits.slice(0, 8).map(async (hit) => {
          let phone = hit.description || "";
          let email = "";
          let displayName = hit.value;
          try {
            const custR = await fetch(
              `${base}/api/resource/Customer/${encodeURIComponent(hit.value)}?fields=${encodeURIComponent(
                JSON.stringify(["customer_name", "mobile_no", "email_id"]),
              )}`,
              { headers: auth },
            );
            if (custR.ok) {
              const cj: any = await custR.json();
              const m = cj.data ?? cj.message ?? {};
              displayName = m.customer_name || hit.value;
              phone = phone || m.mobile_no || "";
              email = m.email_id || "";
            }
            if (!phone || !email) {
              const cr = await fetch(
                `${base}/api/resource/Contact?filters=${encodeURIComponent(
                  JSON.stringify([
                    ["Dynamic Link", "link_doctype", "=", "Customer"],
                    ["Dynamic Link", "link_name", "=", hit.value],
                  ]),
                )}&fields=${encodeURIComponent(JSON.stringify(["mobile_no", "email_id"]))}&limit_page_length=1`,
                { headers: auth },
              );
              if (cr.ok) {
                const cj2: any = await cr.json();
                const ct = cj2.data?.[0];
                if (ct) {
                  phone = phone || ct.mobile_no || "";
                  email = email || ct.email_id || "";
                }
              }
            }
          } catch {
            /* enrich best-effort */
          }
          return {
            type: "customer",
            id: hit.value,
            title: displayName,
            subtitle: [phone, email].filter(Boolean).join(" · ") || null,
            meta: "Customer",
            href: `/customers/${encodeURIComponent(hit.value)}`,
          } satisfies SearchHit;
        }),
      );
    })(),

    // 2. Tickets by customer name
    erpList<any>("Alteration Ticket", {
      filters: [
        ["workflow_state", "!=", "Cancelled"],
        ["customer_name", "like", like],
      ],
      fields: [
        "name",
        "customer_name",
        "workflow_state",
        "ticket_total",
        "ticket_date",
        "payment_status",
        "customer_phone",
      ],
      limit: 8,
      order_by: "modified desc",
    }).catch(() => []),

    // 3. Tickets by name (always — ALT-… / partial)
    erpList<any>("Alteration Ticket", {
      filters: [
        ["name", "like", like],
        ["workflow_state", "!=", "Cancelled"],
      ],
      fields: [
        "name",
        "customer_name",
        "workflow_state",
        "ticket_total",
        "ticket_date",
        "payment_status",
      ],
      limit: looksLikeTicket ? 10 : 5,
      order_by: "modified desc",
    }).catch(() => []),

    // 4. Tickets by phone digits
    digits.length >= 4
      ? erpList<any>("Alteration Ticket", {
          filters: [
            ["customer_phone", "like", `%${digits}%`],
            ["workflow_state", "!=", "Cancelled"],
          ],
          fields: [
            "name",
            "customer_name",
            "workflow_state",
            "ticket_total",
            "payment_status",
            "customer_phone",
          ],
          limit: 6,
          order_by: "modified desc",
        }).catch(() => [])
      : Promise.resolve([]),

    // 5. Sales Orders
    erpList<any>("Sales Order", {
      filters: [["name", "like", like]],
      fields: ["name", "customer", "customer_name", "status", "grand_total", "transaction_date"],
      limit: looksLikeSo ? 8 : 5,
      order_by: "modified desc",
    })
      .then((r) =>
        r.length
          ? r
          : erpList<any>("Sales Order", {
              filters: [["customer_name", "like", like]],
              fields: ["name", "customer", "customer_name", "status", "grand_total", "transaction_date"],
              limit: 5,
              order_by: "modified desc",
            }),
      )
      .catch(() => []),

    // 6. Sales Invoices
    erpList<any>("Sales Invoice", {
      filters: [
        ["name", "like", like],
        ["docstatus", "!=", 2],
      ],
      fields: [
        "name",
        "customer_name",
        "status",
        "grand_total",
        "outstanding_amount",
        "alteration_ticket_ref",
        "posting_date",
      ],
      limit: looksLikeInvoice ? 8 : 5,
      order_by: "modified desc",
    })
      .then((r) =>
        r.length
          ? r
          : erpList<any>("Sales Invoice", {
              filters: [
                ["customer_name", "like", like],
                ["docstatus", "!=", 2],
              ],
              fields: [
                "name",
                "customer_name",
                "status",
                "grand_total",
                "outstanding_amount",
                "alteration_ticket_ref",
                "posting_date",
              ],
              limit: 5,
              order_by: "modified desc",
            }),
      )
      .catch(() => []),

    // 7. Deliveries
    (async () => {
      const byName = looksLikeDelivery || q.length >= 2
        ? await erpList<any>("LSH Delivery", {
            filters: [["name", "like", like], ["docstatus", "!=", 2]],
            fields: [
              "name",
              "customer_name",
              "customer_phone",
              "lsh_status",
              "lsh_delivery_address",
              "lsh_alteration_ticket",
              "lsh_scheduled_date",
            ],
            limit: 6,
            order_by: "modified desc",
          }).catch(() => [])
        : [];
      const byCust =
        q.length >= 2
          ? await erpList<any>("LSH Delivery", {
              filters: [
                ["customer_name", "like", like],
                ["docstatus", "!=", 2],
                ["lsh_status", "not in", ["Cancelled"]],
              ],
              fields: [
                "name",
                "customer_name",
                "customer_phone",
                "lsh_status",
                "lsh_delivery_address",
                "lsh_alteration_ticket",
                "lsh_scheduled_date",
              ],
              limit: 6,
              order_by: "modified desc",
            }).catch(() => [])
          : [];
      const byPhone =
        digits.length >= 4
          ? await erpList<any>("LSH Delivery", {
              filters: [
                ["customer_phone", "like", `%${digits}%`],
                ["docstatus", "!=", 2],
              ],
              fields: [
                "name",
                "customer_name",
                "customer_phone",
                "lsh_status",
                "lsh_delivery_address",
                "lsh_alteration_ticket",
              ],
              limit: 4,
              order_by: "modified desc",
            }).catch(() => [])
          : [];
      const byTicket =
        /ALT/i.test(q)
          ? await erpList<any>("LSH Delivery", {
              filters: [
                ["lsh_alteration_ticket", "like", like],
                ["docstatus", "!=", 2],
              ],
              fields: [
                "name",
                "customer_name",
                "lsh_status",
                "lsh_delivery_address",
                "lsh_alteration_ticket",
              ],
              limit: 4,
              order_by: "modified desc",
            }).catch(() => [])
          : [];

      const seen = new Set<string>();
      const out: any[] = [];
      for (const row of [...byName, ...byCust, ...byPhone, ...byTicket]) {
        if (seen.has(row.name)) continue;
        seen.add(row.name);
        out.push(row);
      }
      return out.slice(0, 8);
    })(),
  ]);

  // Customers
  if (customers.status === "fulfilled") {
    for (const c of customers.value ?? []) results.push(c);
  }

  // Merge tickets
  {
    const seen = new Set<string>();
    const tickets: any[] = [];
    for (const bundle of [ticketsByName, ticketsByCustomer, ticketsByPhone]) {
      if (bundle.status !== "fulfilled") continue;
      for (const t of bundle.value ?? []) {
        if (seen.has(t.name)) continue;
        seen.add(t.name);
        tickets.push(t);
      }
    }
    for (const t of tickets.slice(0, 10)) {
      results.push({
        type: "alteration",
        id: t.name,
        title: t.name,
        subtitle: t.customer_name,
        meta: [t.workflow_state, t.payment_status].filter(Boolean).join(" · ") || null,
        amount: moneyish(t.ticket_total),
        href: `/orders/alterations/${encodeURIComponent(t.name)}`,
      });
    }
  }

  // Sales Orders → open on-order intake with SO preselected
  if (salesOrders.status === "fulfilled") {
    for (const o of salesOrders.value ?? []) {
      const cust = encodeURIComponent(o.customer || "");
      const custName = encodeURIComponent(o.customer_name || "");
      const so = encodeURIComponent(o.name);
      results.push({
        type: "sales_order",
        id: o.name,
        title: o.name,
        subtitle: o.customer_name,
        meta: o.status,
        amount: moneyish(o.grand_total),
        href: `/intake/alterations?kind=on_order&so=${so}&customer=${cust}&customerName=${custName}`,
      });
    }
  }

  // Invoices → invoice detail
  if (invoices.status === "fulfilled") {
    for (const i of invoices.value ?? []) {
      results.push({
        type: "invoice",
        id: i.name,
        title: i.name,
        subtitle: i.alteration_ticket_ref
          ? `${i.customer_name} · ${i.alteration_ticket_ref}`
          : i.customer_name,
        meta: i.status,
        amount: moneyish(i.grand_total),
        outstanding: moneyish(i.outstanding_amount),
        href: `/invoices/${encodeURIComponent(i.name)}`,
      });
    }
  }

  // Deliveries
  if (deliveries.status === "fulfilled") {
    for (const d of deliveries.value ?? []) {
      results.push({
        type: "delivery",
        id: d.name,
        title: d.name,
        subtitle: [d.customer_name, d.lsh_delivery_address].filter(Boolean).join(" · ") || null,
        meta: d.lsh_status || null,
        href: `/deliveries/${encodeURIComponent(d.name)}`,
      });
    }
  }

  // Secondary sources (best-effort, alts-adjacent)
  try {
    const allFabrics = await listFabrics(true);
    const qLower = q.toLowerCase();
    const fabrics = allFabrics
      .filter(
        (f: any) =>
          String(f.fabric_name ?? "")
            .toLowerCase()
            .includes(qLower) ||
          String(f.mill ?? "")
            .toLowerCase()
            .includes(qLower) ||
          String(f.name ?? "")
            .toLowerCase()
            .includes(qLower),
      )
      .slice(0, 3);

    for (const f of fabrics) {
      results.push({
        type: "fabric",
        id: f.name,
        title: f.fabric_name,
        subtitle: f.mill ?? null,
        meta: f.name ? `#${f.name}` : null,
        href: `https://app.lstailors.com/reference/fabrics`,
      });
    }
  } catch {
    /* optional */
  }

  try {
    const notes = await listBrainEntriesFiltered({ summaryLike: q, limit: 2 });
    for (const n of notes) {
      results.push({
        type: "intelligence",
        id: n.name,
        title: n.summary,
        subtitle: `${n.agent_slug} · ${n.entry_type}`,
        meta: n.creation ? new Date(n.creation).toLocaleDateString() : null,
        href: `https://app.lstailors.com/comms`,
      });
    }
  } catch {
    /* optional */
  }

  try {
    const sms = await listSmsMessagesFiltered({ contentLike: q, limit: 2 });
    for (const s of sms) {
      results.push({
        type: "sms",
        id: s.name,
        title:
          (s.content?.slice(0, 80) ?? "") + ((s.content?.length ?? 0) > 80 ? "…" : ""),
        subtitle: s.client_phone,
        meta: s.direction,
        href: `https://app.lstailors.com/sofia`,
      });
    }
  } catch {
    /* optional */
  }

  // Rank: exact id matches first, then tickets/customers/deliveries, then rest
  const qLower = q.toLowerCase();
  results.sort((a, b) => {
    const score = (h: SearchHit) => {
      let s = 0;
      if (h.id.toLowerCase() === qLower) s += 100;
      if (h.id.toLowerCase().includes(qLower)) s += 40;
      if (h.title.toLowerCase() === qLower) s += 30;
      if (h.title.toLowerCase().includes(qLower)) s += 15;
      if (h.type === "alteration") s += 8;
      if (h.type === "customer") s += 7;
      if (h.type === "delivery") s += 6;
      if (h.type === "invoice") s += 5;
      if (h.type === "sales_order") s += 4;
      return s;
    };
    return score(b) - score(a);
  });

  return c.json({ data: { results: results.slice(0, 40), query: q } });
});
