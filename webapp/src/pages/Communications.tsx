import { useState, useMemo, useRef, useEffect } from "react";
import { MessageSquare, Search, Mic, Eye, UserCheck, Star, Send, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { SectionHeader } from "@ls/design";
import { GlassCard } from "@ls/design";
import { EmptyState } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import {
  useCommunications,
  useCustomers,
  useSofiaConversations,
  useSofiaThread,
  useSofiaHandoff,
  useSofiaVoiceApprovals,
  useSofiaChat,
  type SofiaChatAction,
} from "@/lib/queries";
import { formatDateTime } from "@ls/design/format";
import type { Communication, Customer } from "@ls/types";
import { cn } from "@ls/design/utils";
import { toast } from "sonner";

// ─── Tab types ───────────────────────────────────────────────────────────────
type Tab = "sofia" | "ask" | "voice" | "all";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function previewBody(msg: any): string {
  return msg?.body ?? "(no preview)";
}

// ─── Sofia SMS Tab ───────────────────────────────────────────────────────────
function SofiaTab() {
  const { data: threads = [], isLoading } = useSofiaConversations();
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [handedOff, setHandedOff] = useState<Set<string>>(new Set());
  const handoff = useSofiaHandoff();

  const resolvedPhone = activePhone ?? (threads[0]?.phone ?? null);
  const { data: messages = [], isLoading: msgLoading } = useSofiaThread(resolvedPhone);

  const filtered = useMemo(() => {
    if (!search) return threads;
    const s = search.toLowerCase();
    return threads.filter(
      (t: any) =>
        t.phone?.includes(s) ||
        (t.lastMessage?.body ?? "").toLowerCase().includes(s),
    );
  }, [threads, search]);

  const handleHandoff = async () => {
    if (!resolvedPhone) return;
    try {
      await handoff.mutateAsync({ phone: resolvedPhone });
      setHandedOff((prev) => new Set([...prev, resolvedPhone]));
      toast.success("Handoff logged — you've taken over this conversation.");
    } catch {
      toast.error("Handoff failed");
    }
  };

  const isHumanActive = resolvedPhone ? handedOff.has(resolvedPhone) : false;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
      {/* Thread list */}
      <GlassCard className="p-0 overflow-hidden">
        <div className="p-3 border-b border-brass/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cream-dim" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search phone or message"
              className="w-full pl-9 pr-3 py-2 bg-forest-raised/50 border border-brass/15 rounded-md text-base sm:text-sm text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40"
            />
          </div>
        </div>
        <div className="max-h-[calc(100dvh-22rem)] overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-cream-dim text-xs">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-cream-dim text-xs">No conversations.</div>
          ) : (
            filtered.map((t: any) => {
              const isActive = resolvedPhone === t.phone;
              return (
                <button
                  key={t.phone}
                  type="button"
                  onClick={() => setActivePhone(t.phone)}
                  className={cn(
                    "w-full text-left p-3 border-b border-brass/10 transition-colors",
                    isActive ? "bg-brass/10 border-l-2 border-l-brass" : "hover:bg-brass/5",
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-cream text-sm font-medium truncate">{t.phone}</span>
                    <span className="text-[10px] text-cream-dim shrink-0 ml-2">
                      {t.lastMessage?.created_at ? formatRelative(t.lastMessage.created_at) : ""}
                    </span>
                  </div>
                  <div className="text-[11px] text-cream-muted truncate">{previewBody(t.lastMessage)}</div>
                  <div className="text-[10px] text-cream-dim mt-0.5">{t.messageCount} messages</div>
                </button>
              );
            })
          )}
        </div>
      </GlassCard>

      {/* Thread detail */}
      {resolvedPhone ? (
        <GlassCard variant="strong" className="p-0 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-brass/10 flex items-center justify-between gap-4">
            <div>
              <div className="ui-label text-[10px] mb-1">Client Phone</div>
              <div className="text-cream font-medium">{resolvedPhone}</div>
            </div>
            <div className="flex items-center gap-2">
              {isHumanActive ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-signal-emerald border border-signal-emerald/30 rounded-full px-3 py-1">
                  <UserCheck className="h-3 w-3" /> Human active
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-brass/30 text-cream hover:bg-brass/10"
                  onClick={handleHandoff}
                  disabled={handoff.isPending}
                >
                  <UserCheck className="h-3 w-3 mr-1" />
                  Take Over
                </Button>
              )}
            </div>
          </div>
          <div className="p-4 space-y-3 max-h-[calc(100dvh-26rem)] overflow-y-auto">
            {msgLoading ? (
              <div className="text-cream-dim text-xs">Loading…</div>
            ) : messages.length === 0 ? (
              <div className="text-cream-dim text-xs text-center py-8">No messages.</div>
            ) : (
              messages.map((msg: any) => {
                const isInbound = msg.direction === "inbound";
                const isShadow = msg.status === "shadow_review";
                return (
                  <div
                    key={msg.id}
                    className={cn("flex items-end gap-2", isInbound ? "justify-start" : "justify-end")}
                  >
                    <div
                      className={cn(
                        "max-w-[78%] rounded-lg p-3 border",
                        isInbound ? "bg-forest-raised/60 border-brass/15" : "bg-brass/15 border-brass/30",
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={cn("ui-label text-[9px]", isInbound ? "text-signal-emerald" : "text-brass-light")}>
                          {isInbound ? "From client" : `From ${msg.agent_name ?? "house"}`}
                        </span>
                        <span className="text-[10px] text-cream-dim">
                          {msg.created_at ? formatDateTime(msg.created_at) : ""}
                        </span>
                        {isShadow ? (
                          <span className="inline-flex items-center gap-1 text-[9px] text-cream-dim border border-brass/20 rounded px-1.5">
                            <Eye className="h-2.5 w-2.5" /> Observation only
                          </span>
                        ) : null}
                      </div>
                      <div className="text-base sm:text-sm text-cream leading-relaxed whitespace-pre-wrap">
                        {String(msg.body ?? "")}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {/* NO send/compose input — Sofia handles outbound; shadow_review has no send path */}
        </GlassCard>
      ) : (
        <GlassCard className="p-10">
          <EmptyState
            icon={MessageSquare}
            title="Select a conversation"
            description="Pick a client on the left to view their Sofia SMS thread."
          />
        </GlassCard>
      )}
    </div>
  );
}

// ─── Ask Sofia (staff AI chat) Tab ─────────────────────────────────────────────
type AskChatMsg = {
  id: string;
  role: "staff" | "sofia";
  text: string;
  actions?: SofiaChatAction[];
  error?: boolean;
};

function ActionReceipt({ action }: { action: SofiaChatAction }) {
  const label = action.tool === "send_mms_card" ? "MMS" : "SMS";
  return (
    <div
      className={cn(
        "mt-2 rounded-md border px-3 py-2 text-xs",
        action.ok ? "border-signal-emerald/30 bg-signal-emerald/5" : "border-signal-crimson/30 bg-signal-crimson/5",
      )}
    >
      <div className="flex items-center gap-1.5 font-medium">
        {action.ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-signal-emerald shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-signal-crimson shrink-0" />
        )}
        <span className="text-cream">
          {label} {action.ok ? "sent" : "failed"}
          {action.recipient_name ? ` to ${action.recipient_name}` : action.sent_to ? ` to ${action.sent_to}` : ""}
        </span>
      </div>
      {action.message ? (
        <div className="mt-1 text-cream-muted italic">"{action.message}"</div>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-cream-dim">
        {action.sent_to ? <span>To: {action.sent_to}</span> : null}
        {action.twilio_sid ? <span>SID: {action.twilio_sid}</span> : null}
        {action.error ? <span className="text-signal-crimson">{action.error}</span> : null}
      </div>
    </div>
  );
}

function AskSofiaTab() {
  const [messages, setMessages] = useState<AskChatMsg[]>([]);
  const [input, setInput] = useState("");
  const chat = useSofiaChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chat.isPending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || chat.isPending) return;
    const staffMsg: AskChatMsg = { id: `${Date.now()}-staff`, role: "staff", text };
    setMessages((prev) => [...prev, staffMsg]);
    setInput("");
    try {
      const res = await chat.mutateAsync(text);
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-sofia`, role: "sofia", text: res.reply, actions: res.actions },
      ]);
    } catch (e: any) {
      const msg = e?.message ?? "Sofia is briefly unavailable.";
      setMessages((prev) => [...prev, { id: `${Date.now()}-err`, role: "sofia", text: msg, error: true }]);
      toast.error("Ask Sofia failed");
    }
  };

  return (
    <GlassCard variant="strong" className="p-0 overflow-hidden flex flex-col">
      <div className="p-4 border-b border-brass/10 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brass-light" />
        <div>
          <div className="text-cream font-medium text-sm">Ask Sofia</div>
          <div className="text-[10px] text-cream-dim">
            Same brain, tools, and no-draft/never-lie rules as Carl's SMS assistant mode. Type an instruction — Sofia
            acts immediately (real SMS sends).
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="p-4 space-y-3 max-h-[calc(100dvh-26rem)] min-h-[16rem] overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-cream-dim text-xs text-center py-10">
            e.g. "text Sal that his suit is ready" or "who do we have on the schedule today"
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "staff" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-lg p-3 border",
                  m.role === "staff"
                    ? "bg-brass/15 border-brass/30"
                    : m.error
                      ? "border-signal-crimson/30 bg-signal-crimson/5"
                      : "bg-forest-raised/60 border-brass/15",
                )}
              >
                <div className="ui-label text-[9px] mb-1 text-brass-light">
                  {m.role === "staff" ? "You" : "Sofia"}
                </div>
                <div className="text-base sm:text-sm text-cream leading-relaxed whitespace-pre-wrap">{m.text}</div>
                {m.actions && m.actions.length > 0
                  ? m.actions.map((a, i) => <ActionReceipt key={i} action={a} />)
                  : null}
              </div>
            </div>
          ))
        )}
        {chat.isPending ? (
          <div className="flex justify-start">
            <div className="rounded-lg p-3 border border-brass/15 bg-forest-raised/60 text-xs text-cream-dim">
              Sofia is working…
            </div>
          </div>
        ) : null}
      </div>

      <div className="p-3 border-t border-brass/10 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Tell Sofia what to do…"
          disabled={chat.isPending}
          className="flex-1 px-3 py-2 bg-forest-raised/50 border border-brass/15 rounded-md text-base sm:text-sm text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40 disabled:opacity-50"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={chat.isPending || !input.trim()}
          className="h-9 px-3 bg-brass/20 border border-brass/30 text-cream hover:bg-brass/30"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </GlassCard>
  );
}

// ─── Voice Approvals Tab ─────────────────────────────────────────────────────
function VoiceTab() {
  const { data: items = [], isLoading } = useSofiaVoiceApprovals();

  if (isLoading) return <div className="text-cream-dim text-sm">Loading…</div>;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Mic}
        title="No voice approvals"
        description="Voice escalations from Sofia will appear here as read-only records."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {items.map((item: any) => (
        <GlassCard key={item.id} className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Mic className="h-3.5 w-3.5 text-brass-light" />
            <span className="ui-label text-[10px]">Voice Approval</span>
            {item.status ? (
              <span className="ml-auto text-[10px] text-cream-dim border border-brass/15 rounded px-1.5 py-0.5 capitalize">
                {item.status}
              </span>
            ) : null}
          </div>
          {item.client_name || item.client_phone ? (
            <div className="text-base sm:text-sm text-cream mb-1">
              {item.client_name ?? item.client_phone}
            </div>
          ) : null}
          {item.summary ? (
            <div className="text-xs text-cream-muted leading-relaxed">{String(item.summary)}</div>
          ) : null}
          <div className="text-[10px] text-cream-dim mt-2">
            {item.created_at ? formatDateTime(item.created_at) : ""}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

// ─── All Comms Tab (original Prisma comms) ───────────────────────────────────
function AllCommsTab() {
  const { data: comms = [], isLoading } = useCommunications();
  const { data: customers = [] } = useCustomers();
  const [search, setSearch] = useState("");
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(null);

  const customerMap = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  const grouped = useMemo(() => {
    const byCustomer = new Map<string, Communication[]>();
    for (const c of comms) {
      const arr = byCustomer.get(c.customerId) ?? [];
      arr.push(c);
      byCustomer.set(c.customerId, arr);
    }
    return Array.from(byCustomer.entries())
      .map(([customerId, items]) => {
        const sorted = [...items].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        return {
          customerId,
          customer: customerMap.get(customerId) ?? sorted[0]?.customer,
          items: sorted,
          last: sorted[0],
        };
      })
      .sort((a, b) => new Date(b.last.createdAt).getTime() - new Date(a.last.createdAt).getTime());
  }, [comms, customerMap]);

  const filteredThreads = useMemo(() => {
    const s = search.toLowerCase();
    if (!s) return grouped;
    return grouped.filter(
      (t) =>
        (t.customer?.name ?? "").toLowerCase().includes(s) ||
        (t.customer?.phone ?? "").includes(search) ||
        t.items.some((i) => (i.body ?? "").toLowerCase().includes(s) || (i.transcript ?? "").toLowerCase().includes(s)),
    );
  }, [grouped, search]);

  const activeThread = filteredThreads.find((t) => t.customerId === activeCustomerId) ?? filteredThreads[0];

  if (isLoading) return <div className="text-cream-dim text-sm">Loading…</div>;
  if (grouped.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No logged comms"
        description="Calls and SMS logged here from the house comm system."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
      <GlassCard className="p-0 overflow-hidden">
        <div className="p-3 border-b border-brass/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cream-dim" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients or messages"
              className="w-full pl-9 pr-3 py-2 bg-forest-raised/50 border border-brass/15 rounded-md text-base sm:text-sm text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40"
            />
          </div>
        </div>
        <div className="max-h-[calc(100dvh-22rem)] overflow-y-auto">
          {filteredThreads.map((t) => {
            const isActive = activeThread?.customerId === t.customerId;
            return (
              <button
                key={t.customerId}
                type="button"
                onClick={() => setActiveCustomerId(t.customerId)}
                className={cn(
                  "w-full text-left p-3 border-b border-brass/10 transition-colors",
                  isActive ? "bg-brass/10 border-l-2 border-l-brass" : "hover:bg-brass/5",
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="text-cream text-sm font-medium truncate">{t.customer?.name ?? "Unknown"}</div>
                    {t.customer?.dossier?.vip ? <Star className="h-3 w-3 text-brass fill-brass shrink-0" /> : null}
                  </div>
                  <div className="text-[10px] text-cream-dim shrink-0 ml-2">{formatRelative(t.last.createdAt)}</div>
                </div>
                <div className="text-[11px] text-cream-muted truncate">
                  {t.last.body ?? t.last.transcript ?? "(call)"}
                </div>
              </button>
            );
          })}
        </div>
      </GlassCard>
      {activeThread ? (
        <GlassCard variant="strong" className="p-0 overflow-hidden">
          <div className="p-5 border-b border-brass/10">
            <div className="ui-label text-[10px] mb-1">Client</div>
            <div className="text-2xl text-cream font-display flex items-center gap-2">
              {activeThread.customer?.name ?? "Unknown"}
              {activeThread.customer?.dossier?.vip ? <Star className="h-4 w-4 text-brass fill-brass" /> : null}
            </div>
            <div className="text-xs text-cream-dim mt-1">{activeThread.customer?.phone}</div>
          </div>
          <div className="p-5 space-y-4 max-h-[calc(100dvh-26rem)] overflow-y-auto">
            {[...activeThread.items]
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
              .map((m) => {
                const isInbound = m.direction === "inbound";
                return (
                  <div key={m.id} className={cn("flex items-start gap-2", isInbound ? "justify-start" : "justify-end")}>
                    <div
                      className={cn(
                        "max-w-[78%] rounded-lg p-3 border",
                        isInbound ? "bg-forest-raised/60 border-brass/15" : "bg-brass/15 border-brass/30",
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={cn("ui-label text-[9px]", isInbound ? "text-signal-emerald" : "text-brass-light")}>
                          {m.channel === "call" ? "Call · " : "SMS · "}
                          {isInbound ? "From client" : "From house"}
                        </span>
                        <span className="text-[10px] text-cream-dim">· {formatDateTime(m.createdAt)}</span>
                      </div>
                      <div className="text-base sm:text-sm text-cream leading-relaxed whitespace-pre-wrap">
                        {m.body ?? m.transcript ?? (m.channel === "call" ? "(no transcript)" : "(empty)")}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function Communications() {
  const [tab, setTab] = useState<Tab>("sofia");
  const { data: voiceItems = [] } = useSofiaVoiceApprovals();
  const { data: threads = [] } = useSofiaConversations();

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="Sofia · Communications"
        title={
          <>
            The <span className="text-brass-shimmer">conversation</span> centre.
          </>
        }
        description="SMS threads via Sofia, voice escalations, and the full house communication ledger."
      />

      {/* Tab switcher */}
      <div className="flex items-center gap-1 p-1 glass-panel rounded-lg w-fit">
        {(
          [
            { key: "sofia", label: "Sofia SMS", count: threads.length },
            { key: "ask", label: "Ask Sofia", count: null },
            { key: "voice", label: "Voice Approvals", count: voiceItems.length },
            { key: "all", label: "All Comms", count: null },
          ] as { key: Tab; label: string; count: number | null }[]
        ).map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "relative px-4 py-1.5 rounded-md text-xs transition-all",
              tab === key
                ? "bg-brass/20 text-cream border border-brass/30"
                : "text-cream-muted hover:text-cream",
            )}
          >
            {label}
            {count !== null && count > 0 ? (
              <span className="ml-1.5 text-[9px] text-cream-dim">({count})</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "sofia" && <SofiaTab />}
      {tab === "ask" && <AskSofiaTab />}
      {tab === "voice" && <VoiceTab />}
      {tab === "all" && <AllCommsTab />}
    </div>
  );
}
