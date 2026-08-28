import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import { CompleteGarmentDialog } from "@alts/components/garment/CompleteGarmentDialog";
import { TailorTallyStrip } from "@alts/components/TailorTallyStrip";
import { parseProgressScanTarget } from "@alts/lib/scanRoutes";
import type { GarmentActionResult, GarmentJobCard } from "@ls/types";
import "@alts/styles/alts-pos.css";

type SessionLog = {
  id: string;
  at: number;
  ticket: string;
  garment: string;
  label: string;
  worker: string;
  minutes: number;
  allReady?: boolean;
};

const SESSION_KEY = "alts-progress-session-v1";

function loadSession(): SessionLog[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionLog[];
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

function saveSession(rows: SessionLog[]) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(rows.slice(0, 40)));
  } catch {
    /* ignore */
  }
}

function fmtTime(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return "";
  }
}

/**
 * Mark Progress — scan hang tag → who + time chip → next piece.
 * Not Shop Floor. No ticket-level kanban. No stale offline ticket dump.
 */
export default function ProgressBoard() {
  const qc = useQueryClient();
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanBuf, setScanBuf] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [target, setTarget] = useState<{ ticket: string; garment: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState("");
  const [estMinutes, setEstMinutes] = useState<number | null>(null);
  const [session, setSession] = useState<SessionLog[]>(() => loadSession());

  // Keep gun / HID wedge focused
  useEffect(() => {
    if (dialogOpen) return;
    const id = window.setTimeout(() => scanRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [dialogOpen, session.length, target]);

  const tally = useQuery({
    queryKey: ["tailor-tally"],
    queryFn: async () => {
      const res = await api.raw("/api/garment/tally");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error?.message || "Tally failed");
      return j?.data ?? j;
    },
    staleTime: 45_000,
    refetchInterval: 90_000,
    retry: 1,
  });

  const openPiece = useCallback(async (ticket: string, garment: string) => {
    setScanBusy(true);
    setTarget({ ticket, garment });
    setLabel(`${ticket} · ${garment}`);
    setEstMinutes(null);
    setDialogOpen(true);
    try {
      const card = await api.post<GarmentJobCard>("/api/garment/job-card", {
        ticket,
        garment_id: garment,
      });
      const est = (card.lines ?? []).reduce((sum, l) => {
        const n = Number(
          l.est_minutes ?? (l as { estimated_minutes?: number }).estimated_minutes ?? 0,
        );
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
      if (est > 0) setEstMinutes(est);
      const cust = (card as { customer?: string; customer_name?: string }).customer
        || (card as { customer_name?: string }).customer_name;
      const gType = (card as { garment_type?: string }).garment_type;
      const bits = [cust, gType, garment].filter(Boolean);
      if (bits.length) setLabel(bits.join(" · "));
    } catch {
      /* dialog still works without job card */
    } finally {
      setScanBusy(false);
      setScanBuf("");
    }
  }, []);

  const handleScan = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value || scanBusy || dialogOpen) return;
      const parsed = parseProgressScanTarget(value);
      if (!parsed) {
        toast.error("Scan the hang tag (piece) — not the ticket thermal", {
          description: "Need /g/ALT-…/G1 or ALT-…/G1",
        });
        setScanBuf("");
        window.setTimeout(() => scanRef.current?.focus(), 40);
        return;
      }
      await openPiece(parsed.ticket, parsed.garment);
    },
    [dialogOpen, openPiece, scanBusy],
  );

  const confirmComplete = useCallback(
    async (worker: string, actualMinutes: number) => {
      if (!target) return;
      setSaving(true);
      try {
        const res = await api.post<GarmentActionResult>("/api/garment/complete", {
          ticket: target.ticket,
          garment_id: target.garment,
          worker,
          actual_minutes: actualMinutes,
        });
        const entry: SessionLog = {
          id: `${Date.now()}-${target.garment}`,
          at: Date.now(),
          ticket: target.ticket,
          garment: target.garment,
          label,
          worker,
          minutes: actualMinutes,
          allReady: res.all_garments_ready === true,
        };
        setSession((prev) => {
          const next = [entry, ...prev].slice(0, 40);
          saveSession(next);
          return next;
        });
        if (res.all_garments_ready === true) {
          toast.success("Order complete — customer notified", {
            description: `${target.garment} · ${actualMinutes}m · ${worker}`,
          });
        } else {
          toast.success(`Logged · ${target.garment} · ${actualMinutes}m`, {
            description: `${worker} · scan next piece`,
          });
        }
        void qc.invalidateQueries({ queryKey: ["shop-floor-tickets"] });
        void qc.invalidateQueries({ queryKey: ["alts-home-stats"] });
        void qc.invalidateQueries({ queryKey: ["pickup-ready"] });
        void qc.invalidateQueries({ queryKey: ["tailor-tally"] });
        setDialogOpen(false);
        setTarget(null);
        setLabel("");
        setEstMinutes(null);
        window.setTimeout(() => scanRef.current?.focus(), 80);
      } catch (e: any) {
        toast.error(e?.message || "Could not log complete — try again");
      } finally {
        setSaving(false);
      }
    },
    [label, qc, target],
  );

  const sessionCount = session.length;
  const todayPieces = (tally.data as { totals?: { pieces?: number } } | undefined)?.totals?.pieces;

  return (
    <div className="alts-root min-h-dvh flex flex-col overflow-x-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-[32px] leading-none">Mark Progress</div>
          <div className="caps mt-1">Scan piece · who · time · next</div>
        </div>
        <div className="flex-1" />
        <div className="text-right text-xs text-cream-dim hidden sm:block">
          <div>
            Session{" "}
            <strong className="text-cream tabular-nums">{sessionCount}</strong>
          </div>
          {typeof todayPieces === "number" && (
            <div>
              Today floor{" "}
              <strong className="text-cream tabular-nums">{todayPieces}</strong>
            </div>
          )}
        </div>
        <Link
          to="/scanner?mode=progress"
          className="h-11 px-4 rounded-full border border-brass/50 bg-brass/20 text-[12px] font-bold uppercase tracking-widest inline-flex items-center text-brass"
        >
          ⌗ Camera
        </Link>
        <Link
          to="/shop-floor"
          className="h-11 px-3 rounded-full border border-brass/25 text-[11px] font-bold uppercase tracking-widest inline-flex items-center text-cream-dim"
        >
          Shop floor
        </Link>
      </header>

      <main className="flex-1 px-4 sm:px-5 py-5 max-w-3xl mx-auto w-full space-y-5 pb-[max(6rem,calc(env(safe-area-inset-bottom)+4rem))]">
        {/* Primary scan station */}
        <section className="card-glass p-5 sm:p-6 space-y-4">
          <div>
            <div className="caps text-brass">Hang tag</div>
            <p className="text-sm text-cream-dim mt-1 leading-snug">
              Scan the <strong className="text-cream">piece QR</strong> (/g/…/G1) or paste{" "}
              <span className="font-mono text-brass-light">ALT-…/G1</span>. Not the thermal ticket.
              Pick who did it + time chip → next piece.
            </p>
          </div>

          <form
            className="flex items-center gap-2 rounded-2xl border-2 border-brass/50 bg-black/40 px-4 h-14"
            onSubmit={(e) => {
              e.preventDefault();
              void handleScan(scanBuf);
            }}
          >
            <span className="text-brass text-lg shrink-0" aria-hidden>
              ⌗
            </span>
            <input
              ref={scanRef}
              value={scanBuf}
              onChange={(e) => setScanBuf(e.target.value)}
              placeholder={scanBusy ? "Opening…" : "Gun / paste hang tag · ALT-…/G1"}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={scanBusy || dialogOpen}
              className="bg-transparent outline-none text-base flex-1 text-cream placeholder:text-cream-dim min-w-0"
              aria-label="Scan hang tag to log progress"
            />
            <button
              type="submit"
              disabled={scanBusy || !scanBuf.trim() || dialogOpen}
              className="shrink-0 h-10 px-4 rounded-xl bg-brass text-forest-deep text-xs font-bold uppercase tracking-wide disabled:opacity-40"
            >
              Log
            </button>
          </form>

          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/scanner?mode=progress"
              className="h-14 rounded-2xl border border-brass/40 bg-brass/15 grid place-items-center text-sm font-bold uppercase tracking-widest text-brass"
            >
              Camera scan
            </Link>
            <button
              type="button"
              onClick={() => {
                setScanBuf("");
                scanRef.current?.focus();
                toast.message("Ready — scan next hang tag");
              }}
              className="h-14 rounded-2xl border border-brass/25 grid place-items-center text-sm font-bold uppercase tracking-widest text-cream-dim"
            >
              Focus gun
            </button>
          </div>

          {sessionCount > 0 && (
            <div className="rounded-xl border border-signal-emerald/30 bg-signal-emerald/10 px-3 py-2 text-sm text-signal-emerald font-semibold">
              Session · {sessionCount} piece{sessionCount === 1 ? "" : "s"} logged — keep scanning
            </div>
          )}
        </section>

        <TailorTallyStrip />

        {/* This session */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="caps">This session</div>
            {session.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSession([]);
                  saveSession([]);
                }}
                className="text-[11px] uppercase tracking-widest text-cream-dim hover:text-cream"
              >
                Clear
              </button>
            )}
          </div>
          {!session.length && (
            <p className="text-sm text-cream-dim italic px-1 py-6 text-center">
              No pieces yet this session. Scan a hang tag to start.
            </p>
          )}
          <ul className="space-y-2">
            {session.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "card-glass px-3 py-3 flex gap-3 items-start",
                  row.allReady && "border border-signal-emerald/35",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{row.label || `${row.ticket} · ${row.garment}`}</div>
                  <div className="font-mono text-[11px] text-brass-light mt-0.5 truncate">
                    {row.ticket} · {row.garment}
                  </div>
                  <div className="text-xs text-cream-dim mt-1">
                    {row.worker} · {row.minutes}m · {fmtTime(row.at)}
                    {row.allReady ? " · order ready" : ""}
                  </div>
                </div>
                <Link
                  to={`/g/${encodeURIComponent(row.ticket)}/${encodeURIComponent(row.garment)}`}
                  className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-brass-light pt-1"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-[11px] text-cream-dim text-center leading-snug px-4">
          Shop Floor is the full rack board. This page is only{" "}
          <strong className="text-cream">scan → who → time → next piece</strong>.
        </p>
      </main>

      <CompleteGarmentDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setTarget(null);
            setLabel("");
            setEstMinutes(null);
            window.setTimeout(() => scanRef.current?.focus(), 80);
          }
        }}
        onConfirm={(worker, mins) => void confirmComplete(worker, mins)}
        isSubmitting={saving}
        defaultMinutes={estMinutes}
        ticket={target?.ticket}
        garmentId={target?.garment}
        title={label || "Log piece"}
        description="Who did it + time on the piece. Then scan the next hang tag."
      />
    </div>
  );
}
