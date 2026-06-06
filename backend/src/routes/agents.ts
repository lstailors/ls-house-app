     1|// Mission Control — Agent management routes
     2|// Auth: super_admin + store_manager only (unless noted)
     3|
     4|import { Hono } from "hono";
     5|import { supabaseAdmin } from "../lib/supabase";
     6|import { getAuthedUser } from "../lib/scope";
     7|
     8|// Call Anthropic via raw fetch — compatible with Edge runtime
     9|async function callAnthropic(system: string, messages: { role: string; content: string }[]): Promise<string> {
    10|  const key = process.env.ANTHROPIC_API_KEY;
    11|  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
    12|
    13|  const res = await fetch("https://api.anthropic.com/v1/messages", {
    14|    method: "POST",
    15|    headers: {
    16|      "Content-Type": "application/json",
    17|      "x-api-key": key,
    18|      "anthropic-version": "2023-06-01",
    19|    },
    20|    body: JSON.stringify({
    21|      model: "claude-sonnet-4-5",
    22|      max_tokens: 1024,
    23|      system,
    24|      messages,
    25|    }),
    26|  });
    27|
    28|  if (!res.ok) {
    29|    const err = await res.text();
    30|    throw new Error(`Anthropic ${res.status}: ${err}`);
    31|  }
    32|
    33|  const data: any = await res.json();
    34|  return data.content?.[0]?.text ?? "(no response)";
    35|}
    36|
    37|export const agentsRouter = new Hono();
    38|
    39|const lshAdmin = () => (supabaseAdmin as any).schema("lsh");
    40|
    41|// ── Helpers ──────────────────────────────────────────────────────────────────
    42|
    43|function isMissionControl(role: string): boolean {
    44|  return role === "super_admin" || role === "store_manager";
    45|}
    46|
    47|// Priority sort order (higher = more urgent)
    48|const PRIORITY_WEIGHT: Record<string, number> = {
    49|  urgent: 4,
    50|  high: 3,
    51|  medium: 2,
    52|  low: 1,
    53|};
    54|
    55|// ── GET /api/agents ──────────────────────────────────────────────────────────
    56|agentsRouter.get("/", async (c) => {
    57|  const user = await getAuthedUser(c);
    58|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
    59|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
    60|
    61|  if (!supabaseAdmin) return c.json({ data: [] });
    62|
    63|  // Fetch all agents
    64|  const { data: agents, error: agentsErr } = await lshAdmin()
    65|    .from("agents")
    66|    .select("*")
    67|    .order("name", { ascending: true });
    68|
    69|  if (agentsErr) {
    70|    console.error("[agents] fetch error:", agentsErr.message);
    71|    return c.json({ error: { message: "Failed to fetch agents" } }, 500);
    72|  }
    73|
    74|  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    75|
    76|  // Fetch recent tasks (last 24h) grouped by assigned_to
    77|  const { data: recentTasks } = await lshAdmin()
    78|    .from("agent_tasks")
    79|    .select("assigned_to")
    80|    .gte("created_at", since24h);
    81|
    82|  // Fetch pending approvals grouped by source_agent
    83|  const { data: pendingApprovals } = await supabaseAdmin
    84|    .from("approval_queue")
    85|    .select("source_agent")
    86|    .eq("status", "pending");
    87|
    88|  // Build lookup maps
    89|  const taskCountBySlug: Record<string, number> = {};
    90|  for (const t of recentTasks ?? []) {
    91|    if (t.assigned_to) {
    92|      taskCountBySlug[t.assigned_to] = (taskCountBySlug[t.assigned_to] ?? 0) + 1;
    93|    }
    94|  }
    95|
    96|  const approvalCountBySlug: Record<string, number> = {};
    97|  for (const a of pendingApprovals ?? []) {
    98|    if (a.source_agent) {
    99|      approvalCountBySlug[a.source_agent] = (approvalCountBySlug[a.source_agent] ?? 0) + 1;
   100|    }
   101|  }
   102|
   103|  const enriched = (agents ?? []).map((agent: any) => ({
   104|    ...agent,
   105|    recent_task_count: taskCountBySlug[agent.slug] ?? 0,
   106|    pending_approval_count: approvalCountBySlug[agent.slug] ?? 0,
   107|  }));
   108|
   109|  return c.json({ data: enriched });
   110|});
   111|
   112|// ── GET /api/agents/approvals/pending ─────────────────────────────────────────
   113|// NOTE: This must be defined BEFORE /:slug to avoid route conflict
   114|agentsRouter.get("/approvals/pending", async (c) => {
   115|  const user = await getAuthedUser(c);
   116|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   117|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   118|
   119|  if (!supabaseAdmin) return c.json({ data: { byAgent: {}, total: 0 } });
   120|
   121|  const { data, error } = await supabaseAdmin
   122|    .from("approval_queue")
   123|    .select("*")
   124|    .in("status", ["pending", "awaiting_second"])
   125|    .order("created_at", { ascending: false });
   126|
   127|  if (error) {
   128|    console.error("[agents/approvals/pending] fetch error:", error.message);
   129|    return c.json({ error: { message: "Failed to fetch approvals" } }, 500);
   130|  }
   131|
   132|  // Filter financial for non-super_admin
   133|  const filtered = (data ?? []).filter((item: any) => {
   134|    if (item.category === "financial" && user.role !== "super_admin") return false;
   135|    return true;
   136|  });
   137|
   138|  // Sort by priority desc then created_at desc
   139|  filtered.sort((a: any, b: any) => {
   140|    const pa = PRIORITY_WEIGHT[a.priority ?? "low"] ?? 1;
   141|    const pb = PRIORITY_WEIGHT[b.priority ?? "low"] ?? 1;
   142|    if (pb !== pa) return pb - pa;
   143|    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
   144|  });
   145|
   146|  // Group by source_agent
   147|  const byAgent: Record<string, any[]> = {};
   148|  for (const item of filtered) {
   149|    const slug = item.source_agent ?? "unknown";
   150|    if (!byAgent[slug]) byAgent[slug] = [];
   151|    byAgent[slug].push(item);
   152|  }
   153|
   154|  return c.json({ data: { byAgent, total: filtered.length } });
   155|});
   156|
   157|// ── GET /api/agents/briefs ─────────────────────────────────────────────────
   158|agentsRouter.get("/briefs", async (c) => {
   159|  const user = await getAuthedUser(c);
   160|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   161|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   162|
   163|  if (!supabaseAdmin) return c.json({ data: [] });
   164|
   165|  const limitParam = c.req.query("limit");
   166|  const limit = Math.min(parseInt(limitParam ?? "20", 10) || 20, 100);
   167|
   168|  const { data, error } = await lshAdmin()
   169|    .from("agent_briefs")
   170|    .select("*")
   171|    .order("created_at", { ascending: false })
   172|    .limit(limit);
   173|
   174|  if (error) {
   175|    console.error("[agents/briefs] fetch error:", error.message);
   176|    return c.json({ error: { message: `Failed to fetch briefs: ${error.message}` } }, 500);
   177|  }
   178|
   179|  return c.json({ data: data ?? [] });
   180|});
   181|

   525|// ── GET /api/agents/costs — token burn per agent ─────────────────────────────
   526|agentsRouter.get("/costs", async (c) => {
   527|  const user = await getAuthedUser(c);
   528|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   529|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   530|
   531|  const days = parseInt(c.req.query("days") ?? "30", 10) || 30;
   532|  const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
   533|
   534|  const { data, error } = await lshAdmin()
   535|    .from("agent_costs")
   536|    .select("agent_slug, model, input_tokens, output_tokens, cost_usd, day")
   537|    .gte("day", since)
   538|    .order("day", { ascending: false });
   539|
   540|  if (error) return c.json({ data: [] });
   541|
   542|  // Aggregate by agent
   543|  const byAgent: Record<string, { totalCost: number; totalTokens: number; model: string; daily: any[] }> = {};
   544|  for (const row of data ?? []) {
   545|    if (!byAgent[row.agent_slug]) {
   546|      byAgent[row.agent_slug] = { totalCost: 0, totalTokens: 0, model: row.model, daily: [] };
   547|    }
   548|    byAgent[row.agent_slug].totalCost += Number(row.cost_usd);
   549|    byAgent[row.agent_slug].totalTokens += row.input_tokens + row.output_tokens;
   550|    byAgent[row.agent_slug].daily.push(row);
   551|  }
   552|
   553|  return c.json({ data: byAgent });
   554|});
   555|
   556|// ── GET /api/agents/cron — scheduled job manifest ────────────────────────────
   557|agentsRouter.get("/cron", async (c) => {
   558|  const user = await getAuthedUser(c);
   559|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   560|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   561|
   562|  const { data, error } = await lshAdmin()
   563|    .from("cron_jobs")
   564|    .select("*")
   565|    .order("name");
   566|
   567|  if (error) return c.json({ data: [] });
   568|  return c.json({ data: data ?? [] });
   569|});
   570|
   571|// ── PATCH /api/agents/cron/:id — toggle enabled / trigger manual ─────────────
   572|agentsRouter.patch("/cron/:id", async (c) => {
   573|  const user = await getAuthedUser(c);
   574|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   575|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   576|
   577|  const id = c.req.param("id");
   578|  const body = (await c.req.json().catch(() => ({}))) as any;
   579|  const update: Record<string, any> = {};
   580|  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
   581|
   582|  if (Object.keys(update).length === 0) return c.json({ error: { message: "Nothing to update" } }, 400);
   583|
   584|  const { data, error } = await lshAdmin()
   585|    .from("cron_jobs")
   586|    .update(update)
   587|    .eq("id", id)
   588|    .select()
   589|    .single();
   590|
   591|  if (error) return c.json({ error: { message: error.message } }, 500);
   592|  return c.json({ data });
   593|});
   594|
   595|// ── GET /api/agents/audit — audit log ────────────────────────────────────────
   596|agentsRouter.get("/audit", async (c) => {
   597|  const user = await getAuthedUser(c);
   598|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   599|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   600|
   601|  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 500);
   602|  const agentSlug = c.req.query("agent");
   603|
   604|  let q = lshAdmin()
   605|    .from("audit_log")
   606|    .select("*")
   607|    .order("created_at", { ascending: false })
   608|    .limit(limit);
   609|
   610|  if (agentSlug) q = q.eq("agent_slug", agentSlug);
   611|
   612|  const { data, error } = await q;
   613|  if (error) return c.json({ data: [] });
   614|  return c.json({ data: data ?? [] });
   615|});
   616|
   617|// ── GET /api/agents/live — cross-fleet activity feed ─────────────────────────
   618|agentsRouter.get("/live", async (c) => {
   619|  const user = await getAuthedUser(c);
   620|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   621|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   622|
   623|  // All agent events from last 2h, all agents
   624|  const since = new Date(Date.now() - 2 * 3600000).toISOString();
   625|  const { data, error } = await lshAdmin()
   626|    .from("agent_events")
   627|    .select("id, agent_slug, event_type, title, body, severity, metadata, created_at")
   628|    .gte("created_at", since)
   629|    .order("created_at", { ascending: false })
   630|    .limit(200);
   631|
   632|  if (error) return c.json({ data: [] });
   633|  return c.json({ data: data ?? [] });
   634|});
   635|

   182|// ── GET /api/agents/:slug ─────────────────────────────────────────────────────
   183|agentsRouter.get("/:slug", async (c) => {
   184|  const user = await getAuthedUser(c);
   185|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   186|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   187|
   188|  if (!supabaseAdmin) return c.json({ data: null });
   189|
   190|  const slug = c.req.param("slug");
   191|
   192|  // Fetch agent
   193|  const { data: agent, error: agentErr } = await lshAdmin()
   194|    .from("agents")
   195|    .select("*")
   196|    .eq("slug", slug)
   197|    .single();
   198|
   199|  if (agentErr || !agent) return c.json({ error: { message: "Agent not found" } }, 404);
   200|
   201|  // Fetch last 20 events
   202|  const { data: events } = await lshAdmin()
   203|    .from("agent_events")
   204|    .select("*")
   205|    .eq("agent_slug", slug)
   206|    .order("created_at", { ascending: false })
   207|    .limit(20);
   208|
   209|  // Fetch last 10 tasks
   210|  const { data: tasks } = await lshAdmin()
   211|    .from("agent_tasks")
   212|    .select("*")
   213|    .eq("assigned_to", slug)
   214|    .order("created_at", { ascending: false })
   215|    .limit(10);
   216|
   217|  // Active task count
   218|  const { data: activeTasks } = await lshAdmin()
   219|    .from("agent_tasks")
   220|    .select("id")
   221|    .eq("assigned_to", slug)
   222|    .in("status", ["in_progress", "pending"]);
   223|
   224|  // Pending approvals
   225|  const { data: pendingApprovals } = await supabaseAdmin
   226|    .from("approval_queue")
   227|    .select("*")
   228|    .eq("source_agent", slug)
   229|    .eq("status", "pending");
   230|
   231|  return c.json({
   232|    data: {
   233|      ...agent,
   234|      events: events ?? [],
   235|      tasks: tasks ?? [],
   236|      active_task_count: (activeTasks ?? []).length,
   237|      pending_approvals: pendingApprovals ?? [],
   238|    },
   239|  });
   240|});
   241|
   242|// ── GET /api/agents/:slug/events ──────────────────────────────────────────────
   243|agentsRouter.get("/:slug/events", async (c) => {
   244|  const user = await getAuthedUser(c);
   245|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   246|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   247|
   248|  if (!supabaseAdmin) return c.json({ data: [] });
   249|
   250|  const slug = c.req.param("slug");
   251|  const limitParam = c.req.query("limit");
   252|  const offsetParam = c.req.query("offset");
   253|  const limit = Math.min(parseInt(limitParam ?? "50", 10) || 50, 200);
   254|  const offset = parseInt(offsetParam ?? "0", 10) || 0;
   255|
   256|  const { data, error, count } = await lshAdmin()
   257|    .from("agent_events")
   258|    .select("*", { count: "exact" })
   259|    .eq("agent_slug", slug)
   260|    .order("created_at", { ascending: false })
   261|    .range(offset, offset + limit - 1);
   262|
   263|  if (error) {
   264|    console.error("[agents/:slug/events] fetch error:", error.message);
   265|    return c.json({ error: { message: "Failed to fetch events" } }, 500);
   266|  }
   267|
   268|  return c.json({ data: data ?? [], total: count ?? 0 });
   269|});
   270|
   271|// ── GET /api/agents/:slug/tasks ───────────────────────────────────────────────
   272|agentsRouter.get("/:slug/tasks", async (c) => {
   273|  const user = await getAuthedUser(c);
   274|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   275|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   276|
   277|  if (!supabaseAdmin) return c.json({ data: [] });
   278|
   279|  const slug = c.req.param("slug");
   280|  const statusParam = c.req.query("status") ?? "all";
   281|
   282|  let query = lshAdmin()
   283|    .from("agent_tasks")
   284|    .select("*")
   285|    .eq("assigned_to", slug)
   286|    .order("created_at", { ascending: false });
   287|
   288|  if (statusParam === "active") {
   289|    query = query.in("status", ["pending", "in_progress"]);
   290|  } else if (statusParam === "completed") {
   291|    query = query.eq("status", "completed");
   292|  }
   293|  // "all" = no filter
   294|
   295|  const { data, error } = await query;
   296|
   297|  if (error) {
   298|    console.error("[agents/:slug/tasks] fetch error:", error.message);
   299|    return c.json({ error: { message: "Failed to fetch tasks" } }, 500);
   300|  }
   301|
   302|  return c.json({ data: data ?? [] });
   303|});
   304|
   305|// ── POST /api/agents/:slug/tasks ──────────────────────────────────────────────
   306|agentsRouter.post("/:slug/tasks", async (c) => {
   307|  const user = await getAuthedUser(c);
   308|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   309|  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden" } }, 403);
   310|
   311|  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);
   312|
   313|  const slug = c.req.param("slug");
   314|  const body = await c.req.json().catch(() => null);
   315|  if (!body || typeof body.title !== "string" || !body.title.trim()) {
   316|    return c.json({ error: { message: "title is required" } }, 400);
   317|  }
   318|
   319|  const taskData: Record<string, unknown> = {
   320|    assigned_to: slug,
   321|    assigned_by: user.email,
   322|    title: body.title.trim(),
   323|    status: "pending",
   324|  };
   325|
   326|  if (typeof body.description === "string") taskData.description = body.description;
   327|  if (["low", "medium", "high", "urgent"].includes(body.priority)) {
   328|    taskData.priority = body.priority;
   329|  }
   330|  if (typeof body.due_at === "string") taskData.due_at = body.due_at;
   331|
   332|  const { data: task, error: taskErr } = await lshAdmin()
   333|    .from("agent_tasks")
   334|    .insert(taskData)
   335|    .select()
   336|    .single();
   337|
   338|  if (taskErr) {
   339|    console.error("[agents/:slug/tasks POST] insert error:", taskErr.message);
   340|    return c.json({ error: { message: "Failed to create task" } }, 500);
   341|  }
   342|
   343|  // Log event
   344|  await lshAdmin()
   345|    .from("agent_events")
   346|    .insert({
   347|      agent_slug: slug,
   348|      event_type: "task_delegated",
   349|      title: `Task delegated by ${user.name ?? user.email}`,
   350|      body: body.title.trim(),
   351|      severity: "info",
   352|      task_id: task?.id ?? null,
   353|      metadata: { assigned_by: user.email },
   354|    });
   355|
   356|  return c.json({ data: task }, 201);
   357|});
   358|
   359|// ── PATCH /api/agents/:slug/tasks/:taskId ─────────────────────────────────────
   360|agentsRouter.patch("/:slug/tasks/:taskId", async (c) => {
   361|  const user = await getAuthedUser(c);
   362|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   363|  if (!isMissionControl(user.role)) return c.json({ error: { message: "Forbidden" } }, 403);
   364|
   365|  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);
   366|
   367|  const slug = c.req.param("slug");
   368|  const taskId = c.req.param("taskId");
   369|  const body = await c.req.json().catch(() => ({}));
   370|
   371|  const updates: Record<string, unknown> = {};
   372|  if (typeof body.status === "string") updates.status = body.status;
   373|  if (typeof body.result === "string") updates.result = body.result;
   374|
   375|  if (Object.keys(updates).length === 0) {
   376|    return c.json({ error: { message: "No valid fields to update" } }, 400);
   377|  }
   378|
   379|  // Mark timestamps if transitioning
   380|  if (updates.status === "in_progress") updates.started_at = new Date().toISOString();
   381|  if (updates.status === "completed") updates.completed_at = new Date().toISOString();
   382|
   383|  const { data: task, error } = await lshAdmin()
   384|    .from("agent_tasks")
   385|    .update(updates)
   386|    .eq("id", taskId)
   387|    .eq("assigned_to", slug)
   388|    .select()
   389|    .single();
   390|
   391|  if (error) {
   392|    console.error("[agents/:slug/tasks/:taskId PATCH] update error:", error.message);
   393|    return c.json({ error: { message: "Failed to update task" } }, 500);
   394|  }
   395|
   396|  return c.json({ data: task });
   397|});
   398|
   399|// ── PATCH /api/agents/:slug ───────────────────────────────────────────────────
   400|agentsRouter.patch("/:slug", async (c) => {
   401|  const user = await getAuthedUser(c);
   402|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   403|  if (user.role !== "super_admin") return c.json({ error: { message: "Forbidden" } }, 403);
   404|
   405|  if (!supabaseAdmin) return c.json({ error: { message: "Service unavailable" } }, 503);
   406|
   407|  const slug = c.req.param("slug");
   408|  const body = await c.req.json().catch(() => ({}));
   409|
   410|  const updates: Record<string, unknown> = {};
   411|  if (body.settings !== undefined && typeof body.settings === "object") {
   412|    updates.settings = body.settings;
   413|  }
   414|  if (typeof body.enabled === "boolean") {
   415|    updates.enabled = body.enabled;
   416|  }
   417|
   418|  if (Object.keys(updates).length === 0) {
   419|    return c.json({ error: { message: "No valid fields to update" } }, 400);
   420|  }
   421|
   422|  const { data: agent, error } = await lshAdmin()
   423|    .from("agents")
   424|    .update(updates)
   425|    .eq("slug", slug)
   426|    .select()
   427|    .single();
   428|
   429|  if (error) {
   430|    console.error("[agents/:slug PATCH] update error:", error.message);
   431|    return c.json({ error: { message: "Failed to update agent" } }, 500);
   432|  }
   433|
   434|  return c.json({ data: agent });
   435|});
   436|
   437|// ─── Agent persona system prompts ─────────────────────────────────────────────
   438|const AGENT_PERSONAS: Record<string, string> = {
   439|  maestro: `You are Maestro — orchestrator of L&S House, the operating system that runs L&S Custom Tailors (est. 1974, 138 East 61st Street, NYC). You are the chief of staff to Calogero "C" Cristiano, the owner. You are direct, warm with people you trust, Sicilian-American in temperament. You coordinate all agents: Sofia (clients), Mia (calendar), Simone (email), La Penna (copy), Marco (tech), Paperclip (strategy). You never speak as an AI — you are Maestro. You call the owner "C" or "Boss". Answer questions about the house, the business, the team, and operations. Be concise, no fluff.`,
   440|  sofia: `You are Sofia — client concierge of L&S Custom Tailors, a Sicilian-heritage bespoke house founded in 1974 at 138 East 61st Street, NYC. You handle all client SMS and voice. You are warm, professional, impeccably on brand. You book appointments, handle inquiries, and escalate when needed. You never quote prices or make fabric promises without checking with Maestro or C. Answer questions about client management, appointments, and concierge operations. Be gracious but efficient.`,
   441|  mia: `You are Mia — the scheduling and dossier agent at L&S Custom Tailors. You own every calendar, every fitting slot, every minute of C's professional time. You use Cal.com and Apple Calendar. You generate client dossiers before every consultation. You are precise, organized, and never double-book. Answer questions about scheduling, calendar management, and client preparation.`,
   442|  rocco: `You are Rocco — production and delivery manager at L&S Custom Tailors. You own the floor from cradle to delivery. You track MTMPro orders, alteration tickets, the YZ pipeline, and factory monitoring. You flag stalled jobs and late deliveries. You are no-nonsense, floor-smart, and direct. Answer questions about production, orders, delivery timelines, and the factory pipeline.`,
   443|  melena: `You are Melena — head of accounting and books at L&S Custom Tailors. You own the money: billing, invoicing, Square reconciliation across LSTNY, LSTX, and Holdings. You draft only — you never auto-send. You escalate every discrepancy. You are precise, cautious with numbers, and thorough. Answer questions about financials, billing, invoicing, and reconciliation.`,
   444|  filo: `You are Filo — ingestion and intelligence agent at L&S Custom Tailors. You run locally on the Mac Studio. You watch every inbox, the Downloads folder, and all attachments the moment they land. You parse, classify, extract, and backfile data into ERPNext and Supabase. You are fast, thorough, and confidence-tiered: you auto-commit low-risk data and queue financial fields for Melena. Answer questions about data ingestion, document processing, and intelligence pipelines.`,
   445|};
   446|
   447|// ── GET /api/agents/:slug/messages — chat history ────────────────────────────
   448|agentsRouter.get("/:slug/messages", async (c) => {
   449|  const user = await getAuthedUser(c);
   450|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   451|
   452|  const slug = c.req.param("slug");
   453|  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);
   454|
   455|  const { data, error } = await lshAdmin()
   456|    .from("agent_messages")
   457|    .select("id, role, content, created_at")
   458|    .eq("agent_slug", slug)
   459|    .order("created_at", { ascending: true })
   460|    .limit(limit);
   461|
   462|  if (error) return c.json({ error: { message: "Failed to fetch messages" } }, 500);
   463|  return c.json({ data: data ?? [] });
   464|});
   465|
   466|// ── POST /api/agents/:slug/messages — send message, get AI reply ─────────────
   467|agentsRouter.post("/:slug/messages", async (c) => {
   468|  const user = await getAuthedUser(c);
   469|  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
   470|
   471|  const slug = c.req.param("slug");
   472|  const body = await c.req.json().catch(() => null);
   473|  if (!body?.content || typeof body.content !== "string") {
   474|    return c.json({ error: { message: "content is required" } }, 400);
   475|  }
   476|
   477|  const userContent = body.content.trim().slice(0, 2000);
   478|  if (!userContent) return c.json({ error: { message: "content is empty" } }, 400);
   479|
   480|  // Save user message
   481|  const { error: userErr } = await lshAdmin()
   482|    .from("agent_messages")
   483|    .insert({ agent_slug: slug, role: "user", content: userContent, user_id: user.id });
   484|
   485|  if (userErr) return c.json({ error: { message: "Failed to save message" } }, 500);
   486|
   487|  // Fetch recent history for context (last 20 turns)
   488|  const { data: history } = await lshAdmin()
   489|    .from("agent_messages")
   490|    .select("role, content")
   491|    .eq("agent_slug", slug)
   492|    .order("created_at", { ascending: false })
   493|    .limit(20);
   494|
   495|  const messages: { role: "user" | "assistant"; content: string }[] = (history ?? [])
   496|    .reverse()
   497|    .map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content }));
   498|
   499|  // Ensure the message we just saved is at the end
   500|  if (!messages.length || messages[messages.length - 1].content !== userContent) {
   501|    messages.push({ role: "user", content: userContent });
   502|  }
   503|
   504|  const systemPrompt = AGENT_PERSONAS[slug] ?? `You are ${slug}, an agent at L&S Custom Tailors, a bespoke tailoring house in NYC. Be helpful and professional.`;
   505|
   506|  let replyContent = "";
   507|  try {
   508|    replyContent = await callAnthropic(systemPrompt, messages);
   509|  } catch (err: any) {
   510|    console.error("[agents/messages] Anthropic error:", err?.message);
   511|    return c.json({ error: { message: "AI unavailable — try again" } }, 502);
   512|  }
   513|
   514|  // Save assistant reply
   515|  const { data: saved, error: replyErr } = await lshAdmin()
   516|    .from("agent_messages")
   517|    .insert({ agent_slug: slug, role: "assistant", content: replyContent })
   518|    .select("id, role, content, created_at")
   519|    .single();
   520|
   521|  if (replyErr) return c.json({ error: { message: "Failed to save reply" } }, 500);
   522|  return c.json({ data: saved });
   523|});
   524|