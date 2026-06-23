import { Hono } from "hono";
import { getAuthedUser, canSeeFinancials } from "../lib/scope";
import { erpList } from "../lib/erp";
import { listApprovalQueue, listBrainEntriesFiltered } from "../lib/erpnext/agents";

export const notificationsRouter = new Hono();

notificationsRouter.get("/", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const notifications: any[] = [];

  try {
    const approvals = await listApprovalQueue({ status: ["pending", "awaiting_second"], limit: 15 });
    for (const a of approvals) {
      const isCritical =
        a.title?.toUpperCase().includes("CRITICAL") ||
        a.summary?.toUpperCase().includes("CRITICAL");
      notifications.push({
        id: `approval-${a.name}`,
        kind: "approval",
        priority: isCritical ? "critical" : "high",
        title: a.title ?? "Pending Approval",
        body: a.summary ?? null,
        category: a.category ?? null,
        ts: a.creation,
        href: `/mission-control?tab=approvals&id=${a.name}`,
        read: false,
      });
    }
  } catch {}

  try {
    const erpBase = process.env.ERPNEXT_BASE_URL ?? "https://erp.lstailors.com";
    const erpAuth = `token ${process.env.ERPNEXT_API_KEY ?? ""}:${process.env.ERPNEXT_API_SECRET ?? ""}`;
    const filters = JSON.stringify([["ToDo","status","=","Open"],["ToDo","allocated_to","=","carl@lstailors.com"]]);
    const fields = JSON.stringify(["name","description","date","priority","lsh_context"]);
    const erpRes = await fetch(`${erpBase}/api/resource/ToDo?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}&order_by=date+asc&limit_page_length=20`, {
      headers: { Authorization: erpAuth },
    });
    const erpData = await erpRes.json() as any;
    const today = new Date().toISOString().slice(0, 10);
    for (const t of (erpData?.data ?? [])) {
      const overdue = t.date && t.date < today;
      const isHigh = t.priority === "High" || overdue;
      if (!isHigh && notifications.filter((n: any) => n.kind === "task").length >= 5) continue;
      notifications.push({
        id: `todo-${t.name}`,
        kind: "task",
        priority: overdue ? "critical" : t.priority === "High" ? "high" : "normal",
        title: `${overdue ? "⚠ OVERDUE — " : ""}${t.description}`,
        body: t.lsh_context ?? null,
        meta: t.date ? `Due ${t.date}` : null,
        ts: t.date ?? null,
        href: `/tasks`,
        read: false,
      });
    }
  } catch {}

  try {
    const flags = await listBrainEntriesFiltered({
      entryTypes: ["flag", "anomaly", "alert", "decision", "escalation"],
      limit: 8,
    });
    for (const f of flags) {
      notifications.push({
        id: `brain-${f.name}`,
        kind: "intelligence",
        priority: f.entry_type === "flag" || f.entry_type === "alert" ? "high" : "normal",
        title: f.summary,
        body: f.detail ?? null,
        meta: `${f.agent_slug} · ${f.entry_type}`,
        ts: f.creation,
        href: `/comms?flag=${f.name}`,
        read: false,
      });
    }
  } catch {}

  try {
    const briefs = await listApprovalQueue({ limit: 3 });
    const briefItems = briefs.filter((b: any) => String(b.category ?? "").toLowerCase().includes("brief"));
    for (const b of briefItems) {
      notifications.push({
        id: `brief-${b.name}`,
        kind: "brief",
        priority: "normal",
        title: b.title ?? "Maestro Brief",
        body: b.summary?.slice(0, 120) + (b.summary?.length > 120 ? "…" : ""),
        ts: b.creation,
        href: `/mission-control?tab=brief&id=${b.name}`,
        read: false,
      });
    }
  } catch {}

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

  if (canSeeFinancials(user.role)) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const invoices = await erpList<any>("Sales Invoice", {
        filters: [["docstatus", "=", 1], ["due_date", "<", today], ["outstanding_amount", ">", 0]],
        fields: ["name", "customer_name", "outstanding_amount", "due_date"],
        order_by: "due_date asc",
        limit: 5,
      }).catch(() => [] as any[]);

      for (const i of invoices) {
        notifications.push({
          id: `inv-${i.name}`,
          kind: "invoice",
          priority: "high",
          title: `Overdue Invoice — ${i.name}`,
          body: `${i.customer_name} · $${Number(i.outstanding_amount).toLocaleString()} outstanding`,
          ts: i.due_date,
          href: `/invoices?id=${i.name}`,
          read: false,
        });
      }
    } catch {}
  }

  try {
    const hdFilters: unknown[] = [["status", "not in", ["Closed", "Resolved"]]];
    if (user.role !== "super_admin" && user.role !== "store_manager") {
      hdFilters.push(["_assign", "like", `%${user.email}%`]);
    }
    const hdTickets = await erpList<any>("HD Ticket", {
      filters: hdFilters,
      fields: ["name", "subject", "status", "priority", "creation", "_assign"],
      limit: 20,
    }).catch(() => [] as any[]);

    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const t of hdTickets) {
      const daysOpen = Math.floor((now - new Date(t.creation).getTime()) / DAY_MS);
      const escalated = daysOpen >= 3;
      if (!escalated && t.priority !== "High" && t.priority !== "Urgent") continue;
      const isUrgent = t.priority === "Urgent" || daysOpen >= 5;
      notifications.push({
        id: `hd-${t.name}`,
        kind: "helpdesk",
        priority: isUrgent ? "critical" : "high",
        title: escalated ? `${daysOpen}d open — ${t.subject ?? t.name}` : `${t.priority}: ${t.subject ?? t.name}`,
        body: `${t.name} · ${t.status}`,
        meta: `Helpdesk · ${daysOpen}d`,
        ts: t.creation,
        href: `/helpdesk/${t.name}`,
        read: false,
      });
    }
  } catch {}

  const priority = (p: string) => (p === "critical" ? 0 : p === "high" ? 1 : 2);
  notifications.sort((a, b) => {
    const pd = priority(a.priority) - priority(b.priority);
    if (pd !== 0) return pd;
    return new Date(b.ts ?? 0).getTime() - new Date(a.ts ?? 0).getTime();
  });

  const unread = notifications.filter((n) => !n.read).length;
  return c.json({ data: { notifications: notifications.slice(0, 40), unread } });
});
