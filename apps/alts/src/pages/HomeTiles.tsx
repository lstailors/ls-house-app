import { Link, useNavigate } from "react-router-dom";
import { useMe } from "@/lib/session";
import { clearStoredToken } from "@/lib/authClient";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@ls/design/utils";

type Tile = {
  to: string;
  title: string;
  sub: string;
  primary?: boolean;
  external?: boolean;
  badgeKey?: "open" | "ready" | "due";
};

const TILES: Tile[] = [
  {
    to: "/intake/alterations",
    title: "New Ticket",
    sub: "Stepped intake · park · submit",
    primary: true,
  },
  {
    to: "/shop-floor",
    title: "Shop Floor",
    sub: "Board · due · unassigned",
    badgeKey: "open",
  },
  {
    to: "/pickup",
    title: "Pickup",
    sub: "Ready queue · pay · release",
    badgeKey: "ready",
  },
  {
    to: "/orders/alterations",
    title: "Orders",
    sub: "All tickets · search",
    badgeKey: "due",
  },
  {
    to: "/parked",
    title: "Parked",
    sub: "Resume carts · multi-piece waves",
  },
  {
    to: "/board",
    title: "Board",
    sub: "Pipeline view",
  },
  {
    to: "/scanner",
    title: "Scanner",
    sub: "Scan garment tags",
  },
  {
    to: "/customers",
    title: "Customers",
    sub: "Find or create",
  },
  {
    to: "/deliveries",
    title: "Deliveries",
    sub: "Ship · hand deliver · POD",
  },
];

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

export default function HomeTiles() {
  const { data: me } = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();

  const stats = useQuery({
    queryKey: ["alts-home-stats"],
    queryFn: async () => {
      try {
        const rows = await api.get<
          Array<{ workflow_state?: string; due_date?: string; name: string }>
        >("/api/intake-alterations/tickets?limit=200");
        const list = Array.isArray(rows) ? rows : (rows as any)?.tickets ?? [];
        const today = new Date().toISOString().slice(0, 10);
        let open = 0;
        let ready = 0;
        let dueToday = 0;
        let overdue = 0;
        for (const t of list) {
          const st = t.workflow_state ?? "";
          if (st === "Ready") ready += 1;
          if (st && st !== "Picked Up" && st !== "Cancelled") {
            open += 1;
            if (t.due_date) {
              if (t.due_date < today) overdue += 1;
              else if (t.due_date === today) dueToday += 1;
            }
          }
        }
        return { open, ready, dueToday, overdue };
      } catch {
        return { open: 0, ready: 0, dueToday: 0, overdue: 0 };
      }
    },
    staleTime: 60_000,
  });

  const s = stats.data ?? { open: 0, ready: 0, dueToday: 0, overdue: 0 };

  const logout = () => {
    clearStoredToken();
    qc.clear();
    nav("/login", { replace: true });
  };

  const initials = (me?.name ?? "LS")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const badgeFor = (key?: Tile["badgeKey"]) => {
    if (!key) return null;
    if (key === "open") return s.open || null;
    if (key === "ready") return s.ready || null;
    if (key === "due") return s.dueToday || null;
    return null;
  };

  return (
    <div
      className="min-h-screen flex flex-col px-5 py-4 md:px-7 md:py-5"
      style={{
        background: "radial-gradient(ellipse at 50% -12%, #17321F, #0D1A10 58%)",
      }}
    >
      {/* header */}
      <header className="flex items-center gap-3.5 pb-4 border-b border-brass/20">
        <div className="w-10 h-10 rounded-full border border-brass grid place-items-center font-display italic text-xl text-brass-light shrink-0 shadow-[inset_0_0_18px_rgba(176,141,87,0.14)]">
          LS
        </div>
        <div className="min-w-0">
          <div className="font-display italic text-[22px] font-semibold leading-tight">L&S House</div>
          <div className="text-[9.5px] tracking-[0.18em] uppercase text-cream-dim">
            Alterations · alts.lstailors.com
          </div>
        </div>
        <div className="flex-1" />
        <div className="hidden sm:flex gap-1 rounded-full border border-brass/20 bg-black/30 p-1">
          <span className="px-4 py-2.5 rounded-full text-[11px] font-bold tracking-widest uppercase bg-brass text-forest-deep">
            {typeof me?.location === "string"
              ? me.location
              : (me?.location as { name?: string } | undefined)?.name ||
                me?.locationId ||
                "NYC"}
          </span>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2.5 rounded-full border border-brass/20 bg-white/[0.04] pl-2 pr-3.5 py-1.5 hover:border-brass/40 transition-colors"
        >
          <span className="w-8 h-8 rounded-full bg-forest-raised border border-brass/30 grid place-items-center text-[11px] font-bold text-brass-light">
            {initials}
          </span>
          <span className="text-left hidden md:block">
            <span className="block text-xs font-semibold leading-tight">{me?.name ?? "Staff"}</span>
            <span className="block text-[9.5px] text-cream-dim capitalize">{me?.role?.replace("_", " ")}</span>
          </span>
        </button>
      </header>

      {/* greeting */}
      <div className="flex flex-wrap items-end gap-3 py-5">
        <div>
          <h1 className="font-display italic text-3xl md:text-[34px] font-semibold leading-none">
            {timeGreeting()}, {greetingName(me?.name)}
          </h1>
          <p className="text-xs text-cream-dim mt-1.5">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
            {" · "}
            Front of house
          </p>
        </div>
        <div className="flex-1" />
        {s.overdue > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-signal-rose/40 bg-signal-rose/10 text-[11.5px]">
            <b className="text-signal-rose font-bold">{s.overdue}</b> overdue
          </div>
        )}
        {s.dueToday > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-signal-amber/40 bg-signal-amber/10 text-[11.5px]">
            <b className="text-signal-amber font-bold">{s.dueToday}</b> due today
          </div>
        )}
      </div>

      {/* tiles */}
      <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3.5 min-h-0 content-start">
        {TILES.map((t) => {
          const badge = badgeFor(t.badgeKey);
          return (
            <Link
              key={t.to + t.title}
              to={t.to}
              className={cn(
                "relative rounded-[22px] border p-5 md:p-6 flex flex-col min-h-[140px] md:min-h-[160px]",
                "transition-all duration-150 active:scale-[0.988]",
                "bg-gradient-to-br from-white/[0.045] to-white/[0.012]",
                "border-brass/25 hover:border-brass/50 hover:-translate-y-0.5 hover:shadow-glass-lg",
                t.primary &&
                  "from-brass/20 to-brass/5 border-brass/50 hover:from-brass/28 hover:to-brass/8",
              )}
            >
              {badge != null && badge > 0 && (
                <span
                  className={cn(
                    "absolute top-4 right-4 min-w-[34px] h-[34px] px-2.5 rounded-full grid place-items-center",
                    "text-sm font-bold border",
                    t.badgeKey === "ready"
                      ? "bg-signal-amber/90 border-transparent text-forest-deep"
                      : "bg-white/[0.07] border-brass/30 text-cream",
                  )}
                >
                  {badge}
                </span>
              )}
              <h2 className="font-display italic text-2xl md:text-[26px] font-semibold leading-tight mt-auto">
                {t.title}
              </h2>
              <p className="text-[11px] text-cream-dim mt-1.5 leading-snug pr-6">{t.sub}</p>
              <span className="absolute bottom-5 right-5 text-brass-dark opacity-50">→</span>
            </Link>
          );
        })}
      </div>

      {/* footer strip */}
      <div className="mt-4 rounded-[15px] border border-brass/15 bg-black/25 flex flex-wrap overflow-hidden">
        <div className="flex-1 min-w-[120px] px-4 py-3 flex items-baseline gap-2 border-r border-brass/10">
          <span className="text-[9.5px] font-bold tracking-widest uppercase text-cream-dim">Open</span>
          <span className="font-display text-2xl font-semibold ml-auto text-signal-emerald">{s.open}</span>
        </div>
        <div className="flex-1 min-w-[120px] px-4 py-3 flex items-baseline gap-2 border-r border-brass/10">
          <span className="text-[9.5px] font-bold tracking-widest uppercase text-cream-dim">Ready</span>
          <span className="font-display text-2xl font-semibold ml-auto text-signal-amber">{s.ready}</span>
        </div>
        <div className="flex-1 min-w-[120px] px-4 py-3 flex items-baseline gap-2">
          <span className="text-[9.5px] font-bold tracking-widest uppercase text-cream-dim">Due today</span>
          <span className="font-display text-2xl font-semibold ml-auto">{s.dueToday}</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-3 text-[10px] text-cream-dim">
          <span className="w-1.5 h-1.5 rounded-full bg-signal-emerald shadow-[0_0_8px_rgba(79,191,142,0.7)]" />
          API · app.lstailors.com
        </div>
      </div>
    </div>
  );
}
