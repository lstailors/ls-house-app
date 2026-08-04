/**
 * SPEC 072 Phase 2 — fleet chat / admin / artifacts for Hermes tab.
 * One-shot command reuses SPEC 069 queue (mc_commands), not a second chat SoT.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ExternalLink,
  RefreshCw,
  Radio,
  MessageSquare,
  Calendar,
  Sparkles,
  BarChart3,
  Settings,
  Layers,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  Link2,
  Monitor,
  Send,
  Bot,
  Package,
  Shield,
  Network,
} from "lucide-react";
import { Button } from "@ls/design/ui/button";
import { cn } from "@ls/design/utils";
import { toast } from "sonner";
import {
  useAgents,
  useHermesMirrorStatus,
  useHermesMirrorSessions,
  useHermesMirrorSkills,
  useHermesMirrorCron,
  useHermesMirrorMcp,
  useHermesMirrorArtifacts,
  useSendAgentCommand,
  useCancelAgentCommand,
  useAgentCommand,
  type AgentCommandRun,
} from "@/lib/queries";

type Sub =
  | "overview"
  | "chat"
  | "sessions"
  | "skills"
  | "cron"
  | "admin"
  | "artifacts"
  | "map";

const MODE_STYLE: Record<string, string> = {
  mirror: "border-signal-emerald/30 text-signal-emerald bg-signal-emerald/10",
  "deep-link": "border-brass/30 text-brass-light bg-brass/10",
  planned: "border-signal-amber/30 text-signal-amber bg-signal-amber/10",
  "desktop-only": "border-cream/15 text-cream-dim bg-cream/5",
  "mc-native": "border-signal-emerald/20 text-cream-muted bg-forest-deep/40",
};

export function HermesMirrorPanel() {
  const [sub, setSub] = useState<Sub>("overview");
  const statusQ = useHermesMirrorStatus();
  const sessionsQ = useHermesMirrorSessions(sub === "sessions");
  const skillsQ = useHermesMirrorSkills(sub === "skills");
  const cronQ = useHermesMirrorCron(sub === "cron");
  const mcpQ = useHermesMirrorMcp(sub === "admin");
  const artQ = useHermesMirrorArtifacts(sub === "artifacts");
  const agentsQ = useAgents();

  const payload = (statusQ.data as any)?.data ?? statusQ.data ?? {};
  const st = payload.status ?? {};
  const links = payload.links ?? {};
  const map = payload.feature_map ?? [];
  const authOk = Boolean(payload.auth_configured);
  const liveOk = Boolean(payload.ok);

  const agents = useMemo(() => {
    const raw = agentsQ.data as any;
    const list = Array.isArray(raw) ? raw : raw?.data ?? [];
    return list as any[];
  }, [agentsQ.data]);

  const platforms = useMemo(() => {
    const p = st.gateway_platforms || {};
    return Object.entries(p) as [string, any][];
  }, [st]);

  const open = (url?: string) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-2xl p-4 border border-brass/15 flex flex-wrap gap-3 items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Monitor className="h-4 w-4 text-brass-light" />
            <p className="ui-label text-[10px] text-brass-light">HERMES MIRROR · SPEC 072 · PHASE 2</p>
            <span
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded-full border",
                liveOk
                  ? "border-signal-emerald/30 text-signal-emerald"
                  : "border-signal-rose/30 text-signal-rose",
              )}
            >
              {liveOk ? "dashboard live" : "dashboard unreachable"}
            </span>
            <span
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded-full border",
                authOk
                  ? "border-signal-emerald/30 text-signal-emerald"
                  : "border-signal-amber/30 text-signal-amber",
              )}
            >
              {authOk ? "API auth ready" : "API auth pending"}
            </span>
          </div>
          <h2 className="font-display text-xl italic text-cream">
            Desktop mapped into Mission Control
          </h2>
          <p className="text-xs text-cream-muted mt-1 max-w-2xl">
            Phase 2: fleet one-shot chat, admin hub (MCP/channels), artifacts gallery. Streaming TUI
            chat still opens in Console. Sessions/skills/cron lists need dashboard password once.
          </p>
          {payload.base_url && (
            <p className="text-[10px] font-mono text-cream-dim mt-2">{payload.base_url}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="btn-brass" onClick={() => open(links.home || payload.base_url)}>
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Open Console
          </Button>
          <Button size="sm" variant="outline" onClick={() => open(links.chat)}>
            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
            Live Chat
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => statusQ.refetch()}
            disabled={statusQ.isFetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", statusQ.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Version" value={st.version || "—"} sub={st.release_date || ""} />
        <Stat
          label="Gateway"
          value={st.gateway_running ? "running" : "down"}
          sub={st.gateway_state || ""}
          ok={!!st.gateway_running}
        />
        <Stat
          label="Active sessions"
          value={String(st.active_sessions ?? "—")}
          sub={st.gateway_busy ? "busy" : "idle"}
        />
        <Stat
          label="Auth gate"
          value={st.auth_required ? "on" : "off"}
          sub={(st.auth_providers || []).join(", ") || "—"}
        />
      </div>

      {platforms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {platforms.map(([name, info]) => (
            <span
              key={name}
              className={cn(
                "text-[10px] px-2 py-1 rounded-full border",
                info?.state === "connected"
                  ? "border-signal-emerald/25 text-signal-emerald"
                  : "border-signal-rose/25 text-signal-rose",
              )}
            >
              {name}: {info?.state || "unknown"}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1 border border-brass/10 rounded-xl p-1 bg-forest-raised/20">
        {(
          [
            ["overview", "Overview", Layers],
            ["chat", "Chat", MessageSquare],
            ["sessions", "Sessions", Radio],
            ["skills", "Skills", Sparkles],
            ["cron", "Cron", Calendar],
            ["admin", "Admin", Settings],
            ["artifacts", "Artifacts", Package],
            ["map", "Map", BarChart3],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSub(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors",
              sub === id ? "bg-brass/15 text-brass-light" : "text-cream-dim hover:text-cream",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {sub === "overview" && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="glass-panel rounded-xl p-4 space-y-2">
            <p className="ui-label text-[10px]">QUICK OPENS · MAESTRO CONSOLE</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Chat (stream)", links.chat, MessageSquare],
                ["Sessions", links.sessions, Radio],
                ["Cron", links.cron, Calendar],
                ["Skills", links.skills, Sparkles],
                ["MCP", links.mcp, Network],
                ["Channels", links.channels, Link2],
                ["Config", links.config, Settings],
                ["Analytics", links.analytics, BarChart3],
                ["Logs", links.logs, Terminal],
                ["Profiles", links.profiles, Layers],
              ].map(([label, href, Icon]) => (
                <button
                  key={String(label)}
                  type="button"
                  onClick={() => open(String(href))}
                  className="flex items-center gap-2 text-left text-xs text-cream-muted hover:text-cream border border-brass/10 rounded-lg px-2.5 py-2 hover:border-brass/30"
                >
                  <Icon className="h-3.5 w-3.5 text-brass-light shrink-0" />
                  {label}
                  <ExternalLink className="h-3 w-3 ml-auto opacity-50" />
                </button>
              ))}
            </div>
          </div>
          <div className="glass-panel rounded-xl p-4 space-y-3">
            <p className="ui-label text-[10px]">PHASE 2 SURFACE</p>
            <ul className="text-xs text-cream-muted space-y-2 list-disc pl-4">
              <li>
                <button type="button" className="text-brass-light underline" onClick={() => setSub("chat")}>
                  Chat
                </button>{" "}
                — fleet one-shot commands (mc_commands queue) + Open Console for streaming TUI.
              </li>
              <li>
                <button type="button" className="text-brass-light underline" onClick={() => setSub("admin")}>
                  Admin
                </button>{" "}
                — MCP list + channel/gateway status + config deep links.
              </li>
              <li>
                <button type="button" className="text-brass-light underline" onClick={() => setSub("artifacts")}>
                  Artifacts
                </button>{" "}
                — recent outputs (links/files/images) from activity + command results.
              </li>
            </ul>
            {!authOk && (
              <div className="rounded-lg border border-signal-amber/25 bg-signal-amber/10 px-3 py-2 text-[11px] text-signal-amber flex gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Dashboard password not on server yet — Sessions/Skills/Cron/MCP API panels stay empty until
                  keychain/Vercel creds are set (see docs/ops/hermes-mc-mirror.md).
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {sub === "chat" && (
        <FleetChatPane agents={agents} liveChatUrl={links.chat} />
      )}

      {sub === "sessions" && (
        <MirrorList
          loading={sessionsQ.isLoading}
          error={(sessionsQ.data as any)?.data?.error || (sessionsQ.error as Error)?.message}
          empty="No sessions (or auth not configured)."
          items={((sessionsQ.data as any)?.data?.sessions ?? []).map((s: any, i: number) => ({
            key: s.id || s.session_id || String(i),
            title: s.title || s.id || s.session_id || "session",
            meta: [s.model, s.message_count != null ? `${s.message_count} msgs` : null, s.updated_at || s.last_active]
              .filter(Boolean)
              .join(" · "),
            body: s.preview || s.last_message || "",
          }))}
          onOpen={() => open(links.sessions)}
          openLabel="Open Sessions in Console"
        />
      )}

      {sub === "skills" && (
        <MirrorList
          loading={skillsQ.isLoading}
          error={(skillsQ.data as any)?.data?.error || (skillsQ.error as Error)?.message}
          empty="No skills (or auth not configured)."
          items={((skillsQ.data as any)?.data?.skills ?? []).map((s: any, i: number) => ({
            key: s.name || String(i),
            title: s.name || "skill",
            meta: [s.category, s.enabled === false ? "disabled" : "enabled"].filter(Boolean).join(" · "),
            body: s.description || "",
          }))}
          onOpen={() => open(links.skills)}
          openLabel="Open Skills in Console"
        />
      )}

      {sub === "cron" && (
        <MirrorList
          loading={cronQ.isLoading}
          error={(cronQ.data as any)?.data?.error || (cronQ.error as Error)?.message}
          empty="No jobs (or auth not configured). Fleet health is on the Crons tab."
          items={((cronQ.data as any)?.data?.jobs ?? []).map((j: any, i: number) => ({
            key: j.id || j.job_id || String(i),
            title: j.name || j.id || "job",
            meta: [j.schedule, j.enabled === false ? "paused" : "enabled", j.last_status]
              .filter(Boolean)
              .join(" · "),
            body: j.prompt || j.script || "",
          }))}
          onOpen={() => open(links.cron)}
          openLabel="Open Cron in Console"
        />
      )}

      {sub === "admin" && (
        <AdminHub
          links={links}
          platforms={platforms}
          mcpQ={mcpQ}
          onOpen={open}
          authOk={authOk}
        />
      )}

      {sub === "artifacts" && (
        <ArtifactsPane artQ={artQ} onOpenConsole={() => open(links.sessions)} />
      )}

      {sub === "map" && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1.2fr_1.2fr_0.6fr_0.4fr] gap-2 px-2 text-[9px] uppercase tracking-wider text-cream-dim">
            <span>Desktop</span>
            <span>Mission Control</span>
            <span>Mode</span>
            <span>Phase</span>
          </div>
          {map.map((row: any) => (
            <div
              key={row.id}
              className="grid grid-cols-[1.2fr_1.2fr_0.6fr_0.4fr] gap-2 glass-panel rounded-lg px-3 py-2 text-xs items-center"
            >
              <span className="text-cream-muted">{row.desktop}</span>
              <span className="text-cream">{row.mc}</span>
              <span
                className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded-full border w-fit uppercase tracking-wide",
                  MODE_STYLE[row.mode] || MODE_STYLE.planned,
                )}
              >
                {row.mode}
              </span>
              <span className="text-cream-dim font-mono text-[10px]">
                {row.phase === 0 ? "—" : `P${row.phase}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FleetChatPane({ agents, liveChatUrl }: { agents: any[]; liveChatUrl?: string }) {
  const defaultSlug = agents[0]?.slug || "maestro";
  const [slug, setSlug] = useState(defaultSlug);
  useEffect(() => {
    if (!agents.find((a) => a.slug === slug) && agents[0]?.slug) setSlug(agents[0].slug);
  }, [agents, slug]);

  const agent = agents.find((a) => a.slug === slug);
  const name = agent?.name || slug;

  return (
    <div className="grid lg:grid-cols-[220px_1fr] gap-3">
      <div className="glass-panel rounded-xl p-3 space-y-1 max-h-[420px] overflow-y-auto">
        <p className="ui-label text-[9px] mb-2">FLEET · ONE-SHOT</p>
        {agents.length === 0 ? (
          <p className="text-xs text-cream-dim">No agents loaded.</p>
        ) : (
          agents.map((a) => (
            <button
              key={a.slug}
              type="button"
              onClick={() => setSlug(a.slug)}
              className={cn(
                "w-full text-left px-2.5 py-2 rounded-lg text-xs border transition-colors",
                slug === a.slug
                  ? "border-brass/40 bg-brass/10 text-cream"
                  : "border-transparent text-cream-muted hover:border-brass/15",
              )}
            >
              <span className="font-medium">{a.name || a.slug}</span>
              <span className="block text-[10px] text-cream-dim font-mono">{a.slug}</span>
            </button>
          ))
        )}
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <p className="text-xs text-cream-muted">
            Queue-backed command (same as agent detail). For streaming tool cards, open Live Chat.
          </p>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => liveChatUrl && window.open(liveChatUrl, "_blank")}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Live Chat
            </Button>
            <Link
              to={`/mission-control/agents/${slug}`}
              className="inline-flex items-center text-xs text-brass-light border border-brass/25 rounded-lg px-2.5 py-1.5 hover:bg-brass/10"
            >
              Full agent page
            </Link>
          </div>
        </div>
        <InlineAgentCommand slug={slug} agentName={name} />
      </div>
    </div>
  );
}

function InlineAgentCommand({ slug, agentName }: { slug: string; agentName: string }) {
  const [input, setInput] = useState("");
  const [commandId, setCommandId] = useState<string | null>(null);
  const [echo, setEcho] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [err, setErr] = useState<string | null>(null);
  const started = useRef<number | null>(null);
  const [tick, setTick] = useState(0);

  const send = useSendAgentCommand(slug);
  const cancelMut = useCancelAgentCommand(slug);
  const { data: remote } = useAgentCommand(slug, commandId);
  const run: AgentCommandRun | null = remote ?? null;

  useEffect(() => {
    // reset when agent changes
    setCommandId(null);
    setEcho(null);
    setStatus("idle");
    setErr(null);
    started.current = null;
    setInput("");
  }, [slug]);

  useEffect(() => {
    if (!run) return;
    setStatus(run.status);
    if (run.command) setEcho(run.command);
    if (run.started_at) started.current = new Date(run.started_at).getTime();
  }, [run]);

  useEffect(() => {
    if (status !== "queued" && status !== "running") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const inflight = status === "queued" || status === "running";

  const handleSend = async () => {
    const text = input.trim();
    if (!text || inflight || send.isPending) return;
    setEcho(text);
    setStatus("queued");
    setErr(null);
    setCommandId(null);
    started.current = Date.now();
    setInput("");
    try {
      const data = await send.mutateAsync({ prompt: text });
      setCommandId(data.id);
      setStatus(data.status === "running" ? "running" : "queued");
    } catch (e: any) {
      setStatus("error");
      setErr(e?.message || "Failed");
      toast.error(e?.message || "Failed to enqueue");
    }
  };

  const elapsed = started.current
    ? Math.floor((Date.now() - started.current) / 1000)
    : tick;

  return (
    <div className="glass-panel rounded-2xl p-4 border border-brass/15 space-y-3">
      <div className="flex items-center gap-2 border-b border-brass/10 pb-3">
        <div className="h-8 w-8 rounded-full bg-cream/10 border border-brass/20 flex items-center justify-center">
          <Bot className="h-4 w-4 text-brass-light" />
        </div>
        <div>
          <p className="text-sm text-cream">{agentName}</p>
          <p className="text-[10px] text-cream-dim font-mono">{slug} · one-shot</p>
        </div>
        {status !== "idle" && (
          <span className="ml-auto text-[10px] uppercase tracking-wide text-brass-light border border-brass/20 rounded-full px-2 py-0.5">
            {status}
            {inflight ? ` · ${elapsed}s` : ""}
          </span>
        )}
      </div>

      {echo && (
        <p className="font-mono text-xs text-cream-muted">
          <span className="text-brass-light mr-1">›</span>
          {echo}
        </p>
      )}

      {status === "running" && (
        <div className="space-y-2">
          <div className="glass-panel rounded h-3 animate-pulse w-[90%]" />
          <div className="glass-panel rounded h-3 animate-pulse w-[70%]" />
          <Button
            size="sm"
            variant="outline"
            className="border-signal-rose/30 text-signal-rose h-7 text-xs"
            disabled={!commandId || cancelMut.isPending}
            onClick={() => commandId && cancelMut.mutateAsync(commandId).then((d) => setStatus(d.status))}
          >
            Cancel
          </Button>
        </div>
      )}

      {(status === "done" || status === "error" || status === "timeout") && (
        <div
          className={cn(
            "rounded-xl border p-3 text-xs whitespace-pre-wrap max-h-72 overflow-y-auto",
            status === "error"
              ? "border-signal-rose/25 text-signal-rose bg-signal-rose/5"
              : "border-brass/15 text-cream-muted bg-forest-deep/40 font-mono",
          )}
        >
          {status === "error" ? err || run?.error || "Error" : run?.result || "(no output)"}
        </div>
      )}

      <div className="flex gap-2 items-end pt-2 border-t border-brass/10">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
          disabled={inflight}
          placeholder={`Command ${agentName}…`}
          className="flex-1 text-sm bg-forest-raised/50 border border-brass/20 rounded-xl px-3 py-2 text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40 resize-none"
        />
        <Button
          className="btn-brass h-10 w-10 p-0"
          disabled={!input.trim() || inflight || send.isPending}
          onClick={() => void handleSend()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function AdminHub({
  links,
  platforms,
  mcpQ,
  onOpen,
  authOk,
}: {
  links: any;
  platforms: [string, any][];
  mcpQ: any;
  onOpen: (u?: string) => void;
  authOk: boolean;
}) {
  const mcpPayload = mcpQ.data?.data ?? mcpQ.data ?? {};
  const servers = mcpPayload.servers ?? [];

  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="glass-panel rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-brass-light" />
          <p className="ui-label text-[10px]">MCP SERVERS</p>
          <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => onOpen(links.mcp)}>
            Manage
          </Button>
        </div>
        {mcpQ.isLoading ? (
          <div className="h-16 animate-pulse glass-panel rounded-lg" />
        ) : servers.length === 0 ? (
          <p className="text-xs text-cream-dim">
            {mcpPayload.error || (authOk ? "No MCP servers configured." : "Auth required to list MCP servers.")}
          </p>
        ) : (
          <div className="space-y-1.5">
            {servers.map((s: any, i: number) => (
              <div key={s.name || i} className="border border-brass/10 rounded-lg px-2.5 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-cream">{s.name}</span>
                  <span
                    className={cn(
                      "ml-auto text-[9px] uppercase",
                      s.enabled === false ? "text-cream-dim" : "text-signal-emerald",
                    )}
                  >
                    {s.enabled === false ? "off" : "on"}
                  </span>
                </div>
                {s.url && <p className="text-[10px] font-mono text-cream-dim truncate mt-0.5">{s.url}</p>}
                {s.command && (
                  <p className="text-[10px] font-mono text-cream-dim truncate mt-0.5">{s.command}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-brass-light" />
          <p className="ui-label text-[10px]">CHANNELS · GATEWAY</p>
          <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => onOpen(links.channels)}>
            Channels
          </Button>
        </div>
        {platforms.length === 0 ? (
          <p className="text-xs text-cream-dim">No platform state in status payload.</p>
        ) : (
          platforms.map(([name, info]) => (
            <div key={name} className="flex items-center gap-2 text-xs border border-brass/10 rounded-lg px-2.5 py-2">
              <span className="text-cream">{name}</span>
              <span
                className={cn(
                  "ml-auto text-[10px]",
                  info?.state === "connected" ? "text-signal-emerald" : "text-signal-rose",
                )}
              >
                {info?.state || "—"}
              </span>
            </div>
          ))
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          {[
            ["Config", links.config],
            ["Pairing", links.pairing],
            ["Profiles", links.profiles],
            ["Logs", links.logs],
          ].map(([label, href]) => (
            <button
              key={String(label)}
              type="button"
              onClick={() => onOpen(String(href))}
              className="text-[11px] border border-brass/15 rounded-lg px-2 py-1 text-cream-muted hover:text-cream"
            >
              {label} ↗
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArtifactsPane({ artQ, onOpenConsole }: { artQ: any; onOpenConsole: () => void }) {
  const payload = artQ.data?.data ?? artQ.data ?? {};
  const items = payload.artifacts ?? [];

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-cream-muted">
          Recent links, files, and image-like outputs from activity feed + command results.
        </p>
        <Button size="sm" variant="outline" onClick={onOpenConsole}>
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          Sessions
        </Button>
      </div>
      {artQ.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 glass-panel rounded-xl animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-brass/20 rounded-2xl px-6 py-10 text-center text-sm text-cream-dim">
          {payload.error || "No artifacts found in recent activity."}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          {items.map((a: any) => (
            <a
              key={a.id}
              href={a.url || "#"}
              target="_blank"
              rel="noreferrer"
              className="glass-panel rounded-xl p-3 border border-brass/10 hover:border-brass/30 block"
            >
              <div className="flex items-center gap-2">
                <Package className="h-3.5 w-3.5 text-brass-light" />
                <span className="text-[9px] uppercase text-cream-dim">{a.kind || "link"}</span>
                {a.agent && <span className="text-[10px] text-brass-light ml-auto">{a.agent}</span>}
              </div>
              <p className="text-sm text-cream mt-1 truncate">{a.title || a.url}</p>
              {a.snippet && (
                <p className="text-[11px] text-cream-muted line-clamp-2 mt-0.5">{a.snippet}</p>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  ok,
}: {
  label: string;
  value: string;
  sub?: string;
  ok?: boolean;
}) {
  return (
    <div className="glass-panel rounded-xl p-3 border border-brass/10">
      <p className="ui-label text-[9px] text-cream-dim">{label}</p>
      <p
        className={cn(
          "font-mono text-sm mt-1",
          ok === true && "text-signal-emerald",
          ok === false && "text-signal-rose",
          ok == null && "text-cream",
        )}
      >
        {value}
      </p>
      {sub ? <p className="text-[10px] text-cream-dim mt-0.5 truncate">{sub}</p> : null}
    </div>
  );
}

function MirrorList({
  loading,
  error,
  empty,
  items,
  onOpen,
  openLabel,
}: {
  loading?: boolean;
  error?: string;
  empty: string;
  items: { key: string; title: string; meta?: string; body?: string }[];
  onOpen: () => void;
  openLabel: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onOpen}>
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          {openLabel}
        </Button>
      </div>
      {error && (
        <div className="text-xs text-signal-amber border border-signal-amber/25 rounded-xl px-3 py-2">
          {error}
        </div>
      )}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 glass-panel rounded-xl animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-brass/20 rounded-2xl px-6 py-10 text-center text-sm text-cream-dim">
          {empty}
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.key} className="glass-panel rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-2">
                <p className="text-sm text-cream truncate">{it.title}</p>
                {it.meta && (
                  <span className="ml-auto text-[10px] text-cream-dim shrink-0">{it.meta}</span>
                )}
              </div>
              {it.body && (
                <p className="text-[11px] text-cream-muted line-clamp-2 mt-0.5">{it.body}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
