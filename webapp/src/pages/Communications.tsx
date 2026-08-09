import { useState, useMemo, useRef, useEffect } from "react";
import {
  MessageSquare,
  Search,
  Mic,
  Eye,
  UserCheck,
  Star,
  Send,
  Sparkles,
  CheckCircle2,
  XCircle,
  PanelRightOpen,
  X,
} from "lucide-react";
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
  useCommsEvents,
  type SofiaChatAction,
  type CommsEvent,
} from "@/lib/queries";
import { formatDateTime } from "@ls/design/format";
import type { Communication, Customer } from "@ls/types";
import { cn } from "@ls/design/utils";
import { toast } from "sonner";

// ─── Tab types (Ask Sofia is a right drawer — not a center tab) ─────────────
type Tab = "sofia" | "voice" | "all";

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

// ─── Unified Full History (Plan A Phase 1 events) ────────────────────────────
function CustomerFullHistory({ phone }: { phone: string | null }) {
  const { data, isLoading, isError } = useCommsEvents({ phone, limit: 40, enabled: !!phone });
  if (!phone) return null;
  const accent = (t: string) =>
    t === "sms"
      ? "border-l-signal-emerald bg-emerald-900/10"
      : t === "call"
        ? "border-l-brass bg-brass/10"
        : t === "plaud"
          ? "border-l-amber-400/80 bg-amber-900/10"
          : "border-l-cream-dim";
  return (
    <div className="border-t border-brass/10 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="ui-label text-[10px] text-brass">Full history · SMS + Calls + Plaud</div>
        {data?.counts ? (
          <span className="text-[10px] text-cream-dim">
            {data.counts.call}c · {data.counts.sms}s · {data.counts.plaud}p
          </span>
        ) : null}
      </div>
      {isLoading ? <div className="text-cream-dim text-xs py-3">Loading timeline…</div> : null}
      {isError ? <div className="text-signal-crimson text-xs py-2">Timeline unavailable</div> : null}
      {!isLoading && !isError && (data?.events?.length ?? 0) === 0 ? (
        <div className="text-cream-dim text-xs py-2">No linked events yet</div>
      ) : null}
      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
        {(data?.events ?? []).map((ev: CommsEvent) => (
          <div key={ev.id} className={cn("border-l-2 pl-3 py-1.5 rounded-r-md", accent(ev.source_type))}>
            <div className="flex justify-between gap-2 text-[10px] text-cream-dim">
              <span className="uppercase tracking-wide text-cream-muted">
                {ev.source_type}
                {ev.direction ? ` · ${ev.direction}` : ""}
              </span>
              <span className="shrink-0">
                {ev.occurred_at
                  ? new Date(ev.occurred_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : ""}
              </span>
            </div>
            <p className="text-cream text-xs leading-snug line-clamp-2">{ev.summary || "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sofia SMS Tab ───────────────────────────────────────────────────────────
function SofiaTab({
  externalPhone,
  onPhoneChange,
}: {
  externalPhone?: string | null;
  onPhoneChange?: (phone: string | null) => void;
}) {
  const { data: threads = [], isLoading } = useSofiaConversations();
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [handedOff, setHandedOff] = useState<Set<string>>(new Set());
  const handoff = useSofiaHandoff();

  const pickPhone = (p: string) => {
    setActivePhone(p);
    onPhoneChange?.(p);
  };

  const resolvedPhone = externalPhone ?? activePhone ?? (threads[0]?.phone ?? null);
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
                  onClick={() => pickPhone(t.phone)}
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
          {/* Plan A: full multi-channel history under the SMS thread */}
          <CustomerFullHistory phone={resolvedPhone} />
          {/* NO send/compose input — Sofia handles outbound; shadow_review has no send path */}
        </GlassCard>
      ) : (
        <GlassCard className="p-10">
          <EmptyState
            icon={MessageSquare}
            title="Select a conversation"
            description="Pick a client from Attention or the thread list."
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

/** Plan A Phase 3.4 — Ask Sofia as collapsible right drawer (not a 5th tab). */
function AskSofiaDrawer({
  open,
  onClose,
  contextPhone,
}: {
  open: boolean;
  onClose: () => void;
  contextPhone?: string | null;
}) {
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

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close Ask Sofia"
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        className="fixed top-0 right-0 z-50 h-full w-full max-w-md border-l border-brass/20 bg-forest shadow-2xl flex flex-col animate-fade-up"
        role="dialog"
        aria-label="Ask Sofia"
      >
        <div className="p-4 border-b border-brass/10 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-brass-light shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-cream font-medium text-sm">Ask Sofia</div>
              <div className="text-[10px] text-cream-dim leading-snug">
                Same brain + tools as SMS assistant mode. Real sends when she texts a client.
              </div>
              {contextPhone ? (
                <div className="text-[10px] text-brass mt-1 truncate">Context phone · {contextPhone}</div>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md border border-brass/20 text-cream-muted hover:text-cream hover:bg-brass/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 p-4 space-y-3 overflow-y-auto min-h-0">
          {messages.length === 0 ? (
            <div className="text-cream-dim text-xs text-center py-10 px-4">
              e.g. &quot;text Sal that his suit is ready&quot; or &quot;who&apos;s on the schedule today&quot;
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={cn("flex", m.role === "staff" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[90%] rounded-lg p-3 border",
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
                  <div className="text-sm text-cream leading-relaxed whitespace-pre-wrap">{m.text}</div>
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
            className="flex-1 px-3 py-2 bg-forest-raised/50 border border-brass/15 rounded-md text-sm text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40 disabled:opacity-50"
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
      </aside>
    </>
  );
}

// ─── Attention Queue (Plan A Phase 3.1) ─────────────────────────────────────
type AttentionItem = {
  id: string;
  phone?: string;
  title: string;
  preview: string;
  tone: "brass" | "forest" | "gray";
  rel: string;
  kind: "sms" | "voice";
};

function AttentionQueue({
  items,
  activePhone,
  onSelect,
}: {
  items: AttentionItem[];
  activePhone: string | null;
  onSelect: (item: AttentionItem) => void;
}) {
  return (
    <GlassCard className="p-0 overflow-hidden h-full">
      <div className="p-3 border-b border-brass/10 flex items-center justify-between">
        <div>
          <div className="ui-label text-[10px] text-brass">Attention</div>
          <div className="text-cream text-sm font-medium">Needs eyes</div>
        </div>
        <span className="text-[10px] text-cream-dim border border-brass/20 rounded-full px-2 py-0.5">
          {items.length}
        </span>
      </div>
      <div className="max-h-[calc(100dvh-18rem)] overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-6 text-center text-cream-dim text-xs">Queue clear.</div>
        ) : (
          items.map((it) => {
            const active = it.phone && activePhone === it.phone;
            const dot =
              it.tone === "brass"
                ? "bg-brass"
                : it.tone === "forest"
                  ? "bg-signal-emerald"
                  : "bg-cream-dim/50";
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onSelect(it)}
                className={cn(
                  "w-full text-left p-3 border-b border-brass/10 transition-colors",
                  active ? "bg-brass/10 border-l-2 border-l-brass" : "hover:bg-brass/5",
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("h-2 w-2 rounded-full shrink-0", dot)} />
                  <span className="text-cream text-sm font-medium truncate flex-1">{it.title}</span>
                  <span className="text-[10px] text-cream-dim shrink-0">{it.rel}</span>
                </div>
                <div className="text-[11px] text-cream-muted truncate pl-4">{it.preview}</div>
                <div className="text-[9px] text-cream-dim pl-4 mt-0.5 uppercase tracking-wide">
                  {it.kind === "voice" ? "Voice" : "SMS"}
                </div>
              </button>
            );
          })
        )}
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

// ─── Main page — Plan A Phase 3 shell ────────────────────────────────────────
export default function Communications() {
  const [tab, setTab] = useState<Tab>("sofia");
  const [askOpen, setAskOpen] = useState(false);
  const [focusPhone, setFocusPhone] = useState<string | null>(null);
  const { data: voiceItems = [] } = useSofiaVoiceApprovals();
  const { data: threads = [] } = useSofiaConversations();

  const attentionItems = useMemo((): AttentionItem[] => {
    const sms: AttentionItem[] = (threads as any[]).map((t) => {
      const dir = t.lastMessage?.direction;
      const inbound = dir === "inbound" || dir === "in";
      return {
        id: `sms-${t.phone}`,
        phone: t.phone,
        title: t.phone,
        preview: previewBody(t.lastMessage),
        tone: inbound ? "brass" : "forest",
        rel: t.lastMessage?.created_at ? formatRelative(t.lastMessage.created_at) : "",
        kind: "sms" as const,
      };
    });
    // Brass (needs reply) first, then forest (FYI outbound), then by time
    sms.sort((a, b) => {
      const rank = (t: string) => (t === "brass" ? 0 : t === "forest" ? 1 : 2);
      const d = rank(a.tone) - rank(b.tone);
      if (d !== 0) return d;
      return 0;
    });
    const voice: AttentionItem[] = (voiceItems as any[]).slice(0, 12).map((v, i) => ({
      id: `voice-${v.id ?? i}`,
      title: v.client_name || v.client_phone || "Voice approval",
      preview: String(v.summary || v.status || "Needs review"),
      tone: "brass" as const,
      rel: v.created_at ? formatRelative(v.created_at) : "",
      kind: "voice" as const,
      phone: v.client_phone || undefined,
    }));
    return [...voice, ...sms].slice(0, 40);
  }, [threads, voiceItems]);

  const brassCount = attentionItems.filter((i) => i.tone === "brass").length;

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeader
          eyebrow="Plan A · Communications"
          title={
            <>
              The <span className="text-brass-shimmer">conversation</span> centre.
            </>
          }
          description="Attention queue · unified timeline · Ask Sofia drawer. SMS + calls + Plaud on one customer."
        />
        <Button
          size="sm"
          onClick={() => setAskOpen(true)}
          className="h-9 gap-1.5 bg-brass/20 border border-brass/40 text-cream hover:bg-brass/30 shrink-0"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          Ask Sofia
          {brassCount > 0 ? (
            <span className="ml-1 text-[10px] text-brass-light">· {brassCount}</span>
          ) : null}
        </Button>
      </div>

      {/* Center filter chips (power users) — not Ask Sofia */}
      <div className="flex items-center gap-1 p-1 glass-panel rounded-lg w-fit">
        {(
          [
            { key: "sofia" as const, label: "Sofia SMS", count: threads.length },
            { key: "voice" as const, label: "Voice", count: voiceItems.length },
            { key: "all" as const, label: "All Comms", count: null },
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

      {/* Plan A layout: Attention | Center */}
      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4 items-start">
        <AttentionQueue
          items={attentionItems}
          activePhone={focusPhone}
          onSelect={(it) => {
            if (it.kind === "voice") {
              setTab("voice");
              if (it.phone) setFocusPhone(it.phone);
              return;
            }
            setTab("sofia");
            setFocusPhone(it.phone ?? null);
          }}
        />
        <div className="min-w-0">
          {tab === "sofia" && (
            <SofiaTab externalPhone={focusPhone} onPhoneChange={setFocusPhone} />
          )}
          {tab === "voice" && <VoiceTab />}
          {tab === "all" && <AllCommsTab />}
        </div>
      </div>

      <AskSofiaDrawer open={askOpen} onClose={() => setAskOpen(false)} contextPhone={focusPhone} />
    </div>
  );
}

