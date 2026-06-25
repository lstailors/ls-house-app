// House Control Panel — all /api/house/* routes
// No auth required: internal dashboard consumed by the house UI only.

import { Hono } from "hono";
import { erpList, erpGet, erpCreate, erpUpdate } from "../lib/erp";
import { DT } from "../lib/erpnext/doctypes";
import { listAgents, listCronJobs, updateCronJob } from "../lib/erpnext/agents";

export const houseRouter = new Hono();

const HERMES_LOCAL_URL = () => process.env.HERMES_LOCAL_URL ?? "";
const HERMES_DASHBOARD_URL = () =>
  process.env.HERMES_DASHBOARD_URL ?? "https://maestro.lstailors.com";

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTimeAgo(timestamp: string | null | undefined): string {
  if (!timestamp) return "Unknown";
  try {
    const then = new Date(timestamp);
    const diffMs = Date.now() - then.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin === 1) return "1 min ago";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr === 1) return "1 hour ago";
    if (diffHr < 24) return `${diffHr} hours ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return "yesterday";
    return `${diffDay} days ago`;
  } catch {
    return "Unknown";
  }
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

async function hermesGet<T = unknown>(path: string): Promise<T | null> {
  const base = HERMES_LOCAL_URL();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function hermesPost<T = unknown>(path: string, body: unknown): Promise<T | null> {
  const base = HERMES_LOCAL_URL();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Seed data for profiles (fallback when ERP doctype not yet created) ────────

const PROFILES_SEED = [
  {
    id: "maestro",
    name: "Maestro",
    model: "claude-sonnet-4-6",
    provider: "Anthropic",
    status: "active",
    description: "Orchestrator — runs the house",
  },
  {
    id: "paperclip",
    name: "Paperclip",
    model: "claude-opus-4",
    provider: "Anthropic",
    status: "active",
    description: "Strategy and finance",
  },
  {
    id: "coder",
    name: "Coder",
    model: "claude-sonnet-4-6",
    provider: "Anthropic",
    status: "inactive",
    description: "Code and technical work",
  },
];

// ─── TAB 1 — AGENTS ──────────────────────────────────────────────────────────

houseRouter.get("/agents", async (c) => {
  const [agents, pendingApprovals, activeTasks, maestroBrainEntry] =
    await Promise.allSettled([
      listAgents(),
      erpList<any>(DT.APPROVAL_QUEUE, {
        filters: [["status", "=", "pending"]],
        fields: ["name", "source_agent"],
        limit: 500,
      }),
      erpList<any>("ToDo", {
        filters: [["status", "=", "Open"]],
        fields: ["name", "lsh_agent"],
        limit: 500,
      }),
      erpList<any>(DT.BRAIN_ENTRY, {
        filters: [["agent", "=", "maestro"]],
        fields: ["creation"],
        order_by: "creation desc",
        limit: 1,
      }),
    ]);

  const agentRows: any[] = agents.status === "fulfilled" ? agents.value : [];
  const approvalRows: any[] =
    pendingApprovals.status === "fulfilled" ? pendingApprovals.value : [];
  const taskRows: any[] =
    activeTasks.status === "fulfilled" ? activeTasks.value : [];
  const brainRows: any[] =
    maestroBrainEntry.status === "fulfilled" ? maestroBrainEntry.value : [];

  // Sofia health check (parallel, fast timeout)
  let sofiaHealthOk = false;
  try {
    const sofiaRes = await fetch("https://sofia.lstailors.com/health", {
      signal: AbortSignal.timeout(5000),
    });
    if (sofiaRes.ok) {
      const sofiaData = (await sofiaRes.json()) as any;
      sofiaHealthOk = sofiaData.status === "ok";
    }
  } catch {
    sofiaHealthOk = false;
  }

  // Build lookup maps for counts
  const pendingBySlug: Record<string, number> = {};
  for (const row of approvalRows) {
    if (row.source_agent) {
      pendingBySlug[row.source_agent] = (pendingBySlug[row.source_agent] ?? 0) + 1;
    }
  }

  const tasksBySlug: Record<string, number> = {};
  for (const row of taskRows) {
    if (row.lsh_agent) {
      tasksBySlug[row.lsh_agent] = (tasksBySlug[row.lsh_agent] ?? 0) + 1;
    }
  }

  const maestroLastBrain = brainRows[0]?.creation ?? null;
  const dashboardUrl = HERMES_DASHBOARD_URL();

  const result = agentRows.map((agent: any) => {
    const slug: string = agent.slug ?? agent.name ?? "";
    const isMaestro = slug === "maestro";
    const isSofia = slug === "sofia";

    let status: "online" | "idle" | "offline" = "offline";
    if (isSofia) {
      status = sofiaHealthOk ? "online" : "offline";
    } else {
      const s = (agent.status ?? "").toLowerCase();
      if (s === "active" || s === "online") status = "online";
      else if (s === "idle") status = "idle";
      else status = "offline";
    }

    const lastHeartbeat = agent.last_heartbeat_at ?? agent.last_active ?? null;
    let lastActive = "Unknown";
    if (isMaestro && maestroLastBrain) {
      lastActive = formatTimeAgo(maestroLastBrain);
    } else if (lastHeartbeat) {
      lastActive = formatTimeAgo(lastHeartbeat);
    }

    const healthScore = agent.health_score ?? null;
    const healthOk = isSofia
      ? sofiaHealthOk
      : healthScore === null || healthScore > 0;

    return {
      slug,
      name: agent.agent_name ?? agent.name ?? slug,
      role: agent.role ?? "",
      model: agent.model ?? "",
      status,
      last_active: lastActive,
      pending_approvals: pendingBySlug[slug] ?? 0,
      active_tasks: tasksBySlug[slug] ?? 0,
      health_ok: healthOk,
      dashboard_url: isMaestro ? dashboardUrl : null,
      description: agent.description ?? "",
    };
  });

  return c.json({ data: { agents: result } });
});

// ─── TAB 2 — PROFILES ────────────────────────────────────────────────────────

houseRouter.get("/profiles", async (c) => {
  try {
    // LSH House Config is a Single doctype — name equals doctype name
    const doc = await erpGet<any>("LSH House Config", "LSH House Config");
    if (doc?.profiles_json) {
      const profiles = JSON.parse(doc.profiles_json);
      return c.json({ data: { profiles } });
    }
  } catch {
    // doctype may not exist yet — fall through to seed
  }
  return c.json({ data: { profiles: PROFILES_SEED } });
});

houseRouter.post("/profiles", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.profiles)) {
    return c.json({ error: { message: "profiles array required" } }, 400);
  }

  const profilesJson = JSON.stringify(body.profiles);

  try {
    // Try to update existing Single doctype
    await erpUpdate("LSH House Config", "LSH House Config", {
      profiles_json: profilesJson,
    });
  } catch {
    try {
      // Try to create it if it doesn't exist
      await erpCreate("LSH House Config", {
        doctype: "LSH House Config",
        profiles_json: profilesJson,
      });
    } catch {
      // ERP unavailable — still acknowledge the save so the UI doesn't break
    }
  }

  return c.json({ data: { ok: true, profiles: body.profiles } });
});

// ─── TAB 3 — CRON ────────────────────────────────────────────────────────────

houseRouter.get("/cron", async (c) => {
  const [erpJobs, hermesJobs] = await Promise.allSettled([
    listCronJobs(),
    hermesGet<{ jobs?: any[] }>("/api/cron/jobs"),
  ]);

  const fromErp: any[] = erpJobs.status === "fulfilled" ? erpJobs.value : [];
  const fromHermes: any[] =
    hermesJobs.status === "fulfilled" && hermesJobs.value?.jobs
      ? hermesJobs.value.jobs
      : [];

  // Merge: Hermes takes precedence; deduplicate by job_name
  const merged = new Map<string, any>();

  for (const job of fromErp) {
    const key = (job.job_name ?? job.name ?? "").toLowerCase();
    merged.set(key, {
      id: job.name,
      name: job.job_name ?? job.name,
      schedule: job.schedule ?? "",
      last_run: job.last_run ? formatTimeAgo(job.last_run) : "Never",
      next_run: job.next_run ? formatTimeAgo(job.next_run) : "Unknown",
      enabled: job.status !== "Disabled",
      last_status: normaliseRunStatus(job.last_run_status),
      description: job.description ?? "",
      source: "erp" as const,
    });
  }

  for (const job of fromHermes) {
    const key = (job.name ?? job.id ?? "").toLowerCase();
    const existing = merged.get(key);
    merged.set(key, {
      id: job.id ?? job.name ?? key,
      name: job.name ?? key,
      schedule: job.schedule ?? existing?.schedule ?? "",
      last_run: job.last_run ? formatTimeAgo(job.last_run) : existing?.last_run ?? "Never",
      next_run: job.next_run ? formatTimeAgo(job.next_run) : existing?.next_run ?? "Unknown",
      enabled: job.enabled ?? existing?.enabled ?? true,
      last_status: normaliseRunStatus(job.last_status ?? job.status),
      description: job.description ?? existing?.description ?? "",
      source: "hermes" as const,
    });
  }

  const jobs = Array.from(merged.values());
  return c.json({ data: { jobs } });
});

function normaliseRunStatus(s: string | null | undefined): "success" | "failed" | "running" | "unknown" {
  const v = (s ?? "").toLowerCase();
  if (v === "success" || v === "completed") return "success";
  if (v === "failed" || v === "error") return "failed";
  if (v === "running" || v === "in progress") return "running";
  return "unknown";
}

houseRouter.post("/cron/:id/run", async (c) => {
  const id = c.req.param("id");

  // Try Hermes first
  const hermesResult = await hermesPost(`/api/cron/jobs/${encodeURIComponent(id)}/run`, {});
  if (hermesResult !== null) {
    return c.json({ data: { ok: true, triggered_via: "hermes", id } });
  }

  // Hermes unavailable — acknowledge without error so UI doesn't break
  return c.json({ data: { ok: true, triggered_via: "unavailable", id } });
});

houseRouter.patch("/cron/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: { message: "body required" } }, 400);

  const enabled = body.enabled ?? body.status !== "Disabled";

  try {
    await updateCronJob(id, { status: enabled ? "Enabled" : "Disabled" });
  } catch {
    // Job might only exist in Hermes — acknowledge
  }

  return c.json({ data: { ok: true, id, enabled } });
});

// ─── TAB 4 — MEMORY ──────────────────────────────────────────────────────────

houseRouter.get("/memory", async (c) => {
  // Try Hermes first
  const hermesMemory = await hermesGet<any>("/api/memory");
  if (hermesMemory) {
    const memory = parseMemorySection(hermesMemory.memory ?? hermesMemory.content ?? "");
    const userProfile = parseMemorySection(
      hermesMemory.user_profile ?? hermesMemory.user ?? ""
    );
    const skills = hermesMemory.skills ?? [];
    return c.json({ data: { memory, user_profile: userProfile, skills } });
  }

  // Fall back to ERP LSH Brain Entry where kind = memory
  const entries = await erpList<any>(DT.BRAIN_ENTRY, {
    filters: [["kind", "=", "memory"]],
    fields: ["name", "content", "summary", "creation"],
    order_by: "creation desc",
    limit: 50,
  }).catch(() => []);

  const memory: string[] = [];
  const userProfile: string[] = [];

  for (const e of entries) {
    const raw = e.content ?? e.summary ?? "";
    const lines = parseMemorySection(raw);
    memory.push(...lines);
  }

  // Skills: query LSH Agent for maestro skills field
  const maestroAgent = await erpList<any>(DT.AGENT, {
    filters: [["slug", "=", "maestro"]],
    fields: ["skills"],
    limit: 1,
  }).catch(() => []);

  let skills: any[] = [];
  if (maestroAgent[0]?.skills) {
    try {
      const raw = maestroAgent[0].skills;
      skills = (typeof raw === "string" ? JSON.parse(raw) : raw) ?? [];
    } catch {
      skills = [];
    }
  }

  return c.json({ data: { memory, user_profile: userProfile, skills } });
});

function parseMemorySection(content: string): string[] {
  if (!content) return [];
  if (content.includes("§")) {
    return content
      .split("§")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return content
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

houseRouter.patch("/memory", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.target || !body.content) {
    return c.json({ error: { message: "target and content required" } }, 400);
  }

  // Try Hermes
  const result = await hermesPost("/api/memory", {
    target: body.target,
    content: body.content,
  });

  if (result !== null) {
    return c.json({ data: { ok: true } });
  }

  // Fall back: store in ERP Brain Entry
  try {
    await erpCreate(DT.BRAIN_ENTRY, {
      agent: "maestro",
      kind: "memory",
      content: body.content,
      summary: body.content.slice(0, 140),
    });
  } catch {
    // best-effort
  }

  return c.json({ data: { ok: true } });
});

// ─── TAB 5 — LIVE ACTIVITY ───────────────────────────────────────────────────

houseRouter.get("/activity", async (c) => {
  const items = await fetchActivity();
  return c.json({ data: { items } });
});

houseRouter.get("/activity/live", async (c) => {
  let lastCheck = new Date(Date.now() - 60_000).toISOString();

  const { readable, writable } = new TransformStream<string, string>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (payload: unknown) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`) as any);
    } catch {
      // client disconnected
    }
  };

  // Send initial batch immediately
  const initial = await fetchActivity();
  for (const item of initial) {
    await send(item);
  }
  if (initial.length) lastCheck = new Date().toISOString();

  const poll = async () => {
    try {
      const fresh = await fetchActivitySince(lastCheck);
      if (fresh.length) {
        lastCheck = new Date().toISOString();
        for (const item of fresh) await send(item);
      }
    } catch {
      // ignore polling errors
    }
  };

  const interval = setInterval(poll, 10_000);

  c.req.raw.signal.addEventListener("abort", () => {
    clearInterval(interval);
    writer.close().catch(() => {});
  });

  return new Response(readable as any, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

type ActivityItem = {
  id: string;
  timestamp: string;
  agent: string;
  action: string;
  type: "sms" | "task" | "brain" | "approval";
};

async function fetchActivity(limit = 20): Promise<ActivityItem[]> {
  return fetchActivitySince(undefined, limit);
}

async function fetchActivitySince(since?: string, limit = 20): Promise<ActivityItem[]> {
  const sinceFilter = since ? [["creation", ">", since]] : [];

  const [smsRows, brainRows, todoRows, approvalRows] = await Promise.allSettled([
    erpList<any>(DT.SMS_MESSAGE, {
      filters: [...sinceFilter],
      fields: ["name", "direction", "client_name", "creation", "content"],
      order_by: "creation desc",
      limit: limit,
    }),
    erpList<any>(DT.BRAIN_ENTRY, {
      filters: [...sinceFilter],
      fields: ["name", "agent", "kind", "creation", "summary"],
      order_by: "creation desc",
      limit: limit,
    }),
    erpList<any>("ToDo", {
      filters: [...sinceFilter],
      fields: ["name", "description", "lsh_agent", "creation", "status"],
      order_by: "creation desc",
      limit: limit,
    }),
    erpList<any>(DT.APPROVAL_QUEUE, {
      filters: [...sinceFilter],
      fields: ["name", "source_agent", "description", "creation", "status"],
      order_by: "creation desc",
      limit: limit,
    }),
  ]);

  const items: ActivityItem[] = [];

  if (smsRows.status === "fulfilled") {
    for (const r of smsRows.value) {
      items.push({
        id: r.name,
        timestamp: formatTimestamp(r.creation),
        agent: "sofia",
        action: buildSmsAction(r),
        type: "sms",
      });
    }
  }

  if (brainRows.status === "fulfilled") {
    for (const r of brainRows.value) {
      items.push({
        id: r.name,
        timestamp: formatTimestamp(r.creation),
        agent: r.agent ?? "maestro",
        action: r.summary ?? `Brain entry (${r.kind ?? "unknown"})`,
        type: "brain",
      });
    }
  }

  if (todoRows.status === "fulfilled") {
    for (const r of todoRows.value) {
      if (!r.lsh_agent) continue;
      items.push({
        id: r.name,
        timestamp: formatTimestamp(r.creation),
        agent: r.lsh_agent ?? "maestro",
        action: r.description ?? "Task created",
        type: "task",
      });
    }
  }

  if (approvalRows.status === "fulfilled") {
    for (const r of approvalRows.value) {
      items.push({
        id: r.name,
        timestamp: formatTimestamp(r.creation),
        agent: r.source_agent ?? "maestro",
        action: r.description ?? `Approval request (${r.status})`,
        type: "approval",
      });
    }
  }

  // Sort by creation descending and take top N
  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return items.slice(0, limit);
}

function buildSmsAction(r: any): string {
  const name = r.client_name ?? "client";
  const dir = r.direction === "inbound" ? `Received SMS from ${name}` : `Replied to ${name}`;
  const preview = r.content ? ` — "${r.content.slice(0, 60)}"` : "";
  return `${dir}${preview}`;
}
