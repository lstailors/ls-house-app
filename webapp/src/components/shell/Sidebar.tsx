import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Zap, ClipboardList, Scissors, Receipt,
  Truck, CheckSquare, Radio, MessageSquare, Users, Wallet,
  Palette, Layers, Shield, Building2, Settings, Bell,
  ChevronLeft, ChevronRight, FileText, Calendar, Headphones, CalendarCheck, type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMaestroApprovalCount, useTaskCount, useHelpdeskOpenCount } from "@/lib/queries";
import { useMe } from "@/lib/session";
import type { UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: UserRole[];
}

interface NavSection {
  title: string;
  items: NavItem[];
  roles?: UserRole[];
}

const ALL:   UserRole[] = ["super_admin", "store_manager", "salesperson", "driver", "tailor"];
const MGMT:  UserRole[] = ["super_admin", "store_manager"];
const STAFF: UserRole[] = ["super_admin", "store_manager", "salesperson", "tailor"];

const SECTIONS: NavSection[] = [
  {
    title: "House",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
      { to: "/mission-control", label: "Mission Control", icon: Zap, roles: MGMT },
      { to: "/house", label: "House", icon: Building2, roles: MGMT },
    ],
  },
  {
    title: "Workshop",
    roles: STAFF,
    items: [
      { to: "/orders/custom", label: "Custom Orders", icon: ClipboardList, roles: STAFF },
      { to: "/orders/alterations", label: "Alterations", icon: Scissors, roles: STAFF },
      { to: "https://erp.lstailors.com/lsh-scanner", label: "QR Scanner", icon: Zap, roles: ALL },
      { to: "/sales-orders", label: "Sales Orders", icon: Receipt, roles: MGMT },
      { to: "/invoices", label: "Invoices", icon: FileText, roles: MGMT },
    ],
  },
  {
    title: "Ops",
    roles: [...MGMT, "tailor", "salesperson"] as UserRole[],
    items: [
      { to: "/appointments", label: "Appointments", icon: CalendarCheck, roles: STAFF },
      { to: "/calendar", label: "Calendar", icon: Calendar, roles: STAFF },
      { to: "/deliveries", label: "Deliveries", icon: Truck, roles: ALL },
      { to: "/tasks", label: "Tasks", icon: CheckSquare, roles: MGMT },
      { to: "/comms", label: "Intelligence", icon: Radio, roles: [...MGMT, "salesperson"] as UserRole[] },
      { to: "/helpdesk", label: "Helpdesk", icon: Headphones, roles: [...MGMT, "salesperson"] as UserRole[] },
    ],
  },
  {
    title: "Clients",
    roles: STAFF,
    items: [
      { to: "/sofia", label: "Sofia — SMS", icon: MessageSquare, roles: STAFF },
      { to: "/customers", label: "Customers", icon: Users, roles: [...MGMT, "salesperson"] as UserRole[] },
    ],
  },
  {
    title: "Financials",
    roles: MGMT,
    items: [
      { to: "/financials", label: "Financials", icon: Wallet, roles: MGMT },
      { to: "/reference/fabrics", label: "Fabric Pricing", icon: Palette, roles: MGMT },
      { to: "/reference/styles", label: "Style Library", icon: Layers, roles: MGMT },
    ],
  },
  {
    title: "Admin",
    roles: ["super_admin", "salesperson"] as UserRole[],
    items: [
      { to: "/admin/users", label: "Users", icon: Shield, roles: ["super_admin"] },
      { to: "/admin/locations", label: "Locations", icon: Building2, roles: ["super_admin"] },
      { to: "/admin/tailors", label: "Tailors", icon: Shield, roles: ["super_admin"] },
      { to: "/admin/overview", label: "Org Overview", icon: Shield, roles: ["super_admin"] },
      { to: "/admin/board", label: "Alterations Board", icon: Scissors, roles: ["super_admin", "salesperson"] },
    ],
  },
];

export type SidebarMode = "expanded" | "icons" | "hidden";

interface Props {
  role: UserRole;
  onNavigate?: () => void;
  mode?: SidebarMode;
  onModeChange?: (mode: SidebarMode) => void;
}

export function Sidebar({ role, onNavigate, mode = "expanded", onModeChange }: Props) {
  const { data: approvalCount = 0 } = useMaestroApprovalCount();
  const { data: taskCountData } = useTaskCount();
  const { data: helpdeskCount } = useHelpdeskOpenCount();
  const { data: me } = useMe();
  const collapsed = mode === "icons";

  const cycleMode = () => {
    if (!onModeChange) return;
    if (mode === "expanded") onModeChange("icons");
    else onModeChange("expanded");
  };

  return (
    <TooltipProvider delayDuration={100}>
      <aside
        className={cn(
          "flex h-full flex-col border-r border-brass/15 bg-forest-deep/80 backdrop-blur-2xl transition-all duration-200",
          collapsed ? "w-[60px]" : "w-64",
        )}
      >
        {/* ── Header ── */}
        <div className={cn("pt-5 pb-4", collapsed ? "px-2" : "px-5")}>
          <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
            {!collapsed && (
              <div className="flex items-center gap-3">
                <img
                  src="/ls-logo-seal.png"
                  alt="L&S"
                  className="h-9 w-9 rounded-full object-cover border border-brass/25 shadow-glass"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
                <div className="leading-tight">
                  <div className="font-display italic text-lg text-cream">L&amp;S House</div>
                  <div className="ui-label mt-0 text-[9px]">Bespoke Operations</div>
                </div>
              </div>
            )}
            {collapsed && (
              <img
                src="/ls-logo-seal.png"
                alt="L&S"
                className="h-8 w-8 rounded-full object-cover border border-brass/25"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            )}

            {!collapsed && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Bell className="h-4 w-4 text-cream-dim" />
                  {approvalCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-signal-amber" />
                  )}
                </div>
                {onModeChange && (
                  <button
                    onClick={cycleMode}
                    className="text-cream-dim hover:text-cream transition-colors"
                    title="Collapse sidebar"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>
          {!collapsed && <div className="brass-divider mt-4" />}
        </div>

        {/* ── Nav ── */}
        <nav className={cn("flex-1 overflow-y-auto pb-4 scrollbar-none", collapsed ? "px-1.5" : "px-3")}>
          {SECTIONS.filter((s) => !s.roles || s.roles.includes(role)).map((section) => {
            const items = section.items.filter((i) => i.roles.includes(role));
            if (items.length === 0) return null;
            return (
              <div key={section.title} className="mb-4">
                {!collapsed && (
                  <div className="ui-label px-3 mb-1.5 text-[9px] tracking-widest">{section.title}</div>
                )}
                {collapsed && <div className="my-1.5 border-t border-brass/10" />}
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isTasksItem = item.to === "/tasks";
                    const isHelpdeskItem = item.to === "/helpdesk";
                    const taskCount = taskCountData?.count ?? 0;
                    const taskOverdue = taskCountData?.overdue ?? 0;
                    const hdCount = helpdeskCount?.total ?? 0;
                    const hdEscalated = (helpdeskCount?.escalated ?? 0) > 0;
                    const isExternal = item.to.startsWith("http");
                    const linkClass = cn(
                      "group flex items-center rounded-md transition-colors border-l-2 border-transparent",
                      collapsed ? "justify-center px-1.5 py-2" : "gap-3 px-3 py-2 text-sm",
                      "text-cream-muted hover:text-cream hover:bg-brass/5",
                    );
                    const linkContent = (
                      <>
                        <Icon className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100" />
                        {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                        {!collapsed && isTasksItem && taskCount > 0 ? (
                          <span className={cn(
                            "ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                            taskOverdue > 0 ? "bg-signal-rose/20 text-signal-rose" : "bg-brass/15 text-brass-light",
                          )}>{taskCount}</span>
                        ) : null}
                        {!collapsed && isHelpdeskItem && hdCount > 0 ? (
                          <span className={cn(
                            "ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                            hdEscalated ? "bg-signal-rose/20 text-signal-rose" : "bg-brass/15 text-brass-light",
                          )}>{hdCount}</span>
                        ) : null}
                      </>
                    );
                    const link = isExternal ? (
                      <a href={item.to} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className={linkClass}>
                        {linkContent}
                      </a>
                    ) : (
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        onClick={onNavigate}
                        className={({ isActive }) => cn(linkClass, isActive && "sidebar-active")}
                      >
                        {linkContent}
                      </NavLink>
                    );

                    if (collapsed) {
                      return (
                        <li key={item.to}>
                          <Tooltip>
                            <TooltipTrigger asChild>{link}</TooltipTrigger>
                            <TooltipContent side="right" className="bg-forest border-brass/20 text-cream text-xs">
                              {item.label}
                            </TooltipContent>
                          </Tooltip>
                        </li>
                      );
                    }

                    return <li key={item.to}>{link}</li>;
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* ── Footer ── */}
        <div className={cn("border-t border-brass/15 py-3", collapsed ? "px-1.5" : "px-4")}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <NavLink to="/settings" onClick={onNavigate}>
                    <Avatar className="h-7 w-7 border border-brass/25">
                      <AvatarImage src={me?.image ?? undefined} />
                      <AvatarFallback className="bg-forest-raised text-brass-light text-[10px]">
                        {initials(me?.name ?? "?")}
                      </AvatarFallback>
                    </Avatar>
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-forest border-brass/20 text-cream text-xs">
                  Settings
                </TooltipContent>
              </Tooltip>
              {onModeChange && (
                <button
                  onClick={cycleMode}
                  className="text-cream-dim hover:text-cream transition-colors mt-1"
                  title="Expand sidebar"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <NavLink
              to="/settings"
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-2 py-2 transition-colors",
                  "hover:bg-brass/5",
                  isActive && "sidebar-active",
                )
              }
            >
              <Avatar className="h-8 w-8 border border-brass/25 shrink-0">
                <AvatarImage src={me?.image ?? undefined} />
                <AvatarFallback className="bg-forest-raised text-brass-light text-xs">
                  {initials(me?.name ?? "?")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-cream truncate">{me?.name ?? "Account"}</div>
                <div className="text-[10px] text-cream-dim flex items-center gap-1.5">
                  <Settings className="h-2.5 w-2.5" /> Settings
                </div>
              </div>
            </NavLink>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
