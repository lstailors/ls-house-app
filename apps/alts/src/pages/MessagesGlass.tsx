/**
 * SPEC 081 — Alts Messages Desk (chat-first floor Comms)
 * Mocks: ~/ls-design/briefs/mocks/spec-081-alts-messages/
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { useShopLink } from "@alts/offline/status";
import { NeedsConnection } from "@alts/components/NeedsConnection";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { clientInitials, syncLabel } from "@alts/lib/ticketDisplay";
import { toast } from "sonner";
import "@alts/styles/alts-pos.css";
import "@alts/styles/messages-desk.css";

type Filter = "needs_you" | "texts" | "calls" | "today" | "all";
type Channel = "sms" | "missed" | "vm" | "call" | "voice";

type Person = {
  phone: string;
  phone_key: string;
  customer_id: string | null;
  customer_name: string | null;
  preview: string;
  last_at: string | null;
  needs_you: boolean;
  unread_count: number;
  channels: Channel[];
  via_shop_line: boolean;
};

type InboxPayload = {
  people: Person[];
  counts: { needs_you: number; texts: number; calls: number; today: number; all: number };
};

type ThreadEvent = {
  type: string;
  at: string;
  id?: string;
  call_id?: string;
  direction?: string;
  body?: string;
  sent_by?: string | null;
  via_shop?: boolean;
  duration?: number;
  summary?: string | null;
  summary_bullets?: string[];
  transcript?: string | null;
  transcript_pending?: boolean;
  recording_url?: string | null;
  from?: string;
  from_caller_name?: string;
  status?: string;
};

type ThreadPayload = {
  person: {
    phone: string;
    customer_name: string | null;
    customer_id: string | null;
    via_shop_line?: boolean;
  };
  events: ThreadEvent[];
};

const DONE_KEY = "alts.messages.doneKeys";

function loadDone(): string[] {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveDone(keys: string[]) {
  localStorage.setItem(DONE_KEY, JSON.stringify([...new Set(keys)].slice(-500)));
}

function phoneKey(phone?: string | null) {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length > 10 ? d.slice(-10) : d;
}

function fmtPhone(phone?: string | null) {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1"))
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return phone || "Unknown";
}

function telHref(phone?: string | null) {
  const digits = String(phone ?? "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

function timeAgo(iso?: string | null) {
  if (!iso) return "";
  const s = String(iso).includes("T") ? String(iso) : String(iso).replace(" ", "T");
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return "";
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDuration(sec?: number) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function dayLabel(iso?: string | null) {
  if (!iso) return "";
  const s = String(iso).includes("T") ? String(iso) : String(iso).replace(" ", "T");
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "";
  const today = new Date();
  const yday = new Date();
  yday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, yday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function clock(iso?: string | null) {
  if (!iso) return "";
  const s = String(iso).includes("T") ? String(iso) : String(iso).replace(" ", "T");
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

const FILTERS: Array<{ k: Filter; lab: string }> = [
  { k: "needs_you", lab: "Needs you" },
  { k: "texts", lab: "Texts" },
  { k: "calls", lab: "Calls" },
  { k: "today", lab: "Today" },
  { k: "all", lab: "All" },
];

export default function MessagesGlass() {
  const shop = useShopLink();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("needs_you");
  const [showNoise, setShowNoise] = useState(false);
  const [selected, setSelected] = useState<Person | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmedThreads, setConfirmedThreads] = useState<Set<string>>(new Set());
  const [doneKeys, setDoneKeys] = useState<string[]>(() =>
    typeof window !== "undefined" ? loadDone() : [],
  );
  const [expandedTx, setExpandedTx] = useState<Record<string, boolean>>({});
  const threadEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const doneParam = doneKeys.join(",");

  const inbox = useQuery({
    queryKey: ["msg-inbox", filter, showNoise, doneParam],
    queryFn: () =>
      api.get<InboxPayload>(
        `/api/comms/inbox?filter=${filter}&noise=${showNoise ? "show" : "hide"}&limit=120&done=${encodeURIComponent(doneParam)}`,
      ),
    refetchInterval: 45_000,
  });

  const threadPhone = selected?.phone ?? null;
  const thread = useQuery({
    queryKey: ["msg-thread", threadPhone, showNoise],
    enabled: !!threadPhone,
    queryFn: () =>
      api.get<ThreadPayload>(
        `/api/comms/thread/${encodeURIComponent(threadPhone!)}?noise=${showNoise ? "show" : "hide"}`,
      ),
    refetchInterval: 30_000,
  });

  const live = syncLabel(inbox.dataUpdatedAt, inbox.isFetching);
  const counts = inbox.data?.counts ?? {
    needs_you: 0,
    texts: 0,
    calls: 0,
    today: 0,
    all: 0,
  };
  const people = inbox.data?.people ?? [];

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.data?.events?.length, threadPhone]);

  const sendMut = useMutation({
    mutationFn: async (body: string) => {
      if (!threadPhone) throw new Error("No thread");
      return api.post<{ ok: boolean; sid?: string }>("/api/comms/send", {
        to: threadPhone,
        body,
        source: "alts_messages",
        sent_by: "staff_manual",
      });
    },
    onSuccess: () => {
      setDraft("");
      setConfirmOpen(false);
      if (threadPhone) {
        setConfirmedThreads((s) => new Set(s).add(phoneKey(threadPhone)));
        // clear done so new reply state recalculates
        const k = phoneKey(threadPhone);
        const next = doneKeys.filter((x) => x !== k);
        setDoneKeys(next);
        saveDone(next);
      }
      qc.invalidateQueries({ queryKey: ["msg-thread", threadPhone] });
      qc.invalidateQueries({ queryKey: ["msg-inbox"] });
      toast.success("Sent as Sofia");
    },
    onError: (e: Error) => toast.error(e.message || "Send failed"),
  });

  function requestSend(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !threadPhone || sendMut.isPending) return;
    const k = phoneKey(threadPhone);
    if (!confirmedThreads.has(k)) {
      setConfirmOpen(true);
      return;
    }
    sendMut.mutate(body);
  }

  function markDone() {
    if (!selected) return;
    const k = phoneKey(selected.phone);
    const next = [...doneKeys, k];
    setDoneKeys(next);
    saveDone(next);
    setSelected(null);
    qc.invalidateQueries({ queryKey: ["msg-inbox"] });
    toast.message("Marked done");
  }

  const events = thread.data?.events ?? [];
  const person = thread.data?.person;
  const title =
    person?.customer_name || selected?.customer_name || (selected ? fmtPhone(selected.phone) : "");

  return (
    <div className="alts-root msg-desk min-h-dvh flex flex-col overflow-hidden">
      <header className="msg-topbar">
        <BrandSeal />
        <div className="min-w-0 flex-1">
          <div className="display text-[32px] leading-none">Messages</div>
          <div className="caps mt-1 text-cream-dim">Who needs you · texts · calls · UniFi</div>
        </div>
        <div className={cn("msg-live", inbox.isFetching && "is-sync", inbox.isError && "is-down")}>
          <span className="dot" />
          <span className="msg-live-text">{inbox.isError ? "ERPNext down" : live}</span>
        </div>
      </header>

      <div className="msg-filters">
        {FILTERS.map(({ k, lab }) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={cn("msg-chip", filter === k && "is-active")}
          >
            {lab}
            <span className="n">{counts[k] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="msg-noise-row">
        <span>Staff noise hidden by default</span>
        <button
          type="button"
          className={cn("msg-noise-btn", showNoise && "on")}
          onClick={() => setShowNoise((v) => !v)}
        >
          {showNoise ? "Showing staff noise" : "Show staff noise"}
        </button>
      </div>

      {shop === "offline" && (
        <div className="px-4 py-3">
          <NeedsConnection
            title="Messages need a connection"
            detail="Inbox and reply will be available when you're back online."
          />
        </div>
      )}

      {inbox.isError && shop !== "offline" && (
        <div className="px-4 py-3">
          <QueryErrorPanel
            title="Could not load messages"
            message={inbox.error instanceof Error ? inbox.error.message : "Retry — empty is not an outage."}
            onRetry={() => inbox.refetch()}
          />
        </div>
      )}

      <div className={cn("msg-split flex-1 min-h-0", selected && "has-thread")}>
        {/* INBOX */}
        <aside className={cn("msg-inbox", selected && "is-hidden-phone")}>
          <div className="msg-inbox-scroll">
            {people.map((p) => {
              const name = p.customer_name || fmtPhone(p.phone);
              const active = selected && phoneKey(selected.phone) === p.phone_key;
              return (
                <button
                  key={p.phone_key}
                  type="button"
                  onClick={() => {
                    setSelected(p);
                    setDraft("");
                    setConfirmOpen(false);
                  }}
                  className={cn("msg-row", p.needs_you && "needs", active && "is-active")}
                >
                  <span className="msg-avatar" aria-hidden>
                    {clientInitials(name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="msg-row-top">
                      <span className="msg-name truncate">{name}</span>
                      <span className="msg-meta">{timeAgo(p.last_at)}</span>
                    </div>
                    <div className="msg-preview truncate">{p.preview}</div>
                    <div className="msg-minis">
                      {p.channels.map((ch) => (
                        <span key={ch} className="msg-mini">
                          {ch === "vm" ? "VM" : ch === "sms" ? "Text" : ch === "missed" ? "Missed" : "Call"}
                        </span>
                      ))}
                      {p.via_shop_line && <span className="msg-mini shop">Shop</span>}
                    </div>
                  </div>
                  {p.needs_you && (
                    <span className="msg-unread" aria-label={`${p.unread_count} new`}>
                      {p.unread_count > 9 ? "9+" : p.unread_count}
                    </span>
                  )}
                </button>
              );
            })}
            {!inbox.isLoading && people.length === 0 && !inbox.isError && (
              <div className="msg-empty">
                {filter === "needs_you" ? "You’re clear. The line is quiet." : "Nothing in this filter."}
              </div>
            )}
          </div>
        </aside>

        {/* THREAD */}
        <section className={cn("msg-thread", !selected && "is-empty-desktop")}>
          {!selected ? (
            <div className="msg-thread-placeholder">Select a person to open the thread</div>
          ) : (
            <>
              <div className="msg-thread-head">
                <button type="button" className="msg-back" onClick={() => setSelected(null)} aria-label="Back">
                  ←
                </button>
                <div className="min-w-0 flex-1">
                  <div className="msg-thread-title truncate">{title}</div>
                  <div className="msg-thread-sub">
                    {telHref(selected.phone) ? (
                      <a href={telHref(selected.phone)} className="underline-offset-2 hover:underline">
                        {fmtPhone(selected.phone)}
                      </a>
                    ) : (
                      fmtPhone(selected.phone)
                    )}
                    {(person?.via_shop_line || selected.via_shop_line) && (
                      <span className="msg-pill-shop">Via shop line · reply Sofia</span>
                    )}
                  </div>
                </div>
                <div className="msg-thread-actions">
                  {telHref(selected.phone) && (
                    <a href={telHref(selected.phone)} className="msg-btn-ghost">
                      Call
                    </a>
                  )}
                  <button type="button" className="msg-btn-quiet" onClick={markDone}>
                    Mark done
                  </button>
                </div>
              </div>

              <div className="msg-timeline">
                {thread.isError && (
                  <p className="text-sm text-[var(--am)] px-2">Could not load the thread.</p>
                )}
                {events.map((ev, i) => {
                  const prev = events[i - 1];
                  const day = dayLabel(ev.at);
                  const showDay = day && day !== dayLabel(prev?.at);
                  return (
                    <div key={`${ev.type}-${ev.id || ev.call_id || i}-${ev.at}`}>
                      {showDay && <div className="msg-day">{day}</div>}
                      <EventRow
                        ev={ev}
                        phone={selected.phone}
                        expanded={!!expandedTx[String(ev.call_id || ev.id || i)]}
                        onToggleTx={() =>
                          setExpandedTx((m) => {
                            const k = String(ev.call_id || ev.id || i);
                            return { ...m, [k]: !m[k] };
                          })
                        }
                      />
                    </div>
                  );
                })}
                {!thread.isLoading && events.length === 0 && (
                  <div className="msg-empty subtle">No messages in this thread yet.</div>
                )}
                <div ref={threadEndRef} />
              </div>

              <form className="msg-composer" onSubmit={requestSend}>
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Reply as Sofia…"
                  rows={2}
                  className="msg-composer-input"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      requestSend();
                    }
                  }}
                />
                <div className="msg-composer-bar">
                  <span className="msg-composer-help">Sends from (212) 308-4431 · logged to the house</span>
                  <button
                    type="submit"
                    className="msg-btn-send"
                    disabled={!draft.trim() || sendMut.isPending}
                  >
                    {sendMut.isPending ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>

              {confirmOpen && (
                <div className="msg-confirm-scrim" role="dialog" aria-modal="true">
                  <div className="msg-confirm-sheet">
                    <div className="caps text-brass-light">Send as Sofia?</div>
                    <p className="msg-confirm-body mt-2">{draft}</p>
                    <p className="text-xs text-cream-dim mt-2">
                      To {fmtPhone(selected.phone)}
                      {person?.customer_name ? ` · ${person.customer_name}` : ""} · from (212) 308-4431
                    </p>
                    <div className="flex gap-2 mt-4">
                      <button type="button" className="msg-btn-ghost flex-1" onClick={() => setConfirmOpen(false)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="msg-btn-send flex-1"
                        disabled={sendMut.isPending}
                        onClick={() => sendMut.mutate(draft.trim())}
                      >
                        Send as Sofia
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function EventRow({
  ev,
  phone,
  expanded,
  onToggleTx,
}: {
  ev: ThreadEvent;
  phone: string;
  expanded: boolean;
  onToggleTx: () => void;
}) {
  if (ev.type === "sms") {
    const inbound = ev.direction === "inbound";
    return (
      <div className={cn("msg-bubble-row", inbound ? "in" : "out")}>
        <div className={cn("msg-bubble", inbound ? "in" : "out")}>
          <div className="msg-bubble-text">{ev.body}</div>
          <div className="msg-bubble-meta">
            {!inbound && <span>{ev.sent_by === "staff_manual" ? "Staff" : "Sofia"} · </span>}
            {clock(ev.at)}
          </div>
        </div>
      </div>
    );
  }

  if (ev.type === "missed_call") {
    return (
      <div className="msg-sys-pill">
        <div>
          <strong>Missed call</strong>
          {ev.duration ? ` · ${fmtDuration(ev.duration)}` : ""} · {clock(ev.at)}
        </div>
        {telHref(phone) && (
          <a href={telHref(phone)} className="msg-btn-ghost sm">
            Call back
          </a>
        )}
      </div>
    );
  }

  if (ev.type === "voicemail") {
    return (
      <div className="msg-card">
        <div className="msg-card-head">
          <span className="msg-card-label">Voicemail</span>
          <span className="msg-meta">
            {fmtDuration(ev.duration)} · {clock(ev.at)}
          </span>
          {ev.recording_url && (
            <a href={ev.recording_url} target="_blank" rel="noreferrer" className="msg-play" title="Play">
              ▶
            </a>
          )}
        </div>
        <p className="msg-card-body">{ev.summary}</p>
      </div>
    );
  }

  if (ev.type === "call_transcript") {
    const bullets = ev.summary_bullets?.length ? ev.summary_bullets : [];
    const full = (ev.transcript || "").trim();
    const showFull = full && full.toLowerCase() !== "whisper";
    return (
      <div className="msg-card">
        <div className="msg-card-head">
          <span className="msg-card-label">
            Call · {ev.direction === "outbound" || ev.direction === "out" ? "Outbound" : "Inbound"}
            {ev.duration ? ` · ${fmtDuration(ev.duration)}` : ""}
          </span>
          <span className="msg-meta">{clock(ev.at)}</span>
          {ev.recording_url && (
            <a href={ev.recording_url} target="_blank" rel="noreferrer" className="msg-play" title="Play">
              ▶
            </a>
          )}
        </div>
        {bullets.length > 0 ? (
          <>
            <div className="msg-card-label subtle mt-2">
              {ev.summary ? "AI summary" : "Summary"}
            </div>
            <ul className="msg-bullets">
              {bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </>
        ) : ev.transcript_pending ? (
          <p className="msg-card-body muted">Transcript still processing…</p>
        ) : (
          <p className="msg-card-body muted">No transcript yet</p>
        )}
        {showFull && (
          <>
            <button type="button" className="msg-tx-toggle" onClick={onToggleTx}>
              {expanded ? "▾ Full transcript" : "▸ Full transcript"}
            </button>
            {expanded && <pre className="msg-transcript">{full}</pre>}
          </>
        )}
      </div>
    );
  }

  return null;
}
