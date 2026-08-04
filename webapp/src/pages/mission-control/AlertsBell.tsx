// SPEC 071 — Mission Control global Alerts bell + dropdown
// Read-only ambient standing-state. No dismiss/snooze. Resolves passively.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check } from "lucide-react";
import { cn } from "@ls/design/utils";
import { useMissionControlAlerts } from "@/lib/queries";
import type { MissionControlAlert, MissionControlAlertsResponse } from "@ls/types";

function badgeLabel(count: number): string {
  if (count <= 0) return "";
  if (count > 9) return "9+";
  return String(count);
}

function AlertRow({
  alert,
  onNavigate,
}: {
  alert: MissionControlAlert;
  onNavigate: (href: string) => void;
}) {
  const crit = alert.severity === "critical";
  return (
    <button
      type="button"
      onClick={() => onNavigate(alert.href)}
      className={cn(
        "block w-full text-left px-5 py-3.5 border-b border-brass/10 last:border-b-0 transition-colors",
        "hover:bg-white/[0.02] border-l-2",
        crit ? "border-l-signal-rose" : "border-l-signal-amber"
      )}
    >
      <span
        className={cn(
          "pill mb-2 !text-[9px] !tracking-widest !py-0.5 !px-2.5",
          crit ? "pill-rose" : "pill-amber"
        )}
      >
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            crit
              ? "bg-signal-rose shadow-[0_0_5px_rgba(217,150,138,0.5)]"
              : "bg-signal-amber shadow-[0_0_5px_rgba(232,168,92,0.5)]"
          )}
        />
        {crit ? "Critical" : "Warning"}
      </span>
      <div className="text-[13px] text-cream leading-snug mb-1">{alert.title}</div>
      <div className="text-[11px] text-cream-dim tracking-wide">{alert.context}</div>
    </button>
  );
}

function SkeletonRows() {
  return (
    <div>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="px-5 py-3.5 border-b border-brass/10 last:border-b-0 space-y-2"
        >
          <div className="h-3.5 w-[70px] rounded-full bg-white/[0.06] animate-pulse" />
          <div className="h-2.5 w-[85%] rounded bg-white/[0.06] animate-pulse" />
          <div className="h-2 w-[55%] rounded bg-white/[0.06] animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function AlertsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError, error, dataUpdatedAt, isFetched, isFetching } =
    useMissionControlAlerts();

  const payload = (data ?? null) as MissionControlAlertsResponse | null;
  const alerts = payload?.alerts ?? [];
  const count = payload?.count ?? 0;
  const highest = payload?.highest_severity ?? null;
  const hardError = isError && !payload;
  const softError = !!payload?.error || (isError && !!payload);
  const feedError = hardError || softError;
  const cacheAgeMin =
    payload?.cache_age_minutes ??
    (dataUpdatedAt && feedError
      ? Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 60_000))
      : null);

  // Badge: absent until first fetch resolves; absent when count is 0
  const showBadge = isFetched && count > 0;
  const badgeStale = feedError && count > 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const onNavigate = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const badgeTone =
    highest === "warning" && count > 0
      ? "bg-signal-amber"
      : "bg-[#E5968A]"; // rose-light — highest severity or mixed/critical

  const panelClass = cn(
    "z-40 overflow-hidden border border-brass/30 bg-[#0F2218] shadow-[0_24px_48px_rgba(0,0,0,0.45)]",
    // desktop: anchored dropdown
    "md:absolute md:top-12 md:right-0 md:w-[380px] md:rounded-2xl",
    // phone: bottom sheet
    "fixed inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl md:inset-auto md:max-h-[min(520px,70vh)]",
    open ? "block" : "hidden"
  );

  const countLabel = feedError
    ? `last known: ${count}`
    : `${count} active`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={count > 0 ? `Alerts, ${count} active` : "Alerts"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative h-9 w-9 rounded-full bg-forest-raised border border-brass/15",
          "flex items-center justify-center transition-colors hover:border-brass/30",
          open && "border-brass/40"
        )}
      >
        <Bell className="h-4 w-4 text-brass-light" strokeWidth={1.6} />
        {showBadge && (
          <span
            className={cn(
              "absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full flex items-center justify-center",
              "font-mono text-[9px] font-medium text-forest-deep shadow-[0_0_0_2px_#0D1A10]",
              badgeTone,
              badgeStale && "opacity-70 ring-1 ring-signal-amber/50"
            )}
            data-testid="mc-alerts-badge"
          >
            {badgeLabel(count)}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-forest-deep/70 md:hidden"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      <div className={panelClass} role="dialog" aria-label="Alerts">
        <div className="px-5 pt-4 pb-3.5 border-b border-brass/15">
          <div className="ui-label text-[10px] tracking-[0.26em] text-brass-light flex items-center gap-2">
            ALERTS
            {isFetched && !isLoading && (
              <span className="font-mono normal-case tracking-normal text-cream-muted text-[11px]">
                · {countLabel}
              </span>
            )}
            {isFetching && isFetched && (
              <span className="text-cream-dim normal-case tracking-normal text-[10px]">…</span>
            )}
          </div>
          <p className="text-[11px] text-cream-dim mt-1.5">
            Clears automatically when resolved.
          </p>
        </div>

        <div className="overflow-y-auto max-h-[min(420px,60vh)]">
          {/* Loading (first paint) */}
          {isLoading && !isFetched && <SkeletonRows />}

          {/* Hard error, no cached alerts */}
          {hardError && (
            <div className="px-6 py-14 text-center">
              <span className="block text-2xl text-brass-light/50 italic mb-3.5 font-[family-name:var(--font-display,Cormorant_Garamond,Georgia,serif)]">
                L&S
              </span>
              <div className="text-[15px] text-[#E5968A] mb-1.5">
                Alerts feed unavailable
              </div>
              <p className="text-xs text-cream-dim max-w-[260px] mx-auto leading-relaxed">
                {(error as Error)?.message || "Not the same as all clear — reconnecting."}
              </p>
            </div>
          )}

          {/* Soft error banner over last-known list */}
          {softError && alerts.length > 0 && (
            <div className="px-5 py-3 text-[11px] text-[#E5968A] border-b border-signal-rose/20 bg-signal-rose/5">
              Alerts feed unavailable
              {cacheAgeMin != null
                ? ` — showing last known state, ${cacheAgeMin}m old`
                : ""}
              .
            </div>
          )}

          {/* Empty / all clear */}
          {isFetched && !hardError && alerts.length === 0 && !isLoading && (
            <div className="px-6 py-14 text-center">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-signal-emerald/15 text-signal-emerald mb-3.5">
                <Check className="h-4 w-4" strokeWidth={2.5} />
              </span>
              <div className="text-[15px] text-cream-muted mb-1.5">All clear</div>
              <p className="text-xs text-cream-dim max-w-[260px] mx-auto leading-relaxed">
                No cron errors, stale approvals, dark agents, or cost spikes.
              </p>
            </div>
          )}

          {/* Live / last-known rows */}
          {alerts.length > 0 && (
            <div>
              {alerts.map((a) => (
                <AlertRow key={a.id} alert={a} onNavigate={onNavigate} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
