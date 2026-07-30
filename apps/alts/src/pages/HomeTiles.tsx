import { Link, useNavigate } from "react-router-dom";
import { useMe } from "@ls/auth/session";
import { signOut } from "@ls/auth/authClient";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { useMemo } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import "@alts/styles/alts-pos.css";

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

export default function HomeTiles() {
  const { data: me } = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();

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
    await signOut();
    qc.clear();
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
    <div className="alts-root home-007 flex flex-col h-[100dvh] overflow-hidden px-[26px] pt-[18px] pb-4">
      <header className="flex items-center gap-3.5 pb-4 border-b border-brass/15 shrink-0">
        <div className="seal">LS</div>
        <div className="min-w-0">
          <div className="display text-[22px] leading-tight">L&S House</div>
          <div className="text-xs tracking-[0.18em] uppercase text-[var(--cd)]">
            Alterations · alts.lstailors.com
          </div>
        </div>
        <div className="flex-1" />
        <div className="hidden sm:flex items-center rounded-full border border-brass/20 bg-black/30 px-[18px] py-[11px] text-xs font-bold tracking-[0.14em] uppercase text-brass-light">
          NYC
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2.5 rounded-full border border-brass/20 bg-white/[0.04] pl-2 pr-3.5 py-1.5 min-h-[44px] hover:border-brass/40 transition-colors"
        >
          <span className="w-8 h-8 rounded-full bg-forest-raised border border-brass/30 grid place-items-center text-xs font-bold text-brass-light">
            {initials}
          </span>
          <span className="text-left hidden md:block">
            <span className="block text-xs font-semibold leading-tight">{me?.name ?? "Staff"}</span>
            <span className="block text-xs text-[var(--cd)] capitalize">
              {me?.role?.replace(/_/g, " ") || "Front of house"}
            </span>
          </span>
        </button>
      </header>

      <div className="flex flex-wrap items-end gap-3 py-5 shrink-0">
        <div>
          <h1 className="display text-[34px] leading-none">
            {timeGreeting()}, {greetingName(me?.name)}
          </h1>
          <p className="text-xs text-[var(--cd)] mt-1.5">{storeHoursLine()}</p>
        </div>
        <div className="flex-1" />
        {s.parked > 0 && (
          <Link
            to="/parked"
            className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-brass/35 bg-brass/10 text-xs text-cream hover:border-brass/55"
          >
            <b className="text-brass-light font-bold">{s.parked}</b> parked
          </Link>
        )}
        {s.overdue > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-[rgba(217,123,108,0.42)] bg-[rgba(217,123,108,0.12)] text-xs">
            <b className="text-[var(--ro)] font-bold">{s.overdue}</b> overdue
          </div>
        )}
        {s.dueToday > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-[rgba(232,168,92,0.4)] bg-[rgba(232,168,92,0.12)] text-xs">
            <b className="text-[var(--am)] font-bold">{s.dueToday}</b> due today
          </div>
        )}
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

      <div className="flex-1 min-h-0 grid grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-[15px]">
        {tiles.map((t) => {
          const className = cn(
            "relative rounded-[22px] border p-[22px] flex flex-col min-h-0 overflow-hidden",
            "transition-all duration-150 active:scale-[0.988] cursor-pointer group",
            "bg-gradient-to-br from-white/[0.045] to-white/[0.012]",
            "border-brass/25 hover:border-brass/50 hover:-translate-y-0.5 hover:shadow-[var(--sl)] hover:from-white/[0.085] hover:to-white/[0.025]",
            t.primary &&
              "from-brass/20 to-brass/5 border-brass/50 hover:from-brass/28 hover:to-brass/8",
            t.external && "border-dashed border-brass/40",
            // HER-75 Deliveries tile — violet-tinted border (board-owned surface)
            t.key === "deliveries" &&
              "border-[rgba(155,139,196,0.42)] hover:border-[rgba(155,139,196,0.65)] from-[rgba(155,139,196,0.10)] to-white/[0.012]",
          );

          const body = (
            <>
              {t.badge != null && t.badge > 0 && (
                <span
                  className={cn(
                    "absolute top-[18px] right-[18px] min-w-[34px] h-[34px] px-[11px] rounded-full grid place-items-center text-sm font-bold border",
                    t.badgeKind === "alert" && "bg-[rgba(217,123,108,0.9)] border-transparent text-white",
                    t.badgeKind === "warn" && "bg-[rgba(232,168,92,0.9)] border-transparent text-forest-deep",
                    (!t.badgeKind || t.badgeKind === "neutral") && "bg-white/[0.07] border-brass/30 text-cream",
                  )}
                >
                  {t.badge}
                </span>
              )}
              <div className={cn("text-brass-light opacity-90 mb-auto", t.primary && "text-[#E3C48F] opacity-100")}>
                {t.icon}
              </div>
              <h2 className={cn("display mt-3.5 leading-tight", t.external ? "text-[23px]" : "text-[26px]")}>
                {t.title}
              </h2>
              <p className="text-xs text-[var(--cd)] mt-1.5 leading-snug pr-8">{t.sub}</p>
              {t.external && (
                <div className="font-mono text-xs text-[var(--bd)] tracking-wide mt-2">app.lstailors.com ↗</div>
              )}
              <span className="absolute bottom-5 right-[22px] text-[var(--bd)] opacity-55 group-hover:opacity-100 group-hover:text-brass-light transition-opacity">
                <Arrow external={t.external} />
              </span>
            </>
          );

          if (t.href) {
            return (
              <a key={t.key} href={t.href} target="_blank" rel="noreferrer" className={className}>
                {body}
              </a>
            );
          }
          return (
            <Link key={t.key} to={t.to!} className={className}>
              {body}
            </Link>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 shrink-0">
        {[
          { to: "/dispatch", lab: "Charge & dispatch" },
          { to: "/invoices", lab: `Invoices${s.openInvoices ? ` · ${s.openInvoices}` : ""}` },
          { to: "/quote", lab: "Send quote" },
          { to: "/orders/alterations", lab: "Orders" },
          { to: "/parked", lab: `Parked${s.parked ? ` · ${s.parked}` : ""}` },
        ].map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="h-10 px-4 rounded-full border border-brass/25 bg-black/25 text-xs font-bold tracking-widest uppercase text-brass-light inline-flex items-center hover:border-brass/50"
          >
            {l.lab}
          </Link>
        ))}
      </div>

      {/* HER-75: 3×2 status strip — six metrics without wrap-shear at tablet landscape */}
      <div className="mt-[15px] rounded-[15px] border border-brass/15 bg-black/25 grid grid-cols-2 sm:grid-cols-3 overflow-hidden shrink-0">
        <div className="px-[18px] py-[13px] flex items-baseline gap-2.5 border-r border-b border-brass/10">
          <span className="text-xs font-bold tracking-[0.16em] uppercase text-[var(--cd)]">Open tickets</span>
          <span className="display text-2xl ml-auto">{s.open}</span>
        </div>
        <div className="px-[18px] py-[13px] flex items-baseline gap-2.5 border-r border-b border-brass/10 sm:border-r">
          <span className="text-xs font-bold tracking-[0.16em] uppercase text-[var(--cd)]">Ready for pickup</span>
          <span className="display text-2xl ml-auto text-[var(--em)]">{s.ready}</span>
        </div>
        <div className="px-[18px] py-[13px] flex items-baseline gap-2.5 border-b border-brass/10 border-r sm:border-r-0">
          <span className="text-xs font-bold tracking-[0.16em] uppercase text-[var(--cd)]">Out to tailors</span>
          <span className="display text-2xl ml-auto text-[var(--am)]">{s.outToTailors}</span>
        </div>
        <div className="px-[18px] py-[13px] flex items-baseline gap-2.5 border-r border-brass/10">
          <span className="text-xs font-bold tracking-[0.16em] uppercase text-[var(--cd)]">Out for delivery</span>
          <span className="display text-2xl ml-auto text-[var(--am)]">{s.outForDelivery}</span>
        </div>
        <div className="px-[18px] py-[13px] flex items-baseline gap-2.5 border-r border-brass/10">
          <span className="text-xs font-bold tracking-[0.16em] uppercase text-[var(--cd)]">Delivered today</span>
          <span className="display text-2xl ml-auto text-[var(--em)]">{s.deliveredToday}</span>
        </div>
        <div className="px-[18px] py-[13px] flex items-baseline gap-2.5">
          <span className="text-xs font-bold tracking-[0.16em] uppercase text-[var(--cd)]">Overdue</span>
          <span className="display text-2xl ml-auto text-[var(--ro)]">{s.overdue}</span>
        </div>
        <div className="col-span-2 sm:col-span-3 flex items-center gap-2 px-[18px] py-[11px] text-xs text-[var(--cd)] border-t border-brass/10">
          <span
            className={cn(
              "w-[7px] h-[7px] rounded-full",
              stats.isError
                ? "bg-[var(--am)] shadow-[0_0_8px_rgba(232,168,92,0.7)]"
                : "bg-[var(--em)] shadow-[0_0_8px_rgba(79,191,142,0.7)]",
            )}
          />
          {stats.isError ? "ERPNext unreachable · retry above" : `ERPNext live · synced ${syncAge}`}
        </div>
      </div>
    </div>
  );
}
