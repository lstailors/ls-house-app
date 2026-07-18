import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, Send, Sparkles, Type } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DispatchTemplate } from "../../../../backend/src/types";

export type ComposerMode = "template" | "custom" | "sofia";

const MODES: { id: ComposerMode; label: string; icon: any }[] = [
  { id: "template", label: "Template", icon: Type },
  { id: "custom", label: "Write my own", icon: Send },
  { id: "sofia", label: "Tell Sofia", icon: Sparkles },
];

// Composer-supplied merge fields (everything else resolves server-side).
const FIELD_INPUTS: Record<string, { label: string; type: "date" | "time" | "text"; placeholder?: string }> = {
  "{date}": { label: "Date", type: "date" },
  "{time}": { label: "Time", type: "time" },
  "{garment}": { label: "Garment", type: "text", placeholder: "e.g. navy suit" },
};

function findTokens(text: string): string[] {
  return [...new Set(text.match(/\{[a-z_]+\}/gi) ?? [])];
}

function fmtDateToken(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function fmtTimeToken(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

interface Props {
  customerId: string | null;
  disabled: boolean;
  disabledReason: string | null;
  optedOut: boolean;
  sending: boolean;
  composing: boolean;
  onSend: (body: string, mode: "template" | "custom", template?: string) => Promise<boolean>;
  onCompose: (instruction: string) => Promise<boolean>;
}

export function Composer({ customerId, disabled, disabledReason, optedOut, sending, composing, onSend, onCompose }: Props) {
  const [mode, setMode] = useState<ComposerMode>("template");
  const [text, setText] = useState<string>("");
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [instruction, setInstruction] = useState<string>("");

  const { data: templates = [] } = useQuery({
    queryKey: ["dispatch-templates", customerId],
    queryFn: () => api.get<DispatchTemplate[]>(`/api/dispatch/templates${customerId ? `?customer=${encodeURIComponent(customerId)}` : ""}`),
  });

  const tokens = useMemo(() => findTokens(text), [text]);
  const blockedByTokens = mode !== "sofia" && tokens.length > 0;

  const fillToken = (token: string, raw: string, type: "date" | "time" | "text") => {
    if (!raw) return;
    const value = type === "date" ? fmtDateToken(raw) : type === "time" ? fmtTimeToken(raw) : raw;
    setText((t) => t.split(token).join(value));
  };

  const pickTemplate = (t: DispatchTemplate) => {
    setActiveTemplate(t.template_name);
    setText(t.resolved_body);
  };

  const submit = async () => {
    if (mode === "sofia") {
      const ok = await onCompose(instruction.trim());
      if (ok) setInstruction("");
      return;
    }
    const ok = await onSend(text.trim(), mode === "template" ? "template" : "custom", activeTemplate ?? undefined);
    if (ok) {
      setText("");
      setActiveTemplate(null);
    }
  };

  const sendDisabled =
    disabled ||
    sending ||
    composing ||
    (mode === "sofia" ? instruction.trim().length < 3 : text.trim().length === 0 || blockedByTokens);

  return (
    <div className="border-t border-brass/15 bg-forest-raised/30 backdrop-blur-xl p-4 space-y-3">
      {/* Mode switch */}
      <div className="flex items-center gap-1 border border-brass/15 rounded-xl p-1 bg-forest-deep/40 w-fit max-w-full overflow-x-auto">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all",
                active ? "bg-brass/15 text-cream border border-brass/30" : "text-cream-dim hover:text-cream border border-transparent",
              )}
            >
              <Icon className="h-3 w-3" />
              {m.label}
            </button>
          );
        })}
      </div>

      {optedOut ? (
        <div className="flex items-center gap-2 rounded-lg border border-signal-rose/40 bg-signal-rose/10 px-3 py-2 text-xs text-signal-rose">
          <Ban className="h-3.5 w-3.5 shrink-0" />
          This customer texted STOP — sending is blocked until they opt back in.
        </div>
      ) : disabledReason ? (
        <div className="flex items-center gap-2 rounded-lg border border-signal-amber/40 bg-signal-amber/10 px-3 py-2 text-xs text-signal-amber">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {disabledReason}
        </div>
      ) : null}

      {mode === "template" ? (
        <div className="flex gap-1.5 flex-wrap">
          {templates.map((t) => (
            <button
              key={t.name}
              onClick={() => pickTemplate(t)}
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
          {templates.length === 0 ? <span className="text-xs text-cream-dim">No templates enabled.</span> : null}
        </div>
      ) : null}

      {mode === "sofia" ? (
        <div className="space-y-2">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder={'Tell Sofia what to say — e.g. "her navy jacket is ready, get her in Thu or Fri afternoon"'}
            className="w-full rounded-xl border border-brass/20 bg-forest-deep/40 p-3 text-sm text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50 resize-y"
          />
          <p className="text-[10px] text-cream-dim">Sofia writes the message in her voice. Nothing sends until you approve her draft.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (mode === "custom") setActiveTemplate(null);
            }}
            rows={3}
            placeholder={mode === "template" ? "Pick a template above, then adjust before sending…" : "Write the exact message to send…"}
            className={cn(
              "w-full rounded-xl border bg-forest-deep/40 p-3 text-sm text-cream placeholder:text-cream-dim focus:outline-none resize-y transition-colors",
              blockedByTokens ? "border-signal-amber/60 focus:border-signal-amber" : "border-brass/20 focus:border-brass/50",
            )}
          />
          {blockedByTokens ? (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-signal-amber">
              <AlertTriangle className="h-3.5 w-3.5" />
              Fill in before sending:
              {tokens.map((tok) => {
                const input = FIELD_INPUTS[tok.toLowerCase()];
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
                  <span key={tok} className="rounded-lg border border-signal-amber/40 bg-signal-amber/5 px-2 py-1 font-mono">
                    {tok}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] text-cream-dim">
          {mode !== "sofia" && text.length > 0 ? `${text.length} chars${text.length > 160 ? ` · ${Math.ceil(text.length / 153)} segments` : ""}` : ""}
        </span>
        <button
          onClick={submit}
          disabled={sendDisabled}
          className="inline-flex items-center gap-2 rounded-full bg-brass px-5 py-2 text-sm font-semibold text-forest-deep hover:bg-brass-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending || composing ? (
            <div className="h-3.5 w-3.5 rounded-full border-2 border-forest-deep/40 border-t-forest-deep animate-spin" />
          ) : mode === "sofia" ? (
            <Sparkles className="h-3.5 w-3.5" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {mode === "sofia" ? "Ask Sofia to draft" : "Send"}
        </button>
      </div>
    </div>
  );
}
