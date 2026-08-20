import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "@ls/auth/session";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { useState, useCallback, useRef, useEffect } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { useErpHealth } from "@alts/components/ErpStatusBanner";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";
import { UniversalSearchInline } from "@alts/components/UniversalSearch";
import { clientInitials, storeHour } from "@alts/lib/ticketDisplay";
import { formatCompactMoney } from "@alts/lib/money";
import { TileSkeleton } from "@alts/components/skeletons";
import { usePresence } from "@alts/lib/luxuryMotion";
import type { StatusTone } from "@alts/lib/statusTone";
import { useLiveMetrics } from "@alts/lib/useLiveMetrics";
import { NeedsYouNow } from "@alts/components/live/NeedsYouNow";
import { TodayRail } from "@alts/components/live/TodayRail";
import { MoneyStrip } from "@alts/components/live/MoneyStrip";
import { CoverMoneyButton } from "@alts/components/live/CoverMoneyButton";
import { ActivityTicker } from "@alts/components/live/ActivityTicker";
import { TickNumber } from "@alts/components/live/TickNumber";
import { EMPTY_LIVE_HOME } from "@alts/lib/liveDashboard";
import { useShopLink } from "@alts/offline/status";
import { NeedsConnection } from "@alts/components/NeedsConnection";
import { readCoverMoney, writeCoverMoney } from "@alts/lib/coverMoney";
import { canSeeHouseAdmin, houseAdminHref, houseAdminIsExternal } from "@alts/lib/houseAdmin";
import { HouseAdminLink } from "@alts/components/HouseAdminLink";
import { useYzProduction } from "@alts/lib/queries";
import { kpiCounts, yzAsRecord } from "@alts/lib/productionSheet";

const ESPRESSO_OPEN_KEY = "alts.espresso.open";

function peelLeadingIcon(line: string): { icon: string | null; text: string } {
  const m = line.match(/^((?:[\p{Extended_Pictographic}\p{Emoji_Presentation}]|\uFE0F|\u200D)+)\s*(.*)$/u);
  if (m) return { icon: m[1], text: m[2] ?? "" };
  return { icon: null, text: line };
}

function isSignatureLine(line: string) {
  return /^[—–-]\s*Rocco/i.test(line.trim());
}

function isActionLine(line: string) {
  const t = line.trim();
  if (/^(⚡|👉)/u.test(t)) return true;
  if (/\bneeds eyes\b/i.test(t) || /\bChase\b/.test(t)) return true;
  return false;
}

function espressoContentLines(body?: string | null): string[] {
  if (!body) return [];
  return body
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !isSignatureLine(l));
}

function greetingName(name?: string | null) {
  if (!name) return "there";
  return name.split(" ")[0] ?? "there";
}

function timeGreeting() {
  const h = storeHour();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function storeHoursLine() {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date());
  return `${day} · East 61st Street · open until 6:00 PM`;
}

function briefAge(iso?: string | null) {
  if (!iso) return "";
  const raw = iso.includes("T") ? iso : iso.replace(" ", "T");
  // Frappe datetimes are store-local without Z — parse as local-ish
  const ms = Date.parse(raw.endsWith("Z") || /[+\-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}`);
  if (!Number.isFinite(ms)) return "";
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function firstName(full?: string | null) {
  if (!full) return "—";
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts[0] || "—";
}

function shortName(full?: string | null) {
  if (!full) return "Client";
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "Client";
  if (parts.length === 2) return parts.join(" ");
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/** Render Daily Espresso lines — icon column + action brass wash. */
function EspressoBody({ text }: { text: string }) {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return (
    <ul className="espresso-lines m-0 p-0 list-none flex flex-col gap-0">
      {lines.map((line, i) => {
        const sign = isSignatureLine(line);
        if (sign) {
          return (
            <li
              key={`${i}-${line.slice(0, 24)}`}
              className="es-line sign flex justify-end pt-2.5 pb-1 px-1.5 text-[11.5px] italic text-[var(--cd)] border-0"
            >
              <span className="tx">{line}</span>
            </li>
          );
        }
        const { icon, text: rest } = peelLeadingIcon(line);
        const action = isActionLine(line);
        return (
          <li
            key={`${i}-${line.slice(0, 24)}`}
            className={cn(
              "es-line flex items-start gap-2.5 py-[9px] px-1.5 text-[13px] leading-snug text-cream/95 border-b border-brass/[0.08] last:border-b-0",
              action && "es-line-action rounded-[10px] border border-brass/[0.14] bg-[rgba(176,141,87,0.06)] mt-1 border-b-0",
            )}
          >
            <span className="ic w-[22px] shrink-0 text-center text-[14px] leading-tight mt-px" aria-hidden>
              {icon ?? ""}
            </span>
            <span className={cn("tx flex-1 min-w-0", action && "font-semibold text-brass-light")}>
              {rest || line}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function espressoSubline(data?: { fromCache?: boolean; createdAt?: string; body?: string } | null) {
  if (!data) return "Rocco · floor sweep";
  const freshness = data.fromCache ? "cached" : "fresh";
  const age = data.createdAt ? briefAge(data.createdAt) : "";
  return age ? `Rocco · ${freshness} · ${age}` : `Rocco · ${freshness}`;
}

type AskMsg = {
  id: string;
  role: "user" | "rocco" | "error" | "thinking";
  text: string;
  at: number;
};

const ASK_CHIPS: Array<{ label: string; question: string }> = [
  { label: "Most overdue?", question: "Who is most overdue?" },
  { label: "What first?", question: "What should I do first right now?" },
  { label: "Ready rack?", question: "Who is ready for pickup?" },
  { label: "AR chase?", question: "Summarize open AR I should chase today." },
];

const ASK_THREAD_MAX = 6;

function trimAskThread(msgs: AskMsg[]): AskMsg[] {
  const withoutThinking = msgs.filter((m) => m.role !== "thinking");
  if (withoutThinking.length <= ASK_THREAD_MAX) {
    return msgs.slice(-(ASK_THREAD_MAX + 1));
  }
  return withoutThinking.slice(-ASK_THREAD_MAX);
}

function AskRoccoComposer({
  isPending,
  onAsk,
  thread,
  setThread,
  input,
  setInput,
  activeChip,
  setActiveChip,
}: {
  isPending: boolean;
  onAsk: (
    question: string,
    handlers: {
      onSuccess: (data: { answer: string }) => void;
      onError: (err: Error) => void;
    },
  ) => void;
  thread: AskMsg[];
  setThread: React.Dispatch<React.SetStateAction<AskMsg[]>>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  activeChip: string | null;
  setActiveChip: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [thread]);

  const send = useCallback(
    (question: string, chipLabel?: string) => {
      const q = question.trim().slice(0, 240);
      if (!q || isPending) return;

      if (chipLabel) setActiveChip(chipLabel);
      else setActiveChip(null);

      const userMsg: AskMsg = {
        id: `u-${Date.now()}`,
        role: "user",
        text: q,
        at: Date.now(),
      };
      const thinkingMsg: AskMsg = {
        id: `t-${Date.now()}`,
        role: "thinking",
        text: "Checking the floor…",
        at: Date.now(),
      };

      setThread((prev) =>
        trimAskThread([...prev.filter((m) => m.role !== "thinking"), userMsg, thinkingMsg]),
      );
      setInput("");

      onAsk(q, {
        onSuccess: (data) => {
          setThread((prev) =>
            trimAskThread([
              ...prev.filter((m) => m.role !== "thinking"),
              {
                id: `r-${Date.now()}`,
                role: "rocco",
                text: data.answer,
                at: Date.now(),
              },
            ]),
          );
          setActiveChip(null);
        },
        onError: (err) => {
          setThread((prev) =>
            trimAskThread([
              ...prev.filter((m) => m.role !== "thinking"),
              {
                id: `e-${Date.now()}`,
                role: "error",
                text: err.message || "Ask failed",
                at: Date.now(),
              },
            ]),
          );
          setActiveChip(null);
        },
      });
    },
    [isPending, onAsk, setActiveChip, setInput, setThread],
  );

  const canSend = input.trim().length > 0 && !isPending;

  return (
    <div
      className="ask-rocco mt-2.5 pt-3 pb-0.5 border-t border-brass/[0.18] bg-gradient-to-b from-black/12 to-black/22 -mx-1 px-2 sm:px-2.5 rounded-b-[12px]"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[9px] font-bold tracking-[0.16em] uppercase text-brass-light">
          Ask Rocco
        </span>
        <span className="text-[10.5px] font-medium text-[var(--cd)] normal-case tracking-normal">
          · floor only
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {ASK_CHIPS.map((chip) => {
          const on = activeChip === chip.label && isPending;
          return (
            <button
              key={chip.label}
              type="button"
              disabled={isPending}
              onClick={(e) => {
                e.stopPropagation();
                send(chip.question, chip.label);
              }}
              className={cn(
                "h-8 min-h-[32px] px-2.5 sm:px-3 rounded-full border text-[11px] font-semibold transition-colors",
                "border-brass/28 bg-black/25 text-cream/80",
                "hover:border-brass/55 hover:bg-brass/14 hover:text-cream",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                on && "border-brass/55 bg-brass/14 text-cream",
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {thread.length > 0 && (
        <div className="flex flex-col gap-2 mb-2.5 max-h-[220px] overflow-y-auto" aria-live="polite">
          {thread.map((m) => {
            if (m.role === "user") {
              return (
                <div
                  key={m.id}
                  className="self-end max-w-[92%] rounded-[14px] px-3 py-2.5 text-[12.5px] leading-snug bg-brass/16 border border-brass/35 text-cream"
                >
                  <div className="text-[9px] font-bold tracking-[0.12em] uppercase text-brass-light mb-1">
                    You
                  </div>
                  <div className="whitespace-pre-wrap">{m.text}</div>
                </div>
              );
            }
            if (m.role === "thinking") {
              return (
                <div
                  key={m.id}
                  className="self-stretch rounded-[14px] px-3 py-2.5 text-[12.5px] leading-snug italic text-[var(--cd)] bg-black/28 border border-brass/20"
                >
                  {m.text}
                </div>
              );
            }
            if (m.role === "error") {
              return (
                <div
                  key={m.id}
                  className="self-stretch rounded-[14px] px-3 py-2.5 text-[12.5px] leading-snug text-[var(--am)] bg-black/28 border border-[rgba(232,168,92,0.4)]"
                >
                  {m.text}
                </div>
              );
            }
            return (
              <div
                key={m.id}
                className="self-stretch rounded-[14px] px-3 py-2.5 text-[12.5px] leading-snug bg-black/28 border border-brass/20"
              >
                <div className="text-[9px] font-bold tracking-[0.12em] uppercase text-brass-light mb-1.5">
                  Rocco
                </div>
                <div className="whitespace-pre-wrap text-cream">{m.text}</div>
              </div>
            );
          })}
          <div ref={threadEndRef} />
        </div>
      )}

      <div className="flex gap-2 items-end">
        <input
          type="text"
          value={input}
          maxLength={240}
          disabled={isPending}
          placeholder="Ask about the floor…"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && canSend) {
              e.preventDefault();
              send(input);
            }
          }}
          className={cn(
            "flex-1 h-[46px] min-h-[46px] rounded-[14px] px-3.5 text-[14px] outline-none",
            "bg-black/40 border border-brass/32 text-cream placeholder:text-[var(--cd)]",
            "focus:border-brass focus:shadow-[0_0_0_3px_rgba(176,141,87,0.14)]",
            "disabled:opacity-60 appearance-none",
          )}
        />
        <button
          type="button"
          disabled={!canSend}
          onClick={(e) => {
            e.stopPropagation();
            send(input);
          }}
          className={cn(
            "h-[46px] min-h-[46px] min-w-[46px] px-3.5 rounded-[14px] shrink-0",
            "bg-brass text-[#0D1A10] text-[11px] font-bold tracking-[0.12em] uppercase",
            "shadow-[0_8px_20px_rgba(176,141,87,0.25)]",
            "disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none",
            "enabled:hover:brightness-950",
          )}
        >
          Ask
        </button>
      </div>

      <p className="text-[10px] text-[var(--cd)] mt-2 leading-snug">
        Answers from live floor snapshot + this espresso. Not a general chat.
      </p>
    </div>
  );
}
