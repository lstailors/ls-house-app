import { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageSquare, X, ArrowLeft, Send, Hash, Bot, ChevronRight, Camera,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@ls/design/utils";
import { useMe } from "@/lib/session";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RavenChannel {
  name: string;
  channel_name?: string;
  type?: string;
  unread_count?: number;
}

interface RavenMessage {
  name: string;
  owner: string;
  creation: string;
  text?: string;
  message_type?: string;
  channel_id?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: "short" }) + " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const SOFIA_CHANNEL = "sofia-live";

// ── Channel List Item ─────────────────────────────────────────────────────────

function ChannelItem({
  channel,
  active,
  onClick,
}: {
  channel: RavenChannel;
  active: boolean;
  onClick: () => void;
}) {
  const name = channel.channel_name || channel.name || "";
  const isSofia = name.toLowerCase().includes(SOFIA_CHANNEL);

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all",
        active
          ? "bg-brass/15 border border-brass/30 text-cream"
          : "hover:bg-white/5 border border-transparent text-cream-muted hover:text-cream"
      )}
    >
      <Hash size={14} className={cn("shrink-0", active ? "text-brass" : "text-cream-dim")} />
      <span className="flex-1 text-sm font-medium truncate">{name}</span>
      {isSofia && (
        <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-900/40 border border-violet-500/30 text-violet-300 shrink-0">
          <Bot size={9} />
          Sofia
        </span>
      )}
      {!isSofia && <ChevronRight size={13} className="text-cream-dim shrink-0 opacity-40" />}
    </button>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isOwn,
}: {
  msg: RavenMessage;
  isOwn: boolean;
}) {
  const isSystem = msg.message_type === "System";

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-cream-dim/60 italic px-3 py-1 rounded-full bg-white/5">
          {msg.text}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-0.5 mb-3", isOwn ? "items-end" : "items-start")}>
      {!isOwn && (
        <span className="text-[10px] text-cream-dim ml-1 mb-0.5">{msg.owner}</span>
      )}
      <div
        className={cn(
          "max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed",
          isOwn
            ? "bg-brass/20 border border-brass/30 text-cream rounded-br-sm"
            : "bg-white/8 border border-white/10 text-cream-muted rounded-bl-sm"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
      </div>
      <span className={cn("text-[10px] text-cream-dim/50 mx-1", isOwn ? "text-right" : "text-left")}>
        {formatRelativeTime(msg.creation)}
      </span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RavenChat({ open: openProp, onClose }: { open?: boolean; onClose?: () => void } = {}) {
  const { data: user } = useMe();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = (v: boolean) => { setOpenInternal(v); if (!v) onClose?.(); };
  const [activeChannel, setActiveChannel] = useState<RavenChannel | null>(null);
  const [channels, setChannels] = useState<RavenChannel[]>([]);
  const [messages, setMessages] = useState<RavenMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [unreadCount] = useState(0); // future: track unread
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load channels when panel opens
  useEffect(() => {
    if (!open || !user) return;
    setLoadingChannels(true);
    api.get<RavenChannel[]>("/api/raven/channels")
      .then((data) => {
        // Sort: sofia-live first, then alphabetically
        const sorted = [...(data || [])].sort((a, b) => {
          const an = (a.channel_name || a.name || "").toLowerCase();
          const bn = (b.channel_name || b.name || "").toLowerCase();
          if (an.includes(SOFIA_CHANNEL)) return -1;
          if (bn.includes(SOFIA_CHANNEL)) return 1;
          return an.localeCompare(bn);
        });
        setChannels(sorted);
      })
      .catch(() => {})
      .finally(() => setLoadingChannels(false));
  }, [open, user]);

  const fetchMessages = useCallback((channel: RavenChannel) => {
    const name = channel.name || "";
    const encoded = encodeURIComponent(name);
    api.get<RavenMessage[]>(`/api/raven/channels/${encoded}/messages`)
      .then((data) => setMessages(data || []))
      .catch(() => {});
  }, []);

  // Start polling when a channel is active
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!activeChannel || !open) return;

    fetchMessages(activeChannel);
    pollRef.current = setInterval(() => fetchMessages(activeChannel), 8000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeChannel, open, fetchMessages]);

  // Load messages when channel selected
  const selectChannel = (ch: RavenChannel) => {
    setActiveChannel(ch);
    setMessages([]);
    setLoadingMessages(true);
    const name = ch.name || "";
    const encoded = encodeURIComponent(name);
    api.get<RavenMessage[]>(`/api/raven/channels/${encoded}/messages`)
      .then((data) => setMessages(data || []))
      .catch(() => {})
      .finally(() => setLoadingMessages(false));
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleReceiptUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChannel) return;
    setScanningReceipt(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api.post("/raven/process-receipt", {
        image_base64: base64,
        channel_id: activeChannel.name,
      });
      // reload messages to show the receipt summary
      if (activeChannel) {
        const res = await api.get<{ messages: RavenMessage[] }>(
          `/raven/channels/${encodeURIComponent(activeChannel.name)}/messages`
        );
        setMessages(res.messages ?? []);
      }
    } catch (err: unknown) {
      console.error("[receipt]", err);
    } finally {
      setScanningReceipt(false);
      // reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [activeChannel]);

  const sendMessage = async () => {
    if (!text.trim() || !activeChannel || sending) return;
    const body = text.trim();
    setText("");
    setSending(true);
    // Use full Frappe document name (e.g. "L&S Tailors-general"), not short channel_name
    const name = activeChannel.name || "";
    const encoded = encodeURIComponent(name);
    try {
      await api.post(`/api/raven/channels/${encoded}/messages`, { text: body });
      fetchMessages(activeChannel);
    } catch {
      // restore text on failure
      setText(body);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const goBack = () => {
    setActiveChannel(null);
    setMessages([]);
  };

  const closePanel = () => {
    setOpen(false);
    setActiveChannel(null);
    setMessages([]);
  };

  if (!user) return null;

  return (
    <>
      {/* ── Backdrop ── */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={closePanel}
        />
      )}

      {/* ── Slide-over panel ── */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full z-50 w-[400px] max-w-[95vw]",
          "bg-forest-deep/97 border-l border-brass/20 backdrop-blur-2xl",
          "flex flex-col shadow-2xl",
          "transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-brass/15 shrink-0">
          {activeChannel ? (
            <button
              onClick={goBack}
              className="p-1.5 rounded-lg hover:bg-white/8 text-cream-muted hover:text-cream transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
          ) : (
            <div className="w-7 h-7 rounded-lg bg-brass/10 border border-brass/25 flex items-center justify-center">
              <MessageSquare size={14} className="text-brass" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-cream tracking-wide">
              {activeChannel
                ? `# ${activeChannel.channel_name || activeChannel.name}`
                : "Team Chat"}
            </h2>
            {!activeChannel && (
              <p className="text-[11px] text-cream-dim">Raven channels</p>
            )}
          </div>
          <button
            onClick={closePanel}
            className="p-1.5 rounded-lg hover:bg-white/8 text-cream-dim hover:text-cream transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {!activeChannel ? (
          /* ── Channel list ── */
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {loadingChannels ? (
              <div className="flex flex-col gap-2 p-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />
                ))}
              </div>
            ) : channels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-cream-dim text-sm">
                <Hash size={28} className="mb-2 opacity-30" />
                No channels found
              </div>
            ) : (
              channels.map((ch) => (
                <ChannelItem
                  key={ch.name}
                  channel={ch}
                  active={false}
                  onClick={() => selectChannel(ch)}
                />
              ))
            )}
          </div>
        ) : (
          /* ── Messages view ── */
          <>
            <div className="flex-1 overflow-y-auto px-3 pt-3 pb-1">
              {loadingMessages ? (
                <div className="flex flex-col gap-3 p-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className={cn("h-12 rounded-xl bg-white/5 animate-pulse", i % 2 === 0 ? "ml-8" : "mr-8")} />
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-cream-dim text-sm">
                  <MessageSquare size={28} className="mb-2 opacity-30" />
                  No messages yet
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble
                    key={msg.name}
                    msg={msg}
                    isOwn={msg.owner === user?.email || msg.owner === user?.name}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 px-3 pb-4 pt-2 border-t border-brass/10">
              <div className="flex items-end gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 focus-within:border-brass/30 transition-colors">
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message..."
                  rows={1}
                  className="flex-1 bg-transparent text-base sm:text-sm text-cream placeholder:text-cream-dim/50 resize-none outline-none max-h-32 leading-relaxed"
                  style={{ minHeight: "22px" }}
                />
                {/* Hidden file input for receipt photos */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleReceiptUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={scanningReceipt}
                  title="Scan receipt / invoice"
                  className={cn(
                    "p-1.5 rounded-lg transition-all shrink-0",
                    scanningReceipt
                      ? "text-brass/50 animate-pulse"
                      : "text-brass/60 hover:text-brass hover:bg-brass/10"
                  )}
                >
                  <Camera size={15} />
                </button>
                <button
                  onClick={sendMessage}
                  disabled={!text.trim() || sending}
                  className={cn(
                    "p-1.5 rounded-lg transition-all shrink-0",
                    text.trim() && !sending
                      ? "text-brass hover:bg-brass/10"
                      : "text-cream-dim/30"
                  )}
                >
                  <Send size={15} />
                </button>
              </div>
              <p className="text-[10px] text-cream-dim/40 mt-1.5 text-center">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
