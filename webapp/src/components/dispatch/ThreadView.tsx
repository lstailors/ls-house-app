import { useEffect, useRef } from "react";
import { AlertTriangle, Check, Pencil, Send, Trash2 } from "lucide-react";
import { cn } from "@ls/design/utils";
import type { DispatchMessage } from "@ls/types";

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface PendingDraft {
  text: string;
  editing: boolean;
}

interface Props {
  messages: DispatchMessage[];
  hasMore: boolean;
  loading: boolean;
  onLoadEarlier: () => void;
  pendingDraft: PendingDraft | null;
  onDraftChange: (text: string) => void;
  onDraftEditToggle: () => void;
  onDraftApprove: () => void;
  onDraftDiscard: () => void;
  approving: boolean;
}

export function ThreadView({
  messages, hasMore, loading, onLoadEarlier,
  pendingDraft, onDraftChange, onDraftEditToggle, onDraftApprove, onDraftDiscard, approving,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const count = messages.length;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [count, pendingDraft?.text]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
      {hasMore ? (
        <div className="text-center">
          <button
            onClick={onLoadEarlier}
            className="text-[11px] text-brass-light border border-brass/25 rounded-full px-3 py-1 hover:bg-brass/10 transition-colors"
          >
            Load earlier messages
          </button>
        </div>
      ) : null}

      {loading && count === 0 ? (
        <div className="flex justify-center py-10">
          <div className="h-5 w-5 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
        </div>
      ) : null}

      {!loading && count === 0 ? (
        <p className="text-center text-sm text-cream-dim py-10">No messages yet — start the conversation below.</p>
      ) : null}

      {messages.map((m) => {
        const inbound = m.direction === "inbound";
        const failed = m.status === "failed";
        return (
          <div key={m.name} className={cn("flex", inbound ? "justify-start" : "justify-end")}>
            <div className={cn("max-w-[78%] md:max-w-[65%]")}>
              <div
                className={cn(
                  "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
                  inbound
                    ? "bg-forest-raised/70 border border-brass/10 text-cream rounded-bl-sm"
                    : "bg-brass/15 border border-brass/25 text-cream rounded-br-sm",
                  failed ? "border-signal-rose/50" : "",
                )}
              >
                {m.content}
              </div>
              <div className={cn("mt-1 flex items-center gap-1.5 text-[10px] text-cream-dim", inbound ? "" : "justify-end")}>
                <span>{fmtTime(m.timestamp)}</span>
                {!inbound && m.sender ? <span className="text-cream-dim/70">· {m.sender}</span> : null}
                {!inbound ? (
                  failed ? (
                    <span className="inline-flex items-center gap-0.5 text-signal-rose">
                      <AlertTriangle className="h-3 w-3" /> failed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-signal-emerald/80">
                      <Check className="h-3 w-3" /> {m.status ?? "sent"}
                    </span>
                  )
                ) : null}
              </div>
              {failed && m.error_message ? (
                <div className="mt-0.5 text-[10px] text-signal-rose/80 text-right">{m.error_message}</div>
              ) : null}
            </div>
          </div>
        );
      })}

      {pendingDraft ? (
        <div className="flex justify-end">
          <div className="max-w-[85%] md:max-w-[70%] w-full">
            <div className="rounded-2xl border-2 border-dashed border-brass/60 bg-brass/8 px-4 py-3">
              <div className="ui-label text-[9px] text-brass-light mb-2">Sofia's draft — awaiting your approval</div>
              {pendingDraft.editing ? (
                <textarea
                  value={pendingDraft.text}
                  onChange={(e) => onDraftChange(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-brass/30 bg-forest-raised/60 p-2.5 text-sm text-cream focus:outline-none focus:border-brass/60 resize-y"
                />
              ) : (
                <p className="text-sm text-cream whitespace-pre-wrap leading-relaxed">{pendingDraft.text}</p>
              )}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button
                  onClick={onDraftApprove}
                  disabled={approving || !pendingDraft.text.trim()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brass px-4 py-1.5 text-xs font-semibold text-forest-deep hover:bg-brass-light transition-colors disabled:opacity-50"
                >
                  {approving ? (
                    <div className="h-3 w-3 rounded-full border-2 border-forest-deep/40 border-t-forest-deep animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Approve &amp; Send
                </button>
                <button
                  onClick={onDraftEditToggle}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brass/30 px-3.5 py-1.5 text-xs text-brass-light hover:bg-brass/10 transition-colors"
                >
                  {pendingDraft.editing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                  {pendingDraft.editing ? "Done editing" : "Edit"}
                </button>
                <button
                  onClick={onDraftDiscard}
                  className="inline-flex items-center gap-1.5 rounded-full border border-signal-rose/30 px-3.5 py-1.5 text-xs text-signal-rose hover:bg-signal-rose/10 transition-colors"
                >
                  <Trash2 className="h-3 w-3" /> Discard
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div ref={bottomRef} />
    </div>
  );
}
