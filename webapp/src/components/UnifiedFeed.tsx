import { useNavigate } from "react-router-dom";
import {
  X, Bell, Hash, Smartphone, Zap, CheckSquare, Clock, ChevronRight, CheckCheck,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { formatRelative } from "@ls/design/format";
import { cn } from "@ls/design/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  kind: string;
  priority: string;
  title: string;
  body?: string | null;
  meta?: string | null;
  ts?: string | null;
  href: string;
  read: boolean;
}

interface RavenMessage {
  name: string;
  owner: string;
  creation: string;
  text: string;
  message_type: string;
  channel_id?: string;
}

interface RavenChannel {
  name: string;
  channel_name: string;
  type: string;
}

interface SofiaConversation {
  id: string;
  phone?: string | null;
  contact_name?: string | null;
  last_message?: string | null;
  last_message_direction?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
}

type FeedItem =
  | { kind: "approval"; n: Notification; ts: Date }
  | { kind: "task"; n: Notification; ts: Date }
  | { kind: "alert"; n: Notification; ts: Date }
  | { kind: "raven"; channel: string; owner: string; text: string; ts: Date }
  | { kind: "sms"; conv: SofiaConversation; ts: Date };

// ─── Helper ───────────────────────────────────────────────────────────────────

function shortName(owner: string): string {
  const parts = owner.split(/[\s._@]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1][0]}.`;
  return parts[0] ?? owner;
}

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-signal-rose",
  high: "bg-signal-amber",
  normal: "bg-brass/50",
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "text-signal-rose",
  high: "text-signal-amber",
  normal: "text-cream-muted",
};

// ─── Card Components ──────────────────────────────────────────────────────────

function ApprovalCard({ item, onClick }: { item: Extract<FeedItem, { kind: "approval" }>; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-brass/6 transition-colors border-b border-brass/8 last:border-0 text-left"
    >
      <div className="h-7 w-7 rounded-lg bg-signal-amber/10 border border-signal-amber/30 flex items-center justify-center shrink-0 mt-0.5">
        <Zap className="h-3.5 w-3.5 text-signal-amber" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="ui-label text-[9px] text-signal-amber tracking-widest">APPROVAL REQUIRED</span>
          {item.n.priority !== "normal" && (
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", PRIORITY_DOT[item.n.priority])} />
          )}
        </div>
        <div className="text-cream text-xs font-medium leading-snug">{item.n.title}</div>
        {item.n.body && (
          <div className="text-cream-dim text-[11px] mt-0.5 line-clamp-2 leading-relaxed">{item.n.body}</div>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[9px] text-cream-dim flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {formatRelative(item.n.ts)}
          </span>
          <span className="text-[9px] text-brass-light flex items-center gap-0.5 ml-auto">
            Review <ChevronRight className="h-2.5 w-2.5" />
          </span>
        </div>
      </div>
    </button>
  );
}

function TaskCard({ item, onClick }: { item: Extract<FeedItem, { kind: "task" }>; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-brass/6 transition-colors border-b border-brass/8 last:border-0 text-left"
    >
      <div className="h-7 w-7 rounded-lg bg-brass/10 border border-brass/25 flex items-center justify-center shrink-0 mt-0.5">
        <CheckSquare className="h-3.5 w-3.5 text-brass-light" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="ui-label text-[9px] text-brass-light tracking-widest">TASK</span>
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", PRIORITY_DOT[item.n.priority] ?? "bg-brass/40")} />
        </div>
        <div className={cn("text-xs font-medium leading-snug", PRIORITY_COLOR[item.n.priority] ?? "text-cream")}>
          {item.n.title}
        </div>
        {item.n.meta && (
          <div className="text-cream-dim text-[11px] mt-0.5">Due: {item.n.meta}</div>
        )}
        <div className="mt-1.5">
          <span className="text-[9px] text-cream-dim flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {formatRelative(item.n.ts)}
          </span>
        </div>
      </div>
    </button>
  );
}

function AlertCard({ item, onClick }: { item: Extract<FeedItem, { kind: "alert" }>; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-brass/6 transition-colors border-b border-brass/8 last:border-0 text-left"
    >
      <div className="h-7 w-7 rounded-lg bg-forest-raised/60 border border-brass/15 flex items-center justify-center shrink-0 mt-0.5">
        <Bell className="h-3.5 w-3.5 text-cream-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="ui-label text-[9px] text-cream-dim tracking-widest mb-0.5 uppercase">{item.n.kind}</div>
        <div className="text-cream text-xs font-medium leading-snug">{item.n.title}</div>
        {item.n.body && (
          <div className="text-cream-dim text-[11px] mt-0.5 line-clamp-2 leading-relaxed">{item.n.body}</div>
        )}
        <div className="mt-1.5">
          <span className="text-[9px] text-cream-dim flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {formatRelative(item.n.ts)}
          </span>
        </div>
      </div>
    </button>
  );
}

function RavenCard({ item }: { item: Extract<FeedItem, { kind: "raven" }> }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5 border-b border-brass/8 last:border-0">
      <div className="h-7 w-7 rounded-lg bg-violet-900/30 border border-violet-500/25 flex items-center justify-center shrink-0 mt-0.5">
        <Hash className="h-3.5 w-3.5 text-violet-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="ui-label text-[9px] text-violet-400 tracking-widest mb-0.5">#{item.channel}</div>
        <div className="text-cream-dim text-[11px] leading-relaxed">
          <span className="text-cream-muted font-medium">{shortName(item.owner)}</span>
          {" · "}
          <span className="line-clamp-2">{item.text.length > 80 ? item.text.slice(0, 80) + "…" : item.text}</span>
        </div>
        <div className="mt-1.5">
          <span className="text-[9px] text-cream-dim flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {formatRelative(item.ts.toISOString())}
          </span>
        </div>
      </div>
    </div>
  );
}

function SmsCard({ item, onClick }: { item: Extract<FeedItem, { kind: "sms" }>; onClick: () => void }) {
  const display = item.conv.contact_name || item.conv.phone || "Unknown";
  const dir = item.conv.last_message_direction;
  const dirArrow = dir === "inbound" ? "←" : "→";
  const preview = item.conv.last_message ?? "";
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-brass/6 transition-colors border-b border-brass/8 last:border-0 text-left"
    >
      <div className="h-7 w-7 rounded-lg bg-signal-green/10 border border-signal-green/25 flex items-center justify-center shrink-0 mt-0.5">
        <Smartphone className="h-3.5 w-3.5 text-signal-green" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="ui-label text-[9px] text-signal-green tracking-widest mb-0.5">CLIENT SMS</div>
        <div className="text-cream text-xs font-medium leading-snug">
          {display} <span className="text-cream-dim font-normal">{dirArrow}</span>
        </div>
        <div className="text-cream-dim text-[11px] mt-0.5 line-clamp-2 leading-relaxed">
          {preview.length > 80 ? preview.slice(0, 80) + "…" : preview}
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[9px] text-cream-dim flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {formatRelative(item.conv.last_message_at)}
          </span>
          <span className="text-[9px] text-signal-green flex items-center gap-0.5 ml-auto">
            View thread <ChevronRight className="h-2.5 w-2.5" />
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function UnifiedFeed({ onClose }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // 1. Notifications
  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ notifications: Notification[]; unread: number }>("/api/notifications"),
    refetchInterval: 30_000,
  });

  // 2. Raven channels + messages
  const { data: channelsData } = useQuery({
    queryKey: ["raven-channels"],
    queryFn: () => api.get<{ channels: RavenChannel[] }>("/api/raven/channels"),
    refetchInterval: 30_000,
    retry: false,
  });
  const channels = channelsData?.channels ?? [];

  const { data: ravenMessages } = useQuery({
    queryKey: ["raven-feed-messages", channels.map((c) => c.name)],
    queryFn: async () => {
      const results: Array<{ channel: string; msg: RavenMessage }> = [];
      await Promise.allSettled(
        channels.slice(0, 8).map(async (ch) => {
          try {
            const r = await api.get<{ messages: RavenMessage[] }>(
              `/api/raven/channels/${encodeURIComponent(ch.name)}/messages?limit=10`
            );
            (r?.messages ?? []).forEach((m) => {
              if (m.message_type === "Text") {
                results.push({ channel: ch.channel_name || ch.name, msg: m });
              }
            });
          } catch {
            // channel fetch failed, skip
          }
        })
      );
      return results;
    },
    enabled: channels.length > 0,
    refetchInterval: 30_000,
    retry: false,
  });

  // 3. Sofia conversations
  const { data: sofiaData } = useQuery({
    queryKey: ["sofia-conversations"],
    queryFn: () => api.get<{ conversations: SofiaConversation[] }>("/api/sofia/conversations"),
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Combine into feed ──
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const items: FeedItem[] = [];

  (notifData?.notifications ?? []).forEach((n) => {
    const ts = n.ts ? new Date(n.ts) : new Date(0);
    if (n.kind === "approval") items.push({ kind: "approval", n, ts });
    else if (n.kind === "task") items.push({ kind: "task", n, ts });
    else items.push({ kind: "alert", n, ts });
  });

  (ravenMessages ?? []).forEach(({ channel, msg }) => {
    const ts = new Date(msg.creation);
    items.push({ kind: "raven", channel, owner: msg.owner, text: msg.text, ts });
  });

  (sofiaData?.conversations ?? []).forEach((conv) => {
    if (!conv.last_message_at) return;
    const ts = new Date(conv.last_message_at);
    items.push({ kind: "sms", conv, ts });
  });

  // Sort newest first
  items.sort((a, b) => b.ts.getTime() - a.ts.getTime());

  // ── Badge counts ──
  const notifUnread = notifData?.unread ?? 0;
  const ravenUnread = (ravenMessages ?? []).filter(({ msg }) => new Date(msg.creation).getTime() > oneHourAgo).length;
  const sofiaUnread = (sofiaData?.conversations ?? []).filter(
    (c) =>
      c.last_message_direction === "inbound" &&
      c.last_message_at &&
      new Date(c.last_message_at).getTime() > oneDayAgo
  ).length;
  const totalBadge = notifUnread + ravenUnread + sofiaUnread;

  const go = (href: string) => { navigate(href); onClose(); };

  const handleMarkAllRead = async () => {
    try {
      await api.post("/api/notifications/mark-all-read");
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-forest-deep/50 backdrop-blur-sm" aria-hidden />
      <div
        className="absolute right-4 top-16 w-full max-w-[480px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-forest-raised/97 border border-brass/25 rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-brass/15">
            <div>
              <div className="text-cream text-sm font-medium">Activity</div>
              {totalBadge > 0 ? (
                <div className="ui-label text-[9px] text-signal-amber mt-0.5">
                  {totalBadge} item{totalBadge !== 1 ? "s" : ""} requiring attention
                </div>
              ) : (
                <div className="ui-label text-[9px] text-cream-dim mt-0.5">All streams</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {notifUnread > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 text-[10px] text-cream-dim hover:text-brass-light transition-colors px-2 py-1 rounded border border-brass/15 hover:border-brass/30"
                >
                  <CheckCheck className="h-3 w-3" />
                  Mark all read
                </button>
              )}
              <button onClick={onClose} className="text-cream-dim hover:text-cream transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Feed */}
          <div className="overflow-y-auto max-h-[70vh]">
            {items.length === 0 && (
              <div className="px-4 py-12 text-center">
                <div className="text-cream-dim/50 text-3xl mb-3">✓</div>
                <div className="text-cream-muted text-sm">All clear — nothing pending.</div>
                <div className="text-cream-dim text-xs mt-1">No notifications, messages, or SMS activity.</div>
              </div>
            )}
            {items.map((item, i) => {
              const key = `${item.kind}-${i}`;
              if (item.kind === "approval") {
                return (
                  <ApprovalCard key={key} item={item} onClick={() => go(item.n.href)} />
                );
              }
              if (item.kind === "task") {
                return (
                  <TaskCard key={key} item={item} onClick={() => go(item.n.href)} />
                );
              }
              if (item.kind === "alert") {
                return (
                  <AlertCard key={key} item={item} onClick={() => go(item.n.href)} />
                );
              }
              if (item.kind === "raven") {
                return <RavenCard key={key} item={item} />;
              }
              if (item.kind === "sms") {
                return (
                  <SmsCard
                    key={key}
                    item={item}
                    onClick={() => go(`/messages`)}
                  />
                );
              }
              return null;
            })}
          </div>

          <div className="px-4 py-2.5 border-t border-brass/10 text-[10px] text-cream-dim text-center">
            Refreshes every 30s · notifications · Raven chat · client SMS
          </div>
        </div>
      </div>
    </div>
  );
}
