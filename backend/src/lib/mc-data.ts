// Mission Control data access — Supabase snapshots first, ERP fallback.
// Vercel Edge cannot rely on Studio-local Hermes; Studio writers fill lsh.*.

import { lshSelect, supabaseConfig } from "./supabase-lsh";
import {
  listAgents as erpListAgents,
  getAgentBySlug as erpGetAgent,
  listAgentEvents as erpListEvents,
  listAgentTasks as erpListTasks,
  listAgentBriefs as erpListBriefs,
  listAgentCosts as erpListCosts,
  listCronJobs as erpListCronJobs,
  listAuditLogs as erpListAudit,
  listApprovalQueue as erpListApprovals,
  listAgentMessages as erpListMessages,
} from "./erpnext/agents";

function aliasSlugs(slug: string): string[] {
  if (slug === "maestro") return ["maestro", "hermes"];
  if (slug === "hermes") return ["hermes", "maestro"];
  if (slug === "melena") return ["melena", "melana"];
  if (slug === "melana") return ["melana", "melena"];
  return [slug];
}

function mapSbAgent(row: any) {
  return {
    ...row,
    id: row.id || row.slug,
    name: row.name || row.agent_name || row.slug,
    agent_name: row.name || row.agent_name,
    created_at: row.created_at || row.creation,
    settings: typeof row.settings === "string" ? safeJson(row.settings) : row.settings || {},
    stats: typeof row.stats === "string" ? safeJson(row.stats) : row.stats || {},
  };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export async function mcListAgents(): Promise<any[]> {
  if (supabaseConfig()) {
    try {
      const rows = await lshSelect<any>("agents", {
        order: "sort_order.asc.nullslast,name.asc",
        limit: 100,
      });
      if (rows.length) return rows.map(mapSbAgent);
    } catch (e) {
      console.error("[mcListAgents] sb", (e as Error).message);
    }
  }
  const erp = await erpListAgents();
  return erp.map((r: any) => ({
    ...r,
    id: r.name,
    name: r.agent_name ?? r.slug,
    created_at: r.creation,
  }));
}

export async function mcGetAgent(slug: string): Promise<any | null> {
  if (supabaseConfig()) {
    try {
      for (const s of aliasSlugs(slug)) {
        const rows = await lshSelect<any>("agents", {
          filters: [`slug=eq.${s}`],
          limit: 1,
        });
        if (rows[0]) {
          const a = mapSbAgent(rows[0]);
          if (slug === "maestro") a.slug = "maestro";
          return a;
        }
      }
    } catch (e) {
      console.error("[mcGetAgent] sb", (e as Error).message);
    }
  }
  return erpGetAgent(slug);
}

export async function mcListActivity(opts: {
  agentSlug?: string;
  limit?: number;
  sinceHours?: number;
} = {}): Promise<any[]> {
  const limit = opts.limit ?? 100;
  if (supabaseConfig()) {
    try {
      const filters: string[] = [];
      if (opts.agentSlug) {
        // postgrest or across aliases is awkward; fetch then filter
      }
      if (opts.sinceHours) {
        const since = new Date(Date.now() - opts.sinceHours * 3600000).toISOString();
        filters.push(`occurred_at=gte.${since}`);
      }
      let rows = await lshSelect<any>("activity_feed", {
        filters,
        order: "occurred_at.desc",
        limit: Math.min(limit * 2, 400),
      });
      if (opts.agentSlug) {
        const aliases = new Set(aliasSlugs(opts.agentSlug));
        rows = rows.filter((r) => aliases.has(r.agent_slug));
      }
      rows = rows.slice(0, limit);
      if (rows.length) {
        return rows.map((r) => ({
          id: r.id,
          agent_slug: r.agent_slug,
          event_type: r.kind,
          title: r.title,
          body: r.body,
          severity: r.severity || "info",
          metadata: r.metadata || {},
          created_at: r.occurred_at,
          source: r.source,
          ref: r.ref,
          kind: r.kind,
        }));
      }
    } catch (e) {
      console.error("[mcListActivity] sb", (e as Error).message);
    }
  }

  // ERP fallback (+ maestro/hermes alias)
  if (opts.agentSlug) {
    const chunks = await Promise.all(
      aliasSlugs(opts.agentSlug).map((s) => erpListEvents({ agentSlug: s, limit }))
    );
    const merged = chunks.flat();
    merged.sort((a: any, b: any) => String(b.creation).localeCompare(String(a.creation)));
    return merged.slice(0, limit).map((r: any) => ({
      ...r,
      id: r.name,
      created_at: r.creation,
      agent_slug: r.agent_slug === "hermes" ? "maestro" : r.agent_slug,
    }));
  }
  const all = await erpListEvents({ limit });
  return all.map((r: any) => ({
    ...r,
    id: r.name,
    created_at: r.creation,
    agent_slug: r.agent_slug === "hermes" ? "maestro" : r.agent_slug,
  }));
}

export async function mcListCosts(sinceDay: string): Promise<any[]> {
  if (supabaseConfig()) {
    try {
      const rows = await lshSelect<any>("agent_costs", {
        filters: [`day=gte.${sinceDay}`],
        order: "day.desc",
        limit: 2000,
      });
      if (rows.length) return rows;
    } catch (e) {
      console.error("[mcListCosts] sb", (e as Error).message);
    }
  }
  return erpListCosts({ since: sinceDay });
}

export async function mcListCronJobs(): Promise<any[]> {
  // Prefer live hermes health snapshot
  if (supabaseConfig()) {
    try {
      const health = await lshSelect<any>("cron_health", {
        order: "profile.asc,job_name.asc",
        limit: 500,
      });
      if (health.length) {
        return health.map((r) => ({
          id: `${r.profile}:${r.job_id}`,
          name: `${r.profile}:${r.job_id}`,
          job_name: r.job_name,
          agent_slug: r.profile,
          profile: r.profile,
          schedule: r.schedule_display,
          enabled: !!r.enabled,
          last_run_at: r.last_run_at,
          next_run_at: r.next_run_at,
          last_run_status: r.last_status,
          last_error: r.last_error || r.last_delivery_error,
          health_color: r.health_color,
          model: r.model || r.model_snapshot,
          model_drift: r.model_drift,
          source: "hermes",
        }));
      }
    } catch (e) {
      console.error("[mcListCronJobs] sb", (e as Error).message);
    }
  }
  const erp = await erpListCronJobs();
  return erp.map((r: any) => ({ ...r, id: r.name, source: "erp" }));
}

export async function mcListAudit(opts: { agentSlug?: string; limit?: number } = {}): Promise<any[]> {
  // Prefer activity feed severities warning/error + all as audit trail
  const act = await mcListActivity({
    agentSlug: opts.agentSlug,
    limit: opts.limit ?? 100,
  });
  if (act.length) {
    return act.map((r) => ({
      id: r.id,
      agent_slug: r.agent_slug,
      action: r.event_type || r.kind,
      event_type: r.event_type || r.kind,
      title: r.title,
      detail: r.body,
      body: r.body,
      severity: r.severity,
      created_at: r.created_at,
      metadata: r.metadata,
    }));
  }
  const erp = await erpListAudit({ agentSlug: opts.agentSlug, limit: opts.limit });
  return erp.map((r: any) => ({ ...r, id: r.name, created_at: r.creation }));
}

export async function mcListBriefs(limit = 20): Promise<any[]> {
  if (supabaseConfig()) {
    try {
      const rows = await lshSelect<any>("agent_briefs", {
        order: "created_at.desc",
        limit,
      });
      if (rows.length) {
        return rows.map((r) => ({
          ...r,
          id: r.id,
          created_at: r.created_at,
          agent_slug: r.source,
        }));
      }
    } catch (e) {
      console.error("[mcListBriefs] sb", (e as Error).message);
    }
  }
  const erp = await erpListBriefs({ limit });
  return erp.map((r: any) => ({ ...r, id: r.name, created_at: r.creation }));
}

export async function mcListTasksForAgent(slug: string, status?: string[]): Promise<any[]> {
  // Merge ERP agent tasks + kanban snapshot for assignee
  const out: any[] = [];
  if (supabaseConfig()) {
    try {
      for (const s of aliasSlugs(slug)) {
        const cards = await lshSelect<any>("kanban_snapshot", {
          filters: [`assignee=eq.${s}`],
          order: "priority.desc",
          limit: 100,
        });
        for (const c of cards) {
          out.push({
            id: c.task_id,
            name: c.task_id,
            title: c.title,
            description: c.body,
            status: c.status,
            assigned_to: c.assignee,
            priority: c.priority,
            result: c.result_summary,
            created_at: c.created_at,
            source: "kanban",
          });
        }
      }
    } catch (e) {
      console.error("[mcListTasks] kanban", (e as Error).message);
    }
  }
  try {
    for (const s of aliasSlugs(slug)) {
      const erp = await erpListTasks({ assignedTo: s, status, limit: 50 });
      for (const t of erp) {
        out.push({ ...t, id: t.name, created_at: t.creation, source: "erp" });
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export async function mcListApprovals(status: string[] = ["pending", "awaiting_second"]) {
  try {
    return await erpListApprovals({ status, limit: 100 });
  } catch {
    return [];
  }
}

export async function mcListMessages(slug: string, limit = 50) {
  if (supabaseConfig()) {
    try {
      for (const s of aliasSlugs(slug)) {
        const rows = await lshSelect<any>("agent_messages", {
          filters: [`agent_slug=eq.${s}`],
          order: "created_at.asc",
          limit,
        });
        if (rows.length) {
          return rows.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            created_at: m.created_at,
          }));
        }
      }
    } catch (e) {
      console.error("[mcListMessages] sb", (e as Error).message);
    }
  }
  const erp = await erpListMessages({ agentSlug: slug, limit });
  return erp.map((m: any) => ({
    id: m.name,
    role: m.role,
    content: m.content,
    created_at: m.creation,
  }));
}
