import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Zap, ClipboardList, Scissors, Receipt,
  Truck, CheckSquare, Radio, MessageSquare, Users, Wallet,
  Palette, Layers, Shield, Building2, Settings, Bell, type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMaestroApprovalCount } from "@/lib/queries";
import { useMe } from "@/lib/session";
import type { UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

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

const ALL: UserRole[] = ["super_admin", "store_manager", "salesperson", "driver"];
const MGMT: UserRole[] = ["super_admin", "store_manager"];
const STAFF: UserRole[] = ["super_admin", "store_manager", "salesperson"];

const SECTIONS: NavSection[] = [
  {
    title: "House",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
      { to: "/mission-control", label: "Mission Control", icon: Zap, roles: MGMT },
    ],
  },
  {
    title: "Workshop",
    roles: STAFF,
    items: [
      { to: "/orders/custom", label: "Custom Orders", icon: ClipboardList, roles: STAFF },
      { to: "/orders/alterations", label: "Alterations", icon: Scissors, roles: STAFF },
      { to: "/sales-orders", label: "Sales Orders", icon: Receipt, roles: MGMT },
      { to: "/invoices", label: "Invoices", icon: Receipt, roles: MGMT },
    ],
  },
  {
    title: "Ops",
    roles: MGMT,
    items: [
      { to: "/deliveries", label: "Deliveries", icon: Truck, roles: ALL },
      { to: "/tasks", label: "Tasks", icon: CheckSquare, roles: MGMT },
      { to: "/comms", label: "Intelligence", icon: Radio, roles: MGMT },
    ],
  },
  {
    title: "Clients",
    roles: STAFF,
    items: [
      { to: "/sofia", label: "Sofia — SMS", icon: MessageSquare, roles: STAFF },
      { to: "/customers", label: "Customers", icon: Users, roles: MGMT },
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
    roles: ["super_admin"],
    items: [
      { to: "/admin/users", label: "Users", icon: Shield, roles: ["super_admin"] },
      { to: "/admin/locations", label: "Locations", icon: Building2, roles: ["super_admin"] },
      { to: "/admin/tailors", label: "Tailors", icon: Shield, roles: ["super_admin"] },
      { to: "/admin/overview", label: "Org Overview", icon: Shield, roles: ["super_admin"] },
    ],
  },
];

interface Props {
  role: UserRole;
  onNavigate?: () => void;
}

export function Sidebar({ role, onNavigate }: Props) {
  const { data: approvalCount = 0 } = useMaestroApprovalCount();
  const { data: me } = useMe();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-brass/15 bg-forest-deep/80 backdrop-blur-2xl">

      {/* ── Header ── */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Real L&S seal logo */}
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

          {/* Notification bell */}
          <div className="relative">
            <Bell className="h-4 w-4 text-cream-dim" />
            {approvalCount > 0 && (
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-signal-amber" />
            )}
          </div>
        </div>
        <div className="brass-divider mt-4" />
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4 scrollbar-none">
        {SECTIONS.filter((s) => !s.roles || s.roles.includes(role)).map((section) => {
          const items = section.items.filter((i) => i.roles.includes(role));
          if (items.length === 0) return null;
          return (
            <div key={section.title} className="mb-5">
              <div className="ui-label px-3 mb-1.5 text-[9px] tracking-widest">{section.title}</div>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(
                            "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors border-l-2 border-transparent",
                            "text-cream-muted hover:text-cream hover:bg-brass/5",
                            isActive && "sidebar-active",
                          )
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100" />
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* ── Footer — profile + settings ── */}
      <div className="border-t border-brass/15 px-4 py-4">
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
      </div>
    </aside>
  );
}
