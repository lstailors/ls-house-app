import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { localFirstAppointments, localFirstHouseCal } from "@alts/offline/localFirst";
import { cn } from "@ls/design/utils";
import { BrandSeal } from "@alts/components/BrandSeal";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import LuxuryLayer from "@alts/components/LuxuryLayer";
import StatusBadge from "@alts/components/StatusBadge";
import { clientInitials, syncLabel } from "@alts/lib/ticketDisplay";
import { storeToday } from "@alts/lib/storeDate";
import "@alts/styles/alts-pos.css";

type Appt = {
  name: string;
  scheduledTime: string;
  endTime?: string | null;
  status: "Open" | "Unverified" | "Closed" | string;
  assignedAgent?: string | null;
  agentDisplayName?: string | null;
  customerName: string;
  customerPhone?: string | null;
  appointmentType?: string | null;
  isBlock?: false;
};

type Block = {
  name: string;
  subject: string;
  startsOn: string;
  endsOn?: string | null;
  agentDisplayName?: string | null;
  reason?: string | null;
  isWholeshop?: boolean;
  isBlock: true;
};

type HouseEvent = {
  id: string;
  feed: string;
  title: string;
  customer?: string | null;
  start: string;
  status?: string;
  tailor?: string | null;
  location?: string | null;
  allDay?: boolean;
  erpName?: string;
  deliveryNo?: string;
};

const FEED_LABEL: Record<string, string> = {
  nyc_appointments: "NYC appointments",
  houston_appointments: "Houston",
  production_alterations: "Alterations due",
  yz_ship: "Shipping / YZ",
  app_deliveries: "Deliveries",
  pickups_deliveries: "Pickups",
  birthdays: "Birthdays",
};

const FEED_TONES: Record<string, "pickup" | "qc" | "tasks" | "shop" | "neutral"> = {
  nyc_appointments: "shop",
  houston_appointments: "shop",
  production_alterations: "qc",
  yz_ship: "shop",
  app_deliveries: "pickup",
  pickups_deliveries: "pickup",
  birthdays: "tasks",
};

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

function fmtClock(raw?: string | null) {
  if (!raw) return "";
  const s = String(raw).includes("T") ? String(raw) : String(raw).replace(" ", "T");
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function dayLabel(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function phoneHref(phone?: string | null) {
  const digits = String(phone ?? "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
}

export default function AppointmentsGlass() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const today = storeToday();
  const [tab, setTab] = useState<"cal" | "today" | "week" | "house">("cal");
  const [cursor, setCursor] = useState(today);
  const [picked, setPicked] = useState<Appt | null>(null);
  const [feedsOn, setFeedsOn] = useState<Record<string, boolean>>({
    nyc_appointments: true,
    houston_appointments: true,
    production_alterations: true,
    yz_ship: true,
    app_deliveries: true,
    pickups_deliveries: true,
    birthdays: true,
  });

  const monthStart = `${cursor.slice(0, 7)}-01`;
  const monthEnd = addDays(addDays(monthStart, 32).slice(0, 8) + "01", -1);
  const weekEnd = addDays(cursor, 6);
  const rangeFrom = tab === "today" ? cursor : tab === "cal" ? monthStart : cursor;
  const rangeTo = tab === "today" ? cursor : tab === "cal" ? monthEnd : weekEnd;

  const book = useQuery({
    queryKey: ["alts-appointments", rangeFrom, rangeTo],
    queryFn: () =>
      localFirstAppointments<Appt, Block>(rangeFrom, rangeTo, () =>
        api.get<{ appointments: Appt[]; blocks: Block[] }>(
          `/api/appointments?date_from=${rangeFrom}&date_to=${rangeTo}`,
        ),
      ),
    refetchInterval: 60_000,
  });

  const house = useQuery({
    queryKey: ["alts-house-cal", rangeFrom, rangeTo],
    enabled: tab === "house" || tab === "cal",
    queryFn: () =>
      localFirstHouseCal<HouseEvent>(rangeFrom, rangeTo, () =>
        api.get<HouseEvent[]>(`/api/calendar/events?start=${rangeFrom}&end=${rangeTo}`),
      ),
    refetchInterval: 60_000,
  });

  const status = useMutation({
    mutationFn: ({ name, next }: { name: string; next: "confirm" | "complete" | "no_show" | "cancel" }) =>
      api.patch(`/api/appointments/${encodeURIComponent(name)}/status`, { status: next }),
    onSuccess: (_d, vars) => {
      toast.success(`${vars.name} · ${vars.next.replace("_", " ")}`);
      setPicked(null);
      qc.invalidateQueries({ queryKey: ["alts-appointments"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not update"),
  });

  const appts = book.data?.appointments ?? [];
  const blocks = book.data?.blocks ?? [];
  const houseRows = house.data ?? [];

  const byDay = useMemo(() => {
    const map = new Map<string, { appts: Appt[]; blocks: Block[] }>();
    for (let i = 0; i < (tab === "today" ? 1 : 7); i++) {
      map.set(addDays(cursor, i), { appts: [], blocks: [] });
    }
    for (const a of appts) {
      const day = String(a.scheduledTime || "").slice(0, 10);
      if (!map.has(day)) map.set(day, { appts: [], blocks: [] });
      map.get(day)!.appts.push(a);
    }
    for (const b of blocks) {
      const day = String(b.startsOn || "").slice(0, 10);
      if (!map.has(day)) map.set(day, { appts: [], blocks: [] });
      map.get(day)!.blocks.push(b);
    }
    return [...map.entries()];
  }, [appts, blocks, cursor, tab]);

  const houseByDay = useMemo(() => {
    const map = new Map<string, HouseEvent[]>();
    for (const ev of houseRows) {
      if (feedsOn[ev.feed] === false) continue;
      const day = String(ev.start || "").slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(ev);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [houseRows, feedsOn]);

  const live = syncLabel(book.dataUpdatedAt, book.isFetching);
  const counts = {
    today: appts.filter((a) => String(a.scheduledTime).slice(0, 10) === today).length,
    week: appts.length,
    house: houseRows.length,
  };

  const shift = (dir: number) => {
    if (tab === "cal") {
      const [y, m] = cursor.split("-").map(Number);
      const d = new Date(y, m - 1 + dir, 1);
      setCursor(isoDay(d));
      return;
    }
    setCursor((c) => addDays(c, tab === "today" ? dir : dir * 7));
  };

  const monthCells = useMemo(() => {
    const start = new Date(monthStart + "T12:00:00");
    const pad = start.getDay();
    const daysIn = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const cells: Array<{ iso: string | null; label: string }> = [];
    for (let i = 0; i < pad; i++) cells.push({ iso: null, label: "" });
    for (let d = 1; d <= daysIn; d++) {
      const iso = `${monthStart.slice(0, 7)}-${String(d).padStart(2, "0")}`;
      cells.push({ iso, label: String(d) });
    }
    return cells;
  }, [monthStart]);

  const houseVisible = houseRows.filter((ev) => feedsOn[ev.feed] !== false);

  const openHouse = (ev: HouseEvent) => {
    if (ev.feed === "production_alterations" && ev.erpName) {
      nav(`/orders/alterations/${encodeURIComponent(ev.erpName)}`);
      return;
    }
    if ((ev.feed === "app_deliveries" || ev.deliveryNo) && (ev.deliveryNo || ev.erpName)) {
      nav(`/deliveries/${encodeURIComponent(ev.deliveryNo || ev.erpName || "")}`);
    }
  };

  return (
    <div className="alts-root min-h-dvh flex flex-col">
      <header className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-brass/20 flex-wrap">
        <BrandSeal />
        <div className="min-w-0">
          <div className="display text-[32px] leading-none">Calendar</div>
          <div className="caps mt-1">House · fittings · shipping</div>
        </div>
        <div className="flex-1" />
        <div className={cn("sf-live", book.isFetching && "is-sync", book.isError && "is-down")}>
          <span className="dot" />
          {book.isError ? "ERPNext down" : live}
        </div>
      </header>

      <div className="px-4 sm:px-5 pt-3 flex flex-wrap gap-2">
        {(
          [
            ["cal", "Calendar", houseVisible.length],
            ["today", "Today", counts.today],
            ["week", "Week", counts.week],
            ["house", "List", counts.house],
          ] as const
        ).map(([k, lab, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border",
              tab === k ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
            <span className="og-count">{n}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} className="h-11 w-11 rounded-full border border-brass/25">
            ‹
          </button>
          <button
            type="button"
            onClick={() => setCursor(today)}
            className="h-11 px-3 rounded-full border border-brass/25 text-[11px] font-bold uppercase tracking-widest"
          >
            {cursor === today ? "Now" : dayLabel(cursor)}
          </button>
          <button type="button" onClick={() => shift(1)} className="h-11 w-11 rounded-full border border-brass/25">
            ›
          </button>
        </div>
      </div>

      {(tab === "cal" || tab === "house") && (
        <div className="px-4 sm:px-5 pt-3 flex flex-wrap gap-2">
          {Object.keys(FEED_LABEL).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFeedsOn((prev) => ({ ...prev, [id]: !prev[id] }))}
              className={cn(
                "h-11 px-3 rounded-full border text-[11px] font-bold uppercase tracking-widest",
                feedsOn[id]
                  ? "bg-brass/20 border-brass text-cream"
                  : "border-brass/20 text-cream-dim opacity-60",
              )}
            >
              {FEED_LABEL[id]}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]">
        {book.isError && (
          <QueryErrorPanel
            title="Could not load appointments"
            message={book.error instanceof Error ? book.error.message : "Retry — an empty day is not the same as an outage."}
            onRetry={() => book.refetch()}
          />
        )}

        {tab === "cal" && (
          <div>
            <div className="display text-[28px] mb-3">
              {new Date(monthStart + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="caps text-center text-[10px] py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthCells.map((cell, i) => {
                const events = cell.iso
                  ? houseVisible.filter((ev) => String(ev.start).slice(0, 10) === cell.iso)
                  : [];
                const apptN = cell.iso
                  ? appts.filter((a) => String(a.scheduledTime).slice(0, 10) === cell.iso).length
                  : 0;
                return (
                  <button
                    key={cell.iso || `pad-${i}`}
                    type="button"
                    disabled={!cell.iso}
                    onClick={() => cell.iso && setCursor(cell.iso)}
                    className={cn(
                      "min-h-[88px] rounded-xl border p-1.5 text-left align-top",
                      cell.iso === today && "border-brass bg-brass/15",
                      cell.iso && cell.iso !== today && "border-brass/15 bg-black/20",
                      !cell.iso && "border-transparent",
                    )}
                  >
                    <div className="text-[13px] font-bold tabular-nums">{cell.label}</div>
                    <div className="mt-1 space-y-0.5">
                      {events.slice(0, 3).map((ev) => (
                        <div key={ev.id} className="truncate">
                          <StatusBadge status={FEED_LABEL[ev.feed] || ev.feed} tone={FEED_TONES[ev.feed]} size="sm" />
                        </div>
                      ))}
                      {apptN > 0 && <StatusBadge status={`${apptN} fitting`} tone="shop" size="sm" />}
                      {events.length > 3 && (
                        <div className="text-[10px] text-cream-dim">+{events.length - 3}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-4">
              <div className="caps mb-2">{cursor === today ? "Today" : dayLabel(cursor)}</div>
              {houseVisible
                .filter((ev) => String(ev.start).slice(0, 10) === cursor)
                .map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => openHouse(ev)}
                    className="og-row sf-card w-full text-left card-glass px-4 py-3.5 mb-2"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={FEED_LABEL[ev.feed] || ev.feed} tone={FEED_TONES[ev.feed]} size="sm" />
                      {!ev.allDay && <span className="font-mono text-xs text-brass-light">{fmtClock(ev.start)}</span>}
                    </div>
                    <div className="display text-[22px] leading-none mt-1 truncate">{ev.customer || ev.title}</div>
                  </button>
                ))}
              {appts
                .filter((a) => String(a.scheduledTime).slice(0, 10) === cursor)
                .map((a) => (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => setPicked(a)}
                    className="og-row sf-card w-full text-left card-glass px-4 py-3.5 mb-2"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-brass-light">{fmtClock(a.scheduledTime)}</span>
                      <StatusBadge status={a.status} size="sm" />
                    </div>
                    <div className="display text-[22px] leading-none mt-1 truncate">{a.customerName}</div>
                  </button>
                ))}
              {!houseVisible.some((ev) => String(ev.start).slice(0, 10) === cursor) &&
                !appts.some((a) => String(a.scheduledTime).slice(0, 10) === cursor) && (
                  <div className="sf-empty">Nothing on this day.</div>
                )}
            </div>
          </div>
        )}

        {(tab === "today" || tab === "week") &&
          byDay.map(([day, rows]) => (
            <section key={day}>
              <div className="caps mb-2">{day === today ? "Today" : dayLabel(day)}</div>
              {rows.blocks.map((b) => (
                <div
                  key={b.name}
                  className="card-glass px-4 py-3 mb-2 border-l-2 border-l-signal-amber/70"
                >
                  <div className="text-[11px] font-bold uppercase tracking-widest text-signal-amber">
                    Blocked · {b.agentDisplayName || "Shop"}
                  </div>
                  <div className="display text-xl leading-none mt-1">{b.reason || b.subject}</div>
                  <div className="text-xs text-cream-dim mt-1">{fmtClock(b.startsOn)}</div>
                </div>
              ))}
              {rows.appts.map((a) => (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => setPicked(a)}
                  className="og-row sf-card w-full text-left card-glass px-4 py-3.5 flex items-center gap-3 mb-2"
                >
                  <span className="sf-avatar" aria-hidden>
                    {clientInitials(a.customerName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-brass-light">{fmtClock(a.scheduledTime) || "—"}</span>
                      <StatusBadge status={a.status} size="sm" />
                      {a.appointmentType && <span className="text-[11px] text-cream-dim">{a.appointmentType}</span>}
                    </div>
                    <div className="display text-[22px] leading-none mt-1 truncate">{a.customerName || "Client"}</div>
                    <div className="text-xs text-cream-dim mt-1 truncate">
                      {a.agentDisplayName || a.assignedAgent || "Unassigned"}
                    </div>
                  </div>
                  <div className="text-cream-dim">→</div>
                </button>
              ))}
              {!rows.appts.length && !rows.blocks.length && (
                <div className="sf-empty">Nothing on the book.</div>
              )}
            </section>
          ))}

        {tab === "house" && house.isError && (
          <QueryErrorPanel
            title="Could not load the house calendar"
            message="Due tickets and deliveries failed to load."
            onRetry={() => house.refetch()}
          />
        )}
        {tab === "house" &&
          houseByDay.map(([day, rows]) => (
            <section key={day}>
              <div className="caps mb-2">{day === today ? "Today" : dayLabel(day)}</div>
              {rows.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openHouse(ev)}
                  className="og-row sf-card w-full text-left card-glass px-4 py-3.5 mb-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={FEED_LABEL[ev.feed] || ev.feed} tone={FEED_TONES[ev.feed]} size="sm" />
                    {!ev.allDay && <span className="font-mono text-xs text-brass-light">{fmtClock(ev.start)}</span>}
                    {ev.status && <StatusBadge status={ev.status} size="sm" />}
                  </div>
                  <div className="display text-[22px] leading-none mt-1 truncate">{ev.customer || ev.title}</div>
                  <div className="text-xs text-cream-dim mt-1 truncate">
                    {ev.title}
                    {ev.location ? ` · ${ev.location}` : ""}
                    {ev.tailor ? ` · ${ev.tailor}` : ""}
                  </div>
                </button>
              ))}
            </section>
          ))}
        {tab === "house" && !house.isLoading && !houseByDay.length && (
          <div className="sf-empty">The house book is clear.</div>
        )}
      </div>

      <LuxuryLayer
        open={!!picked}
        onClose={() => setPicked(null)}
        variant="sheet"
        label="Appointment"
        z={70}
      >
        {picked && (
          <div
            className="w-full max-w-lg mx-auto rounded-t-[22px] border border-brass/30 border-b-0 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
          >
            <div className="flex justify-center pb-2" aria-hidden>
              <i className="block w-10 h-1 rounded-full bg-brass/40" />
            </div>
            <div className="caps text-brass-light">{fmtClock(picked.scheduledTime)}</div>
            <h2 className="display text-[32px] leading-none mt-1">{picked.customerName || "Client"}</h2>
            <p className="text-sm text-cream-dim mt-2">
              {[picked.appointmentType, picked.agentDisplayName || picked.assignedAgent, picked.status]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="flex flex-col gap-2 mt-5">
              {phoneHref(picked.customerPhone) && (
                <a href={phoneHref(picked.customerPhone)} className="btn-brass h-12 text-xs inline-flex items-center justify-center">
                  Call {picked.customerPhone}
                </a>
              )}
              {picked.status !== "Closed" && (
                <>
                  <button
                    type="button"
                    disabled={status.isPending}
                    onClick={() => status.mutate({ name: picked.name, next: "complete" })}
                    className="h-12 rounded-xl border border-brass/35 text-[11px] font-bold uppercase tracking-widest"
                  >
                    Mark complete
                  </button>
                  <button
                    type="button"
                    disabled={status.isPending}
                    onClick={() => status.mutate({ name: picked.name, next: "no_show" })}
                    className="h-12 rounded-xl border border-brass/25 text-[11px] font-bold uppercase tracking-widest text-cream-dim"
                  >
                    No show
                  </button>
                </>
              )}
              <button type="button" onClick={() => setPicked(null)} className="btn-ghost h-12 text-xs">
                Close
              </button>
            </div>
          </div>
        )}
      </LuxuryLayer>
    </div>
  );
}
