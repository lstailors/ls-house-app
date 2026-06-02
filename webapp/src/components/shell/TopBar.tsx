import { useNavigate } from "react-router-dom";
import {
  Bell, LogOut, Menu, Search, Settings, UserRound, X,
  Users, FileText, Receipt, Scissors, Cpu, MessageSquare,
  AlertTriangle, CheckSquare, Zap, Clock, ChevronRight, QrCode,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/authClient";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import type { Profile } from "@/lib/types";
import { initials, formatDate } from "@/lib/format";
import { LocationBanner } from "./LocationBanner";
import { api } from "@/lib/api";
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
const RavenChat = lazy(() => import("@/components/RavenChat"));
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  store_manager: "Store Manager",
  salesperson: "Salesperson",
  driver: "Driver",
};

interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  amount?: number;
  href: string;
}

interface Notification {
  id: string;
  kind: string;
  priority: string;
  title: string;
  body?: string | null;
  meta?: string | null;
  ts?: string | null;
  href: string;
  read: boolean;
}

const TYPE_ICON: Record<string, React.ElementType> = {
  customer:     Users,
  alteration:   Scissors,
  sales_order:  Receipt,
  invoice:      FileText,
  fabric:       Scissors,
  task:         CheckSquare,
  intelligence: Cpu,
  sms:          MessageSquare,
};

const TYPE_LABEL: Record<string, string> = {
  customer:     "Customer",
  alteration:   "ALT Ticket",
  sales_order:  "Sales Order",
  invoice:      "Invoice",
  fabric:       "Fabric",
  task:         "Task",
  intelligence: "Intelligence",
  sms:          "Message",
};

const KIND_ICON: Record<string, React.ElementType> = {
  approval: Zap,
  task: CheckSquare,
  intelligence: Cpu,
  brief: FileText,
  invoice: AlertTriangle,
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "text-signal-rose",
  high: "text-signal-amber",
  normal: "text-cream-muted",
};

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-signal-rose",
  high: "bg-signal-amber",
  normal: "bg-brass/50",
};

function useDebounce<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const dq = useDebounce(q, 220);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["search", dq],
    queryFn: () => api.get<{ results: SearchResult[]; query: string }>(`/api/search?q=${encodeURIComponent(dq)}`),
    enabled: dq.length >= 2,
    staleTime: 10_000,
  });

  const results = data?.results ?? [];

  // Group by type
  const groups = results.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {} as Record<string, SearchResult[]>);

  const typeLabel: Record<string, string> = {
    customer: "Customers", alteration: "Alteration Tickets",
    sales_order: "Sales Orders", invoice: "Invoices",
    fabric: "Fabrics", task: "Tasks", intelligence: "Intelligence", sms: "Messages",
  };

  const go = (href: string) => { navigate(href); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" onClick={onClose}>
      <div
        className="absolute inset-0 bg-forest-deep/80 backdrop-blur-sm"
        aria-hidden
      />
      <div
        className="relative mx-auto mt-16 w-full max-w-2xl px-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 bg-forest-raised/95 border border-brass/30 rounded-xl px-4 py-3 shadow-2xl backdrop-blur-xl">
          <Search className="h-5 w-5 text-brass-light shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customers, orders, invoices, fabrics, tasks…"
            className="flex-1 bg-transparent text-cream text-base placeholder:text-cream-dim/60 focus:outline-none"
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          />
          {isFetching && (
            <div className="h-4 w-4 border-2 border-brass/40 border-t-brass rounded-full animate-spin shrink-0" />
          )}
          <button onClick={onClose} className="text-cream-dim hover:text-cream transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        {q.length >= 2 && (
          <div className="mt-2 bg-forest-raised/95 border border-brass/20 rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden max-h-[60vh] overflow-y-auto">
            {results.length === 0 && !isFetching && (
              <div className="px-5 py-8 text-center text-cream-dim text-sm">
                No results for <span className="text-cream italic">"{q}"</span>
              </div>
            )}
            {Object.entries(groups).map(([type, items]) => (
              <div key={type}>
                <div className="px-4 py-2 ui-label text-[9px] tracking-widest border-b border-brass/10 bg-forest-deep/30">
                  {typeLabel[type] ?? type}
                </div>
                {items.map((r) => {
                  const Icon = TYPE_ICON[r.type] ?? Search;
                  return (
                    <button
                      key={r.id}
                      onClick={() => go(r.href)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brass/8 transition-colors border-b border-brass/5 last:border-0 text-left"
                    >
                      <div className="h-8 w-8 rounded-lg bg-forest-deep/60 border border-brass/15 flex items-center justify-center shrink-0">
                        <Icon className="h-3.5 w-3.5 text-brass-light" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-cream text-sm font-medium truncate">{r.title}</div>
                        {r.subtitle && (
                          <div className="text-cream-dim text-xs truncate">{r.subtitle}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {r.meta && (
                          <span className="ui-label text-[9px] px-1.5 py-0.5 rounded border border-brass/15 text-brass-light">
                            {r.meta}
                          </span>
                        )}
                        {r.amount != null && (
                          <span className="font-display italic text-brass-shimmer text-sm">
                            ${Number(r.amount).toLocaleString()}
                          </span>
                        )}
                        <ChevronRight className="h-3 w-3 text-cream-dim" />
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
            {results.length > 0 && (
              <div className="px-4 py-2 text-[10px] text-cream-dim text-center border-t border-brass/10">
                {results.length} result{results.length !== 1 ? "s" : ""} · press Esc to close
              </div>
            )}
          </div>
        )}

        {q.length < 2 && (
          <div className="mt-2 bg-forest-raised/90 border border-brass/20 rounded-xl px-5 py-4 text-xs text-cream-dim backdrop-blur-xl">
            Type at least 2 characters · searches customers, orders, invoices, fabrics, tasks, messages
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ notifications: Notification[]; unread: number }>("/api/notifications"),
    refetchInterval: 60_000,
  });

  const notifications = data?.notifications ?? [];

  const go = (href: string) => { navigate(href); onClose(); };

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-forest-deep/50 backdrop-blur-sm" aria-hidden />
      <div
        className="absolute right-4 top-16 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-forest-raised/97 border border-brass/25 rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-brass/15">
            <div>
              <div className="text-cream text-sm font-medium">Notifications</div>
              {data?.unread ? (
                <div className="ui-label text-[9px] text-signal-amber mt-0.5">
                  {data.unread} requiring attention
                </div>
              ) : null}
            </div>
            <button onClick={onClose} className="text-cream-dim hover:text-cream transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-[70vh]">
            {isLoading && (
              <div className="px-4 py-8 text-center text-cream-dim text-sm">Loading…</div>
            )}
            {!isLoading && notifications.length === 0 && (
              <div className="px-4 py-8 text-center text-cream-dim text-sm">
                All clear — nothing pending.
              </div>
            )}
            {notifications.map((n) => {
              const Icon = KIND_ICON[n.kind] ?? Bell;
              return (
                <button
                  key={n.id}
                  onClick={() => go(n.href)}
                  className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-brass/6 transition-colors border-b border-brass/8 last:border-0 text-left"
                >
                  {/* Priority dot */}
                  <div className="flex flex-col items-center gap-1.5 shrink-0 pt-0.5">
                    <div className={cn("h-2 w-2 rounded-full shrink-0", PRIORITY_DOT[n.priority] ?? "bg-brass/40")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-xs font-medium leading-snug", PRIORITY_COLOR[n.priority] ?? "text-cream-muted")}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div className="text-[11px] text-cream-dim mt-0.5 leading-relaxed line-clamp-2">
                        {n.body}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      {n.meta && (
                        <span className="ui-label text-[9px] text-brass-light">{n.meta}</span>
                      )}
                      {n.ts && (
                        <span className="text-[9px] text-cream-dim flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDate(n.ts)}
                        </span>
                      )}
                    </div>
                  </div>
                  <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", PRIORITY_COLOR[n.priority] ?? "text-cream-dim")} />
                </button>
              );
            })}
          </div>

          <div className="px-4 py-2.5 border-t border-brass/10 text-[10px] text-cream-dim text-center">
            Refreshes every minute · tap any item to navigate
          </div>
        </div>
      </div>
    </div>
  );
}

interface Props {
  user: Profile;
  onMenuClick?: () => void;
}

export function TopBar({ user, onMenuClick }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Preload notification count
  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ notifications: Notification[]; unread: number }>("/api/notifications"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const unread = notifData?.unread ?? 0;
  const hasCritical = notifData?.notifications?.some((n) => n.priority === "critical") ?? false;

  // Cmd/Ctrl+K opens search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    qc.clear();
    navigate("/login");
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-2 sm:gap-4 border-b border-brass/15 bg-forest-deep/70 backdrop-blur-2xl px-3 sm:px-4 md:px-6">
        {/* Mobile menu */}
        <button
          type="button"
          onClick={onMenuClick}
          className="lg:hidden flex items-center justify-center h-11 w-11 -ml-1 rounded-md border border-brass/20 bg-forest-raised/40 hover:border-brass/40 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5 text-cream-muted" />
        </button>

        <LocationBanner user={user} />

        {/* Search bar — desktop */}
        <button
          onClick={() => setSearchOpen(true)}
          className="ml-2 hidden md:flex flex-1 max-w-md items-center gap-2 h-9 px-3 rounded-lg border border-brass/20 bg-forest-raised/40 hover:border-brass/35 transition-colors text-left"
        >
          <Search className="h-4 w-4 text-cream-dim shrink-0" />
          <span className="text-cream-dim/60 text-sm flex-1">Search everything…</span>
          <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] text-cream-dim border border-brass/20 rounded px-1.5 py-0.5 font-mono">
            ⌘K
          </kbd>
        </button>

        {/* Search icon — mobile */}
        <button
          onClick={() => setSearchOpen(true)}
          className="md:hidden flex items-center justify-center h-9 w-9 rounded-md border border-brass/20 bg-forest-raised/40 hover:border-brass/40 transition-colors"
        >
          <Search className="h-4 w-4 text-cream-muted" />
        </button>

        <div className="flex-1 md:hidden" />

        {/* QR Scanner button */}
        <button
          onClick={() => navigate("/scan")}
          className="h-9 w-9 rounded-full border border-brass/20 bg-forest-raised/40 hover:border-brass/40 transition-colors flex items-center justify-center"
          aria-label="QR Scanner"
          title="Scan QR code"
        >
          <QrCode className="h-4 w-4 text-cream-muted" />
        </button>

        {/* Team Chat button */}
        <button
          onClick={() => setChatOpen(true)}
          className="relative h-9 w-9 rounded-full border border-brass/20 bg-forest-raised/40 hover:border-brass/40 transition-colors flex items-center justify-center"
          aria-label="Team Chat"
          title="Team Chat"
        >
          <MessageSquare className="h-4 w-4 text-cream-muted" />
        </button>

        {/* Notification bell */}
        <button
          onClick={() => setNotifOpen(true)}
          className="relative h-9 w-9 rounded-full border border-brass/20 bg-forest-raised/40 hover:border-brass/40 transition-colors flex items-center justify-center"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4 text-cream-muted" />
          {unread > 0 && (
            <>
              <span className={cn(
                "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-forest-deep",
                hasCritical ? "bg-signal-rose" : "bg-signal-amber"
              )}>
                {unread > 9 ? "9+" : unread}
              </span>
            </>
          )}
        </button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 pr-1 pl-1 rounded-full border border-brass/20 hover:border-brass/40 transition-colors min-h-9">
              <Avatar className="h-8 w-8 border border-brass/30">
                <AvatarImage src={user.image ?? undefined} />
                <AvatarFallback className="bg-forest-raised text-brass-light text-xs font-medium">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:block pr-3 text-left leading-tight">
                <div className="text-xs text-cream">{user.name}</div>
                <div className="ui-label text-[9px] mt-0.5">{ROLE_LABEL[user.role]}</div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem] bg-forest-raised/95 backdrop-blur-xl border-brass/25">
            <DropdownMenuLabel className="text-cream">
              <div className="text-sm">{user.name}</div>
              <div className="ui-label text-[9px] mt-0.5">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-brass/15" />
            <DropdownMenuItem onClick={() => navigate("/settings")} className="text-cream-muted focus:bg-brass/10 focus:text-cream">
              <UserRound className="mr-2 h-4 w-4" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")} className="text-cream-muted focus:bg-brass/10 focus:text-cream">
              <Settings className="mr-2 h-4 w-4" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-brass/15" />
            <DropdownMenuItem onClick={handleSignOut} className="text-signal-rose focus:bg-signal-rose/10 focus:text-signal-rose">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
      {notifOpen && <NotificationPanel onClose={() => setNotifOpen(false)} />}
      <Suspense fallback={null}>
        <RavenChat open={chatOpen} onClose={() => setChatOpen(false)} />
      </Suspense>
    </>
  );
}
