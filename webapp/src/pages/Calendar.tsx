import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Calendar as CalIcon, MapPin, Clock, User, Filter } from "lucide-react";
import { SectionHeader } from "@/components/glass/SectionHeader";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Feed config ───────────────────────────────────────────────────────────────
const FEEDS = [
  { id: "nyc_appointments",      label: "NYC Appointments",   color: "bg-brass/80 border-brass",          dot: "bg-brass" },
  { id: "houston_appointments",  label: "HOU Appointments",   color: "bg-blue-500/70 border-blue-400",    dot: "bg-blue-400" },
  { id: "production_alterations",label: "Alterations Due",    color: "bg-purple-500/70 border-purple-400",dot: "bg-purple-400" },
  { id: "production_custom",     label: "Custom Delivery",    color: "bg-emerald-600/70 border-emerald-500",dot: "bg-emerald-400" },
  { id: "pickups_deliveries",    label: "Pickups & Deliveries",color: "bg-amber-500/70 border-amber-400",  dot: "bg-amber-400" },
];

const FEED_MAP = Object.fromEntries(FEEDS.map(f => [f.id, f]));

// ── Helpers ───────────────────────────────────────────────────────────────────
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function isoDate(d: Date)      { return d.toISOString().split("T")[0]; }
function fmtTime(iso: string)  {
  try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}
function fmtDate(iso: string)  {
  try { return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
  catch { return iso?.split("T")[0] ?? ""; }
}

interface CalEvent {
  id: string; feed: string; title: string; customer?: string;
  start: string; end?: string; status?: string;
  location?: string; tailor?: string; allDay?: boolean; erpName?: string;
}

// ── Event pill ────────────────────────────────────────────────────────────────
function EventPill({ ev, onClick }: { ev: CalEvent; onClick: () => void }) {
  const feed = FEED_MAP[ev.feed] ?? FEEDS[0];
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left text-[10px] px-1.5 py-0.5 rounded border truncate font-medium transition-opacity hover:opacity-80",
        feed.color, "text-white border-opacity-60"
      )}
    >
      {!ev.allDay && <span className="opacity-70 mr-1">{fmtTime(ev.start)}</span>}
      {ev.title}
    </button>
  );
}

// ── Event detail modal ────────────────────────────────────────────────────────
function EventModal({ ev, onClose }: { ev: CalEvent; onClose: () => void }) {
  const feed = FEED_MAP[ev.feed] ?? FEEDS[0];
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-panel-strong rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <span className={cn("w-3 h-3 rounded-full flex-shrink-0", feed.dot)} />
          <span className="ui-label text-brass-light text-[10px]">{feed.label}</span>
        </div>
        <h3 className="font-display italic text-xl text-cream mb-3 leading-snug">{ev.title}</h3>
        <div className="space-y-2 text-sm text-cream-muted">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-brass-light/60 flex-shrink-0" />
            <span>{fmtDate(ev.start)}{!ev.allDay && ` · ${fmtTime(ev.start)}`}</span>
          </div>
          {ev.customer && (
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-brass-light/60 flex-shrink-0" />
              <span>{ev.customer}</span>
            </div>
          )}
          {ev.location && (
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-brass-light/60 flex-shrink-0" />
              <span>{ev.location}</span>
            </div>
          )}
          {ev.tailor && (
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Tailor: {ev.tailor}</span>
            </div>
          )}
          {ev.status && (
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="capitalize">Status: {ev.status}</span>
            </div>
          )}
          {ev.erpName && (
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-mono text-xs">{ev.erpName}</span>
            </div>
          )}
        </div>
        <button onClick={onClose} className="mt-5 w-full text-center text-xs text-cream-dim hover:text-cream transition-colors">Close</button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [current, setCurrent] = useState(new Date());
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [activeFeeds, setActiveFeeds] = useState<Set<string>>(new Set(FEEDS.map(f => f.id)));
  const [showFeedFilter, setShowFeedFilter] = useState(false);
  const [view, setView] = useState<"month" | "list">("month");

  const start = isoDate(startOfMonth(current));
  const end = isoDate(endOfMonth(current));

  const { data, isLoading } = useQuery({
    queryKey: ["calendar", start, end],
    queryFn: () => api.get<CalEvent[]>(`/api/calendar/events?start=${start}&end=${end}`),
    staleTime: 2 * 60_000,
  });

  const allEvents: CalEvent[] = Array.isArray(data) ? data : (data as any)?.data ?? [];
  const events = useMemo(() => {
    const filtered = allEvents.filter(e => activeFeeds.has(e.feed));
    const seen = new Set<string>();
    return filtered.filter(e => {
      const key = `${e.title}|${e.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [allEvents, activeFeeds]);

  // Build calendar grid
  const monthStart = startOfMonth(current);
  const firstDow = monthStart.getDay(); // 0=Sun
  const daysInMonth = endOfMonth(current).getDate();
  const today = isoDate(new Date());

  const toggleFeed = (id: string) => {
    setActiveFeeds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const eventsOnDay = (day: number) => {
    const d = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return events.filter(e => e.start.startsWith(d));
  };

  const prevMonth = () => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const monthLabel = current.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-5 animate-fade-up">
      <SectionHeader
        eyebrow="L&S House · Calendar"
        title={<>The <span className="text-brass-shimmer">schedule</span>.</>}
        description="Appointments, production deadlines, pickups — all in one view."
      />

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Month nav */}
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-brass/10 text-cream-dim hover:text-cream transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-display italic text-lg text-cream min-w-[180px] text-center">{monthLabel}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-brass/10 text-cream-dim hover:text-cream transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center gap-0.5 border border-brass/15 rounded-lg p-0.5 bg-forest-raised/30">
            {(["month", "list"] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={cn("px-3 py-1.5 rounded text-xs font-medium transition-all capitalize",
                  view === v ? "bg-brass/20 text-cream border border-brass/30" : "text-cream-dim hover:text-cream"
                )}>{v}</button>
            ))}
          </div>
          {/* Feed filter */}
          <button onClick={() => setShowFeedFilter(f => !f)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all",
              showFeedFilter ? "border-brass/40 bg-brass/10 text-cream" : "border-brass/15 text-cream-muted hover:border-brass/30"
            )}>
            <Filter className="w-3.5 h-3.5" /> Calendars
          </button>
        </div>
      </div>

      {/* Feed legend / filter */}
      {showFeedFilter && (
        <div className="glass-panel p-4 rounded-xl border border-brass/15">
          <p className="ui-label mb-3 text-[10px]">Toggle calendars</p>
          <div className="flex flex-wrap gap-2">
            {FEEDS.map(f => (
              <button key={f.id} onClick={() => toggleFeed(f.id)}
                className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all",
                  activeFeeds.has(f.id) ? "border-brass/40 bg-brass/8 text-cream" : "border-brass/10 text-cream-dim opacity-50"
                )}>
                <span className={cn("w-2 h-2 rounded-full", f.dot)} />
                {f.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {FEEDS.map(f => (
              <span key={f.id} className="flex items-center gap-1 text-[10px] text-cream-dim">
                <span className={cn("w-2 h-2 rounded-full", f.dot)} />{f.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {isLoading && <div className="text-cream-muted text-sm">Loading…</div>}

      {/* Month grid */}
      {!isLoading && view === "month" && (
        <div className="glass-panel rounded-2xl border border-brass/10 overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-brass/10">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <div key={d} className="py-2 text-center ui-label text-[9px]">{d}</div>
            ))}
          </div>
          {/* Cells */}
          <div className="grid grid-cols-7">
            {/* Offset blanks */}
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`blank-${i}`} className="border-r border-b border-brass/5 min-h-[80px] bg-forest-deep/20" />
            ))}
            {/* Days */}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const dayStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayEvents = eventsOnDay(day);
              const isToday = dayStr === today;
              return (
                <div key={day} className={cn(
                  "border-r border-b border-brass/5 min-h-[80px] p-1 relative",
                  isToday && "bg-brass/5"
                )}>
                  <span className={cn(
                    "text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1",
                    isToday ? "bg-brass text-forest-deep font-bold" : "text-cream-dim"
                  )}>{day}</span>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map(ev => (
                      <EventPill key={ev.id} ev={ev} onClick={() => setSelected(ev)} />
                    ))}
                    {dayEvents.length > 3 && (
                      <p className="text-[9px] text-cream-dim px-1">+{dayEvents.length - 3} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* List view */}
      {!isLoading && view === "list" && (
        <div className="space-y-2">
          {events.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 text-center border border-dashed border-brass/15">
              <CalIcon className="w-8 h-8 text-cream-dim mx-auto mb-3" />
              <p className="text-cream-muted text-sm">No events this month with selected calendars.</p>
            </div>
          ) : (
            events.map(ev => {
              const feed = FEED_MAP[ev.feed] ?? FEEDS[0];
              return (
                <button key={ev.id} onClick={() => setSelected(ev)}
                  className="w-full text-left glass-panel rounded-xl p-4 border border-brass/10 hover:border-brass/30 transition-all flex items-start gap-3">
                  <span className={cn("w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0", feed.dot)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-cream text-sm font-medium truncate">{ev.title}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-cream-dim text-xs flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {fmtDate(ev.start)}{!ev.allDay && ` · ${fmtTime(ev.start)}`}
                      </span>
                      {ev.customer && <span className="text-cream-muted text-xs">{ev.customer}</span>}
                      {ev.location && (
                        <span className="text-cream-dim text-xs flex items-center gap-1">
                          <MapPin className="w-3 h-3" />{ev.location}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[9px] tracking-wider font-bold uppercase px-2 py-0.5 rounded border border-brass/15 text-cream-dim flex-shrink-0">
                    {feed.label}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Houston placeholder */}
      <div className="glass-panel rounded-xl p-4 border border-blue-400/15 flex items-center gap-3">
        <span className="w-2.5 h-2.5 rounded-full bg-blue-400 flex-shrink-0" />
        <div className="text-xs text-cream-muted">
          <span className="font-semibold text-cream">Houston Calendar</span> — placeholder until Kelvin's Cal.com event type is configured. Appointments will appear here automatically once set up.
        </div>
      </div>

      {selected && <EventModal ev={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
