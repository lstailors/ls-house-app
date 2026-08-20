import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Send, Sparkles, X, XCircle } from "lucide-react";
import { Button } from "@ls/design/ui/button";
import { cn } from "@ls/design/utils";
import { toast } from "sonner";
import { useSofiaChat, type SofiaChatAction } from "@/lib/queries";

type AskChatMsg = {
  id: string;
  role: "staff" | "sofia";
  text: string;
  actions?: SofiaChatAction[];
  error?: boolean;
};

const STORAGE_KEY = "ls-ask-sofia-chat";

function loadSaved(): AskChatMsg[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AskChatMsg[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => m && (m.role === "staff" || m.role === "sofia") && typeof m.text === "string");
  } catch {
    return [];
  }
}

function saveMessages(messages: AskChatMsg[]) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(messages.filter((m) => !m.error).slice(-40)),
    );
  } catch {
    /* ignore quota */
  }
}

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

function greetingFor(phone?: string | null): AskChatMsg {
  return {
    id: "sofia-greeting",
    role: "sofia",
    text: phone
      ? `I'm Sofia. I can see you're looking at ${phone} — ask me about this client, or tell me to text them.`
      : "I'm Sofia. Ask me about a client, who's on the book today, or tell me to text someone.",
  };
}

/** Ask Sofia — live conversation with the house AI (same brain as SMS). */
export function AskSofiaDrawer({
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMessages((prev) => {
      if (prev.length > 0) return prev;
      const saved = loadSaved();
      return saved.length > 0 ? saved : [greetingFor(contextPhone)];
    });
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open, contextPhone]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chat.isPending]);

  const starters = useMemo(() => {
    if (contextPhone) {
      return [
        "What's the latest with this client?",
        "Text them that their garment is ready.",
        "Who's on the schedule today?",
      ];
    }
    return [
      "Who's on the schedule today?",
      "Text Sal that his suit is ready.",
      "Any open follow-ups I should know?",
    ];
  }, [contextPhone]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || chat.isPending) return;
    const prior = messages
      .filter((m) => !m.error && m.id !== "sofia-greeting")
      .map((m) => ({
        role: m.role === "staff" ? ("user" as const) : ("assistant" as const),
        content: m.text,
      }));
    const staffMsg: AskChatMsg = { id: `${Date.now()}-staff`, role: "staff", text };
    const next = [...messages, staffMsg];
    setMessages(next);
    setInput("");
    try {
      const res = await chat.mutateAsync({
        message: text,
        history: prior,
        context_phone: contextPhone ?? null,
      });
      const updated: AskChatMsg[] = [
        ...next,
        { id: `${Date.now()}-sofia`, role: "sofia", text: res.reply, actions: res.actions },
      ];
      setMessages(updated);
      saveMessages(updated);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Sofia is briefly unavailable.";
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
                Talk to the house AI. She can look things up and text a client when you ask.
              </div>
              {contextPhone ? (
                <div className="text-[10px] text-brass mt-1 truncate">Looking at · {contextPhone}</div>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md border border-brass/20 text-cream-muted hover:text-cream hover:bg-brass/10 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 p-4 space-y-3 overflow-y-auto min-h-0">
          {messages.map((m) => (
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
          ))}
          {chat.isPending ? (
            <div className="flex justify-start">
              <div className="rounded-lg p-3 border border-brass/15 bg-forest-raised/60 text-xs text-cream-dim">
                Sofia is working…
              </div>
            </div>
          ) : null}

          {messages.length <= 1 && !chat.isPending ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {starters.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-left text-[11px] text-cream-muted border border-brass/20 rounded-full px-3 py-1.5 hover:bg-brass/10 hover:text-cream"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="p-3 border-t border-brass/10 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Talk to Sofia…"
            disabled={chat.isPending}
            className="flex-1 px-3 py-2 bg-forest-raised/50 border border-brass/15 rounded-md text-sm text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/40 disabled:opacity-50"
          />
          <Button
            size="sm"
            onClick={() => void send(input)}
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
