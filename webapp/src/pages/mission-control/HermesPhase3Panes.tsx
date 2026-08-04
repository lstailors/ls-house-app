import { useHermesMirrorSessionMessages } from "@/lib/queries";
import { Button } from "@ls/design/ui/button";
import { cn } from "@ls/design/utils";
import {
  ExternalLink,
  ChevronLeft,
  Brain,
  Package,
} from "lucide-react";

function fmtN(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

function fmtUsd(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `$${Number(n).toFixed(2)}`;
}

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

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="glass-panel rounded-xl p-3 border border-brass/10">
      <p className="ui-label text-[9px] text-cream-dim">{label}</p>
      <p className="font-mono text-sm mt-1 text-cream truncate">{value}</p>
      {sub ? <p className="text-[10px] text-cream-dim mt-0.5 truncate">{sub}</p> : null}
    </div>
  );
}

export function SessionsPane({
  sessionsQ,
  statsQ,
  openSessionId,
  setOpenSessionId,
  links,
  onOpen,
}: {
  sessionsQ: any;
  statsQ: any;
  openSessionId: string | null;
  setOpenSessionId: (id: string | null) => void;
  links: any;
  onOpen: (u?: string) => void;
}) {
  const msgsQ = useHermesMirrorSessionMessages(openSessionId);
  const stats = (statsQ.data as any)?.data?.stats ?? {};
  const sessions = (sessionsQ.data as any)?.data?.sessions ?? [];
  const err =
    (sessionsQ.data as any)?.data?.error ||
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
            {err}
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
                    !isUser && !isTool && "border-brass/10 glass-panel",
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="ui-label text-[9px] text-brass-light">{role}</span>
                    {m.model && (
                      <span className="text-[9px] font-mono text-cream-dim">{m.model}</span>
                    )}
                  </div>
                  <p className="text-cream-muted whitespace-pre-wrap break-words line-clamp-[20]">
                    {text || (m.tool_calls ? JSON.stringify(m.tool_calls).slice(0, 500) : "(empty)")}
                  </p>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Total sessions" value={fmtN(stats.total)} />
        <Stat label="Messages" value={fmtN(stats.messages)} />
        <Stat label="Archived" value={fmtN(stats.archived)} />
        <Stat
          label="By source"
          value={
            stats.by_source
              ? Object.entries(stats.by_source)
                  .slice(0, 2)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(" ")
              : "—"
          }
          sub={
            stats.by_source
              ? Object.entries(stats.by_source)
                  .slice(2)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(" ")
              : ""
          }
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => onOpen(links.sessions)}>
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          Open Sessions in Console
        </Button>
      </div>
      {err && (
        <div className="text-xs text-signal-amber border border-signal-amber/25 rounded-xl px-3 py-2">
          {err}
        </div>
      )}
      {sessionsQ.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 glass-panel rounded-xl animate-pulse" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="border border-dashed border-brass/20 rounded-2xl px-6 py-10 text-center text-sm text-cream-dim">
          No sessions (or auth not configured).
        </div>
      ) : (
        <div className="space-y-1.5">
          {sessions.map((s: any, i: number) => {
            const id = s.id || s.session_id || String(i);
            return (
              <button
                key={id}
                type="button"
                onClick={() => setOpenSessionId(s.id || s.session_id)}
                className="w-full text-left glass-panel rounded-xl px-3 py-2.5 border border-transparent hover:border-brass/30"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm text-cream truncate">
                    {s.title || s.id || s.session_id || "session"}
                  </p>
                  <span className="ml-auto text-[10px] text-cream-dim shrink-0">
                    {[
                      s.source,
                      s.model,
                      s.message_count != null ? `${s.message_count} msgs` : null,
                      s.tool_call_count != null ? `${s.tool_call_count} tools` : null,
                      s.is_active ? "live" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {s.preview && (
                  <p className="text-[11px] text-cream-muted line-clamp-2 mt-0.5">{s.preview}</p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MemoryPane({ memQ, onOpen }: { memQ: any; onOpen: (u?: string) => void }) {
  const d = (memQ.data as any)?.data ?? {};
  const providers = d.providers ?? [];
  const files = d.builtin_files ?? {};
  const links = d.links ?? {};
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-cream-muted">
          Active provider:{" "}
          <span className="text-cream font-mono">{d.active || "built-in"}</span>
        </p>
        <Button size="sm" variant="outline" onClick={() => onOpen(links.memory || links.system)}>
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          System · Memory
        </Button>
      </div>
      {d.error && (
        <div className="text-xs text-signal-amber border border-signal-amber/25 rounded-xl px-3 py-2">
          {d.error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="MEMORY.md" value={`${fmtN(files.memory ?? 0)} B`} />
        <Stat label="USER.md" value={`${fmtN(files.user ?? 0)} B`} />
      </div>
      <div className="space-y-1.5">
        <p className="ui-label text-[9px]">PROVIDERS</p>
        {memQ.isLoading ? (
          <div className="h-20 glass-panel rounded-xl animate-pulse" />
        ) : providers.length === 0 ? (
          <p className="text-xs text-cream-dim">No providers returned.</p>
        ) : (
          providers.map((p: any) => (
            <div
              key={p.name}
              className="glass-panel rounded-xl px-3 py-2.5 border border-brass/10 flex gap-3 items-start"
            >
              <Brain className="h-4 w-4 text-brass-light shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-cream">{p.name}</span>
                  <span
                    className={cn(
                      "text-[9px] uppercase",
                      p.configured ? "text-signal-emerald" : "text-cream-dim",
                    )}
                  >
                    {p.configured ? "configured" : "not configured"}
                  </span>
                  {d.active === p.name && (
                    <span className="text-[9px] text-brass-light border border-brass/25 rounded-full px-1.5">
                      active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-cream-muted mt-0.5 line-clamp-2">{p.description}</p>
              </div>
            </div>
          ))
        )}
      </div>
      <p className="text-[10px] text-cream-dim">
        Graph UI stays in Desktop/Console when a provider is configured. Built-in files edit via
        Console → System.
      </p>
    </div>
  );
}

export function UsagePane({
  usageQ,
  modelsQ,
  statsQ,
  onOpen,
}: {
  usageQ: any;
  modelsQ: any;
  statsQ: any;
  onOpen: () => void;
}) {
  const usage = (usageQ.data as any)?.data?.usage ?? (usageQ.data as any)?.data ?? {};
  const totals = usage.totals || (modelsQ.data as any)?.data?.totals || {};
  const models = (modelsQ.data as any)?.data?.models ?? [];
  const daily = usage.daily ?? [];
  const stats = (statsQ.data as any)?.data?.stats ?? {};
  const err =
    (usageQ.data as any)?.data?.error ||
    (modelsQ.data as any)?.data?.error ||
    (usageQ.error as Error)?.message;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onOpen}>
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          Console analytics
        </Button>
      </div>
      {err && (
        <div className="text-xs text-signal-amber border border-signal-amber/25 rounded-xl px-3 py-2">
          {err}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Input tok" value={fmtN(totals.input_tokens)} />
        <Stat label="Output tok" value={fmtN(totals.output_tokens)} />
        <Stat label="Cache read" value={fmtN(totals.cache_read_tokens)} />
        <Stat
          label="Est. cost"
          value={fmtUsd(totals.estimated_cost ?? totals.actual_cost)}
          sub={`${fmtN(stats.total)} sessions store`}
        />
      </div>
      <div>
        <p className="ui-label text-[9px] mb-2">BY MODEL · 14d</p>
        {modelsQ.isLoading ? (
          <div className="h-24 glass-panel rounded-xl animate-pulse" />
        ) : models.length === 0 ? (
          <p className="text-xs text-cream-dim">No model breakdown.</p>
        ) : (
          <div className="space-y-1.5">
            {models.slice(0, 12).map((m: any) => (
              <div
                key={m.model + (m.provider || "")}
                className="glass-panel rounded-xl px-3 py-2 border border-brass/10 grid grid-cols-[1.4fr_0.8fr_0.8fr_0.6fr] gap-2 text-xs items-center"
              >
                <div>
                  <p className="text-cream font-mono text-[11px] truncate">{m.model}</p>
                  <p className="text-[9px] text-cream-dim">{m.provider}</p>
                </div>
                <span className="text-cream-muted font-mono">{fmtN(m.input_tokens)} in</span>
                <span className="text-cream-muted font-mono">{fmtN(m.output_tokens)} out</span>
                <span className="text-brass-light font-mono text-right">{fmtN(m.sessions)} sess</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {daily.length > 0 && (
        <div>
          <p className="ui-label text-[9px] mb-2">DAILY</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {[...daily]
              .reverse()
              .slice(0, 14)
              .map((d: any) => (
                <div
                  key={d.day}
                  className="flex gap-3 text-[11px] font-mono text-cream-muted border-b border-brass/5 py-1"
                >
                  <span className="text-cream w-24">{d.day}</span>
                  <span>{fmtN(d.input_tokens)} in</span>
                  <span>{fmtN(d.output_tokens)} out</span>
                  <span className="ml-auto">{fmtN(d.sessions)} sess</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// silence unused import if tree-shaken oddly
void Package;
