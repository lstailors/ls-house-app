import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, Check, Send, Users, X } from "lucide-react";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import type { DispatchTemplate } from "@ls/types";
import type { DispatchSelection } from "./CustomerPicker";
import { selectionKey } from "./CustomerPicker";

// Personalized per recipient at send time; everything else is shared.
const PER_RECIPIENT = ["{first_name}", "{client_name}"];

const SHARED_INPUTS: Record<string, { type: "date" | "time" | "text"; placeholder?: string }> = {
  "{date}": { type: "date" },
  "{time}": { type: "time" },
  "{garment}": { type: "text", placeholder: "e.g. navy suit" },
};

function personalize(body: string, name: string): string {
  const first = name.split(/\s+/)[0] ?? name;
  return body.split("{first_name}").join(first).split("{client_name}").join(name);
}

function fmtDateToken(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function fmtTimeToken(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

type SendState = "pending" | "sending" | "sent" | "failed" | "blocked" | "skipped";

interface RecipientResult {
  key: string;
  state: SendState;
  detail?: string;
}

interface Props {
  recipients: DispatchSelection[];
  onRemove: (key: string) => void;
  onClear: () => void;
  onDone: () => void;
}

export function BatchPanel({ recipients, onRemove, onClear, onDone }: Props) {
  const [text, setText] = useState<string>("");
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [finished, setFinished] = useState<boolean>(false);
  const [results, setResults] = useState<Record<string, RecipientResult>>({});

  const { data: templates = [] } = useQuery({
    queryKey: ["dispatch-templates", null],
    queryFn: () => api.get<DispatchTemplate[]>("/api/dispatch/templates"),
  });

  // Shared tokens still unresolved (per-recipient ones resolve at send time).
  const sharedTokens = useMemo(
    () => [...new Set(text.match(/\{[a-z_]+\}/gi) ?? [])].filter((t) => !PER_RECIPIENT.includes(t.toLowerCase())),
    [text],
  );

  const sendable = recipients.filter((r) => !!r.phone);
  const noPhone = recipients.filter((r) => !r.phone);

  const fillToken = (token: string, raw: string, type: "date" | "time" | "text") => {
    if (!raw) return;
    const value = type === "date" ? fmtDateToken(raw) : type === "time" ? fmtTimeToken(raw) : raw;
    setText((t) => t.split(token).join(value));
  };

  const runBatch = async () => {
    setRunning(true);
    setFinished(false);
    const next: Record<string, RecipientResult> = {};
    for (const r of recipients) next[selectionKey(r)] = { key: selectionKey(r), state: r.phone ? "pending" : "skipped", detail: r.phone ? undefined : "No phone on file" };
    setResults({ ...next });

    for (const r of sendable) {
      const key = selectionKey(r);
      next[key] = { key, state: "sending" };
      setResults({ ...next });
      try {
        const res = await api.post<{ ok: boolean; status: string; error: string | null }>("/api/dispatch/send", {
          customer: r.customerId ?? undefined,
          clientName: r.name,
          phone: r.phone,
          body: personalize(text.trim(), r.name),
          mode: activeTemplate ? "template" : "custom",
          template: activeTemplate ?? undefined,
          batch: true,
        });
        next[key] = res.ok
          ? { key, state: "sent" }
          : { key, state: "failed", detail: res.error ?? "Twilio send failed" };
      } catch (e: any) {
        const blocked = e?.status === 409;
        next[key] = { key, state: blocked ? "blocked" : "failed", detail: blocked ? "Opted out (STOP)" : e?.message ?? "Send failed" };
      }
      setResults({ ...next });
      await new Promise((res) => setTimeout(res, 350));
    }
    setRunning(false);
    setFinished(true);
  };

  const sentCount = Object.values(results).filter((r) => r.state === "sent").length;
  const doneCount = Object.values(results).filter((r) => r.state !== "pending" && r.state !== "sending").length;
  const sendDisabled = running || sendable.length === 0 || text.trim().length === 0 || sharedTokens.length > 0;

  const stateBadge = (s: RecipientResult | undefined) => {
    if (!s || s.state === "pending") return <span className="text-[10px] text-cream-dim">queued</span>;
    if (s.state === "sending") return <div className="h-3 w-3 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />;
    if (s.state === "sent") return <span className="inline-flex items-center gap-0.5 text-[10px] text-signal-emerald"><Check className="h-3 w-3" /> sent</span>;
    if (s.state === "blocked") return <span className="inline-flex items-center gap-0.5 text-[10px] text-signal-rose"><Ban className="h-3 w-3" /> opted out</span>;
    if (s.state === "skipped") return <span className="text-[10px] text-signal-amber">no phone</span>;
    return <span className="inline-flex items-center gap-0.5 text-[10px] text-signal-rose"><AlertTriangle className="h-3 w-3" /> failed</span>;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Recipients */}
      <div className="border-b border-brass/15 px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="ui-label text-[10px] flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Recipients ({recipients.length}{noPhone.length ? ` · ${noPhone.length} without phone` : ""})
          </div>
          {recipients.length > 0 && !running ? (
            <button onClick={onClear} className="text-[11px] text-cream-dim hover:text-cream">Clear all</button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {recipients.length === 0 ? (
            <p className="text-xs text-cream-dim">Tap customers on the left to add them to this batch.</p>
          ) : (
            recipients.map((r) => {
              const key = selectionKey(r);
              const res = results[key];
              return (
                <span
                  key={key}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
                    !r.phone
                      ? "border-signal-amber/40 bg-signal-amber/5 text-signal-amber"
                      : res?.state === "sent"
                        ? "border-signal-emerald/40 bg-signal-emerald/5 text-cream"
                        : res?.state === "failed" || res?.state === "blocked"
                          ? "border-signal-rose/40 bg-signal-rose/5 text-cream"
                          : "border-brass/25 bg-brass/5 text-cream",
                  )}
                  title={res?.detail ?? r.phone ?? "No phone on file"}
                >
                  {r.name}
                  {stateBadge(res)}
                  {!running ? (
                    <button onClick={() => onRemove(key)} className="text-cream-dim hover:text-cream">
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        <div className="flex gap-1.5 flex-wrap">
          {templates.map((t) => (
            <button
              key={t.name}
              disabled={running}
              onClick={() => {
                setActiveTemplate(t.template_name);
                setText(t.resolved_body);
                setResults({});
                setFinished(false);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all",
                activeTemplate === t.template_name
                  ? "border-brass/60 bg-brass/20 text-cream"
                  : "border-brass/20 bg-brass/5 text-cream-muted hover:border-brass/40 hover:text-cream",
              )}
            >
              {t.template_name}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResults({});
            setFinished(false);
          }}
          disabled={running}
          rows={4}
          placeholder="Write one message for everyone — {first_name} personalizes per customer…"
          className={cn(
            "w-full rounded-xl border bg-forest-deep/40 p-3 text-sm text-cream placeholder:text-cream-dim focus:outline-none resize-y transition-colors",
            sharedTokens.length ? "border-signal-amber/60 focus:border-signal-amber" : "border-brass/20 focus:border-brass/50",
          )}
        />

        {sharedTokens.length ? (
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-signal-amber">
            <AlertTriangle className="h-3.5 w-3.5" />
            Fill in before sending:
            {sharedTokens.map((tok) => {
              const input = SHARED_INPUTS[tok.toLowerCase()];
              return input ? (
                <label key={tok} className="inline-flex items-center gap-1.5 rounded-lg border border-signal-amber/40 bg-signal-amber/5 px-2 py-1">
                  <span className="font-mono">{tok}</span>
                  <input
                    type={input.type}
                    placeholder={input.placeholder}
                    onChange={(e) => {
                      if (input.type === "text") return;
                      fillToken(tok, e.target.value, input.type);
                    }}
                    onBlur={(e) => {
                      if (input.type !== "text") return;
                      fillToken(tok, e.target.value.trim(), "text");
                    }}
                    onKeyDown={(e) => {
                      if (input.type === "text" && e.key === "Enter") {
                        fillToken(tok, (e.target as HTMLInputElement).value.trim(), "text");
                      }
                    }}
                    className="bg-forest-deep/60 border border-brass/20 rounded px-1.5 py-0.5 text-[11px] text-cream w-32 focus:outline-none focus:border-brass/50"
                  />
                </label>
              ) : (
                <span key={tok} className="rounded-lg border border-signal-amber/40 bg-signal-amber/5 px-2 py-1 font-mono">{tok}</span>
              );
            })}
          </div>
        ) : null}

        {text.trim() && sendable.length > 0 ? (
          <div className="rounded-xl border border-brass/15 bg-forest-raised/30 p-3">
            <div className="ui-label text-[9px] mb-1.5">Preview — as {sendable[0].name.split(/\s+/)[0]} will receive it</div>
            <p className="text-sm text-cream-muted whitespace-pre-wrap leading-relaxed">{personalize(text.trim(), sendable[0].name)}</p>
          </div>
        ) : null}
      </div>

      {/* Send bar */}
      <div className="border-t border-brass/15 bg-forest-raised/30 backdrop-blur-xl px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-[11px] text-cream-dim">
          {running
            ? `Sending ${doneCount}/${sendable.length}…`
            : finished
              ? `Done — ${sentCount}/${sendable.length} sent${noPhone.length ? `, ${noPhone.length} skipped (no phone)` : ""}`
              : sendable.length
                ? `Will send ${sendable.length} personalized message${sendable.length === 1 ? "" : "s"}`
                : "Add recipients with a phone number"}
        </span>
        {finished && !running ? (
          <button
            onClick={onDone}
            className="inline-flex items-center gap-2 rounded-full border border-brass/30 px-4 py-2 text-xs text-brass-light hover:bg-brass/10 transition-colors"
          >
            Done
          </button>
        ) : (
          <button
            onClick={runBatch}
            disabled={sendDisabled}
            className="inline-flex items-center gap-2 rounded-full bg-brass px-5 py-2 text-sm font-semibold text-forest-deep hover:bg-brass-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running ? (
              <div className="h-3.5 w-3.5 rounded-full border-2 border-forest-deep/40 border-t-forest-deep animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Send to {sendable.length || "…"}
          </button>
        )}
      </div>
    </div>
  );
}
