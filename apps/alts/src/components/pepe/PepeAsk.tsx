import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, RotateCcw, Send } from "lucide-react";
import { cn } from "@ls/design/utils";
import { useMe } from "@ls/auth/session";
import { ApiError, PEPE_EMAIL, pepeApi, type PepeMessage } from "./pepeApi";
import { usePepePanel } from "./PepeContext";
import { PepeMarkdown } from "./pepeMarkdown";

const POLL_MS = 3000;
const THINKING_MS = 90_000;

export default function PepeAsk({ wired }: { wired: boolean }) {
  const { data: me } = useMe();
  const { consumeContext, contextPending, context } = usePepePanel();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [failedText, setFailedText] = useState<string | null>(null);
  const [thinkingSince, setThinkingSince] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const messagesQ = useQuery({
    queryKey: ["pepe", "messages"],
    queryFn: () => pepeApi.messages(50),
    enabled: wired,
    refetchInterval: wired ? POLL_MS : false,
  });
  const messages = messagesQ.data ?? [];

  const lastStaffIdx = useMemo(() => lastStaffMessageIndex(messages, me?.email), [messages, me?.email]);

  const thinking = useMemo(() => {
    if (!thinkingSince) return false;
    if (Date.now() - thinkingSince > THINKING_MS) return false;
    return lastStaffIdx >= 0 && staffAwaitingPepe(messages, me?.email);
  }, [messages, me?.email, thinkingSince, lastStaffIdx]);

  useEffect(() => {
    if (thinkingSince && Date.now() - thinkingSince > THINKING_MS) setThinkingSince(null);
    if (thinkingSince && !staffAwaitingPepe(messages, me?.email)) setThinkingSince(null);
  }, [messages, me?.email, thinkingSince]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, thinking]);

  const send = useMutation({
    mutationFn: (text: string) => pepeApi.send(text),
    onSuccess: (rows) => {
      qc.setQueryData(["pepe", "messages"], rows);
      setFailedText(null);
      setDraft("");
      setThinkingSince(Date.now());
    },
    onError: (_err, text) => {
      setFailedText(text);
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => pepeApi.upload(file),
    onSuccess: (rows) => {
      qc.setQueryData(["pepe", "messages"], rows);
      setThinkingSince(Date.now());
    },
  });

  function submit() {
    const raw = draft.trim();
    if (!raw || send.isPending || !wired) return;
    const ctx = consumeContext();
    const text = ctx ? `[context: ${ctx.doctype} / ${ctx.name}]\n${raw}` : raw;
    send.mutate(text);
  }

  function retry() {
    if (!failedText) return;
    send.mutate(failedText);
  }

  if (!wired) {
    return (
      <div className="flex flex-1 flex-col items-start justify-center px-6 py-10">
        <h3 className="font-display italic text-2xl text-cream">Pepe isn’t wired for this login yet</h3>
        <p className="mt-2 text-sm text-cream-dim">Ask Carl.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messagesQ.isError && (
          <p className="rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            Couldn’t load history.
          </p>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={m.name}
            msg={m}
            mine={isMine(m, me?.email)}
            pepe={isPepeMsg(m)}
            thinking={thinking && i === lastStaffIdx}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {failedText && (
        <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2">
          <p className="text-xs text-red-300">Send failed</p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.16em] text-cream"
          >
            <RotateCcw size={12} /> Retry
          </button>
        </div>
      )}

      {contextPending && context && (
        <p className="mx-3 mb-1 text-[11px] uppercase tracking-[0.14em] text-brass">
          Next send includes [context: {context.doctype} / {context.name}]
        </p>
      )}

      <form
        className="border-t border-brass/20 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
          <button
            type="button"
            aria-label="Attach"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brass/30 text-brass hover:bg-brass/10 disabled:opacity-40"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            value={draft}
            rows={1}
            disabled={send.isPending}
            placeholder="Ask Pepe…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className={cn(
              "min-h-11 max-h-32 flex-1 resize-none rounded-2xl border border-brass/25 bg-forest-deep/70",
              "px-3 py-2.5 text-sm text-cream placeholder:text-cream-dim",
              "focus:border-brass/50 focus:outline-none",
            )}
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!draft.trim() || send.isPending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brass/50 bg-brass/20 text-brass hover:bg-brass/30 disabled:opacity-40"
          >
            <Send size={15} />
          </button>
        </div>
        {upload.isError && (
          <p className="mt-2 text-xs text-red-300">
            {upload.error instanceof ApiError ? upload.error.message : "Attach failed"}
          </p>
        )}
      </form>
    </div>
  );
}

function isPepeMsg(m: PepeMessage) {
  return m.is_pepe === true || m.owner?.toLowerCase() === PEPE_EMAIL;
}

function isMine(m: PepeMessage, email?: string) {
  if (isPepeMsg(m)) return false;
  if (!email) return true;
  return m.owner?.toLowerCase() === email.toLowerCase();
}

function lastStaffMessageIndex(messages: PepeMessage[], email?: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isMine(messages[i]!, email)) return i;
  }
  return -1;
}

function staffAwaitingPepe(messages: PepeMessage[], email?: string): boolean {
  const lastStaff = lastStaffMessageIndex(messages, email);
  if (lastStaff < 0) return false;
  return !messages.slice(lastStaff + 1).some((m) => isPepeMsg(m));
}

function MessageBubble({
  msg,
  mine,
  pepe,
  thinking,
}: {
  msg: PepeMessage;
  mine: boolean;
  pepe?: boolean;
  thinking?: boolean;
}) {
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-2xl border px-3 py-2",
          mine
            ? "border-brass/25 bg-brass/15 text-cream"
            : "border-brass/20 bg-forest-raised/80 text-cream",
        )}
      >
        {pepe ? (
          <PepeMarkdown text={msg.text} />
        ) : (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{msg.text}</p>
        )}
        {msg.file_url && (
          <a
            href={msg.file_url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-brass/25 bg-black/20 px-2.5 py-2 text-xs text-cream"
          >
            <span className="truncate">{msg.file_name || "Attachment"}</span>
            {msg.file_size ? <span className="shrink-0 text-cream-dim">{formatSize(msg.file_size)}</span> : null}
          </a>
        )}
        {thinking && (
          <p className="mt-1.5 text-[11px] italic text-cream-dim">thinking…</p>
        )}
      </div>
    </div>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
