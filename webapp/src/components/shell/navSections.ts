// Navigation definitions. Extracted from Sidebar.tsx so the same sidebar
// component can render a different menu per app target: the admin dashboard at
// app.lstailors.com and the alterations POS at alts.lstailors.com.
//
// The POS menu lives in src/alts/navSections.alts.ts.

import {
  LayoutDashboard, Zap, ClipboardList, Scissors, Receipt,
  Truck, CheckSquare, Radio, MessageSquare, Users, Wallet,
  Palette, Layers, Shield, Building2, FileText, Calendar,
  Headphones, CalendarCheck, Factory, Send, type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: UserRole[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
  roles?: UserRole[];
}

export interface NavBrand {
  title: string;
  subtitle: string;
}

export const ALL:   UserRole[] = ["super_admin", "store_manager", "salesperson", "driver", "tailor"];
export const MGMT:  UserRole[] = ["super_admin", "store_manager"];
export const STAFF: UserRole[] = ["super_admin", "store_manager", "salesperson", "tailor"];

export const ADMIN_BRAND: NavBrand = {
  title: "L&S House",
  subtitle: "Bespoke Operations",
};

export const ADMIN_SECTIONS: NavSection[] = [
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
      { to: "/shop-floor", label: "Shop Floor", icon: Factory, roles: STAFF },
      { to: "/orders/custom", label: "Custom Orders", icon: ClipboardList, roles: STAFF },
      // Read-only oversight — alterations are worked at alts.lstailors.com.
      { to: "/orders/alterations", label: "Alterations", icon: Scissors, roles: STAFF },
      { to: "/scanner", label: "QR Scanner", icon: Zap, roles: ALL },
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
      // Deliveries moved to the POS entirely — see src/alts/navSections.alts.ts.
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
      { to: "/dispatch", label: "Sofia Dispatch", icon: Send, roles: STAFF },
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
