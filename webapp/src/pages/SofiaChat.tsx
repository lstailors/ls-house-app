import { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageSquare, Send, ArrowLeft, Search, Bot, User,
  CheckCheck, Clock, ClipboardList, CheckCircle2, AlertCircle,
  Phone, RefreshCw
} from "lucide-react";
import { SectionHeader } from "@ls/design";
import { EmptyState } from "@ls/design";
import { Button } from "@ls/design/ui/button";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@ls/design/utils";
import { useIsMobile } from "@ls/design/hooks/use-mobile";

// ── Types ────────────────────────────────────────────────────────────────────
interface Conversation {
  phone: string;
  clientName?: string | null;
  lastMessage: {
    body: string;
    direction: "inbound" | "outbound";
    created_at?: string;
    timestamp?: string;
  };
  messageCount: number;
  sofiaActive: boolean;
  unread: boolean;
}

interface Message {
  id: string;
  client_phone: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
  sender?: string;
}

interface SofiaTask {
  id: string;
  title: string;
  type: string;
  priority: "high" | "medium" | "low";
  client_phone?: string | null;
  created_at: string;
  status: "open" | "done";
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(iso: string | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatFull(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400 border-red-500/30 bg-red-900/15",
  medium: "text-amber-400 border-amber-500/30 bg-amber-900/15",
  low: "text-green-400 border-green-500/30 bg-green-900/15",
};

// ── Thread Item ───────────────────────────────────────────────────────────────
function ThreadItem({
  conv, active, onClick
}: {
  conv: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const displayName = conv.clientName || conv.phone;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-brass/8 transition-all group",
        active
          ? "bg-brass/12 border-l-2 border-l-brass"
          : "hover:bg-brass/5 border-l-2 border-l-transparent"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={cn(
          "w-9 h-9 rounded-full border flex items-center justify-center flex-shrink-0 text-xs font-bold",
          conv.sofiaActive
            ? "bg-brass/15 border-brass/40 text-brass-shimmer"
            : "bg-slate-800 border-slate-600/40 text-slate-300"
        )}>
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className={cn("text-sm font-semibold truncate", active ? "text-cream" : "text-cream-muted group-hover:text-cream")}>
              {displayName}
            </span>
            <span className="text-[10px] text-cream-dim flex-shrink-0 ml-2">
              {formatTime(conv.lastMessage.timestamp || conv.lastMessage.created_at)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {conv.lastMessage.direction === "outbound" && (
              <CheckCheck className="w-3 h-3 text-brass-light/50 flex-shrink-0" />
            )}
            <span className="text-xs text-cream-dim truncate">{conv.lastMessage.body}</span>
            {conv.unread && (
              <span className="ml-auto w-2 h-2 rounded-full bg-brass flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={cn(
              "text-[9px] tracking-wider font-bold uppercase px-1.5 py-0.5 rounded border",
              conv.sofiaActive
                ? "border-brass/30 text-brass-light bg-brass/8"
                : "border-slate-600/30 text-slate-400 bg-slate-800/30"
            )}>
              {conv.sofiaActive ? "Sofia" : "Human"}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const isOut = msg.direction === "outbound";
  return (
    <div className={cn("flex gap-2 max-w-[85%]", isOut ? "ml-auto flex-row-reverse" : "mr-auto")}>
      <div className={cn(
        "w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0 mt-1",
        isOut ? "bg-brass/15 border-brass/40" : "bg-slate-800 border-slate-600/40"
      )}>
        {isOut
          ? <Bot className="w-3.5 h-3.5 text-brass-light" />
          : <User className="w-3.5 h-3.5 text-slate-400" />
        }
      </div>
      <div>
        <div className={cn(
          "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isOut
            ? "bg-brass/15 border border-brass/25 text-cream rounded-tr-sm"
            : "bg-slate-800/60 border border-slate-700/40 text-cream-muted rounded-tl-sm"
        )}>
          {msg.body}
        </div>
        <div className={cn(
          "text-[10px] text-cream-dim mt-1 px-1",
          isOut ? "text-right" : "text-left"
        )}>
          {formatFull(msg.created_at)}
        </div>
      </div>
    </div>
  );
}

// ── Loading Skeleton ──────────────────────────────────────────────────────────
function ThreadSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 py-3 border-b border-brass/8 animate-pulse">
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-full bg-brass/10 flex-shrink-0" />
            <div className="flex-1 space-y-1.5 py-1">
              <div className="h-3 bg-brass/10 rounded w-2/3" />
              <div className="h-2.5 bg-brass/8 rounded w-4/5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="space-y-4 p-4 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={cn("flex gap-2 max-w-[75%]", i % 2 ? "ml-auto flex-row-reverse" : "")}>
          <div className="w-7 h-7 rounded-full bg-brass/10 flex-shrink-0 mt-1" />
          <div className="space-y-1.5">
            <div className="h-10 bg-brass/8 rounded-2xl w-48" />
            <div className="h-2 bg-brass/6 rounded w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tasks Tab ─────────────────────────────────────────────────────────────────
function TasksPane() {
  const qc = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery<SofiaTask[]>({
    queryKey: ["sofia-tasks"],
    queryFn: () => api.get<SofiaTask[]>("/api/sofia/tasks"),
    refetchInterval: 30_000,
  });

  const markDone = useMutation({
    mutationFn: (id: string) => api.patch(`/api/sofia/tasks/${id}`, { status: "done" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sofia-tasks"] }),
  });

  const open = tasks.filter(t => t.status === "open");
  const done = tasks.filter(t => t.status === "done");

  if (isLoading) {
    return (
      <div className="p-4 space-y-2 animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-brass/8 rounded-xl" />
        ))}
      </div>
    );
  }

  if (open.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={CheckCircle2}
          title="All clear"
          description="No open tasks from Sofia right now."
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <p className="ui-label">{open.length} open task{open.length !== 1 ? "s" : ""}</p>
      {open.map(task => (
        <div
          key={task.id}
          className="glass-panel p-3.5 rounded-xl border border-brass/10 hover:border-brass/25 transition-all"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-base sm:text-sm text-cream font-medium leading-snug">{task.title}</p>
              <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                <span className="text-[9px] tracking-wider uppercase font-bold px-1.5 py-0.5 rounded border border-brass/25 text-brass-light bg-brass/8">
                  {task.type}
                </span>
                <span className={cn(
                  "text-[9px] tracking-wider uppercase font-bold px-1.5 py-0.5 rounded border",
                  PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.medium
                )}>
                  {task.priority}
                </span>
                {task.client_phone && (
                  <span className="flex items-center gap-1 text-[10px] text-cream-dim">
                    <Phone className="w-2.5 h-2.5" />{task.client_phone}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => markDone.mutate(task.id)}
              disabled={markDone.isPending}
              className="flex-shrink-0 p-2 rounded-lg border border-brass/20 hover:bg-brass/15 hover:border-brass/40 transition-all text-brass-light disabled:opacity-50"
              title="Mark done"
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-2 text-[10px] text-cream-dim flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {formatTime(task.created_at)}
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <details className="mt-4">
          <summary className="ui-label cursor-pointer select-none hover:text-cream-muted transition-colors">
            {done.length} completed
          </summary>
          <div className="mt-2 space-y-2">
            {done.map(task => (
              <div key={task.id} className="glass-panel p-3 rounded-xl border border-brass/8 opacity-50">
                <p className="text-base sm:text-sm text-cream-dim line-through">{task.title}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SofiaChat() {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"conversations" | "tasks">("conversations");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyAs, setReplyAs] = useState<"sofia" | "carl">("sofia");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showThread, setShowThread] = useState(false); // mobile: show right panel

  // ── Queries ──
  const { data: conversations = [], isLoading: convLoading } = useQuery<Conversation[]>({
    queryKey: ["sofia-conversations"],
    queryFn: () => api.get<Conversation[]>("/api/sofia/conversations"),
    refetchInterval: 15_000,
  });

  const { data: messages = [], isLoading: msgLoading } = useQuery<Message[]>({
    queryKey: ["sofia-messages", selectedPhone],
    queryFn: () => api.get<Message[]>(`/api/sofia/conversations/${encodeURIComponent(selectedPhone!)}`),
    enabled: !!selectedPhone,
    refetchInterval: 10_000,
  });

  // ── Send message ──
  const sendMsg = useMutation({
    mutationFn: () => api.post("/api/sofia/send", { to: selectedPhone, message: replyText }),
    onSuccess: () => {
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["sofia-messages", selectedPhone] });
      qc.invalidateQueries({ queryKey: ["sofia-conversations"] });
    },
  });

  // ── Auto-scroll ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSelectThread = useCallback((phone: string) => {
    setSelectedPhone(phone);
    setShowThread(true);
  }, []);

  const handleBack = useCallback(() => {
    setShowThread(false);
  }, []);

  const handleSend = useCallback(() => {
    if (!replyText.trim() || !selectedPhone) return;
    sendMsg.mutate();
  }, [replyText, selectedPhone, sendMsg]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const filteredConvs = conversations.filter(c => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      c.phone.includes(q) ||
      (c.clientName ?? "").toLowerCase().includes(q) ||
      c.lastMessage.body.toLowerCase().includes(q)
    );
  });

  const activeConv = conversations.find(c => c.phone === selectedPhone);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="L&S House · Sofia"
        title={<span className="text-brass-shimmer">Sofia — SMS.</span>}
        description="Every client conversation, both sides."
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-brass/15">
        {(["conversations", "tasks"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-all capitalize border-b-2 -mb-px",
              activeTab === tab
                ? "border-brass text-cream"
                : "border-transparent text-cream-muted hover:text-cream"
            )}
          >
            {tab === "conversations" ? (
              <span className="flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Conversations
                {conversations.filter(c => c.unread).length > 0 && (
                  <span className="w-4 h-4 rounded-full bg-brass text-[9px] font-bold text-black flex items-center justify-center">
                    {conversations.filter(c => c.unread).length}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <ClipboardList className="w-3.5 h-3.5" /> Tasks
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "tasks" ? (
        <TasksPane />
      ) : (
        /* Conversations split panel */
        <div className={cn(
          "border border-brass/12 rounded-2xl overflow-hidden",
          "flex",
          isMobile ? "h-[calc(100dvh-260px)]" : "h-[calc(100dvh-280px)]"
        )}>

          {/* LEFT: Thread list */}
          {(!isMobile || !showThread) && (
            <div className={cn(
              "flex flex-col border-r border-brass/12 bg-black/20",
              isMobile ? "w-full" : "w-1/3 min-w-[260px] max-w-[360px]"
            )}>
              {/* Search bar */}
              <div className="p-3 border-b border-brass/12">
                <div className="flex items-center gap-2 bg-brass/5 border border-brass/15 rounded-xl px-3 py-2">
                  <Search className="w-3.5 h-3.5 text-cream-dim flex-shrink-0" />
                  <input
                    className="flex-1 bg-transparent text-base sm:text-sm text-cream placeholder:text-cream-dim focus:outline-none"
                    placeholder="Search conversations…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto">
                {convLoading ? (
                  <ThreadSkeleton />
                ) : filteredConvs.length === 0 ? (
                  <div className="p-6 text-center text-cream-dim text-sm">
                    {search ? `No results for "${search}"` : "No conversations yet."}
                  </div>
                ) : (
                  filteredConvs.map(conv => (
                    <ThreadItem
                      key={conv.phone}
                      conv={conv}
                      active={conv.phone === selectedPhone}
                      onClick={() => handleSelectThread(conv.phone)}
                    />
                  ))
                )}
              </div>

              {/* Footer: total */}
              {!convLoading && conversations.length > 0 && (
                <div className="px-4 py-2 border-t border-brass/8 flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 text-cream-dim" />
                  <span className="text-[10px] text-cream-dim">
                    {conversations.length} thread{conversations.length !== 1 ? "s" : ""} · auto-refreshing
                  </span>
                </div>
              )}
            </div>
          )}

          {/* RIGHT: Conversation view */}
          {(!isMobile || showThread) && (
            <div className={cn(
              "flex flex-col flex-1 min-w-0 bg-black/10",
            )}>
              {!selectedPhone ? (
                /* Empty state */
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="text-center space-y-3">
                    <div className="w-16 h-16 rounded-full border border-brass/20 bg-brass/5 flex items-center justify-center mx-auto">
                      <MessageSquare className="w-7 h-7 text-brass-light/60" />
                    </div>
                    <p className="text-cream font-semibold">Select a conversation</p>
                    <p className="text-cream-dim text-sm">Choose a thread to view messages</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Conversation header */}
                  <div className="px-4 py-3 border-b border-brass/12 bg-black/20 flex items-center gap-3">
                    {isMobile && (
                      <button
                        onClick={handleBack}
                        className="p-1.5 rounded-lg hover:bg-brass/10 text-cream-muted hover:text-cream transition-all"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                    )}
                    <div className={cn(
                      "w-9 h-9 rounded-full border flex items-center justify-center flex-shrink-0 text-xs font-bold",
                      activeConv?.sofiaActive
                        ? "bg-brass/15 border-brass/40 text-brass-shimmer"
                        : "bg-slate-800 border-slate-600/40 text-slate-300"
                    )}>
                      {(activeConv?.clientName || selectedPhone).charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-cream truncate">
                        {activeConv?.clientName || selectedPhone}
                      </p>
                      {activeConv?.clientName && (
                        <p className="text-[10px] text-cream-dim">{selectedPhone}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[9px] tracking-wider font-bold uppercase px-2 py-1 rounded border",
                        activeConv?.sofiaActive
                          ? "border-brass/30 text-brass-light bg-brass/8"
                          : "border-slate-600/30 text-slate-400 bg-slate-800/30"
                      )}>
                        {activeConv?.sofiaActive ? "Sofia active" : "Human active"}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs border-brass/25 text-cream-muted hover:border-brass/50 hover:text-cream h-7 px-2.5"
                        onClick={() => {/* TODO: take over logic */}}
                      >
                        Take Over
                      </Button>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {msgLoading ? (
                      <MessageSkeleton />
                    ) : messages.length === 0 ? (
                      <div className="flex items-center justify-center h-full text-cream-dim text-sm">
                        No messages yet in this thread.
                      </div>
                    ) : (
                      messages.map(msg => (
                        <MessageBubble key={msg.id} msg={msg} />
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Reply box */}
                  <div className="p-3 border-t border-brass/12 bg-black/20 space-y-2">
                    {/* Toggle */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-cream-dim">Reply as</span>
                      {(["sofia", "carl"] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setReplyAs(mode)}
                          className={cn(
                            "flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border transition-all",
                            replyAs === mode
                              ? "bg-brass/15 border-brass/40 text-brass-light"
                              : "border-brass/12 text-cream-dim hover:border-brass/25"
                          )}
                        >
                          {mode === "sofia"
                            ? <Bot className="w-2.5 h-2.5" />
                            : <User className="w-2.5 h-2.5" />
                          }
                          {mode === "sofia" ? "Sofia" : "Carl"}
                        </button>
                      ))}
                    </div>
                    {/* Input */}
                    <div className="flex items-end gap-2">
                      <textarea
                        rows={2}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={`Message as ${replyAs === "sofia" ? "Sofia (AI)" : "Carl"}…`}
                        className="flex-1 bg-brass/5 border border-brass/15 focus:border-brass/40 rounded-xl px-3 py-2 text-base sm:text-sm text-cream placeholder:text-cream-dim focus:outline-none resize-none transition-colors"
                      />
                      <button
                        onClick={handleSend}
                        disabled={!replyText.trim() || sendMsg.isPending}
                        className={cn(
                          "p-3 rounded-xl border transition-all flex-shrink-0",
                          replyText.trim()
                            ? "bg-brass/20 border-brass/40 text-brass-light hover:bg-brass/30"
                            : "border-brass/10 text-cream-dim opacity-40 cursor-not-allowed"
                        )}
                      >
                        {sendMsg.isPending
                          ? <RefreshCw className="w-4 h-4 animate-spin" />
                          : <Send className="w-4 h-4" />
                        }
                      </button>
                    </div>
                    {sendMsg.isError && (
                      <p className="text-xs text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Failed to send. Please try again.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
