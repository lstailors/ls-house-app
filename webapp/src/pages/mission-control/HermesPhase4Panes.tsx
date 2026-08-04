import { useEffect, useMemo, useState } from "react";
import {
  useHermesCronAction,
  useHermesCronCreate,
  useHermesCronDeliveryTargets,
  useHermesCronJobRuns,
  useHermesCronUpdate,
  useHermesLearningGraph,
  useHermesProfiles,
  useHermesSessionSearch,
  useHermesMirrorSessionMessages,
} from "@/lib/queries";
import { Button } from "@ls/design/ui/button";
import { cn } from "@ls/design/utils";
import { toast } from "sonner";
import {
  ChevronLeft,
  ExternalLink,
  Play,
  Pause,
  RefreshCw,
  Plus,
  Search,
  Network,
  Calendar,
} from "lucide-react";

function msgText(m: any): string {
  const c = m?.content ?? m?.text ?? m?.message ?? "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => (typeof p === "string" ? p : p?.text || p?.content || JSON.stringify(p)))
      .join("\n");
  }
  if (c && typeof c === "object") return JSON.stringify(c);
  return "";
}

/** Phase 4 Sessions — search + profile filter + transcript */
export function SessionsPaneV4({
  sessionsQ,
  statsQ,
  openSessionId,
  setOpenSessionId,
  links,
  onOpen,
  profile,
  setProfile,
}: {
  sessionsQ: any;
  statsQ: any;
  openSessionId: string | null;
  setOpenSessionId: (id: string | null) => void;
  links: any;
  onOpen: (u?: string) => void;
  profile: string | null;
  setProfile: (p: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const profilesQ = useHermesProfiles(true);
  const searchQ = useHermesSessionSearch(debounced, profile, true);
  const msgsQ = useHermesMirrorSessionMessages(openSessionId);

  const profilesRaw = (profilesQ.data as any)?.data?.profiles ?? [];
  const profiles: string[] = profilesRaw
    .map((p: any) => (typeof p === "string" ? p : p?.name || p?.id || p?.profile))
    .filter(Boolean);

  const stats = (statsQ.data as any)?.data?.stats ?? {};
  const listSessions = (sessionsQ.data as any)?.data?.sessions ?? [];
  const searchResults = (searchQ.data as any)?.data?.results ?? [];
  const usingSearch = debounced.length >= 2;
  const sessions = usingSearch
    ? searchResults.map((r: any) => r.session || r)
    : listSessions;

  const err =
    (sessionsQ.data as any)?.data?.error ||
    (searchQ.data as any)?.data?.error ||
    (sessionsQ.error as Error)?.message ||
    (msgsQ.data as any)?.data?.error;

  if (openSessionId) {
    const messages = (msgsQ.data as any)?.data?.messages ?? [];
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpenSessionId(null)}>
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
            Back
          </Button>
          <p className="text-xs font-mono text-cream-muted truncate">{openSessionId}</p>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => onOpen(links.chat)}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            Live Chat
          </Button>
        </div>
        {err && (
          <div className="text-xs text-signal-amber border border-signal-amber/25 rounded-xl px-3 py-2">
            {String(err)}
          </div>
        )}
        {msgsQ.isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 glass-panel rounded-xl animate-pulse" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="border border-dashed border-brass/20 rounded-2xl px-6 py-10 text-center text-sm text-cream-dim">
            No messages in this session.
          </div>
        ) : (
          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {messages.map((m: any, i: number) => {
              const role = (m.role || m.type || "message").toString();
              const text = msgText(m);
              const isUser = role === "user" || role === "human";
              const isTool = role === "tool" || role === "function" || m.tool_calls;
              return (
                <div
                  key={m.id || i}
                  className={cn(
                    "rounded-xl px-3 py-2.5 border text-xs",
                    isUser && "border-brass/25 bg-brass/5",
                    isTool && "border-signal-amber/20 bg-signal-amber/5 font-mono",
                    !isUser && !isTool && "border-brass/10 bg-cream/[0.02]",
                  )}
                >
                  <div className="flex gap-2 mb-1">
                    <span className="ui-label text-[9px] text-brass-light">{role}</span>
                    {(m.created_at || m.timestamp) && (
                      <span className="text-[9px] text-cream-dim font-mono">
                        {m.created_at || m.timestamp}
                      </span>
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-cream-muted leading-relaxed">
                    {text.slice(0, 4000) || "—"}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cream-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sessions (id or message text)…"
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-forest-deep/40 border border-brass/15 text-xs text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40"
          />
        </div>
        <select
          value={profile || ""}
          onChange={(e) => setProfile(e.target.value || null)}
          className="px-3 py-2 rounded-xl bg-forest-deep/40 border border-brass/15 text-xs text-cream"
        >
          <option value="">All profiles</option>
          {profiles.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          {!profiles.includes("default") && <option value="default">default</option>}
          {!profiles.includes("simone") && <option value="simone">simone</option>}
          {!profiles.includes("maestro") && <option value="maestro">maestro</option>}
        </select>
        <Button size="sm" variant="outline" onClick={() => onOpen(links.sessions)}>
          <ExternalLink className="h-3.5 w-3.5 mr-1" />
          Console
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: "Total", value: stats.total ?? "—" },
          { label: "Active store", value: stats.active_store ?? "—" },
          { label: "Archived", value: stats.archived ?? "—" },
          { label: "Messages", value: stats.messages ?? "—" },
        ].map((s) => (
          <div key={s.label} className="glass-panel rounded-xl p-3 border border-brass/10">
            <p className="ui-label text-[9px] text-cream-dim">{s.label}</p>
            <p className="font-mono text-sm mt-1 text-cream">{String(s.value)}</p>
          </div>
        ))}
      </div>

      {err && (
        <div className="text-xs text-signal-amber border border-signal-amber/25 rounded-xl px-3 py-2">
          {String(err)}
        </div>
      )}

      {(usingSearch ? searchQ.isLoading : sessionsQ.isLoading) ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 glass-panel rounded-xl animate-pulse" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="border border-dashed border-brass/20 rounded-2xl px-6 py-10 text-center text-sm text-cream-dim">
          {usingSearch ? "No search hits." : "No sessions (or auth not configured)."}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
          {sessions.map((s: any, i: number) => {
            const id = s.id || s.session_id || String(i);
            return (
              <button
                key={id}
                type="button"
                onClick={() => setOpenSessionId(id)}
                className="w-full text-left glass-panel rounded-xl px-3 py-2.5 border border-brass/10 hover:border-brass/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-cream truncate">
                    {s.title || id}
                  </span>
                  {(s.profile || profile) && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded border border-brass/15 text-cream-dim">
                      {s.profile || profile}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] font-mono text-cream-dim shrink-0">
                    {[s.model, s.message_count != null ? `${s.message_count} msgs` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {(s.preview || s.last_message || s.snippet) && (
                  <p className="text-[11px] text-cream-dim mt-1 line-clamp-2">
                    {s.preview || s.last_message || s.snippet}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Cron create / pause / resume / trigger drawer */
export function CronDrawerPane({ cronQ, onOpen }: { cronQ: any; onOpen: () => void }) {
  const jobs = (cronQ.data as any)?.data?.jobs ?? [];
  const err = (cronQ.data as any)?.data?.error || (cronQ.error as Error)?.message;
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("0 9 * * 1-5");
  const [prompt, setPrompt] = useState("");
  const [deliver, setDeliver] = useState("local");
  const targetsQ = useHermesCronDeliveryTargets(showCreate);
  const createM = useHermesCronCreate();
  const actionM = useHermesCronAction();
  const updateM = useHermesCronUpdate();
  const runsQ = useHermesCronJobRuns(selectedId);
  const targets = (targetsQ.data as any)?.data?.targets ?? [{ id: "local", name: "Local" }];

  const selected = jobs.find((j: any) => (j.id || j.job_id) === selectedId);

  const runAction = async (id: string, action: "pause" | "resume" | "trigger") => {
    try {
      await actionM.mutateAsync({ id, action });
      toast.success(`${action} ok`);
    } catch (e: any) {
      toast.error(e?.message || `${action} failed`);
    }
  };

  const onCreate = async () => {
    if (!schedule.trim()) {
      toast.error("Schedule required");
      return;
    }
    try {
      await createM.mutateAsync({
        name: name.trim() || undefined,
        schedule: schedule.trim(),
        prompt: prompt.trim(),
        deliver,
      });
      toast.success("Cron created");
      setShowCreate(false);
      setName("");
      setPrompt("");
    } catch (e: any) {
      toast.error(e?.message || "Create failed");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Calendar className="h-3.5 w-3.5 text-brass-light" />
        <span className="ui-label text-[10px]">CRON DRAWER · SUPER_ADMIN MUTATIONS</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New job
          </Button>
          <Button size="sm" variant="outline" onClick={onOpen}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            Console
          </Button>
        </div>
      </div>

      {showCreate && (
        <div className="glass-panel rounded-2xl p-4 border border-brass/20 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className="w-full px-3 py-2 rounded-xl bg-forest-deep/40 border border-brass/15 text-xs text-cream"
          />
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder='Schedule — e.g. "0 9 * * 1-5" or "every 2h"'
            className="w-full px-3 py-2 rounded-xl bg-forest-deep/40 border border-brass/15 text-xs text-cream font-mono"
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt / task instruction"
            rows={3}
            className="w-full px-3 py-2 rounded-xl bg-forest-deep/40 border border-brass/15 text-xs text-cream resize-y"
          />
          <select
            value={deliver}
            onChange={(e) => setDeliver(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-forest-deep/40 border border-brass/15 text-xs text-cream"
          >
            {targets.map((t: any) => (
              <option key={t.id || t.name} value={t.id || "local"}>
                {t.name || t.id}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button size="sm" onClick={onCreate} disabled={createM.isPending}>
              {createM.isPending ? "Creating…" : "Create"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {err && (
        <div className="text-xs text-signal-amber border border-signal-amber/25 rounded-xl px-3 py-2">
          {String(err)}
        </div>
      )}

      {cronQ.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 glass-panel rounded-xl animate-pulse" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="border border-dashed border-brass/20 rounded-2xl px-6 py-10 text-center text-sm text-cream-dim">
          No jobs (or auth not configured).
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
          {jobs.map((j: any, i: number) => {
            const id = j.id || j.job_id || String(i);
            const enabled = j.enabled !== false && j.paused !== true;
            const open = selectedId === id;
            return (
              <div
                key={id}
                className={cn(
                  "glass-panel rounded-xl border px-3 py-2.5",
                  open ? "border-brass/35" : "border-brass/10",
                  !enabled && "opacity-60",
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left"
                    onClick={() => setSelectedId(open ? null : id)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-cream font-medium truncate">
                        {j.name || id}
                      </span>
                      <span className="text-[9px] font-mono text-cream-dim border border-brass/10 rounded px-1.5">
                        {j.schedule || "—"}
                      </span>
                      <span
                        className={cn(
                          "text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border",
                          enabled
                            ? "border-signal-emerald/30 text-signal-emerald"
                            : "border-cream/20 text-cream-dim",
                        )}
                      >
                        {enabled ? "on" : "paused"}
                      </span>
                    </div>
                    {(j.prompt || j.script) && (
                      <p className="text-[11px] text-cream-dim mt-1 line-clamp-2">
                        {j.prompt || j.script}
                      </p>
                    )}
                  </button>
                  <div className="flex gap-1 shrink-0">
                    {enabled ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        disabled={actionM.isPending}
                        onClick={() => runAction(id, "pause")}
                        title="Pause"
                      >
                        <Pause className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        disabled={actionM.isPending}
                        onClick={() => runAction(id, "resume")}
                        title="Resume"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      disabled={actionM.isPending}
                      onClick={() => runAction(id, "trigger")}
                      title="Trigger now"
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {open && (
                  <div className="mt-3 pt-3 border-t border-brass/10 space-y-2">
                    <p className="text-[10px] font-mono text-cream-dim">id: {id}</p>
                    {selected?.deliver && (
                      <p className="text-[11px] text-cream-muted">deliver: {selected.deliver}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateM.isPending}
                        onClick={async () => {
                          const next = window.prompt("New schedule", j.schedule || "");
                          if (!next) return;
                          try {
                            await updateM.mutateAsync({ id, updates: { schedule: next } });
                            toast.success("Schedule updated");
                          } catch (e: any) {
                            toast.error(e?.message || "Update failed");
                          }
                        }}
                      >
                        Edit schedule
                      </Button>
                    </div>
                    <div>
                      <p className="ui-label text-[9px] mb-1">Recent runs</p>
                      {runsQ.isLoading ? (
                        <div className="h-10 animate-pulse glass-panel rounded-lg" />
                      ) : ((runsQ.data as any)?.data?.runs ?? []).length === 0 ? (
                        <p className="text-[11px] text-cream-dim">No runs yet.</p>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {((runsQ.data as any)?.data?.runs ?? []).slice(0, 8).map((r: any, ri: number) => (
                            <div
                              key={r.id || ri}
                              className="text-[10px] font-mono text-cream-dim flex gap-2"
                            >
                              <span>{r.status || r.state || "run"}</span>
                              <span className="truncate">{r.started_at || r.created_at || ""}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Read-only learning graph visualization */
export function GraphPane({ onOpen }: { onOpen: () => void }) {
  const graphQ = useHermesLearningGraph(true);
  const data = (graphQ.data as any)?.data ?? {};
  const nodes: any[] = data.nodes ?? [];
  const edges: any[] = data.edges ?? [];
  const stats = data.stats || {};
  const err = data.error || (graphQ.error as Error)?.message;

  const laid = useMemo(() => {
    const n = nodes.slice(0, 48);
    const w = 640;
    const h = 360;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.38;
    return n.map((node, i) => {
      const a = (i / Math.max(n.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return {
        ...node,
        id: node.id || node.name || String(i),
        x: cx + Math.cos(a) * r * (0.55 + (i % 3) * 0.15),
        y: cy + Math.sin(a) * r * (0.55 + (i % 3) * 0.15),
        label: String(node.label || node.name || node.id || i).slice(0, 28),
        kind: node.type || node.kind || "node",
      };
    });
  }, [nodes]);

  const byId = useMemo(() => {
    const m = new Map<string, (typeof laid)[0]>();
    laid.forEach((n) => m.set(n.id, n));
    return m;
  }, [laid]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Network className="h-3.5 w-3.5 text-brass-light" />
        <span className="ui-label text-[10px]">LEARNING GRAPH · READ-ONLY</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={onOpen}>
          <ExternalLink className="h-3.5 w-3.5 mr-1" />
          Console System
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: "Nodes", value: stats.nodes ?? nodes.length },
          { label: "Edges", value: stats.edges ?? edges.length },
          { label: "Clusters", value: stats.clusters ?? (data.clusters || []).length },
          { label: "Shown", value: laid.length },
        ].map((s) => (
          <div key={s.label} className="glass-panel rounded-xl p-3 border border-brass/10">
            <p className="ui-label text-[9px] text-cream-dim">{s.label}</p>
            <p className="font-mono text-sm mt-1 text-cream">{String(s.value)}</p>
          </div>
        ))}
      </div>

      {err && (
        <div className="text-xs text-signal-amber border border-signal-amber/25 rounded-xl px-3 py-2">
          {String(err)}
        </div>
      )}

      {graphQ.isLoading ? (
        <div className="h-[360px] glass-panel rounded-2xl animate-pulse" />
      ) : laid.length === 0 ? (
        <div className="border border-dashed border-brass/20 rounded-2xl px-6 py-10 text-center text-sm text-cream-dim">
          No graph nodes yet (or auth not configured).
        </div>
      ) : (
        <div className="glass-panel rounded-2xl border border-brass/15 overflow-hidden">
          <svg viewBox="0 0 640 360" className="w-full h-auto max-h-[420px] bg-forest-deep/30">
            {edges.slice(0, 80).map((e: any, i: number) => {
              const s = byId.get(e.source || e.from || e.src);
              const t = byId.get(e.target || e.to || e.dst);
              if (!s || !t) return null;
              return (
                <line
                  key={i}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke="rgba(176,141,87,0.25)"
                  strokeWidth={1}
                />
              );
            })}
            {laid.map((n) => (
              <g key={n.id}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.kind === "skill" ? 8 : 6}
                  fill={n.kind === "memory" ? "rgba(79,191,142,0.7)" : "rgba(176,141,87,0.85)"}
                  stroke="rgba(241,233,214,0.35)"
                  strokeWidth={1}
                />
                <text
                  x={n.x}
                  y={n.y + 16}
                  textAnchor="middle"
                  fill="rgba(241,233,214,0.75)"
                  fontSize={8}
                  fontFamily="system-ui,sans-serif"
                >
                  {n.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}

      {nodes.length > 0 && (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {nodes.slice(0, 40).map((n: any, i: number) => (
            <div key={n.id || i} className="text-[11px] text-cream-dim flex gap-2">
              <span className="text-brass-light shrink-0">{n.type || n.kind || "node"}</span>
              <span className="truncate text-cream-muted">{n.label || n.name || n.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
