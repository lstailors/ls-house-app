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
