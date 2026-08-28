import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { useShopLink } from "@alts/offline/status";
import { NeedsConnection } from "@alts/components/NeedsConnection";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import LuxuryLayer from "@alts/components/LuxuryLayer";
import StatusBadge from "@alts/components/StatusBadge";
import { clientInitials, syncLabel } from "@alts/lib/ticketDisplay";
import { storeToday } from "@alts/lib/storeDate";
import { useAltsMetrics } from "@alts/lib/useAltsMetrics";
import "@alts/styles/alts-pos.css";

type Tab = "all" | "sms" | "calls" | "voice" | "fittings" | "other";

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

type Recording = {
  name?: string;
  title?: string;
  recorded_at?: string;
  duration_sec?: number;
  customer?: string;
  summary?: string;
};

type Appt = {
  name: string;
  scheduledTime: string;
  customerName: string;
  appointmentType?: string | null;
  status?: string;
  agentDisplayName?: string | null;
};

type CommsFeed = {
  calls?: CallRow[];
  smsThreads?: SmsThread[];
  recordings?: Recording[];
  counts?: { missedCalls?: number; unreadSms?: number; callsToday?: number; smsThreads?: number; totalRecordings?: number };
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

function fmtClock(raw?: string | null) {
  if (!raw) return "";
  const s = String(raw).includes("T") ? String(raw) : String(raw).replace(" ", "T");
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default function MessagesGlass() {
  const shop = useShopLink();
  const [tab, setTab] = useState<Tab>("all");
  const [threadPhone, setThreadPhone] = useState<string | null>(null);
  const [call, setCall] = useState<CallRow | null>(null);
  const [voice, setVoice] = useState<Recording | null>(null);
  const today = storeToday();

  const feed = useQuery({
    queryKey: ["alts-comms"],
    queryFn: () => api.get<CommsFeed>("/api/comms?limit=80"),
    refetchInterval: 60_000,
  });

  const fittings = useQuery({
    queryKey: ["alts-comms-fittings", today],
    queryFn: () =>
      api.get<{ appointments: Appt[] }>(`/api/appointments?date_from=${today}&date_to=${today}`),
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

  const metrics = useAltsMetrics();
  const calls = feed.data?.calls ?? [];
  const sms = feed.data?.smsThreads ?? [];
  const recordings = feed.data?.recordings ?? [];
  const appts = fittings.data?.appointments ?? [];
  const live = syncLabel(feed.dataUpdatedAt, feed.isFetching);

  const textsN = metrics.data?.messages.texts ?? sms.length;
  const callsN = metrics.data?.messages.calls ?? calls.length;
  const voiceN = metrics.data?.messages.voice ?? recordings.length;
  const fittingsN = metrics.data?.messages.fittings ?? appts.length;
  const otherN = metrics.data?.messages.other ?? 0;
  const allN = metrics.data?.messages.all ?? textsN + callsN + voiceN + fittingsN + otherN;

  const unreadSms = sms.filter((t) => t.unread > 0);
  const otherSms = sms.filter((t) => t.unread <= 0);
  const missed = calls.filter((c) => c.status === "missed");
  const otherCalls = calls.filter((c) => c.status !== "missed");

  return (
    <div className="alts-root min-h-dvh flex flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-[32px] leading-none">Messages</div>
          <div className="caps mt-1">Texts · calls · voice · fittings</div>
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
            ["all", "All", allN],
            ["sms", "Texts", textsN],
            ["calls", "Calls", callsN],
            ["voice", "Voice", voiceN],
            ["fittings", "Fittings", fittingsN],
            ["other", "Other", otherN],
          ] as Array<[Tab, string, number]>
        )
          .filter((row) => row[0] !== "other" || otherN > 0)
          .map(([k, lab, n]) => (
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
        {shop === "offline" && (
          <NeedsConnection
            title="Messages need a connection"
            detail="Texts and the inbox will be available when you're back online."
          />
        )}
        {feed.isError && shop !== "offline" && (
          <QueryErrorPanel
            title="Could not load messages"
            message={feed.error instanceof Error ? feed.error.message : "Retry — an empty inbox is not the same as an outage."}
            onRetry={() => feed.refetch()}
          />
        )}

        {(tab === "all" || tab === "sms") && unreadSms.length > 0 && (
          <Section title="New texts" tone="qc">
            {unreadSms.map((t) => (
              <SmsCard key={`u-${t.phone}`} t={t} onOpen={() => setThreadPhone(t.phone)} />
            ))}
          </Section>
        )}
        {(tab === "all" || tab === "calls") && missed.length > 0 && (
          <Section title="Missed calls" tone="tasks">
            {missed.map((c) => (
              <CallCard key={`m-${c.name || c.time}`} c={c} onOpen={() => setCall(c)} />
            ))}
          </Section>
        )}
        {(tab === "all" || tab === "voice") && recordings.length > 0 && (
          <Section title="Voice notes" tone="shop">
            {recordings.map((r) => (
              <button
                key={r.name || r.recorded_at}
                type="button"
                onClick={() => setVoice(r)}
                className="og-row sf-card msg-row w-full text-left card-glass px-4 py-3.5 flex items-center gap-3 mb-2"
              >
                <span className="sf-avatar" aria-hidden>
                  {clientInitials(r.title || r.customer || "Voice")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status="Voice" tone="shop" size="sm" />
                    {fmtDuration(r.duration_sec) && (
                      <span className="text-[11px] text-cream-dim">{fmtDuration(r.duration_sec)}</span>
                    )}
                    <span className="text-[11px] text-cream-dim">{timeAgo(r.recorded_at)}</span>
                  </div>
                  <div className="display text-[22px] leading-none mt-1 truncate">{r.title || "Voice note"}</div>
                  <div className="text-xs text-cream-dim mt-1 truncate">{r.summary || r.customer || "Plaud capture"}</div>
                </div>
                <div className="text-cream-dim">→</div>
              </button>
            ))}
          </Section>
        )}
        {(tab === "all" || tab === "fittings") && appts.length > 0 && (
          <Section title="Fittings today" tone="shop">
            {appts.map((a) => (
              <div key={a.name} className="og-row sf-card msg-row card-glass px-4 py-3.5 flex items-center gap-3 mb-2">
                <span className="sf-avatar" aria-hidden>
                  {clientInitials(a.customerName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status="Fitting" tone="shop" size="sm" />
                    {a.status && <StatusBadge status={a.status} size="sm" />}
                    <span className="font-mono text-xs text-brass-light">{fmtClock(a.scheduledTime)}</span>
                  </div>
                  <div className="display text-[22px] leading-none mt-1 truncate">{a.customerName || "Client"}</div>
                  <div className="text-xs text-cream-dim mt-1 truncate">
                    {[a.appointmentType, a.agentDisplayName].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
            ))}
          </Section>
        )}
        {(tab === "all" || tab === "sms") && otherSms.length > 0 && (
          <Section title="Texts" tone="shop">
            {otherSms.map((t) => (
              <SmsCard key={`s-${t.phone}`} t={t} onOpen={() => setThreadPhone(t.phone)} />
            ))}
          </Section>
        )}
        {(tab === "all" || tab === "calls") && otherCalls.length > 0 && (
          <Section title="Calls" tone="pickup">
            {otherCalls.map((c) => (
              <CallCard key={`c-${c.name || c.time}`} c={c} onOpen={() => setCall(c)} />
            ))}
          </Section>
        )}

        {!feed.isLoading &&
          ((tab === "all" && !sms.length && !calls.length && !recordings.length && !appts.length) ||
            (tab === "sms" && !sms.length) ||
            (tab === "calls" && !calls.length) ||
            (tab === "voice" && !recordings.length) ||
            (tab === "fittings" && !appts.length)) &&
          !feed.isError && (
            <div className="sf-empty">
              {tab === "voice"
                ? "Personal voice notes stay private unless tagged to a client or order."
                : "The line is quiet."}
            </div>
          )}
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
            <h2 className="display text-[32px] leading-none mt-1">
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

      <LuxuryLayer open={!!voice} onClose={() => setVoice(null)} variant="sheet" label="Voice note" z={70}>
        {voice && (
          <div
            className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
          >
            <div className="caps text-brass-light">Voice</div>
            <h2 className="display text-[28px] leading-none mt-1">{voice.title || "Voice note"}</h2>
            <p className="text-sm text-cream-dim mt-2">
              {[fmtDuration(voice.duration_sec), timeAgo(voice.recorded_at)].filter(Boolean).join(" · ")}
            </p>
            {voice.summary && <p className="text-sm text-cream mt-3">{voice.summary}</p>}
            <button type="button" onClick={() => setVoice(null)} className="btn-ghost h-12 w-full mt-5 text-xs">
              Close
            </button>
          </div>
        )}
      </LuxuryLayer>
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "pickup" | "qc" | "tasks" | "shop";
  children: ReactNode;
}) {
  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <StatusBadge status={title} tone={tone} size="sm" />
      </div>
      {children}
    </section>
  );
}

function SmsCard({ t, onOpen }: { t: SmsThread; onOpen: () => void }) {
  const preview = t.lastMessage?.content || t.lastMessage?.body || "No messages";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="og-row sf-card msg-row w-full text-left card-glass px-4 py-3.5 flex items-center gap-3 mb-2"
    >
      <span className="sf-avatar" aria-hidden>
        {clientInitials(fmtPhone(t.phone))}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status="Text" tone="shop" size="sm" />
          {t.unread > 0 && <StatusBadge status={`${t.unread} new`} tone="qc" size="sm" />}
          <span className="text-[11px] text-cream-dim">{timeAgo(t.lastMessage?.timestamp)}</span>
        </div>
        <div className="display text-[22px] leading-none mt-1 truncate">{fmtPhone(t.phone)}</div>
        <div className="text-xs text-cream-dim mt-1 truncate">{preview}</div>
      </div>
      <div className="text-cream-dim">→</div>
    </button>
  );
}

function CallCard({ c, onOpen }: { c: CallRow; onOpen: () => void }) {
  const missed = c.status === "missed";
  const name = c.from_caller_name || fmtPhone(c.from || c.to);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="og-row sf-card msg-row w-full text-left card-glass px-4 py-3.5 flex items-center gap-3 mb-2"
    >
      <span className="sf-avatar" aria-hidden>
        {clientInitials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={missed ? "Missed call" : "Call"} tone={missed ? "tasks" : "pickup"} size="sm" />
          {fmtDuration(c.duration) && <span className="text-[11px] text-cream-dim">{fmtDuration(c.duration)}</span>}
          <span className="text-[11px] text-cream-dim">{timeAgo(c.time)}</span>
        </div>
        <div className="display text-[22px] leading-none mt-1 truncate">{name}</div>
        <div className="text-xs text-cream-dim mt-1 truncate">{fmtPhone(c.from || c.to)}</div>
      </div>
      <div className="text-cream-dim">→</div>
    </button>
  );
}
