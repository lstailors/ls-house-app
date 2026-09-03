import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "@ls/auth/session";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
import { FloorCommandStrip } from "@alts/components/live/FloorCommandStrip";
import { TodayRail } from "@alts/components/live/TodayRail";
import { MoneyStrip } from "@alts/components/live/MoneyStrip";
import { CoverMoneyButton } from "@alts/components/live/CoverMoneyButton";
import { StatusPipeline } from "@alts/components/live/StatusPipeline";
import { ActivityTicker } from "@alts/components/live/ActivityTicker";
import { TickNumber } from "@alts/components/live/TickNumber";
import { EMPTY_LIVE_HOME } from "@alts/lib/liveDashboard";
import { useShopLink } from "@alts/offline/status";
import { NeedsConnection } from "@alts/components/NeedsConnection";
import { readCoverMoney, writeCoverMoney } from "@alts/lib/coverMoney";
import { canSeeHouseAdmin, houseAdminHref, houseAdminIsExternal } from "@alts/lib/houseAdmin";
import { HouseAdminLink } from "@alts/components/HouseAdminLink";

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
  const ms = Date.parse(raw.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}`);
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

/** Minutes-from-midnight → 12h label for header next-up. */
function clockish(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 || 12;
  const ap = h < 12 ? "a" : "p";
  if (m === 0) return `${h12}${ap}`;
  return `${h12}:${String(m).padStart(2, "0")}${ap}`;
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

type EspressoFeedItem = {
  id: string;
  text: string;
  meta?: string;
  href?: string;
  tone?: "default" | "hot" | "warn" | "good";
};

function EspressoFeed({
  items,
  title,
}: {
  items: EspressoFeedItem[];
  title: string;
}) {
  return (
    <div className="espresso-feed-block">
      <div className="espresso-feed-h">{title}</div>
      {items.length === 0 ? (
        <div className="espresso-feed-empty">Nothing here yet.</div>
      ) : (
        <ul className="espresso-feed-list">
          {items.map((it) => {
            const body = (
              <>
                <span className={cn("ef-dot", it.tone && it.tone !== "default" && `is-${it.tone}`)} aria-hidden />
                <span className="ef-body">
                  <span className="ef-text">{it.text}</span>
                  {it.meta ? <span className="ef-meta">{it.meta}</span> : null}
                </span>
              </>
            );
            if (it.href) {
              return (
                <li key={it.id}>
                  <Link to={it.href} className={cn("espresso-feed-item", it.tone && `is-${it.tone}`)}>
                    {body}
                  </Link>
                </li>
              );
            }
            return (
              <li key={it.id} className={cn("espresso-feed-item", it.tone && `is-${it.tone}`)}>
                {body}
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
            "enabled:hover:brightness-105",
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

type LiveTone = "em" | "am" | "ro" | "cd" | null;

type TileDef = {
  key: string;
  to?: string;
  href?: string;
  sameWindow?: boolean;
  title: string;
  sub: string;
  /** lg = hero FOH tile; sm = compact bar */
  size?: "lg" | "sm";
  /** desk: span N columns (Fabric Library hero) */
  colSpan?: 1 | 2;
  primary?: boolean;
  admin?: boolean;
  dim?: boolean;
  badge?: React.ReactNode;
  badgeKind?: StatusTone | "money";
  live?: React.ReactNode;
  liveTone?: LiveTone;
  icon: React.ReactNode;
};

function LiveDot({ tone }: { tone?: LiveTone }) {
  const t = tone ?? "em";
  return (
    <span
      className={cn(
        "home-live-dot",
        t === "am" && "is-am",
        t === "ro" && "is-ro",
        t === "cd" && "is-cd",
      )}
      aria-hidden
    />
  );
}

function readEspressoOpenDefault(): boolean {
  try {
    const v = localStorage.getItem(ESPRESSO_OPEN_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* private mode */
  }
  return false;
}

export default function HomeTiles() {
  const { data: me } = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const erpHealth = useErpHealth();
  const [params] = useSearchParams();
  const kiosk = params.get("kiosk") === "1";
  const live = useLiveMetrics();
  const [espressoOpen, setEspressoOpen] = useState(readEspressoOpenDefault);
  const [coverMoney, setCoverMoney] = useState(readCoverMoney);
  const espressoMotion = usePresence(espressoOpen);
  const [askThread, setAskThread] = useState<AskMsg[]>([]);
  const [askInput, setAskInput] = useState("");
  const [askActiveChip, setAskActiveChip] = useState<string | null>(null);

  // iPhone Safari keeps the old layout box until a tick after rotate.
  useEffect(() => {
    const bump = () => {
      requestAnimationFrame(() => {
        window.scrollTo(0, window.scrollY);
      });
    };
    window.addEventListener("orientationchange", bump);
    window.visualViewport?.addEventListener("resize", bump);
    return () => {
      window.removeEventListener("orientationchange", bump);
      window.visualViewport?.removeEventListener("resize", bump);
    };
  }, []);

  const toggleEspresso = useCallback(() => {
    setEspressoOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ESPRESSO_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleCoverMoney = useCallback(() => {
    setCoverMoney((prev) => {
      const next = !prev;
      writeCoverMoney(next);
      return next;
    });
  }, []);

  const home = live;
  const shop = useShopLink();
  const erpDown = Boolean(erpHealth.data && !erpHealth.data.erp.reachable);
  const offline = shop === "offline" || live.status === "offline";

  type FloorBrief = {
    body: string;
    title: string;
    stats?: Record<string, number>;
    createdAt: string;
    fromCache: boolean;
  };

  const floorBrief = useQuery({
    queryKey: ["alts-floor-brief"],
    queryFn: async (): Promise<FloorBrief> => {
      const res = await api.raw("/api/dashboard/floor-brief");
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(j?.error?.message || "Floor brief failed");
      return (j?.data ?? j) as FloorBrief;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: 1,
  });

  const refreshBrief = useMutation({
    mutationFn: async () => {
      const res = await api.raw("/api/dashboard/floor-brief/refresh", { method: "POST" });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(j?.error?.message || "Refresh failed");
      return (j?.data ?? j) as FloorBrief;
    },
    onSuccess: (data) => {
      qc.setQueryData(["alts-floor-brief"], data);
    },
  });

  type WeatherReading = { temp: number; weathercode: number; description: string };
  const weather = useQuery({
    queryKey: ["alts-home-weather"],
    queryFn: async (): Promise<WeatherReading | null> => {
      const res = await api.raw("/api/espresso");
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) return null;
      return ((j?.data ?? j)?.weather as WeatherReading) ?? null;
    },
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: 1,
  });
  const weatherEmoji = (code: number | undefined) => {
    if (code == null) return "☀️";
    if (code <= 1) return "☀️";
    if (code === 2) return "🌤";
    if (code === 3) return "☁️";
    if (code >= 45 && code <= 48) return "🌫";
    if (code >= 51 && code <= 67) return "🌧";
    if (code >= 71 && code <= 77) return "❄️";
    if (code >= 80 && code <= 82) return "🌦";
    if (code >= 95 && code <= 99) return "⛈";
    return "☀️";
  };

  const askRocco = useMutation({
    mutationFn: async (question: string) => {
      const res = await api.raw("/api/dashboard/floor-brief/ask", {
        method: "POST",
        body: JSON.stringify({ question }),
        headers: { "Content-Type": "application/json" },
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(j?.error?.message || "Ask failed");
      return (j?.data ?? j) as { answer: string; askedAt?: string; model?: string };
    },
  });

  const runAskRocco = useCallback(
    (
      question: string,
      handlers: {
        onSuccess: (data: { answer: string }) => void;
        onError: (err: Error) => void;
      },
    ) => {
      askRocco.mutate(question, {
        onSuccess: handlers.onSuccess,
        onError: (err) => handlers.onError(err instanceof Error ? err : new Error(String(err))),
      });
    },
    [askRocco],
  );

  const feed = home.data;
  const c = feed?.counts;
  const strip = feed?.strip;
  const feeds = feed?.feeds;
  const conflictCount = c?.doubleBookedSlots ?? 0;
  const firstConflict = feeds?.conflictDetails?.[0];

  const syncAge = live.ageLabel;

  const initials = clientInitials(me?.name ?? "LS");
  const canQc = me?.role === "super_admin" || me?.role === "tailor";
  const canAdmin = canSeeHouseAdmin(me?.role);
  const hour = storeHour();
  const ambient = kiosk && (hour >= 18 || hour < 9);
  const board = feed ?? EMPTY_LIVE_HOME;
  const pulse = live.pulsed;

  // Header center: live NYC clock
  const [storeClock, setStoreClock] = useState(() => {
    const d = new Date();
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
    return { label, nowMin: storeHour() * 60 + d.getMinutes() };
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(d);
      const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
      const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(d);
      setStoreClock({ label, nowMin: h * 60 + m });
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, []);

  /** Next appointment or must-leave after now — fills header dead space. */
  const headerNext = useMemo(() => {
    const now = storeClock.nowMin;
    const rail = board.todayRail;
    type Cand = { when: string; who: string; href: string; kind: string; tone: "default" | "warn" | "good"; minutes: number; detail: string };
    const cands: Cand[] = [];
    for (const a of rail.appointments ?? []) {
      if (a.minutes + 20 < now) continue;
      cands.push({
        minutes: a.minutes,
        when: clockish(a.minutes),
        who: shortName(a.label),
        href: a.href || "/appointments",
        kind: "Appt",
        tone: "default",
        detail: a.label,
      });
    }
    for (const d of rail.dueOuts ?? []) {
      if (d.minutes + 15 < now) continue;
      cands.push({
        minutes: d.minutes,
        when: clockish(d.minutes),
        who: shortName(d.label),
        href: d.href || "/shop-floor?filter=today",
        kind: "Due",
        tone: "warn",
        detail: d.label,
      });
    }
    for (const del of rail.deliveries ?? []) {
      if (del.minutes + 15 < now) continue;
      cands.push({
        minutes: del.minutes,
        when: clockish(del.minutes),
        who: shortName(del.label),
        href: del.href || "/deliveries",
        kind: "Run",
        tone: "good",
        detail: del.label,
      });
    }
    cands.sort((a, b) => a.minutes - b.minutes);
    if (cands[0]) return cands[0];
    const next = feed?.glimpses?.appointments?.next;
    if (next) {
      return {
        when: next.time,
        who: shortName(next.client),
        href: "/appointments",
        kind: next.type ? String(next.type).slice(0, 8) : "Appt",
        tone: "default" as const,
        detail: `${next.time} · ${next.client}`,
        minutes: now,
      };
    }
    return null;
  }, [board.todayRail, storeClock.nowMin, feed?.glimpses?.appointments?.next]);

  const espressoLiveItems = useMemo((): EspressoFeedItem[] => {
    const out: EspressoFeedItem[] = [];
    for (const ex of board.exceptions.slice(0, 6)) {
      out.push({
        id: `ex-${ex.id}`,
        text: `${ex.icon ? `${ex.icon} ` : ""}${ex.name}`,
        meta: [ex.subtitle, ex.number].filter(Boolean).join(" · ") || ex.action,
        href: ex.href,
        tone: ex.severity === "urgent" ? "hot" : "warn",
      });
    }
    for (const ev of board.activity.slice(0, 8)) {
      out.push({
        id: `act-${ev.id}`,
        text: coverMoney ? String(ev.text).replace(/\$[\d,.]+/g, "••") : ev.text,
        meta: ev.at,
        href: ev.href,
        tone: "default",
      });
    }
    // Desk pulse when live feed is thin
    if (out.length < 3) {
      const chips = board.todayRail.chips;
      if (chips.comingIn > 0) {
        out.push({
          id: "desk-coming",
          text: `${chips.comingIn} coming in today`,
          meta: "Appointments",
          href: "/appointments",
        });
      }
      if (chips.mustLeave > 0) {
        out.push({
          id: "desk-leave",
          text: `${chips.mustLeave} must leave today`,
          meta: "Promised due",
          href: "/shop-floor?filter=today",
          tone: "warn",
        });
      }
      if ((c?.readyNotTexted ?? 0) > 0) {
        out.push({
          id: "desk-text",
          text: `${c!.readyNotTexted} ready · need text`,
          meta: "Pickup",
          href: "/shop-floor?filter=text",
          tone: "warn",
        });
      }
      if ((c?.stalledCount ?? 0) > 0) {
        out.push({
          id: "desk-stalled",
          text: `${c!.stalledCount} stalled on floor`,
          meta: "Shop floor",
          href: "/shop-floor?filter=stalled",
          tone: "hot",
        });
      }
      if ((strip?.overdue ?? 0) > 0) {
        out.push({
          id: "desk-overdue",
          text: `${strip!.overdue} overdue`,
          meta: "Shop floor",
          href: "/shop-floor?filter=overdue",
          tone: "hot",
        });
      }
    }
    // de-dupe by id
    const seen = new Set<string>();
    return out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).slice(0, 12);
  }, [board.exceptions, board.activity, board.todayRail.chips, c, strip, coverMoney]);

  const espressoBriefItems = useMemo((): EspressoFeedItem[] => {
    const body = floorBrief.data?.body;
    if (!body) return [];
    return espressoContentLines(body)
      .filter((l) => !isSignatureLine(l))
      .slice(0, 10)
      .map((line, i) => {
        const { icon, text } = peelLeadingIcon(line);
        return {
          id: `brief-${i}`,
          text: text || line,
          meta: icon || undefined,
          tone: isActionLine(line) ? ("warn" as const) : ("default" as const),
        };
      });
  }, [floorBrief.data?.body]);

  const lastTicketLive = (() => {
    const t = feeds?.lastTicket;
    if (!t) return { text: "No tickets yet", tone: "cd" as LiveTone };
    const age = briefAge(t.createdAt);
    const who = shortName(t.customerName);
    return {
      text: (
        <>
          <b>{who}</b>
          {age ? ` · ${age}` : ""}
        </>
      ),
      tone: "em" as LiveTone,
    };
  })();

  const shopLive = (() => {
    const ip = c?.inProgress ?? 0;
    const ah = c?.atHome ?? 0;
    const stalled = c?.stalledCount ?? 0;
    if (stalled > 0) {
      const reasons = feeds?.stalledReasons ?? {};
      const topReasons = Object.entries(reasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([r]) => r)
        .join(" / ");
      return {
        text: (
          <>
            <b>{stalled}</b> stalled{topReasons ? ` · ${topReasons}` : ""}{" "}
            · <b>{ip}</b> in prog
          </>
        ),
        tone: "ro" as LiveTone,
      };
    }
    const tone: LiveTone = ip > 0 || ah > 0 ? "am" : "em";
    return {
      text: (
        <>
          <b>{ip}</b> in progress · <b>{ah}</b> at home
        </>
      ),
      tone,
    };
  })();

  const progressLive = (() => {
    const p = feeds?.lastProgress;
    if (!p) return { text: "No completions yet", tone: "cd" as LiveTone };
    const age = briefAge(p.completedAt);
    const who = firstName(p.workerName);
    const g = (p.garmentLabel || "garment").toString().split(/\s+/)[0];
    return {
      text: (
        <>
          <b>{who}</b> · {g}
          {age ? ` · ${age}` : ""}
        </>
      ),
      tone: "em" as LiveTone,
    };
  })();

  const pickupLive = (() => {
    const n = c?.readyNotTexted ?? 0;
    if (n <= 0) {
      return {
        text: c?.ready ? (
          <>
            <b>{c.ready}</b> ready · all texted
          </>
        ) : (
          "Nothing on the rack"
        ),
        tone: (c?.ready ? "em" : "cd") as LiveTone,
      };
    }
    return {
      text: (
        <>
          <b>{n}</b> ready · not texted
        </>
      ),
      tone: "am" as LiveTone,
    };
  })();

  const xferLive = (() => {
    const n = c?.lateTransferCount ?? 0;
    const names = feeds?.lateTransferNames ?? [];
    if (n <= 0) {
      const ah = c?.atHome ?? 0;
      return {
        text: ah > 0 ? (
          <>
            <b>{ah}</b> at home · on time
          </>
        ) : (
          "No work at home"
        ),
        tone: (ah > 0 ? "em" : "cd") as LiveTone,
      };
    }
    const label = names.map(firstName).slice(0, 2).join(", ");
    return {
      text: (
        <>
          <b>{n}</b> late{label ? ` · ${label}` : ""}
        </>
      ),
      tone: "ro" as LiveTone,
    };
  })();

  const findLive = {
    text: (
      <>
        <b>{c?.open ?? 0}</b> open on file
      </>
    ),
    tone: ((c?.open ?? 0) > 0 ? "em" : "cd") as LiveTone,
  };

  const delivLive = (() => {
    const n = c?.pendingBoard ?? 0;
    if (n <= 0) return { text: "No active runs", tone: "cd" as LiveTone };
    return {
      text: (
        <>
          <b>{n}</b> on board
          {(strip?.outForDelivery ?? 0) > 0 ? (
            <>
              {" "}
              · <b>{strip!.outForDelivery}</b> out
            </>
          ) : null}
        </>
      ),
      tone: (strip?.outForDelivery ?? 0) > 0 ? ("am" as LiveTone) : ("em" as LiveTone),
    };
  })();

  const custLive = (() => {
    const t = feeds?.lastTouchedCustomer;
    if (!t) return { text: "No recent edits", tone: "cd" as LiveTone };
    const age = briefAge(t.modified);
    return {
      text: (
        <>
          <b>{shortName(t.name)}</b>
          {age ? ` · ${age}` : ""}
        </>
      ),
      tone: "em" as LiveTone,
    };
  })();

  const invLive = (() => {
    const n = c?.openInvoices ?? 0;
    const oldest = c?.oldestUnpaidDays;
    if (n <= 0) return { text: "All clear", tone: "cd" as LiveTone, href: "/invoices" };
    return {
      text: (
        <>
          <b>{n}</b> unpaid
          {oldest != null ? ` · ${oldest}d oldest` : ""}
        </>
      ),
      tone: n > 0 ? ("am" as LiveTone) : ("em" as LiveTone),
      href: c?.oldestUnpaidInvoiceId
        ? `/invoices/${encodeURIComponent(c.oldestUnpaidInvoiceId)}`
        : "/invoices",
    };
  })();

  const apptLive = (() => {
    if (conflictCount > 0) {
      const tailorLabel = firstConflict?.tailor ? ` · ${firstConflict.tailor}` : "";
      return {
        text: (
          <>
            <b>{conflictCount}</b> conflict{conflictCount > 1 ? "s" : ""}{tailorLabel}
          </>
        ),
        tone: "ro" as LiveTone,
      };
    }
    return { text: "No conflicts", tone: "em" as LiveTone };
  })();

  const moneyBadge =
    (c?.openInvoices ?? 0) > 0
      ? coverMoney
        ? `${c!.openInvoices} unpaid`
        : `${c!.openInvoices} · ${formatCompactMoney(c!.openInvoicesAmount)}`
      : null;

  const tiles: TileDef[] = [
    {
      key: "pickup",
      size: "sm",
      to: "/pickup",
      title: "Pickup",
      sub: feed?.glimpses.pickup.names.length
        ? feed.glimpses.pickup.names.map((n) => `${n.name}${n.texted ? " ✓" : ""}`).join(" · ")
        : "Hand back · settle",
      badge: c?.ready || null,
      badgeKind: "pickup",
      live: pickupLive.text,
      liveTone: pickupLive.tone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M26 6a5 5 0 0 0-5 5c0 2.5 2 3.6 3.6 4.4L9 25.5a3 3 0 0 0-1.5 2.6V31a2 2 0 0 0 2 2h33a2 2 0 0 0 2-2v-2.9a3 3 0 0 0-1.5-2.6L27.4 15.4C29 14.6 31 13.5 31 11a5 5 0 0 0-5-5z" />
          <path d="M40 41l4 4 7-8" stroke="#4FBF8E" strokeWidth="2" />
        </svg>
      ),
    },
    {
      key: "parked",
      size: "sm",
      to: "/parked",
      title: "Parked",
      sub: "Held carts · resume · no #",
      primary: false,
      live: "Retrieve held work",
      liveTone: "em" as LiveTone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 14h28v24H12z" />
          <path d="M18 14V10h16v4" />
          <path d="M20 24h12M20 30h8" />
        </svg>
      ),
    },
    {
      key: "progress",
      size: "sm",
      to: "/progress",
      title: "Mark Progress",
      sub: "Board · scan · notes",
      live: progressLive.text,
      liveTone: progressLive.tone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M28 5H11a3 3 0 0 0-3 3v36a3 3 0 0 0 3 3h24a3 3 0 0 0 3-3V15z" />
          <path d="M28 5v10h10" />
          <path d="M17 34l4 4 8-9" stroke="#4FBF8E" strokeWidth="2" />
        </svg>
      ),
    },
    {
      key: "lookup",
      size: "sm",
      to: "/lookup",
      title: "Find a Ticket",
      sub: "Name · phone · tag",
      live: findLive.text,
      liveTone: findLive.tone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="22" cy="22" r="14" />
          <path d="M32.5 32.5L46 46" strokeWidth="2" />
        </svg>
      ),
    },
    {
      key: "deliveries",
      size: "sm",
      to: "/deliveries",
      title: "Deliveries",
      sub: `Queued ${feed?.glimpses.deliveries.queued ?? 0} · Out ${feed?.glimpses.deliveries.out ?? 0} · ✓ ${feed?.glimpses.deliveries.deliveredToday ?? 0}`,
      badge: c?.pendingBoard || null,
      badgeKind: "shop",
      dim: (c?.pendingBoard ?? 0) === 0,
      live: delivLive.text,
      liveTone: delivLive.tone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 30l10-15h16l10 15v10a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" />
          <path d="M6 30h36" strokeWidth="1.4" />
        </svg>
      ),
    },
    {
      key: "customers",
      size: "sm",
      to: "/customers",
      title: "Customers",
      sub: "Profiles · phones",
      live: custLive.text,
      liveTone: custLive.tone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="16" r="7" />
          <path d="M6 40c0-8 5-13 12-13s12 5 12 13" strokeWidth="1.5" />
          <circle cx="37" cy="18" r="5.5" opacity=".75" />
          <path d="M30 40c0-6 3.5-10 9-10" opacity=".75" />
        </svg>
      ),
    },
    {
      key: "all-orders",
      size: "sm",
      to: "/orders",
      title: "All orders",
      sub: "Alts · MTM · lights",
      live: "Desk list",
      liveTone: "em",
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 12h36M8 26h36M8 40h24" />
          <circle cx="40" cy="40" r="5" />
        </svg>
      ),
    },
    {
      key: "invoices",
      size: "sm",
      to: c?.oldestUnpaidInvoiceId
        ? `/invoices/${encodeURIComponent(c.oldestUnpaidInvoiceId)}`
        : "/invoices",
      title: "Invoices",
      sub: `${feed?.glimpses.invoices.unpaid ?? 0} unpaid`,
      badge: moneyBadge,
      badgeKind: "qc",
      live: invLive.text,
      liveTone: invLive.tone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5h20l8 8v34a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
          <path d="M32 5v8h8" />
          <path d="M16 26h6M16 32h6" strokeWidth="1.4" />
        </svg>
      ),
    },
    {
      key: "transfers",
      size: "sm",
      to: "/transfers",
      title: "Transfers",
      sub: "Send · take back home",
      live: xferLive.text,
      liveTone: xferLive.tone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="14" width="19" height="15" rx="2.5" />
          <rect x="29" y="26" width="19" height="15" rx="2.5" />
          <path d="M27 10h13M35 5l5 5-5 5" />
        </svg>
      ),
    },
    {
      key: "appointments",
      size: "sm",
      to: "/appointments",
      title: "Appointments",
      sub: feed?.glimpses.appointments.next
        ? `${feed.glimpses.appointments.next.time} · ${feed.glimpses.appointments.next.type} · ${feed.glimpses.appointments.next.client}`
        : conflictCount > 0
          ? `${conflictCount} conflict${conflictCount > 1 ? "s" : ""} · 7 days`
          : "Today · week · house",
      badge: conflictCount > 0 ? conflictCount : null,
      badgeKind: "tasks" as const,
      live: apptLive.text,
      liveTone: apptLive.tone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="10" width="40" height="36" rx="3" />
          <path d="M6 20h40" strokeWidth="1.4" />
          <path d="M17 6v8M35 6v8" />
          <circle cx="26" cy="33" r="5" strokeWidth="1.4" />
          {conflictCount > 0 && (
            <path d="M26 30v4M26 36v1" stroke="#E85050" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      ),
    },
    {
      key: "stock",
      size: "sm",
      to: "/stock",
      title: "Stock",
      sub: "Remnants · use to remove",
      primary: false,
      live: (
        <>
          <b>Gallery</b> · lining · bolts
        </>
      ),
      liveTone: "em",
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="10" width="18" height="24" rx="2.5" />
          <rect x="28" y="16" width="18" height="24" rx="2.5" />
          <path d="M10 18h10M10 24h8" strokeWidth="1.3" />
        </svg>
      ),
    },
    {
      key: "fabric-library",
      size: "lg",
      colSpan: 2,
      to: "/wardrobe",
      title: "Fabric Library",
      sub: "Client closet · mill · photo · history",
      primary: true,
      live: (
        <>
          <b>Wardrobe</b> · search client
        </>
      ),
      liveTone: "em",
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 8h22a4 4 0 0 1 4 4v32a3 3 0 0 0-3-3H10a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" />
          <path d="M36 12h6a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H33a3 3 0 0 1 3-3V12z" opacity=".85" />
          <path d="M14 18h12M14 24h10M14 30h8" strokeWidth="1.3" />
          <circle cx="40" cy="28" r="5" strokeWidth="1.4" />
        </svg>
      ),
    },
    {
      key: "qc",
      size: "sm",
      to: "/qc",
      title: "QC",
      sub:
        (feed?.glimpses.qc.waiting ?? 0) > 0
          ? `${feed!.glimpses.qc.waiting} waiting · ${feed!.glimpses.qc.passRateWeek}% week`
          : `${feed?.glimpses.qc.passRateWeek ?? 100}% pass this week`,
      badge: feed?.glimpses.qc.waiting || null,
      badgeKind: "qc",
      live:
        (feed?.glimpses.qc.waiting ?? 0) > 0 ? (
          <>
            <b>{feed!.glimpses.qc.waiting}</b> waiting · {feed!.glimpses.qc.passRateWeek}% week
          </>
        ) : (
          `${feed?.glimpses.qc.passRateWeek ?? 100}% pass this week`
        ),
      liveTone: (feed?.glimpses.qc.waiting ?? 0) > 0 ? "am" : "em",
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="26" cy="26" r="18" />
          <path d="M16 27l7 7 14-16" strokeWidth="2" />
        </svg>
      ),
    },
    {
      key: "tasks",
      size: "sm",
      to: "/tasks",
      title: "Tasks",
      sub:
        (feed?.glimpses.tasks.open ?? 0) > 0
          ? `${feed!.glimpses.tasks.open} open${feed!.glimpses.tasks.trend === "up" ? " ↑" : feed!.glimpses.tasks.trend === "down" ? " ↓" : ""}`
          : "House list",
      badge: feed?.glimpses.tasks.open || null,
      badgeKind: "tasks",
      live:
        (feed?.glimpses.tasks.open ?? 0) > 0 ? (
          <>
            <b>{feed!.glimpses.tasks.open}</b> open
            {feed!.glimpses.tasks.trend === "up" ? " ↑" : feed!.glimpses.tasks.trend === "down" ? " ↓" : ""}
          </>
        ) : (
          "All clear"
        ),
      liveTone: (feed?.metrics.tasks.overdue ?? 0) > 0 ? "ro" : (feed?.glimpses.tasks.open ?? 0) > 0 ? "em" : "cd",
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="8" y="8" width="36" height="36" rx="4" />
          <path d="M16 26l7 7 13-14" strokeWidth="2" />
        </svg>
      ),
    },
    {
      key: "new",
      size: "lg",
      to: "/intake/kind",
      title: "New Ticket",
      sub: "Walk-in · parked · custom · re-do",
      primary: true,
      live: lastTicketLive.text,
      liveTone: lastTicketLive.tone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M28 5H11a3 3 0 0 0-3 3v36a3 3 0 0 0 3 3h24a3 3 0 0 0 3-3V15z" />
          <path d="M28 5v10h10" />
          <path d="M16 25h14M16 32h14M16 39h8" />
          <circle cx="39" cy="38" r="9" strokeWidth="1.4" />
          <path d="M39 34v8M35 38h8" strokeWidth="1.4" />
        </svg>
      ),
    },
    {
      key: "messages",
      size: "lg",
      to: "/messages",
      title: "Messages",
      sub: feed?.glimpses.messages.preview
        ? `${feed.glimpses.messages.sender ?? "Inbox"} · ${feed.glimpses.messages.preview}`
        : "Texts · calls",
      live: feed?.glimpses.messages.unread
        ? `${feed.glimpses.messages.unread} unread`
        : "Inbox",
      liveTone: "em",
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="12" width="40" height="28" rx="4" />
          <path d="M6 16l20 14L46 16" />
        </svg>
      ),
    },
    {
      key: "floor",
      size: "lg",
      primary: true,
      to: "/shop-floor",
      title: "Shop Floor",
      sub: feed?.glimpses.floor.tailors.length
        ? feed.glimpses.floor.tailors
            .slice(0, 4)
            .map((t) => `${t.name} ${t.inProgress}${t.stalled ? "!" : ""}`)
            .join(" · ")
        : `${c?.openGarments ?? c?.open ?? 0} pcs · ${c?.ready ?? 0} ready`,
      badge: c?.open || null,
      badgeKind: "shop",
      live: shopLive.text,
      liveTone: shopLive.tone,
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="9" width="12" height="34" rx="2.5" />
          <rect x="20" y="9" width="12" height="34" rx="2.5" />
          <rect x="35" y="9" width="12" height="34" rx="2.5" />
        </svg>
      ),
    },
    {
      key: "house",
      size: "lg",
      to: "/house",
      title: "House orders",
      sub: "RTW · alts · MTM Pro",
      live: "Find a make",
      liveTone: "em",
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 22L26 8l18 14v20a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" />
          <path d="M20 45V30h12v15" />
        </svg>
      ),
    },
    {
      key: "reports",
      size: "lg",
      to: "/reports",
      title: "Floor Reports",
      sub: coverMoney ? "Pipeline · tally" : "Pipeline · tally · $",
      live: "On this phone",
      liveTone: "em",
      icon: (
        <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 44h40" strokeWidth="1.6" />
          <rect x="10" y="28" width="8" height="16" rx="1.5" />
          <rect x="22" y="18" width="8" height="26" rx="1.5" />
          <rect x="34" y="24" width="8" height="20" rx="1.5" />
        </svg>
      ),
    },
  ];

  return (
    <div
      className={cn(
        "alts-root home-040 flex flex-col min-h-dvh overflow-x-hidden px-[12px] sm:px-[18px] pt-[max(8px,env(safe-area-inset-top))] pb-[max(4.75rem,env(safe-area-inset-bottom))] gap-2",
        kiosk && "is-kiosk",
        ambient && "is-ambient",
        coverMoney && "is-cover-money",
      )}
    >
      {/* Header — seal, brand, search, loc, weather, avatar */}
      <header className="home-040-hd flex items-center gap-2 sm:gap-3 shrink-0 min-w-0 flex-wrap">
        <BrandSeal className="shrink-0" size={34} />
        <div className="min-w-0 hidden sm:block shrink-0">
          <div className="display text-[24px] leading-tight">L&S House</div>
          <div className="text-[11px] tracking-[0.16em] uppercase text-[var(--cd)]">Alterations</div>
        </div>
        {canAdmin && !kiosk && (
          <HouseAdminLink className="h-9 px-4 rounded-full bg-brass text-[#0D1A10] text-[11px] font-bold tracking-[0.14em] uppercase shrink-0 inline-flex items-center">
            Admin
          </HouseAdminLink>
        )}
        {!kiosk && <UniversalSearchInline className="mx-0.5 sm:mx-1 flex-1 min-w-0 max-w-[min(100%,320px)]" />}
        {/* Header center — store clock + next up (fills the dead green) */}
        <div className="home-hd-mid hidden md:flex flex-1 min-w-0 items-center justify-center gap-2 px-1">
          <div className="home-hd-clock shrink-0" aria-live="polite" title="Store time · New York">
            <b className="display tabular-nums">{storeClock.label}</b>
            <span>NYC</span>
          </div>
          {headerNext ? (
            <Link
              to={headerNext.href}
              className={cn("home-hd-next min-w-0", headerNext.tone === "warn" && "is-warn", headerNext.tone === "good" && "is-good")}
              title={headerNext.detail}
            >
              <em>{headerNext.kind}</em>
              <b className="truncate">{headerNext.when}</b>
              <span className="truncate">{headerNext.who}</span>
            </Link>
          ) : (
            <div className="home-hd-next is-calm min-w-0">
              <em>Next</em>
              <span className="truncate">Clear desk</span>
            </div>
          )}
          <div className="home-hd-actions shrink-0">
            <Link to="/intake/kind" className="home-hd-act is-primary" title="New ticket">
              + New
            </Link>
            <a
              href="https://checkout.lstailors.com/"
              className="home-hd-act is-primary"
              title="Open payment checkout"
            >
              Checkout
            </a>
            <Link to="/pickup" className="home-hd-act" title="Pickup counter">
              Pickup
            </Link>
          </div>
        </div>
        <div className="hidden xl:flex items-center rounded-full border border-brass/35 px-3 py-1.5 text-[10.5px] font-bold tracking-[0.1em] text-brass-light shrink-0">
          NYC
        </div>
        <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-[var(--cd)] shrink-0 max-w-[140px] truncate">
          {weather.data ? (
            <>
              <span aria-hidden>{weatherEmoji(weather.data.weathercode)}</span>
              {weather.data.temp}°F {weather.data.description}
            </>
          ) : (
            "—"
          )}
        </div>
        <CoverMoneyButton on={coverMoney} onToggle={toggleCoverMoney} />
        {!kiosk && (
        <button
          type="button"
          onClick={() => nav("/settings")}
          className="w-8 h-8 rounded-full bg-forest-raised border border-brass/32 grid place-items-center text-[11.5px] font-bold text-brass-light shrink-0 min-h-0 min-w-0"
          title={me?.name ?? "Settings"}
          aria-label="Settings"
        >
          {initials}
        </button>
        )}
      </header>

      {/* Status strip — greeting + espresso + counts + live */}
      <div className="home-040-strip shrink-0" data-testid="status-strip">
        <div className="seg greet grow min-w-0">
          <div className="min-w-0">
            <b className="display block text-[22px] leading-tight truncate">
              {timeGreeting()}, {greetingName(me?.name)}
            </b>
            <i className="block text-[10.5px] text-[var(--cd)] not-italic truncate tracking-[0.02em]">
              {storeHoursLine()}
            </i>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleEspresso}
          aria-expanded={espressoOpen}
          className="seg esp min-w-0 text-left"
        >
          <span className="cup text-[14px]" aria-hidden>
            ☕
          </span>
          <div className="min-w-0">
            <b className="block text-[12px] text-cream font-semibold tracking-[0.02em]">Daily Espresso</b>
            <i className="block text-[10px] text-[var(--cd)] not-italic truncate">
              {espressoSubline(floorBrief.data)}
            </i>
          </div>
        </button>

        <Link
          to="/shop-floor?filter=overdue"
          className={cn("seg pill", (strip?.overdue ?? 0) > 0 && "rd", pulse.overdue && "is-pulse")}
          data-testid="overdue-chip"
        >
          <b className="display tabular-nums">
            {strip?.overdue != null ? <TickNumber value={strip.overdue} /> : "—"}
          </b>
          <span>Overdue</span>
        </Link>
        <Link to="/deliveries" className="seg pill">
          <b className="display tabular-nums">{strip?.outForDelivery ?? "—"}</b>
          <span>Out</span>
        </Link>
        <Link to="/deliveries" className="seg pill gr">
          <b className="display tabular-nums">{strip?.deliveredToday ?? "—"}</b>
          <span>Delivered</span>
        </Link>
        <button
          type="button"
          onClick={toggleCoverMoney}
          className={cn("seg pill", coverMoney ? "gr" : "am")}
          data-testid="cover-money-strip"
          title={coverMoney ? "Show sales numbers" : "Hide sales numbers from customers"}
        >
          <b className="display">{coverMoney ? "SHOW" : "HIDE"}</b>
          <span>Numbers</span>
        </button>
        <Link
          to={
            c?.oldestUnpaidInvoiceId
              ? `/invoices/${encodeURIComponent(c.oldestUnpaidInvoiceId)}`
              : "/invoices"
          }
          className={cn("seg pill", (c?.openInvoices ?? 0) > 0 && "am")}
        >
          <b className="display tabular-nums">
            {coverMoney
              ? (c?.openInvoices ?? "—")
              : c?.openInvoicesAmount != null
                ? formatCompactMoney(c.openInvoicesAmount)
                : "—"}
          </b>
          <span>{c?.openInvoices ? `${c.openInvoices} unpaid` : "All paid"}</span>
        </Link>
        <button
          type="button"
          onClick={() => void live.refetch()}
          className={cn("seg refresh border-0 cursor-pointer", `is-${offline ? "offline" : live.status}`)}
          data-testid="live-chip"
        >
          <span
            className={cn(
              "dot",
              live.status === "stale" && !offline && "is-stale",
              (live.status === "down" || erpDown) && !offline && "is-down",
              offline && "is-offline",
            )}
          />
          <span className="leading-tight text-left">
            {offline ? "OFFLINE" : live.status === "down" || erpDown ? "LIVE · retry" : "LIVE"}
            <br />
            <span className="normal-case tracking-normal opacity-80">
              {offline ? "shop cache" : live.status === "down" ? "feed down" : `updated ${syncAge}`}
            </span>
          </span>
        </button>
      </div>

      {/* Espresso — unfolds and folds back instead of popping */}
      {espressoMotion.shown && (
        <div
          id="espresso-body"
          className={cn("lux-espresso-wrap shrink-0", espressoMotion.entered && "is-in")}
        >
        <div className="lux-espresso-inner">
        <div className="home-040-espresso rounded-[14px] border border-brass/20 bg-black/35 px-3 sm:px-3.5 pt-2.5 pb-3 max-h-[min(42vh,420px)] overflow-y-auto">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-brass-light text-[15px]" aria-hidden>
              ☕
            </span>
            <span className="font-semibold text-brass-light tracking-[0.1em] uppercase text-[11px]">
              Daily Espresso
            </span>
            <span className="text-[10px] text-[var(--cd)] truncate hidden sm:inline">
              {espressoSubline(floorBrief.data)}
            </span>
            <button
              type="button"
              disabled={refreshBrief.isPending || floorBrief.isFetching}
              onClick={() => refreshBrief.mutate()}
              className="ml-auto text-[10px] px-2.5 py-1 rounded-lg border border-brass/30 text-brass-light hover:border-brass disabled:opacity-50 shrink-0 min-h-0"
            >
              {refreshBrief.isPending ? "…" : "Brew"}
            </button>
            <button
              type="button"
              onClick={toggleEspresso}
              className="text-[10px] px-2.5 py-1 rounded-lg border border-brass/25 text-[var(--cd)] hover:text-cream min-h-0"
            >
              Close
            </button>
          </div>

          <div className="espresso-feed">
            <EspressoFeed title="Live floor feed" items={espressoLiveItems} />
            {floorBrief.isLoading && !floorBrief.data ? (
              <div className="espresso-feed-block">
                <div className="espresso-feed-h">Rocco's read</div>
                <div className="espresso-feed-empty">Brewing the floor read…</div>
              </div>
            ) : floorBrief.isError ? (
              <div className="espresso-feed-block">
                <div className="espresso-feed-h">Rocco's read</div>
                <div className="espresso-feed-empty">Unavailable — tap Brew. Counts still work.</div>
              </div>
            ) : espressoBriefItems.length > 0 ? (
              <EspressoFeed title="Rocco's read" items={espressoBriefItems} />
            ) : (
              <div className="espresso-feed-block">
                <div className="espresso-feed-h">Rocco's read</div>
                <div className="espresso-feed-empty">No brief yet — tap Brew for a floor sweep.</div>
              </div>
            )}
          </div>

          <AskRoccoComposer
            isPending={askRocco.isPending}
            onAsk={runAskRocco}
            thread={askThread}
            setThread={setAskThread}
            input={askInput}
            setInput={setAskInput}
            activeChip={askActiveChip}
            setActiveChip={setAskActiveChip}
          />
        </div>
        </div>
        </div>
      )}

      {live.isLoading ? (
        <div className="live-band-skel" aria-busy="true" aria-label="Loading live bands">
          <div className="h-16 rounded-xl bg-brass/10 border border-brass/10 animate-pulse" />
          <div className="h-14 rounded-xl bg-brass/10 border border-brass/10 animate-pulse" />
          <div className="h-16 rounded-xl bg-brass/10 border border-brass/10 animate-pulse" />
        </div>
      ) : (
        <>
          {/* Desk → pipeline → timeline → compact money (one-screen hierarchy) */}
          {!kiosk && (
            <FloorCommandStrip
              pulse={Boolean(pulse.comingIn || pulse.mustLeave || pulse.exceptions)}
              coverMoney={coverMoney}
              canAdmin={canAdmin}
              stats={[
                {
                  key: "coming",
                  label: "Coming in",
                  value: board.todayRail.chips.comingIn,
                  to: "/appointments",
                  tone: "default",
                },
                {
                  key: "leave",
                  label: "Must leave",
                  value: board.todayRail.chips.mustLeave,
                  to: "/shop-floor?filter=today",
                  tone: (board.todayRail.chips.mustLeave ?? 0) > 0 ? "warn" : "default",
                },
                {
                  key: "text",
                  label: "Need text",
                  value: c?.readyNotTexted,
                  to: "/shop-floor?filter=text",
                  tone: (c?.readyNotTexted ?? 0) > 0 ? "warn" : "good",
                },
                {
                  key: "stalled",
                  label: "Stalled",
                  value: c?.stalledCount,
                  to: "/shop-floor?filter=stalled",
                  tone: (c?.stalledCount ?? 0) > 0 ? "hot" : "default",
                },
                {
                  key: "conflicts",
                  label: "Conflicts",
                  value: c?.doubleBookedSlots,
                  to: "/appointments",
                  tone: (c?.doubleBookedSlots ?? 0) > 0 ? "hot" : "default",
                },
                {
                  key: "unpaid",
                  label: coverMoney ? "Unpaid #" : "Unpaid $",
                  value: coverMoney ? c?.openInvoices : c?.openInvoicesAmount,
                  to: c?.oldestUnpaidInvoiceId
                    ? `/invoices/${encodeURIComponent(c.oldestUnpaidInvoiceId)}`
                    : "/invoices",
                  tone: "money",
                  money: !coverMoney,
                },
              ]}
              actions={[
                { key: "new", label: "New ticket", to: "/intake/kind", primary: true, icon: "+" },
                { key: "dispatch", label: "Charge & Dispatch", to: "/dispatch", primary: true, icon: "⚡" },
                { key: "pickup", label: "Pickup", to: "/pickup", icon: "✓" },
                { key: "quote", label: "Quote", to: "/quote", icon: "✎" },
                { key: "parked", label: "Parked", to: "/parked", icon: "⌁" },
                { key: "stock", label: "Stock", to: "/stock", icon: "▣" },
                { key: "admin", label: "Admin", admin: true, icon: "◆" },
              ]}
            />
          )}
          <StatusPipeline
            title="Shop pipeline"
            pulse={pulse.overdue || pulse.floor}
            stages={[
              {
                key: "open",
                label: "Open",
                count: c?.open,
                to: "/shop-floor",
              },
              {
                key: "progress",
                label: "In progress",
                count: c?.inProgress,
                to: "/shop-floor?filter=in_progress",
                tone: "warn",
              },
              {
                key: "ready",
                label: "Ready",
                count: c?.ready,
                to: "/pickup",
                tone: "good",
              },
              {
                key: "overdue",
                label: "Overdue",
                count: strip?.overdue,
                to: "/shop-floor?filter=overdue",
                tone: (strip?.overdue ?? 0) > 0 ? "hot" : "default",
              },
              {
                key: "out",
                label: "Out",
                count: strip?.outForDelivery,
                to: "/deliveries",
              },
            ]}
          />
          <TodayRail rail={board.todayRail} pulse={pulse.comingIn || pulse.mustLeave || pulse.ready} />
          {coverMoney ? (
            <section className="live-band live-money is-covered is-compact" data-band="money" aria-label="Sales numbers covered">
              <div className="live-money-head">
                <p className="live-money-covered">Sales numbers covered</p>
                <CoverMoneyButton on={coverMoney} onToggle={toggleCoverMoney} size="band" />
              </div>
            </section>
          ) : (
            <MoneyStrip
              money={board.money}
              pulse={pulse.revToday || pulse.ar}
              coverControl={<CoverMoneyButton on={coverMoney} onToggle={toggleCoverMoney} size="band" />}
            />
          )}
        </>
      )}

      {/* Quick actions moved into FloorCommandStrip */}

      {(home.isError || erpDown) && !kiosk && !offline && (
        <div className="shrink-0">
          <QueryErrorPanel
            title="Could not load the shop board"
            message="ERPNext stats failed — an outage must never look like an empty day. Tiles still work; counts may be stale."
            onRetry={() => {
              void home.refetch();
              void erpHealth.refetch();
            }}
          />
        </div>
      )}

      {/* Tile grid — 2 / 3 / 4 col; scrolls; no fixed-row clip */}
      {!kiosk && (home.isLoading ? (
        <TileSkeleton count={12} />
      ) : (
      <div className="home-040-grid flex-1 min-h-0" data-testid="tile-grid">
        {tiles
          .filter((t) => t.key !== "qc" || canQc)
          .map((t) => {
          const className = cn(
            "home-040-tile",
            t.size === "lg" ? "is-lg" : "is-sm",
            t.colSpan === 2 && "is-span-2",
            t.primary && "pri",
            t.dim && "dim",
            t.key === "fabric-library" && "is-fabric-lib",
            (pulse[t.key] || (t.key === "invoices" && pulse.invoices) || (t.key === "qc" && pulse.qc)) && "is-pulse",
          );

          const tileBody = (
            <>
              {t.badge != null && t.badge !== 0 && t.badge !== "" && (
                <span
                  className={cn(
                    "home-040-badge",
                    t.badgeKind === "pickup" && "st-pickup",
                    t.badgeKind === "qc" && "st-qc",
                    t.badgeKind === "tasks" && "st-tasks",
                    t.badgeKind === "shop" && "st-shop",
                    t.badgeKind === "money" && "money",
                  )}
                >
                  {t.badge}
                </span>
              )}
              <div className="mid">
                <div className={cn("ic", t.primary && "text-[#E3C48F]")}>{t.icon}</div>
                <div className="tx">
                  <h2>{t.title}</h2>
                  <div className="sub">{t.sub}</div>
                </div>
              </div>
              {t.live != null ? (
                <div className={cn("live", t.liveTone === "am" && "am", t.liveTone === "ro" && "ro")}>
                  <LiveDot tone={t.liveTone} />
                  <span className="truncate min-w-0">{t.live}</span>
                </div>
              ) : null}
            </>
          );

          if (t.href) {
            return (
              <a
                key={t.key}
                href={t.href}
                target={t.sameWindow ? undefined : "_blank"}
                rel={t.sameWindow ? undefined : "noreferrer"}
                className={className}
              >
                {tileBody}
              </a>
            );
          }
          return (
            <Link key={t.key} to={t.to!} className={className}>
              {tileBody}
            </Link>
          );
        })}
      </div>
      ))}
      {offline ? (
        <NeedsConnection
          title="Activity needs connection"
          detail="The live ticker will resume when you're back online. Last cached snapshot stays on the tiles."
        />
      ) : (
        <ActivityTicker items={board.activity} coverMoney={coverMoney} />
      )}
    </div>
  );
}
