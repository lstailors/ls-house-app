import { useMemo, useState } from "react";
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
} from "lucide-react";
import { Button } from "@ls/design/ui/button";
import { cn } from "@ls/design/utils";
import {
  useHermesMirrorStatus,
  useHermesMirrorSessions,
  useHermesMirrorSkills,
  useHermesMirrorCron,
} from "@/lib/queries";

type Sub = "overview" | "sessions" | "skills" | "cron" | "map";

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

  const payload = (statusQ.data as any)?.data ?? statusQ.data ?? {};
  const st = payload.status ?? {};
  const links = payload.links ?? {};
  const map = payload.feature_map ?? [];
  const authOk = Boolean(payload.auth_configured);
  const liveOk = Boolean(payload.ok);

  const platforms = useMemo(() => {
    const p = st.gateway_platforms || {};
    return Object.entries(p) as [string, any][];
  }, [st]);

  const open = (url?: string) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="glass-panel rounded-2xl p-4 border border-brass/15 flex flex-wrap gap-3 items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Monitor className="h-4 w-4 text-brass-light" />
            <p className="ui-label text-[10px] text-brass-light">HERMES MIRROR · SPEC 072</p>
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
            Live status + deep links now. Sessions / skills / cron manage unlock when dashboard
            credentials are on the server. Full streaming chat, files, git stay on Desktop or Open
            Console.
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
            Chat
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

      {/* Live status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Version"
          value={st.version || "—"}
          sub={st.release_date || ""}
        />
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

      {/* Sub tabs */}
      <div className="flex flex-wrap gap-1 border border-brass/10 rounded-xl p-1 bg-forest-raised/20">
        {(
          [
            ["overview", "Overview", Layers],
            ["sessions", "Sessions", MessageSquare],
            ["skills", "Skills", Sparkles],
            ["cron", "Cron manage", Calendar],
            ["map", "Feature map", BarChart3],
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
                ["Chat", links.chat, MessageSquare],
                ["Sessions", links.sessions, Radio],
                ["Cron", links.cron, Calendar],
                ["Skills", links.skills, Sparkles],
                ["MCP", links.mcp, Settings],
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
                  {/* @ts-expect-error icon */}
                  <Icon className="h-3.5 w-3.5 text-brass-light shrink-0" />
                  {label}
                  <ExternalLink className="h-3 w-3 ml-auto opacity-50" />
                </button>
              ))}
            </div>
          </div>
          <div className="glass-panel rounded-xl p-4 space-y-3">
            <p className="ui-label text-[10px]">HOW THIS MIRROR WORKS</p>
            <ul className="text-xs text-cream-muted space-y-2 list-disc pl-4">
              <li>
                <span className="text-cream">Open Console</span> = full Hermes Web Dashboard at{" "}
                <span className="font-mono text-[10px]">maestro.lstailors.com</span> (same backend
                Desktop uses).
              </li>
              <li>
                <span className="text-cream">API panels</span> (Sessions / Skills / Cron) need server
                credentials once — then they render inside MC.
              </li>
              <li>
                L&S fleet Board / Approvals / activity stay MC-native (not Desktop).
              </li>
              <li>
                Streaming chat with tool cards: Desktop app on Studio, or Console → Chat.
              </li>
            </ul>
            {!authOk && (
              <div className="rounded-lg border border-signal-amber/25 bg-signal-amber/10 px-3 py-2 text-[11px] text-signal-amber flex gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Wire <code className="font-mono">HERMES_DASHBOARD_BASIC_AUTH_USERNAME</code> +{" "}
                  <code className="font-mono">PASSWORD</code> (or keychain{" "}
                  <code className="font-mono">hermes-dashboard-username/password</code>) on Studio +
                  Vercel to unlock mirrored sessions/skills/cron inside this tab.
                </span>
              </div>
            )}
            {authOk && (
              <div className="rounded-lg border border-signal-emerald/25 bg-signal-emerald/10 px-3 py-2 text-[11px] text-signal-emerald flex gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Dashboard API credentials configured — open Sessions / Skills / Cron subtabs.
              </div>
            )}
          </div>
        </div>
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
