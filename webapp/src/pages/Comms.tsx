import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Mic,
  MessageSquare,
  Search,
  Sparkles,
  X,
  User,
  ChevronRight,
  Lock,
} from "lucide-react";
import { api } from "@/lib/api";
import { GlassCard } from "@/components/glass/GlassCard";
import { cn } from "@/lib/utils";
import { useComms, useSmsThread } from "@/lib/queries";

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return "yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDuration(sec: number) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtPhone(phone: string) {
  if (!phone) return "Unknown";
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return phone;
}

// ── Types ──────────────────────────────────────────────────────────────────

type Tab = "all" | "calls" | "sms" | "recordings";
type SelectedItem =
  | { type: "call"; data: any }
  | { type: "sms_thread"; data: any }
  | { type: "recording"; data: any }
  | null;

// ── Left sidebar item components ────────────────────────────────────────────

// ── Avatar initials helper ──────────────────────────────────────────────────
function Avatar({ name, size = "sm", color = "brass" }: { name: string; size?: "sm" | "md"; color?: string }) {
  const initials = name.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const sz = size === "sm" ? "w-9 h-9 text-xs" : "w-11 h-11 text-sm";
  return (
    <div className={cn("rounded-full flex items-center justify-center font-semibold flex-shrink-0 border", sz,
      color === "brass" ? "bg-brass/20 border-brass/40 text-brass-shimmer" :
      color === "emerald" ? "bg-emerald-900/40 border-emerald-500/40 text-emerald-400" :
      "bg-forest-raised border-brass/20 text-cream-muted"
    )}>
      {initials}
    </div>
  );
}

function CallListItem({ item, active, onClick }: { item: any; active: boolean; onClick: () => void }) {
  const dir = item.direction;
  const missed = item.status === "missed";
  const name = item.from_caller_name || fmtPhone(item.from || item.to || "Unknown");
  const Icon = missed ? PhoneMissed : dir === "inbound" || dir === "in" ? PhoneIncoming : PhoneOutgoing;
  const iconColor = missed ? "text-red-400" : dir === "inbound" || dir === "in" ? "text-signal-emerald" : "text-brass";
  const date = item.time ? new Date(item.time).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  return (
    <button onClick={onClick} className={cn(
      "w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-brass/8 transition-colors min-h-[56px]",
      active ? "bg-brass/15 border-l-2 border-l-brass-shimmer" : "hover:bg-forest-raised/60",
    )}>
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <Avatar name={name} size="sm" color={missed ? "rose" : "brass"} />
        <Icon className={cn("absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5", iconColor)} />
      </div>
      {/* Info — 2 column */}
      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5">
        <span className="text-cream text-sm font-medium truncate">{name}</span>
        <span className="text-cream-dim text-[10px] text-right">{timeAgo(item.time)}</span>
        <span className="text-cream-muted text-xs truncate">{fmtDuration(item.duration)}</span>
        <span className="text-cream-dim text-[10px] text-right">{item.time ? new Date(item.time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}) : date}</span>
      </div>
    </button>
  );
}

function SmsListItem({ item, active, onClick }: { item: any; active: boolean; onClick: () => void }) {
  const preview = item.lastMessage?.content || "";
  const phone = item.phone || "";
  const name = fmtPhone(phone);
  const hasUnread = item.unread > 0;

  return (
    <button onClick={onClick} className={cn(
      "w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-brass/8 transition-colors min-h-[56px]",
      active ? "bg-brass/15 border-l-2 border-l-brass-shimmer" : "hover:bg-forest-raised/60",
    )}>
      <div className="relative flex-shrink-0">
        <Avatar name={name} size="sm" color="brass" />
        {hasUnread && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-brass rounded-full text-[9px] font-bold text-forest-deep flex items-center justify-center">{item.unread}</span>}
      </div>
      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5">
        <span className={cn("text-sm font-medium truncate", hasUnread ? "text-cream" : "text-cream-muted")}>{name}</span>
        <span className="text-cream-dim text-[10px] text-right">{timeAgo(item.lastMessage?.timestamp)}</span>
        <span className="text-cream-dim text-xs truncate">{preview.slice(0, 35) || "No messages"}</span>
        <span className="text-cream-dim text-[10px] text-right">{item.lastMessage?.timestamp ? new Date(item.lastMessage.timestamp).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}) : ""}</span>
      </div>
    </button>
  );
}

function RecordingListItem({ item, active, onClick }: { item: any; active: boolean; onClick: () => void }) {
  const title = item.summary_raw?.split("\n")[0]?.replace(/^#+\s*/, "").slice(0, 45) || "Recording";
  const customers = Array.isArray(item.detected_customer_names) ? item.detected_customer_names[0] : item.detected_customer_names;
  const date = item.recorded_at ? new Date(item.recorded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  return (
    <button onClick={onClick} className={cn(
      "w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-brass/8 transition-colors min-h-[56px]",
      active ? "bg-brass/15 border-l-2 border-l-brass-shimmer" : "hover:bg-forest-raised/60",
    )}>
      <div className="w-9 h-9 rounded-full bg-signal-amber/15 border border-signal-amber/30 flex items-center justify-center flex-shrink-0">
        <Mic className="w-4 h-4 text-signal-amber" />
      </div>
      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5">
        <span className="text-cream text-sm font-medium truncate">{title}</span>
        <span className="text-cream-dim text-[10px] text-right">{timeAgo(item.recorded_at)}</span>
        <span className="text-cream-dim text-xs truncate">{customers || fmtDuration(item.duration_seconds)}</span>
        <span className="text-cream-dim text-[10px] text-right">{item.recorded_at ? new Date(item.recorded_at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}) : date}</span>
      </div>
    </button>
  );
}

// ── KPI Tile ────────────────────────────────────────────────────────────────

function KpiTile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <GlassCard className="flex flex-col items-center justify-center p-5 text-center gap-1">
      <div className="font-display italic text-3xl text-brass-shimmer">{value}</div>
      <div className="ui-label text-cream-muted">{label}</div>
      {sub && <div className="text-xs text-cream-dim">{sub}</div>}
    </GlassCard>
  );
}

// ── Call Detail Panel ───────────────────────────────────────────────────────

function CallPanel({ item, onBrief }: { item: any; onBrief: (phone: string) => void }) {
  const phone = item.from || item.to || "";
  const dir = item.direction;
  const Icon =
    item.status === "missed"
      ? PhoneMissed
      : dir === "inbound" || dir === "in"
        ? PhoneIncoming
        : PhoneOutgoing;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-brass" />
            <h2 className="text-cream text-xl font-semibold">
              {item.from_caller_name || fmtPhone(phone)}
            </h2>
          </div>
          <div className="text-cream-muted text-sm mt-1">{fmtPhone(phone)}</div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <span className={cn(
              "px-2 py-0.5 rounded text-xs font-medium",
              item.status === "missed" ? "bg-red-900/40 text-red-300" : "bg-forest-raised text-cream-muted",
            )}>
              {item.status || "completed"}
            </span>
            <span className="px-2 py-0.5 rounded text-xs bg-forest-raised text-cream-muted">
              {dir === "inbound" || dir === "in" ? "Inbound" : "Outbound"}
            </span>
          </div>
        </div>
        <div className="text-right text-cream-muted text-sm">
          <div>{item.time ? new Date(item.time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</div>
          <div>{item.time ? new Date(item.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""}</div>
          <div className="mt-1 font-medium text-cream">{fmtDuration(item.duration)}</div>
        </div>
      </div>

      {/* Brief button */}
      {phone && (
        <button
          onClick={() => onBrief(phone)}
          className="flex items-center gap-2 px-4 py-2 bg-brass/20 hover:bg-brass/30 border border-brass/30 rounded-lg text-brass text-sm font-medium transition-colors w-fit"
        >
          <Sparkles className="w-4 h-4" />
          Brief this customer
        </button>
      )}

      {/* Transcript */}
      {item.transcript_raw && (
        <GlassCard className="p-4">
          <div className="ui-label text-cream-muted mb-3">Transcript</div>
          <div className="text-cream-muted text-sm leading-relaxed whitespace-pre-wrap">
            {item.transcript_raw}
          </div>
        </GlassCard>
      )}

      {/* Summary */}
      {item.transcript_summary && (
        <GlassCard className="p-4">
          <div className="ui-label text-cream-muted mb-3">AI Summary</div>
          <div className="text-cream text-sm leading-relaxed">{item.transcript_summary}</div>
        </GlassCard>
      )}

      {/* Recording */}
      {item.recording_url && (
        <GlassCard className="p-4">
          <div className="ui-label text-cream-muted mb-3">Recording</div>
          <audio controls className="w-full" src={item.recording_url}>
            Your browser does not support audio playback.
          </audio>
        </GlassCard>
      )}
    </div>
  );
}

// ── SMS Thread Panel ────────────────────────────────────────────────────────

function SmsThreadPanel({ thread, onBrief }: { thread: any; onBrief: (phone: string) => void }) {
  const phone = thread.phone;
  const { data: threadData } = useSmsThread(phone);
  const messages = threadData?.messages ?? thread.messages ?? [];
  const customer = threadData?.customer;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-brass/15 flex-shrink-0 flex items-center justify-between">
        <div>
          <div className="text-cream font-semibold">{customer ? customer.name : fmtPhone(phone)}</div>
          <div className="text-cream-muted text-sm">{fmtPhone(phone)}</div>
        </div>
        <div className="flex items-center gap-2">
          {customer && (
            <span className="flex items-center gap-1 text-xs text-signal-emerald bg-signal-emerald/10 px-2 py-1 rounded-full">
              <User className="w-3 h-3" />
              {customer.id}
            </span>
          )}
          <button
            onClick={() => onBrief(phone)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brass/20 hover:bg-brass/30 border border-brass/30 rounded-lg text-brass text-xs font-medium transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            Brief
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="text-cream-dim text-sm text-center py-8">No messages in this thread</div>
        )}
        {messages.map((msg: any) => {
          const isOutbound = msg.direction === "outbound";
          const content = msg.content || msg.body || "";
          return (
            <div key={msg.id} className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[75%] px-4 py-2.5 rounded-2xl",
                  isOutbound
                    ? "bg-brass/20 border border-brass/30 text-cream rounded-br-sm"
                    : "bg-forest-raised text-cream rounded-bl-sm",
                )}
              >
                <div className="text-sm leading-relaxed">{content}</div>
                <div className={cn("text-xs mt-1", isOutbound ? "text-brass/70 text-right" : "text-cream-dim")}>
                  {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Recording Panel ─────────────────────────────────────────────────────────

function RecordingPanel({ item }: { item: any }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const summary = item.summary_raw || "";
  const customers = item.detected_customer_names;

  const handleBrief = async () => {
    setBriefLoading(true);
    setBrief(null);
    try {
      const result = await api.post<{ brief: string }>(`/api/comms/brief/recording/${item.id}`, {});
      setBrief(result?.brief ?? null);
    } catch { setBrief("Unable to generate brief."); }
    finally { setBriefLoading(false); }
  };

  // Split summary into sections by ### headers
  const sections = summary.split(/\n(?=###\s)/);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 gap-6">
      {/* Header */}
      <div>
        <h2 className="text-cream text-xl font-semibold">{item.title || "Recording"}</h2>
        <div className="text-cream-muted text-sm mt-1">
          {item.recorded_at ? new Date(item.recorded_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—"}
          {" · "}
          {fmtDuration(item.duration_seconds)}
        </div>
        {item.detected_type && (
          <span className="inline-block mt-2 px-2 py-0.5 bg-signal-amber/20 text-signal-amber text-xs rounded-full">
            {item.detected_type}
          </span>
        )}
      </div>

      {/* Sofia Brief button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleBrief}
          disabled={briefLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brass/15 border border-brass/30 text-brass-shimmer text-sm hover:bg-brass/25 transition-all disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          {briefLoading ? "Generating brief…" : "⚡ Sofia Brief"}
        </button>
        {brief && (
          <button onClick={() => setBrief(null)} className="text-xs text-cream-dim hover:text-cream">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Brief result */}
      {brief && (
        <GlassCard className="p-4 border border-brass/30">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-brass" />
            <span className="ui-label text-brass">Sofia Intelligence Brief</span>
          </div>
          <div className="text-cream text-sm leading-relaxed whitespace-pre-wrap">
            {brief}
          </div>
        </GlassCard>
      )}

      {/* Detected customers */}
      {customers && customers.length > 0 && (
        <GlassCard className="p-4">
          <div className="ui-label text-cream-muted mb-2">Detected Customers</div>
          <div className="flex flex-wrap gap-2">
            {(Array.isArray(customers) ? customers : [customers]).map((name: string, i: number) => (
              <span key={i} className="flex items-center gap-1 text-sm text-signal-emerald bg-signal-emerald/10 px-2 py-1 rounded-full">
                <User className="w-3 h-3" />
                {name}
              </span>
            ))}
          </div>
        </GlassCard>
      )}

      {/* AI Summary */}
      {summary && (
        <GlassCard className="p-4">
          <div className="ui-label text-cream-muted mb-3">AI Summary</div>
          <div className="text-cream text-sm leading-relaxed space-y-4">
            {sections.map((section: string, i: number) => {
              const lines = section.split("\n").filter(Boolean);
              const heading = lines[0]?.startsWith("###") ? lines[0].replace(/^###\s*/, "") : null;
              const body = heading ? lines.slice(1) : lines;
              return (
                <div key={i}>
                  {heading && <div className="font-semibold text-brass mb-1">{heading}</div>}
                  {body.map((line: string, j: number) => (
                    <div key={j} className={cn("text-cream-muted", line.startsWith("-") ? "pl-3" : "")}>
                      {line}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* Full transcript toggle */}
      {item.transcript_raw && (
        <div>
          <button
            onClick={() => setShowTranscript(v => !v)}
            className="text-brass text-sm hover:underline"
          >
            {showTranscript ? "Hide" : "Show"} full transcript
          </button>
          {showTranscript && (
            <GlassCard className="p-4 mt-3">
              <div className="text-cream-muted text-xs leading-relaxed whitespace-pre-wrap font-mono">
                {item.transcript_raw}
              </div>
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
}

// ── Grok Brief Card ─────────────────────────────────────────────────────────

function GrokBriefCard({ brief, customer, onClose }: { brief: string; customer: any; onClose: () => void }) {
  return (
    <div className="mx-6 mt-0 mb-4">
      <GlassCard className="p-4 border border-brass/30 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-cream-dim hover:text-cream"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-brass" />
          <span className="ui-label text-brass">Customer Brief</span>
          {customer && (
            <span className="text-xs text-cream-dim">· {customer.name}</span>
          )}
        </div>
        <p className="text-cream text-sm leading-relaxed pr-6">{brief}</p>
      </GlassCard>
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────────────────────────

function EmptyState({ counts, dailyBrief, onFilter }: { counts: any; dailyBrief: any; onFilter: (tab: Tab) => void }) {
  const [briefLoading, setBriefLoading] = useState(false);
  const [generatedBrief, setGeneratedBrief] = useState<string | null>(dailyBrief?.body ?? null);

  const runBrief = async () => {
    setBriefLoading(true);
    try {
      const r = await api.get<{ brief: string }>("/api/comms/daily-brief/trigger");
      setGeneratedBrief(r?.brief ?? null);
    } catch { /* silent */ }
    finally { setBriefLoading(false); }
  };

  if (!counts) return (
    <div className="flex-1 flex items-center justify-center text-cream-dim text-sm">
      Select a conversation to view details.
    </div>
  );

  const tiles = [
    { label: "Calls Today", value: counts.callsToday, sub: `${Math.round((counts.todayTalkTime||0)/60)}m talk time`, tab: "calls" as Tab, accent: "emerald" },
    { label: "Missed Calls", value: counts.missedCalls, sub: `${counts.missedRate || 0}% miss rate`, tab: "calls" as Tab, accent: counts.missedCalls > 0 ? "rose" : "default" },
    { label: "Avg Duration", value: fmtDuration(counts.avgDuration || 0), sub: "per answered call", tab: "calls" as Tab, accent: "default" },
    { label: "SMS Threads", value: counts.smsThreads, sub: `${counts.unreadSms || 0} unread`, tab: "sms" as Tab, accent: counts.unreadSms > 0 ? "amber" : "default" },
    { label: "Recordings", value: counts.totalRecordings, sub: "Plaud captures", tab: "recordings" as Tab, accent: "amber" },
  ];

  const accentClass: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-900/20",
    rose: "border-red-500/30 bg-red-900/20",
    amber: "border-signal-amber/30 bg-signal-amber/10",
    default: "border-brass/20 bg-forest-raised/40",
  };
  const numClass: Record<string, string> = {
    emerald: "text-signal-emerald",
    rose: "text-red-400",
    amber: "text-signal-amber",
    default: "text-brass-shimmer",
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-cream text-xl font-semibold">Comms Intelligence</h2>
          <p className="text-cream-dim text-xs mt-0.5">Click any tile to filter the list</p>
        </div>
        <button onClick={runBrief} disabled={briefLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brass/15 border border-brass/30 text-brass-shimmer text-sm hover:bg-brass/25 transition-all disabled:opacity-50">
          <Sparkles className="w-4 h-4" />
          {briefLoading ? "Analyzing…" : "⚡ Daily Brief"}
        </button>
      </div>

      {/* KPI tiles — clickable */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {tiles.map(t => (
          <button key={t.label} onClick={() => onFilter(t.tab)}
            className={cn("rounded-xl border p-4 text-left hover:border-brass/50 transition-all active:scale-95", accentClass[t.accent])}>
            <div className={cn("font-display italic text-3xl leading-none mb-1", numClass[t.accent])}>{t.value}</div>
            <div className="ui-label text-[9px] text-cream-muted">{t.label}</div>
            {t.sub && <div className="text-[10px] text-cream-dim mt-0.5">{t.sub}</div>}
          </button>
        ))}
      </div>

      {/* Top callers */}
      {counts.topCallers?.length > 0 && (
        <GlassCard className="p-4">
          <div className="ui-label text-cream-muted mb-3 flex items-center gap-1.5"><Phone className="w-3 h-3" /> Top Callers</div>
          <div className="space-y-2">
            {counts.topCallers.map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-brass-shimmer font-mono text-xs w-4">{i + 1}</span>
                  <span className="text-cream text-sm">{c.name}</span>
                </div>
                <span className="text-cream-dim text-xs">{c.count} call{c.count !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Daily Brief */}
      {generatedBrief && (
        <GlassCard className="p-5 border border-brass/25">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-brass" />
            <span className="ui-label text-brass">Daily Intelligence Brief</span>
            {dailyBrief?.created_at && (
              <span className="text-xs text-cream-dim">· {timeAgo(dailyBrief.created_at)}</span>
            )}
          </div>
          <div className="text-cream text-sm leading-relaxed whitespace-pre-wrap">{generatedBrief}</div>
        </GlassCard>
      )}

      {!generatedBrief && (
        <GlassCard className="p-5 border border-dashed border-brass/20 flex flex-col items-center gap-3 text-center">
          <Sparkles className="w-6 h-6 text-brass/40" />
          <div>
            <p className="text-cream-muted text-sm font-medium">Daily Intelligence Brief</p>
            <p className="text-cream-dim text-xs mt-1">Auto-generates every evening at 7pm ET.<br />Or tap ⚡ Daily Brief to generate now.</p>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function Comms() {
  const { data: commsData, isLoading } = useComms();
  const [tab, setTab] = useState<Tab>("all");
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isDragging = useRef(false);

  const handleDragStart = (e: React.MouseEvent) => {
    isDragging.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const w = Math.min(520, Math.max(240, startW + ev.clientX - startX));
      setSidebarWidth(w);
    };
    const onUp = () => { isDragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [brief, setBrief] = useState<{ brief: string; customer: any } | null>(null);

  const briefMutation = useMutation({
    mutationFn: (phone: string) =>
      api.post<{ brief: string; customer: any }>(`/api/comms/brief/${encodeURIComponent(phone)}`, {}),
    onSuccess: (data) => {
      if (data) setBrief(data);
    },
  });

  const handleBrief = (phone: string) => {
    setBrief(null);
    briefMutation.mutate(phone);
  };

  // Build filtered list
  const calls = commsData?.calls ?? [];
  const recordings = commsData?.recordings ?? [];
  const smsThreads = commsData?.smsThreads ?? [];
  const timeline = commsData?.timeline ?? [];

  const q = search.toLowerCase();

  const filteredTimeline = (tab === "all" ? timeline : [
    ...(tab === "calls" ? calls.map((c: any) => ({ type: "call", ts: c.time, data: c })) : []),
    ...(tab === "sms" ? smsThreads.map((t: any) => ({ type: "sms_thread", ts: t.lastMessage?.timestamp, data: t })) : []),
    ...(tab === "recordings" ? recordings.map((r: any) => ({ type: "recording", ts: r.recorded_at, data: r })) : []),
  ]).filter((item: any) => {
    if (!q) return true;
    if (item.type === "call") {
      return (
        (item.data.from_caller_name || "").toLowerCase().includes(q) ||
        (item.data.from || "").includes(q) ||
        (item.data.to || "").includes(q)
      );
    }
    if (item.type === "sms_thread") {
      return (
        (item.data.phone || "").includes(q) ||
        (item.data.lastMessage?.content || "").toLowerCase().includes(q)
      );
    }
    if (item.type === "recording") {
      return (
        (item.data.title || "").toLowerCase().includes(q) ||
        (item.data.summary_raw || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "calls", label: "Calls" },
    { id: "sms", label: "SMS" },
    { id: "recordings", label: "Rec." },
  ];

  const isActive = (item: any) => {
    if (!selected) return false;
    if (item.type === "call" && selected.type === "call") return item.data.id === selected.data.id;
    if (item.type === "sms_thread" && selected.type === "sms_thread") return item.data.phone === selected.data.phone;
    if (item.type === "recording" && selected.type === "recording") return item.data.id === selected.data.id;
    return false;
  };

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden">
      {/* ── LEFT SIDEBAR (resizable) ── */}
      <div style={{ width: sidebarWidth }} className="flex-shrink-0 border-r border-brass/15 flex flex-col bg-forest-deep relative">
        {/* Header + Search */}
        <div className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-brass/10">
          <h1 className="text-cream font-semibold text-lg mb-3">Comms</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cream-dim" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-forest-raised border border-brass/15 rounded-lg text-cream text-sm placeholder:text-cream-dim focus:outline-none focus:border-brass/40"
            />
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-4 py-2 flex gap-1 flex-shrink-0 border-b border-brass/10">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 py-1 text-xs font-medium rounded transition-colors",
                tab === t.id
                  ? "bg-brass/25 text-brass-shimmer"
                  : "text-cream-muted hover:text-cream hover:bg-forest-raised",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="text-cream-dim text-xs text-center py-8">Loading...</div>
          )}
          {!isLoading && filteredTimeline.length === 0 && (
            <div className="text-cream-dim text-xs text-center py-8">No items</div>
          )}
          {filteredTimeline.map((item: any, i: number) => {
            const active = isActive(item);
            if (item.type === "call") {
              return (
                <CallListItem
                  key={`call-${item.data.id ?? i}`}
                  item={item.data}
                  active={active}
                  onClick={() => { setSelected({ type: "call", data: item.data }); setBrief(null); }}
                />
              );
            }
            if (item.type === "sms_thread") {
              return (
                <SmsListItem
                  key={`sms-${item.data.phone ?? i}`}
                  item={item.data}
                  active={active}
                  onClick={() => { setSelected({ type: "sms_thread", data: item.data }); setBrief(null); }}
                />
              );
            }
            if (item.type === "recording") {
              return (
                <RecordingListItem
                  key={`rec-${item.data.id ?? i}`}
                  item={item.data}
                  active={active}
                  onClick={() => { setSelected({ type: "recording", data: item.data }); setBrief(null); }}
                />
              );
            }
            return null;
          })}
        </div>
      </div>

      {/* Drag handle */}
      <div onMouseDown={handleDragStart}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-brass/40 transition-colors z-10" />

      {/* ── RIGHT PANEL ── */}
      <div className="flex-1 flex flex-col bg-forest-deep overflow-hidden">
        {/* Grok brief result */}
        {briefMutation.isPending && (
          <div className="mx-6 mt-4">
            <GlassCard className="p-4 border border-brass/20">
              <div className="flex items-center gap-2 text-brass text-sm">
                <Sparkles className="w-4 h-4 animate-pulse" />
                Generating brief...
              </div>
            </GlassCard>
          </div>
        )}
        {brief && !briefMutation.isPending && (
          <GrokBriefCard brief={brief.brief} customer={brief.customer} onClose={() => setBrief(null)} />
        )}

        {/* Main content */}
        {selected === null ? (
          <EmptyState counts={commsData?.counts} dailyBrief={(commsData as any)?.dailyBrief} onFilter={(t) => { setTab(t); }} />
        ) : selected.type === "call" ? (
          <CallPanel item={selected.data} onBrief={handleBrief} />
        ) : selected.type === "sms_thread" ? (
          <SmsThreadPanel thread={selected.data} onBrief={handleBrief} />
        ) : selected.type === "recording" ? (
          <RecordingPanel item={selected.data} />
        ) : null}
      </div>
    </div>
  );
}
