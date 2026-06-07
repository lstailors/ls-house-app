import { Hono } from "hono";
import { supabaseAdmin } from "../lib/supabase";
import { getAuthedUser, canSeeFinancials } from "../lib/scope";
import { erpList } from "../lib/erp";

export const notificationsRouter = new Hono();

// Unified notification feed — approvals, tasks, brain flags, briefs.
// Sorted by urgency: critical → high → normal, then recency.

notificationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!supabaseAdmin) return c.json({ notifications: [], unread: 0 });

  const notifications: any[] = [];

  // ── Approval queue — pending items ─────────────────────────
  try {
    const { data: approvals } = await supabaseAdmin
      .from("approval_queue")
      .select("id, title, summary, category, created_at, status")
      .in("status", ["pending", "awaiting_second"])
      .order("created_at", { ascending: false })
      .limit(15);

    for (const a of approvals ?? []) {
      const isCritical =
        a.title?.toUpperCase().includes("CRITICAL") ||
        a.summary?.toUpperCase().includes("CRITICAL");
      notifications.push({
        id: `approval-${a.id}`,
        kind: "approval",
        priority: isCritical ? "critical" : "high",
        title: a.title ?? "Pending Approval",
        body: a.summary ?? null,
        category: a.category ?? null,
        ts: a.created_at,
        href: `/mission-control?tab=approvals&id=${a.id}`,
        read: false,
      });
    }
  } catch {}

  // ── Open tasks — overdue + high priority ──────────────────
  try {
    const now = new Date().toISOString();
    const { data: tasks } = await supabaseAdmin
      .from("ls_tasks")
      .select("id, task_no, title, priority, status, due_at, assigned_to_name")
      .in("status", ["pending", "in_progress"])
      .order("due_at", { ascending: true })
      .limit(20);

    for (const t of tasks ?? []) {
      const overdue = t.due_at && t.due_at < now;
      const isHigh = t.priority === "high" || t.priority === "critical" || overdue;
      if (!isHigh && notifications.filter(n => n.kind === "task").length >= 5) continue;

      notifications.push({
        id: `task-${t.id}`,
        kind: "task",
        priority: overdue ? "critical" : t.priority === "critical" ? "critical" : t.priority === "high" ? "high" : "normal",
        title: `${overdue ? "⚠ OVERDUE — " : ""}${t.title}`,
        body: t.assigned_to_name ? `Assigned to ${t.assigned_to_name}` : null,
        meta: t.due_at ? `Due ${new Date(t.due_at).toLocaleDateString()}` : null,
        ts: t.due_at ?? null,
        href: `/tasks?id=${t.id}`,
        read: false,
      });
    }
  } catch {}

  // ── Brain entries — flags and anomalies ───────────────────
  try {
    const { data: flags } = await supabaseAdmin
      .from("brain_entries")
      .select("id, summary, entry_type, agent_slug, created_at, detail")
      .in("entry_type", ["flag", "anomaly", "alert", "decision", "escalation"])
      .order("created_at", { ascending: false })
      .limit(8);

    for (const f of flags ?? []) {
      notifications.push({
        id: `brain-${f.id}`,
        kind: "intelligence",
        priority: f.entry_type === "flag" || f.entry_type === "alert" ? "high" : "normal",
        title: f.summary,
        body: f.detail ?? null,
        meta: `${f.agent_slug} · ${f.entry_type}`,
        ts: f.created_at,
        href: `/comms?flag=${f.id}`,
        read: false,
      });
    }
  } catch {}

  // ── Recent Maestro briefs ─────────────────────────────────
  try {
    const { data: briefs } = await supabaseAdmin
      .from("approval_queue")
      .select("id, title, summary, created_at")
      .ilike("category", "%brief%")
      .order("created_at", { ascending: false })
      .limit(3);

    for (const b of briefs ?? []) {
      notifications.push({
        id: `brief-${b.id}`,
        kind: "brief",
        priority: "normal",
        title: b.title ?? "Maestro Brief",
        body: b.summary?.slice(0, 120) + (b.summary?.length > 120 ? "…" : ""),
        ts: b.created_at,
        href: `/mission-control?tab=brief&id=${b.id}`,
        read: false,
      });
    }
  } catch {}

  // ── ERPNext ToDos — overdue + high priority ───────────────
  try {
    const today = new Date().toISOString().slice(0, 10);
    const todoFilters: unknown[] = [["status", "=", "Open"]];
    if (user.role !== "super_admin") todoFilters.push(["allocated_to", "=", user.email]);
    const todos = await erpList<any>("ToDo", {
      filters: todoFilters,
      fields: ["name", "description", "priority", "date", "allocated_to"],
      limit: 20,
    }).catch(() => [] as any[]);

    for (const t of todos) {
      const overdue = t.date && t.date < today;
      const isHigh = t.priority === "High" || overdue;
      if (!isHigh) continue;
      const desc = String(t.description ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 80);
      notifications.push({
        id: `todo-${t.name}`,
        kind: "todo",
        priority: overdue ? "critical" : "high",
        title: overdue ? `⚠ Overdue: ${desc}` : desc,
        body: t.allocated_to ? `→ ${t.allocated_to.split("@")[0]}` : null,
        meta: t.date ? `Due ${t.date}` : null,
        ts: t.date ?? null,
        href: `/tasks`,
        read: false,
      });
    }
  } catch {}

  // ── Ready-to-deliver orders ───────────────────────────────
  if (canSeeFinancials(user.role)) {
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
      const readyOrders = await erpList<any>("Sales Order", {
        filters: [["status", "=", "To Deliver and Bill"], ["modified", ">=", weekAgo]],
        fields: ["name", "customer_name", "delivery_date", "modified"],
        limit: 5,
      }).catch(() => [] as any[]);

      for (const o of readyOrders) {
        notifications.push({
          id: `ready-${o.name}`,
          kind: "order_ready",
          priority: "high",
          title: `${o.customer_name}'s order is ready`,
          body: `${o.name} — ready to deliver`,
          ts: o.modified,
          href: `/sales-orders/${o.name}`,
          read: false,
        });
      }
    } catch {}
  }

  // ── Overdue invoices ──────────────────────────────────────
  if (canSeeFinancials(user.role)) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: invoices } = await supabaseAdmin
        .from("erp_sales_invoices")
        .select("id, erp_name, erp_customer, end_customer, outstanding_amount, due_date")
        .lt("due_date", today)
        .gt("outstanding_amount", 0)
        .order("due_date", { ascending: true })
        .limit(5);

      for (const i of invoices ?? []) {
        notifications.push({
          id: `inv-${i.id}`,
          kind: "invoice",
          priority: "high",
          title: `Overdue Invoice — ${i.erp_name}`,
          body: `${i.end_customer ?? i.erp_customer} · $${Number(i.outstanding_amount).toLocaleString()} outstanding`,
          ts: i.due_date,
          href: `/invoices?id=${i.erp_name}`,
          read: false,
        });
      }
    } catch {}
  }

  // Sort: critical first, then high, then normal; within tier sort by recency
  const priority = (p: string) => (p === "critical" ? 0 : p === "high" ? 1 : 2);
  notifications.sort((a, b) => {
    const pd = priority(a.priority) - priority(b.priority);
    if (pd !== 0) return pd;
    return new Date(b.ts ?? 0).getTime() - new Date(a.ts ?? 0).getTime();
  });

  const unread = notifications.filter((n) => !n.read).length;

  return c.json({ data: { notifications: notifications.slice(0, 40), unread } });
});
