import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Zap,
  Scissors,
  ShoppingBag,
  ClipboardList,
  Receipt,
  Truck,
  MessageCircle,
  Wallet,
  Settings,
  Shield,
  Palette,
  Layers,
  GraduationCap,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Monogram } from "../glass/Monogram";

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

const SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
      { to: "/mission-control", label: "Mission Control", icon: Zap, roles: ["super_admin", "store_manager"] },
    ],
  },
  {
    title: "Intake",
    roles: ["super_admin", "store_manager", "salesperson"],
    items: [
      { to: "/intake/alterations", label: "Alteration Ticket", icon: Scissors, roles: ["super_admin", "store_manager", "salesperson"] },
      { to: "/intake/custom", label: "Custom Made (POS)", icon: ShoppingBag, roles: ["super_admin", "store_manager", "salesperson"] },
    ],
  },
  {
    title: "Orders",
    roles: ["super_admin", "store_manager", "salesperson"],
    items: [
      { to: "/orders/alterations", label: "Alterations", icon: Scissors, roles: ["super_admin", "store_manager", "salesperson"] },
      { to: "/orders/custom", label: "Custom Orders", icon: ClipboardList, roles: ["super_admin", "store_manager", "salesperson"] },
      { to: "/sales-orders", label: "Sales Orders", icon: Receipt, roles: ["super_admin", "store_manager"] },
      { to: "/invoices", label: "Invoices", icon: Receipt, roles: ["super_admin", "store_manager"] },
    ],
  },
  {
    title: "Logistics",
    items: [
      { to: "/deliveries", label: "Deliveries", icon: Truck, roles: ALL },
    ],
  },
  {
    title: "Customer",
    roles: ["super_admin", "store_manager", "salesperson"],
    items: [
      { to: "/communications", label: "Sofia — Comms", icon: MessageCircle, roles: ["super_admin", "store_manager", "salesperson"] },
    ],
  },
  {
    title: "Financials",
    roles: ["super_admin", "store_manager"],
    items: [
      { to: "/financials", label: "Financials", icon: Wallet, roles: ["super_admin", "store_manager"] },
    ],
  },
  {
    title: "Reference Data",
    roles: ["super_admin", "store_manager"],
    items: [
      { to: "/reference/fabrics", label: "Fabric Pricing", icon: Palette, roles: ["super_admin", "store_manager"] },
      { to: "/reference/styles", label: "Style Library", icon: Layers, roles: ["super_admin", "store_manager"] },
    ],
  },
  {
    title: "Super Admin Portal",
    roles: ["super_admin"],
    items: [
      { to: "/admin/users", label: "Users", icon: Shield, roles: ["super_admin"] },
      { to: "/admin/locations", label: "Locations", icon: Shield, roles: ["super_admin"] },
      { to: "/admin/tailors", label: "Tailors", icon: Shield, roles: ["super_admin"] },
      { to: "/admin/overview", label: "Org Overview", icon: Shield, roles: ["super_admin"] },
    ],
  },
  {
    title: "L&S Academy",
    items: [
      { to: "/academy", label: "Coming Soon", icon: GraduationCap, roles: ALL },
    ],
  },
  {
    title: "Account",
    items: [
      { to: "/settings", label: "Settings", icon: Settings, roles: ALL },
    ],
  },
];

interface Props {
  role: UserRole;
  onNavigate?: () => void;
}

export function Sidebar({ role, onNavigate }: Props) {
  return (
    <aside className="flex h-full w-64 flex-col border-r border-brass/15 bg-forest-deep/80 backdrop-blur-2xl">
      <div className="relative px-5 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <Monogram size="md" />
          <div className="leading-tight">
            <div className="font-display italic text-xl text-cream">L&amp;S House</div>
            <div className="ui-label mt-0.5 text-[9px]">Bespoke Operations</div>
          </div>
        </div>
        <div className="brass-divider mt-5" />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-6 scrollbar-none">
        {SECTIONS.filter((s) => !s.roles || s.roles.includes(role)).map((section) => {
          const items = section.items.filter((i) => i.roles.includes(role));
          if (items.length === 0) return null;
          return (
            <div key={section.title} className="mb-6">
              <div className="ui-label px-3 mb-2">{section.title}</div>
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
      <div className="border-t border-brass/15 px-5 py-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widerer text-cream-dim">
          <BookOpen className="h-3 w-3" />
          v0.1 · Prototype
        </div>
      </div>
    </aside>
  );
}
