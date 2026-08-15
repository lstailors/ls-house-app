import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import LuxuryLayer from "@alts/components/LuxuryLayer";
import { clientInitials, syncLabel } from "@alts/lib/ticketDisplay";
import "@alts/styles/alts-pos.css";

type Tab = "all" | "sms" | "calls";

type SmsThread = {
  phone: string;
  unread: number;
  lastMessage?: { content?: string; body?: string; timestamp?: string; direction?: string };
};

type CallRow = {
  name?: string;
  from?: string;
  to?: string;
  from_caller_name?: string;
  time?: string;
  status?: string;
  direction?: string;
  duration?: number;
};

type CommsFeed = {
  calls?: CallRow[];
  smsThreads?: SmsThread[];
  counts?: { missedCalls?: number; unreadSms?: number; callsToday?: number; smsThreads?: number };
};

function timeAgo(iso?: string) {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtPhone(phone?: string | null) {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return phone || "Unknown";
}

function telHref(phone?: string | null) {
  const digits = String(phone ?? "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

function fmtDuration(sec?: number) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function MessagesGlass() {
  const [tab, setTab] = useState<Tab>("all");
  const [threadPhone, setThreadPhone] = useState<string | null>(null);
  const [call, setCall] = useState<CallRow | null>(null);

  const feed = useQuery({
    queryKey: ["alts-comms"],
    queryFn: () => api.get<CommsFeed>("/api/comms?limit=80"),
    refetchInterval: 60_000,
  });

  const thread = useQuery({
    queryKey: ["alts-sms-thread", threadPhone],
    enabled: !!threadPhone,
    queryFn: () =>
      api.get<{
        messages: Array<{ name: string; content?: string; body?: string; direction?: string; timestamp?: string }>;
        customer?: { name?: string; id?: string } | null;
      }>(`/api/comms/thread/${encodeURIComponent(threadPhone!)}`),
  });

  const calls = feed.data?.calls ?? [];
  const sms = feed.data?.smsThreads ?? [];
  const counts = feed.data?.counts;
  const live = syncLabel(feed.dataUpdatedAt, feed.isFetching);

  const rows = useMemo(() => {
    const smsRows = sms.map((t) => ({
      kind: "sms" as const,
      ts: t.lastMessage?.timestamp || "",
      thread: t,
    }));
    const callRows = calls.map((c) => ({
      kind: "call" as const,
      ts: c.time || "",
      call: c,
    }));
    const all = [...smsRows, ...callRows].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    if (tab === "sms") return all.filter((r) => r.kind === "sms");
    if (tab === "calls") return all.filter((r) => r.kind === "call");
    return all;
  }, [calls, sms, tab]);

  return (
    <div className="alts-root min-h-dvh flex flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-[28px] leading-none">Messages</div>
          <div className="caps mt-1">Texts · calls</div>
        </div>
        <div className="flex-1" />
        <div className={cn("sf-live", feed.isFetching && "is-sync", feed.isError && "is-down")}>
          <span className="dot" />
          {feed.isError ? "ERPNext down" : live}
        </div>
      </header>

      <div className="px-4 sm:px-5 pt-3 flex flex-wrap gap-2">
        {(
          [
            ["all", "All", (counts?.smsThreads ?? sms.length) + (counts?.callsToday ?? calls.length)],
            ["sms", "Texts", counts?.unreadSms ?? sms.length],
            ["calls", "Calls", counts?.missedCalls ?? calls.length],
          ] as const
        ).map(([k, lab, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border",
              tab === k ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
            <span className="og-count">{n}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]">
        {feed.isError && (
          <QueryErrorPanel
            title="Could not load messages"
            message={feed.error instanceof Error ? feed.error.message : "Retry — an empty inbox is not the same as an outage."}
            onRetry={() => feed.refetch()}
          />
        )}
        {rows.map((row) => {
          if (row.kind === "sms") {
            const t = row.thread;
            const preview = t.lastMessage?.content || t.lastMessage?.body || "No messages";
            return (
              <button
                key={`sms-${t.phone}`}
                type="button"
                onClick={() => setThreadPhone(t.phone)}
                className="og-row sf-card w-full text-left card-glass px-4 py-3.5 flex items-center gap-3 mb-2"
              >
                <span className="sf-avatar" aria-hidden>
                  {clientInitials(fmtPhone(t.phone))}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="chip">Text</span>
                    {t.unread > 0 && <span className="text-[11px] text-[var(--am)]">{t.unread} in</span>}
                    <span className="text-[11px] text-cream-dim">{timeAgo(t.lastMessage?.timestamp)}</span>
                  </div>
                  <div className="display text-[22px] leading-none mt-1 truncate">{fmtPhone(t.phone)}</div>
                  <div className="text-xs text-cream-dim mt-1 truncate">{preview}</div>
                </div>
                <div className="text-cream-dim">→</div>
              </button>
            );
          }
          const c = row.call;
          const missed = c.status === "missed";
          const name = c.from_caller_name || fmtPhone(c.from || c.to);
          return (
            <button
              key={`call-${c.name || c.time || name}`}
              type="button"
              onClick={() => setCall(c)}
              className="og-row sf-card w-full text-left card-glass px-4 py-3.5 flex items-center gap-3 mb-2"
            >
              <span className="sf-avatar" aria-hidden>
                {clientInitials(name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("chip", missed && "text-[var(--ro)]")}>{missed ? "Missed" : "Call"}</span>
                  {fmtDuration(c.duration) && <span className="text-[11px] text-cream-dim">{fmtDuration(c.duration)}</span>}
                  <span className="text-[11px] text-cream-dim">{timeAgo(c.time)}</span>
                </div>
                <div className="display text-[22px] leading-none mt-1 truncate">{name}</div>
                <div className="text-xs text-cream-dim mt-1 truncate">{fmtPhone(c.from || c.to)}</div>
              </div>
              <div className="text-cream-dim">→</div>
            </button>
          );
        })}
        {!feed.isLoading && !rows.length && !feed.isError && <div className="sf-empty">The line is quiet.</div>}
      </div>

      <LuxuryLayer open={!!threadPhone} onClose={() => setThreadPhone(null)} variant="sheet" label="Text thread" z={70}>
        {threadPhone && (
          <div
            className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[85dvh] overflow-y-auto"
            style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
          >
            <div className="flex justify-center pb-2" aria-hidden>
              <i className="block w-10 h-1 rounded-full bg-brass/40" />
            </div>
            <div className="caps text-brass-light">Text</div>
            <h2 className="display text-[28px] leading-none mt-1">
              {thread.data?.customer?.name || fmtPhone(threadPhone)}
            </h2>
            <p className="text-sm text-cream-dim mt-1">{fmtPhone(threadPhone)}</p>
            <div className="mt-4 space-y-2">
              {(thread.data?.messages ?? []).map((m) => (
                <div
                  key={m.name}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm",
                    m.direction === "inbound" ? "bg-white/8 mr-8" : "bg-brass/15 ml-8",
                  )}
                >
                  <div>{m.content || m.body}</div>
                  <div className="text-[10px] text-cream-dim mt-1">{timeAgo(m.timestamp)}</div>
                </div>
              ))}
              {thread.isError && <p className="text-sm text-[var(--am)]">Could not load the thread.</p>}
            </div>
            <div className="flex flex-col gap-2 mt-5">
              {telHref(threadPhone) && (
                <a href={telHref(threadPhone)} className="btn-brass h-12 text-xs inline-flex items-center justify-center">
                  Call {fmtPhone(threadPhone)}
                </a>
              )}
              <button type="button" onClick={() => setThreadPhone(null)} className="btn-ghost h-12 text-xs">
                Close
              </button>
            </div>
          </div>
        )}
      </LuxuryLayer>

      <LuxuryLayer open={!!call} onClose={() => setCall(null)} variant="sheet" label="Call" z={70}>
        {call && (
          <div
            className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
          >
            <div className="flex justify-center pb-2" aria-hidden>
              <i className="block w-10 h-1 rounded-full bg-brass/40" />
            </div>
            <div className="caps text-brass-light">{call.status === "missed" ? "Missed call" : "Call"}</div>
            <h2 className="display text-[28px] leading-none mt-1">
              {call.from_caller_name || fmtPhone(call.from || call.to)}
            </h2>
            <p className="text-sm text-cream-dim mt-2">
              {[fmtPhone(call.from || call.to), fmtDuration(call.duration), timeAgo(call.time)].filter(Boolean).join(" · ")}
            </p>
            <div className="flex flex-col gap-2 mt-5">
              {telHref(call.from || call.to) && (
                <a
                  href={telHref(call.from || call.to)}
                  className="btn-brass h-12 text-xs inline-flex items-center justify-center"
                >
                  Call back
                </a>
              )}
              <button type="button" onClick={() => setCall(null)} className="btn-ghost h-12 text-xs">
                Close
              </button>
            </div>
          </div>
        )}
      </LuxuryLayer>
    </div>
  );
}
