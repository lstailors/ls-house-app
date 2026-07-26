// POS menu for alts.lstailors.com.
//
// Deliberately much shorter than the admin menu: this is a counter tool used on
// an iPad, so it carries only what someone standing in front of a customer
// needs. Anything analytical, financial, or administrative stays on
// app.lstailors.com.

import {
  Scissors, Zap, Users, Truck, CalendarCheck, Calendar,
  MessageSquare, Send, Home, Factory,
} from "lucide-react";
import {
  ALL, MGMT, STAFF,
  type NavBrand, type NavSection,
} from "@/components/shell/navSections";
import type { UserRole } from "@/lib/types";

export const ALTS_BRAND: NavBrand = {
  title: "L&S Alterations",
  subtitle: "Counter",
};

const SALES: UserRole[] = [...MGMT, "salesperson"] as UserRole[];

export const ALTS_SECTIONS: NavSection[] = [
  {
    title: "Counter",
    items: [
      { to: "/", label: "Today", icon: Home, roles: ALL },
      { to: "/intake/alterations", label: "New Ticket", icon: Scissors, roles: STAFF },
      { to: "/orders/alterations", label: "Tickets", icon: Factory, roles: STAFF },
      { to: "/scanner", label: "Scan", icon: Zap, roles: ALL },
      { to: "/customers", label: "Customers", icon: Users, roles: SALES },
    ],
  },
  {
    title: "Schedule",
    roles: STAFF,
    items: [
      { to: "/appointments", label: "Appointments", icon: CalendarCheck, roles: STAFF },
      { to: "/calendar", label: "Calendar", icon: Calendar, roles: SALES },
    ],
  },
  {
    title: "Deliveries",
    items: [{ to: "/deliveries", label: "Deliveries", icon: Truck, roles: ALL }],
  },
  {
    title: "Messages",
    roles: STAFF,
    items: [
      { to: "/sofia", label: "Sofia — SMS", icon: MessageSquare, roles: STAFF },
      { to: "/dispatch", label: "Dispatch", icon: Send, roles: STAFF },
    ],
  },
];
