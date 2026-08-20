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
