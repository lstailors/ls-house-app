import { Link, useNavigate } from "react-router-dom";
import { useMe } from "@ls/auth/session";
import { signOut } from "@ls/auth/authClient";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";
import { UniversalSearchInline } from "@alts/components/UniversalSearch";
import { clearAltsPrivateStorage } from "@alts/lib/logoutPrivacy";

const ESPRESSO_OPEN_KEY = "alts.espresso.open";

/** Live date/time pill (SPEC_060) — neutral outline, updates every minute.
 *  SPEC_061: leads the pill row (right after the greeting) + live pulse dot
 *  + live open-tickets badge count so the clock also reads as "floor is live". */
function TimeClockPill({ openCount }: { openCount: number }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString([], { month: "short", day: "numeric" });
  return (
    <div className="relative flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full border border-cream/30 bg-white/[0.02] text-[11px] sm:text-xs min-h-[40px] text-[var(--cd)]">
      <span
        className="w-[6px] h-[6px] rounded-full bg-[var(--em)] shadow-[0_0_6px_rgba(79,191,142,0.8)] animate-pulse shrink-0"
        aria-hidden
        title="Live"
      />
      <span className="font-mono tabular-nums">{time}</span>
      <span className="opacity-60">·</span>
      <span>{date}</span>
      {openCount > 0 && (
        <span
          className="ml-1 min-w-[20px] h-[20px] px-1.5 rounded-full grid place-items-center text-[10px] font-bold bg-white/[0.08] border border-brass/30 text-cream shrink-0"
          title="Open tickets right now"
        >
          {openCount}
        </span>
      )}
    </div>
  );
}


/** Phone default collapsed; tablet (≥720) default open. Honor localStorage if set. */
function readEspressoOpenDefault(): boolean {
  try {
    const v = localStorage.getItem(ESPRESSO_OPEN_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") {
    return window.matchMedia("(min-width: 720px)").matches;
  }
  return false;
}

function peelLeadingIcon(line: string): { icon: string | null; text: string } {
  // Leading emoji / pictograph cluster (⚡ 👉 🔴 etc.)
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

type Stats = {
  open: number;
  ready: number;
  dueToday: number;
  overdue: number;
  outToTailors: number;
  parked: number;
  outForDelivery: number;
  deliveredToday: number;
  pendingBoard: number;
  openInvoices: number;
  syncedAt: number;
};

const Arrow = ({ external }: { external?: boolean }) =>
  external ? (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 16L16 6M9 6h7v7" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11h13M12 6l5 5-5 5" />
    </svg>
  );

function greetingName(name?: string | null) {
  if (!name) return "there";
  return name.split(" ")[0] ?? "there";
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function storeHoursLine() {
  const d = new Date();
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return `${day} · East 61st Street · open until 6:00 PM`;
}

function briefAge(iso?: string | null) {
  if (!iso) return "";
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

function espressoSubline(data?: { fromCache?: boolean; createdAt?: string } | null) {
  if (!data) return "Rocco · floor sweep";
  const freshness = data.fromCache ? "cached" : "fresh";
  const age = data.createdAt ? briefAge(data.createdAt) : "";
  return age ? `Rocco · ${freshness} · ${age}` : `Rocco · ${freshness}`;
}

function espressoIsStale(data?: { fromCache?: boolean; createdAt?: string } | null) {
  if (!data) return true;
  if (data.fromCache) return true;
  if (!data.createdAt) return false;
  const hours = (Date.now() - new Date(data.createdAt).getTime()) / 3_600_000;
  return hours > 6;
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
  // Keep last N non-thinking messages; drop orphan thinking if over.
  const withoutThinking = msgs.filter((m) => m.role !== "thinking");
  if (withoutThinking.length <= ASK_THREAD_MAX) {
    return msgs.slice(-(ASK_THREAD_MAX + 1)); // allow one thinking
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
        <div
          className="flex flex-col gap-2 mb-2.5 max-h-[220px] overflow-y-auto"
          aria-live="polite"
        >
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
            "[&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_rgba(0,0,0,0.85)] [&:-webkit-autofill]:[-webkit-text-fill-color:#F1E9D6]",
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

export default function HomeTiles() {
  const { data: me } = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [espressoOpen, setEspressoOpen] = useState(readEspressoOpenDefault);
  const [askThread, setAskThread] = useState<AskMsg[]>([]);
  const [askInput, setAskInput] = useState("");
  const [askActiveChip, setAskActiveChip] = useState<string | null>(null);

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

  const stats = useQuery({
    queryKey: ["alts-home-stats"],
    queryFn: async (): Promise<Stats> => {
      const [rows, parked, deliveries, invoices] = await Promise.all([
        api.get<
          Array<{
            workflow_state?: string;
            due_date?: string;
            name: string;
            origin_location?: string;
            assigned_tailor?: string;
          }>
        >("/api/intake-alterations/tickets?limit=200"),
        api.get<Array<unknown>>("/api/carts").catch(() => [] as unknown[]),
        // HER-75: board counts for Deliveries tile + status strip
        api
          .get<
            Array<{ status?: string; deliveredAt?: string | null }>
          >("/api/deliveries")
          .catch(() => [] as Array<{ status?: string; deliveredAt?: string | null }>),
        api
          .raw("/api/invoices?status=open&limit=100")
          .then(async (r) => {
            const j = await r.json().catch(() => ({}));
            if (!r.ok) return { openCount: 0 };
            return {
              openCount:
                typeof j?.summary?.openCount === "number"
                  ? j.summary.openCount
                  : Array.isArray(j?.data)
                    ? j.data.filter((i) => Number(i.outstandingAmount) > 0.005).length
                    : 0,
            };
          })
          .catch(() => ({ openCount: 0 })),
      ]);
      const list = Array.isArray(rows) ? rows : (rows as any)?.tickets ?? [];
      const today = new Date().toISOString().slice(0, 10);
      let open = 0;
      let ready = 0;
      let dueToday = 0;
      let overdue = 0;
      let outToTailors = 0;
      for (const t of list) {
        const st = t.workflow_state ?? "";
        if (st === "Ready") ready += 1;
        if (st && st !== "Picked Up" && st !== "Cancelled") {
          open += 1;
          if (t.due_date) {
            if (t.due_date < today) overdue += 1;
            else if (t.due_date === today) dueToday += 1;
          }
          const ol = (t.origin_location || "").toLowerCase();
          if (ol.includes("home") || (t.assigned_tailor && ol && ol !== "nyc")) {
            outToTailors += 1;
          }
        }
      }
      const deliv = Array.isArray(deliveries) ? deliveries : [];
      let outForDelivery = 0;
      let deliveredToday = 0;
      let pendingBoard = 0;
      for (const d of deliv) {
        const st = (d.status || "").toLowerCase();
        if (st === "out_for_delivery") outForDelivery += 1;
        if (st === "scheduled" || st === "out_for_delivery" || st === "queued") pendingBoard += 1;
        if (st === "delivered" && d.deliveredAt && String(d.deliveredAt).slice(0, 10) === today) {
          deliveredToday += 1;
        }
      }
      return {
        open,
        ready,
        dueToday,
        overdue,
        outToTailors,
        parked: Array.isArray(parked) ? parked.length : 0,
        outForDelivery,
        deliveredToday,
        pendingBoard,
        openInvoices: invoices.openCount || 0,
        syncedAt: Date.now(),
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 2,
  });


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

  const empty: Stats = {
    open: 0,
    ready: 0,
    dueToday: 0,
    overdue: 0,
    outToTailors: 0,
    parked: 0,
    outForDelivery: 0,
    deliveredToday: 0,
    pendingBoard: 0,
    openInvoices: 0,
    syncedAt: Date.now(),
  };

  const s = stats.data ?? empty;

  const syncAge = useMemo(() => {
    const sec = Math.max(0, Math.round((Date.now() - s.syncedAt) / 1000));
    if (sec < 5) return "just now";
    if (sec < 60) return `${sec}s ago`;
    return `${Math.floor(sec / 60)}m ago`;
  }, [s.syncedAt, stats.dataUpdatedAt]);

  const logout = async () => {
    clearAltsPrivateStorage();
    qc.clear();
    await signOut();
    nav("/login", { replace: true });
  };

  const initials = (me?.name ?? "LS")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const tiles: Array<{
    key: string;
    to?: string;
    href?: string;
    title: string;
    sub: string;
    primary?: boolean;
    external?: boolean;
    badge?: number | null;
    badgeKind?: "warn" | "alert" | "neutral";
    icon: React.ReactNode;
  }> = [
    {
      key: "new",
      to: "/intake/kind",
      title: "New Ticket",
      sub: "Walk-in, custom order, or re-do — then intake",
      primary: true,
      icon: (
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M28 5H11a3 3 0 0 0-3 3v36a3 3 0 0 0 3 3h24a3 3 0 0 0 3-3V15z" />
          <path d="M28 5v10h10" />
          <path d="M16 25h14M16 32h14M16 39h8" />
          <circle cx="39" cy="38" r="9" strokeWidth="1.4" />
          <path d="M39 34v8M35 38h8" strokeWidth="1.4" />
        </svg>
      ),
    },
    {
      key: "floor",
      to: "/shop-floor",
      title: "Shop Floor",
      sub: "Every garment, every station, what’s next",
      badge: s.open || null,
      badgeKind: s.overdue > 0 ? "alert" : "warn",
      icon: (
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="9" width="12" height="34" rx="2.5" />
          <rect x="20" y="9" width="12" height="34" rx="2.5" />
          <rect x="35" y="9" width="12" height="34" rx="2.5" />
          <path d="M8 16h6M23 16h6M38 16h6" strokeWidth="1.3" opacity=".75" />
          <path d="M8 22h6M23 22h6" strokeWidth="1.3" opacity=".55" />
          <path d="M8 28h6" strokeWidth="1.3" opacity=".4" />
        </svg>
      ),
    },
    {
      key: "pickup",
      to: "/pickup",
      title: "Pickup",
      sub: "Hand back finished work, settle the balance",
      badge: s.ready || null,
      badgeKind: "neutral",
      icon: (
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M26 6a5 5 0 0 0-5 5c0 2.5 2 3.6 3.6 4.4L9 25.5a3 3 0 0 0-1.5 2.6V31a2 2 0 0 0 2 2h33a2 2 0 0 0 2-2v-2.9a3 3 0 0 0-1.5-2.6L27.4 15.4C29 14.6 31 13.5 31 11a5 5 0 0 0-5-5z" />
          <path d="M14 38h24M14 44h16" strokeWidth="1.4" opacity=".7" />
          <path d="M40 41l4 4 7-8" stroke="#4FBF8E" strokeWidth="2" />
        </svg>
      ),
    },
    {
      key: "transfers",
      to: "/transfers",
      title: "Transfers",
      sub: "Send work to at-home tailors · take it back in",
      badge: s.outToTailors || null,
      badgeKind: "neutral",
      icon: (
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="14" width="19" height="15" rx="2.5" />
          <rect x="29" y="26" width="19" height="15" rx="2.5" />
          <path d="M27 10h13M35 5l5 5-5 5" />
          <path d="M25 45H12M18 40l-5 5 5 5" opacity=".85" />
        </svg>
      ),
    },
    {
      key: "lookup",
      to: "/lookup",
      title: "Find a Ticket",
      sub: "Search by number, name, phone, or scan a tag",
      icon: (
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="22" cy="22" r="14" />
          <path d="M32.5 32.5L46 46" strokeWidth="2" />
          <path d="M15 19h14M15 25h9" strokeWidth="1.3" opacity=".7" />
        </svg>
      ),
    },
    {
      key: "deliveries",
      // Alts board + POD live here; full ops board still on app
      to: "/deliveries",
      title: "Deliveries",
      sub: "Board status · driver route · POD",
      badge: s.pendingBoard || null,
      badgeKind: s.outForDelivery > 0 ? "warn" : "neutral",
      icon: (
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 16.5 26 7l20 9.5v17L26 43 6 33.5z" />
          <path d="M6 16.5 26 26l20-9.5M26 26v17" opacity=".7" />
          <circle cx="38" cy="36" r="8" stroke="#9B8BC4" strokeWidth="1.4" />
          <path d="M38 32.5v7M34.5 36h7" stroke="#9B8BC4" strokeWidth="1.4" />
        </svg>
      ),
    },
    {
      key: "customers",
      to: "/customers",
      title: "Customers",
      sub: "Profiles, phones, addresses, photo — open any client",
      icon: (
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="26" cy="18" r="8" />
          <path d="M10 44c2.5-10 11-14 16-14s13.5 4 16 14" />
          <circle cx="40" cy="16" r="5" opacity=".7" />
          <path d="M42 28c4 1.5 7 5 8 12" opacity=".55" />
        </svg>
      ),
    },
    {
      key: "invoices",
      to: "/invoices",
      title: "Invoices",
      sub: "All sales invoices — custom + alts. Charge card & close out",
      badge: s.openInvoices || null,
      badgeKind: s.openInvoices > 0 ? "warn" : "neutral",
      icon: (
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 6h18l10 10v30a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
          <path d="M32 6v10h10" />
          <path d="M18 26h16M18 33h16M18 40h10" strokeWidth="1.4" opacity=".75" />
          <circle cx="40" cy="40" r="8" stroke="#E3C48F" strokeWidth="1.4" />
          <path d="M40 36.5v7M36.5 40h7" stroke="#E3C48F" strokeWidth="1.4" />
        </svg>
      ),
    },
    {
      key: "admin",
      href: "https://app.lstailors.com",
      title: "Reports & Admin",
      sub: "Workload, money, pricing, users",
      external: true,
      icon: (
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 44h40" strokeWidth="1.6" />
          <rect x="10" y="28" width="8" height="16" rx="1.5" />
          <rect x="22" y="18" width="8" height="26" rx="1.5" />
          <rect x="34" y="24" width="8" height="20" rx="1.5" />
          <path d="M10 12l10-4 10 6 12-6" strokeWidth="1.3" opacity=".6" />
        </svg>
      ),
    },
  ];

  return (
    <div className="alts-root home-007 flex flex-col min-h-[100dvh] overflow-x-hidden overflow-y-auto px-3.5 sm:px-5 lg:px-[26px] pt-[max(12px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]">
      <header className="flex items-center gap-2 sm:gap-3 pb-2.5 sm:pb-3 border-b border-brass/15 shrink-0">
        {/* Official CUSTOM L&S TAILORS mark → home */}
        <BrandSeal className="shrink-0" size={44} />
        <div className="min-w-0 hidden sm:block shrink-0">
          <div className="display text-[18px] sm:text-[22px] leading-tight">L&S House</div>
          <div className="text-[10px] sm:text-xs tracking-[0.14em] sm:tracking-[0.18em] uppercase text-[var(--cd)] truncate">
            Alterations · alts.lstailors.com
          </div>
        </div>
        <UniversalSearchInline className="mx-0.5 sm:mx-1" />
        <div className="hidden lg:flex items-center rounded-full border border-brass/20 bg-black/30 px-3.5 py-2.5 text-xs font-bold tracking-[0.14em] uppercase text-brass-light shrink-0">
          NYC
        </div>
        {/* Weather chip (SPEC_060) — static per brief; 72° Clear next to NYC */}
        <div className="hidden lg:flex items-center rounded-full border border-brass/20 bg-black/30 px-3 py-1.5 text-xs font-bold tracking-[0.14em] uppercase text-brass-light shrink-0">
          72° Clear
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2 rounded-full border border-brass/20 bg-white/[0.04] pl-1.5 pr-2.5 sm:pl-2 sm:pr-3.5 py-1.5 min-h-[44px] hover:border-brass/40 transition-colors shrink-0"
        >
          <span className="w-8 h-8 rounded-full bg-forest-raised border border-brass/30 grid place-items-center text-xs font-bold text-brass-light">
            {initials}
          </span>
          <span className="text-left hidden xl:block">
            <span className="block text-xs font-semibold leading-tight">{me?.name ?? "Staff"}</span>
            <span className="block text-xs text-[var(--cd)] capitalize">
              {me?.role?.replace(/_/g, " ") || "Front of house"}
            </span>
          </span>
        </button>
      </header>

      <div className="flex flex-wrap items-end gap-2 sm:gap-3 pt-3 sm:pt-4 pb-2.5 sm:pb-3 shrink-0">
        <div className="min-w-0 flex-1">
          <h1 className="display text-[26px] sm:text-[32px] leading-none">
            {timeGreeting()}, {greetingName(me?.name)}
          </h1>
          <p className="text-[11px] sm:text-xs text-[var(--cd)] mt-1 sm:mt-1.5">{storeHoursLine()}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:gap-2 items-end">
          {/* Time Clock pill (SPEC_060/061) — leads the row, live pulse + date/time + open-ticket count */}
          <TimeClockPill openCount={s.open} />
          {s.overdue > 0 && (
            <Link
              to="/shop-floor"
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full border border-[rgba(217,123,108,0.42)] bg-[rgba(217,123,108,0.12)] text-[11px] sm:text-xs hover:border-[rgba(217,123,108,0.7)] min-h-[40px]"
            >
              <b className="text-[var(--ro)] font-bold">{s.overdue}</b> overdue
            </Link>
          )}
          {s.dueToday > 0 && (
            <Link
              to="/shop-floor"
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full border border-[rgba(232,168,92,0.4)] bg-[rgba(232,168,92,0.12)] text-[11px] sm:text-xs hover:border-[rgba(232,168,92,0.7)] min-h-[40px]"
            >
              <b className="text-[var(--am)] font-bold">{s.dueToday}</b> due today
            </Link>
          )}
          {s.parked > 0 && (
            <Link
              to="/parked"
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full border border-brass/35 bg-brass/10 text-[11px] sm:text-xs text-cream hover:border-brass/55 min-h-[40px]"
            >
              <b className="text-brass-light font-bold">{s.parked}</b> parked
            </Link>
          )}
        </div>
      </div>

      {/* Daily Espresso ☕ — one line (SPEC_060), toggle restored (SPEC_061) */}
      <div className="espresso-line shrink-0 mb-2.5 sm:mb-3 rounded-[12px] border border-brass/20 bg-black/20 px-3 py-2 flex items-center gap-2 text-[12px]">
        <button
          type="button"
          onClick={toggleEspresso}
          aria-expanded={espressoOpen}
          aria-controls="espresso-body"
          className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
        >
          <span className="text-brass-light">☕</span>
          <span className="font-semibold text-brass-light tracking-[0.08em] uppercase shrink-0">Daily Espresso</span>
          <span className="text-[var(--cd)] flex-1 truncate">{espressoSubline(floorBrief.data)}</span>
        </button>
        <button
          type="button"
          disabled={refreshBrief.isPending || floorBrief.isFetching}
          onClick={() => refreshBrief.mutate()}
          className="text-[10px] px-2 py-0.5 rounded border border-brass/30 text-brass-light hover:border-brass disabled:opacity-50 shrink-0"
        >
          {refreshBrief.isPending ? "..." : "Brew"}
        </button>
        <button
          type="button"
          onClick={toggleEspresso}
          aria-expanded={espressoOpen}
          aria-controls="espresso-body"
          aria-label={espressoOpen ? "Collapse Daily Espresso" : "Expand Daily Espresso"}
          className="w-6 h-6 rounded-[8px] border border-brass/25 bg-black/20 grid place-items-center text-brass-light shrink-0 hover:border-brass/50 transition-transform"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            className={cn("transition-transform duration-200", espressoOpen && "rotate-180")}
          >
            <path d="M3 5l4 4 4-4" />
          </svg>
        </button>
      </div>

        {/* Collapsed peek */}
        {!espressoOpen && (
          <div className="espresso-peek px-3.5 pb-3 pl-[58px]">
            {floorBrief.isLoading && !floorBrief.data ? (
              <p className="text-[12.5px] leading-snug text-[var(--cd)]">Brewing the floor read…</p>
            ) : floorBrief.isError ? (
              <p className="text-[12.5px] leading-snug text-[var(--am)]">
                Espresso unavailable — try Brew.
              </p>
            ) : (() => {
              const content = espressoContentLines(floorBrief.data?.body);
              if (!content.length) {
                return (
                  <p className="text-[12.5px] leading-snug text-[var(--cd)]">
                    No espresso yet — tap Brew.
                  </p>
                );
              }
              const more = Math.max(0, content.length - 1);
              return (
                <>
                  <div className="peek-line text-[12.5px] leading-snug text-cream line-clamp-2">
                    {content[0]}
                  </div>
                  {more > 0 && (
                    <div className="mt-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--cd)]">
                      <b className="text-brass-light font-bold">{more}</b> more · tap to open
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Expanded body */}
        {espressoOpen && (
          <div
            id="espresso-body"
            className="espresso-body border-t border-brass/16 px-3 sm:px-3.5 pt-2.5 pb-3 max-h-[min(62vh,560px)] overflow-y-auto"
          >
            {floorBrief.isLoading && !floorBrief.data ? (
              <p className="text-sm text-[var(--cd)] leading-relaxed">Brewing the floor read…</p>
            ) : floorBrief.isError ? (
              <p className="text-sm text-[var(--am)] leading-relaxed">
                Espresso unavailable — counts still work. Try Brew now.
              </p>
            ) : floorBrief.data?.body ? (
              <EspressoBody text={floorBrief.data.body} />
            ) : (
              <p className="text-sm text-[var(--cd)]">No espresso yet — tap Brew now.</p>
            )}

            {/* SPEC 055 — Ask Rocco (open espresso only; Brew does not clear thread) */}
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
        )}

      {/* Clickable stats */}
      <div className="home-stats rounded-[14px] sm:rounded-[15px] border border-brass/15 bg-black/25 grid grid-cols-2 md:grid-cols-3 overflow-hidden shrink-0 mb-2.5 sm:mb-3">
        {(
          [
            { to: "/shop-floor", lab: "Open tickets", val: s.open, tone: "" },
            { to: "/pickup", lab: "Ready for pickup", val: s.ready, tone: "text-[var(--em)]" },
            { to: "/transfers", lab: "Out to tailors", val: s.outToTailors, tone: "text-[var(--am)]" },
            { to: "/deliveries", lab: "Out for delivery", val: s.outForDelivery, tone: "text-[var(--am)]" },
            { to: "/deliveries", lab: "Delivered today", val: s.deliveredToday, tone: "text-[var(--em)]" },
            { to: "/shop-floor", lab: "Overdue", val: s.overdue, tone: "text-[var(--ro)]" },
          ] as const
        ).map((cell, i) => (
          <Link
            key={cell.lab}
            to={cell.to}
            className={cn(
              "px-3 sm:px-[18px] py-2.5 sm:py-[12px] flex items-baseline gap-2 hover:bg-white/[0.04] active:bg-white/[0.06] transition-colors min-h-[48px]",
              "border-brass/10",
              i % 2 === 0 && "border-r",
              i < 4 && "border-b",
              // md 3-col: items 0,1 border-r; 2 no r; row border-b on 0-2
              "md:border-r md:[&:nth-child(3n)]:border-r-0",
              i < 3 && "md:border-b",
              i >= 3 && "md:border-b-0",
              i === 4 && "border-b border-r sm:border-b",
              i === 5 && "border-b-0",
            )}
          >
            <span className="text-[10px] sm:text-xs font-bold tracking-[0.12em] sm:tracking-[0.16em] uppercase text-[var(--cd)] leading-tight">
              {cell.lab}
            </span>
            <span className={cn("display text-xl sm:text-2xl ml-auto tabular-nums", cell.tone)}>{cell.val}</span>
          </Link>
        ))}
        <div className="col-span-2 md:col-span-3 flex items-center gap-2 px-3 sm:px-[18px] py-2 text-[11px] sm:text-xs text-[var(--cd)] border-t border-brass/10">
          <span
            className={cn(
              "w-[7px] h-[7px] rounded-full shrink-0",
              stats.isError
                ? "bg-[var(--am)] shadow-[0_0_8px_rgba(232,168,92,0.7)]"
                : "bg-[var(--em)] shadow-[0_0_8px_rgba(79,191,142,0.7)]",
            )}
          />
          <span className="truncate">
            {stats.isError ? "ERPNext unreachable" : `ERPNext live · ${syncAge}`}
          </span>
          <button
            type="button"
            onClick={() => stats.refetch()}
            className="ml-auto text-[10px] font-bold tracking-widest uppercase text-brass-light hover:text-cream shrink-0 min-h-[36px] px-1"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Quick actions — horizontal scroll on phone */}
      <div className="home-quick flex gap-2 shrink-0 pb-2.5 sm:pb-3 overflow-x-auto -mx-1 px-1 scrollbar-none">
        {[
          { to: "/dispatch", lab: "Charge & dispatch" },
          { to: "/invoices", lab: `Invoices${s.openInvoices ? ` · ${s.openInvoices}` : ""}` },
          { to: "/quote", lab: "Send quote" },
          { to: "/orders/alterations", lab: "Orders" },
          { to: "/parked", lab: `Parked${s.parked ? ` · ${s.parked}` : ""}` },
          { to: "/deliveries", lab: "Deliveries" },
          { to: "/pickup", lab: "Pickup" },
        ].map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="h-10 px-3.5 sm:px-4 rounded-full border border-brass/25 bg-black/25 text-[10px] sm:text-xs font-bold tracking-widest uppercase text-brass-light inline-flex items-center hover:border-brass/50 active:scale-[0.98] whitespace-nowrap shrink-0"
          >
            {l.lab}
          </Link>
        ))}
      </div>

      {stats.isError && (
        <div className="mb-3 shrink-0">
          <QueryErrorPanel
            title="Could not load the shop board"
            message="ERPNext stats failed — an outage must never look like an empty day. Tiles still work; counts may be stale."
            onRetry={() => stats.refetch()}
          />
        </div>
      )}

      {/* Unified 8-tile grid (SPEC_060) — one viewport, no scroll */}
      <div className="home-tiles grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5 content-start pb-2">
        {tiles.map((t) => {
          const className = cn(
            "home-tile relative rounded-[18px] sm:rounded-[20px] border p-3.5 sm:p-4 flex flex-col",
            "min-h-[124px] sm:min-h-[132px]",
            "transition-all duration-150 active:scale-[0.988] cursor-pointer group",
            "bg-gradient-to-br from-white/[0.045] to-white/[0.012]",
            "border-brass/25 hover:border-brass/50 hover:-translate-y-0.5 hover:shadow-[var(--sl)] hover:from-white/[0.085] hover:to-white/[0.025]",
            t.primary &&
              "from-brass/20 to-brass/5 border-brass/50 hover:from-brass/28 hover:to-brass/8",
            t.external && "border-dashed border-brass/40",
            t.key === "deliveries" &&
              "border-[rgba(155,139,196,0.42)] hover:border-[rgba(155,139,196,0.65)] from-[rgba(155,139,196,0.10)] to-white/[0.012]",
          );

          const tileBody = (
            <>
              {t.badge != null && t.badge > 0 && (
                <span
                  className={cn(
                    "absolute top-3 right-3 min-w-[28px] h-[28px] sm:min-w-[30px] sm:h-[30px] px-2 rounded-full grid place-items-center text-xs sm:text-sm font-bold border",
                    t.badgeKind === "alert" && "bg-[rgba(217,123,108,0.9)] border-transparent text-white",
                    t.badgeKind === "warn" && "bg-[rgba(232,168,92,0.9)] border-transparent text-forest-deep",
                    (!t.badgeKind || t.badgeKind === "neutral") && "bg-white/[0.07] border-brass/30 text-cream",
                  )}
                >
                  {t.badge}
                </span>
              )}
              <div
                className={cn(
                  "text-brass-light opacity-90 mb-auto scale-[0.72] sm:scale-90 origin-top-left",
                  t.primary && "text-[#E3C48F] opacity-100",
                )}
              >
                {t.icon}
              </div>
              <h2 className={cn("display mt-1.5 sm:mt-2 leading-tight", t.external ? "text-[18px] sm:text-[20px]" : "text-[19px] sm:text-[22px]")}>
                {t.title}
              </h2>
              <p className="text-[10px] sm:text-[11px] text-[var(--cd)] mt-0.5 sm:mt-1 leading-snug pr-6 line-clamp-2">{t.sub}</p>
              {t.external && (
                <div className="font-mono text-[10px] text-[var(--bd)] tracking-wide mt-1">app.lstailors.com ↗</div>
              )}
              <span className="absolute bottom-3 right-3.5 text-[var(--bd)] opacity-55 group-hover:opacity-100 group-hover:text-brass-light transition-opacity">
                <Arrow external={t.external} />
              </span>
            </>
          );

          if (t.href) {
            return (
              <a key={t.key} href={t.href} target="_blank" rel="noreferrer" className={className}>
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
    </div>
  );
}
