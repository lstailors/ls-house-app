import { Route, Navigate, useParams } from "react-router-dom";
import { lazy } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { RoleGuard } from "@/components/shell/RoleGuard";
import type { UserRole } from "@ls/types";
import Dashboard from "@/pages/Dashboard";
import IntakeCustom from "@/pages/intake/IntakeCustom";
import OrdersCustom from "@/pages/orders/OrdersCustom";
import CustomOrderDetail from "@/pages/orders/CustomOrderDetail";

const SalesOrders = lazy(() => import("@/pages/orders/SalesOrders"));
const SalesOrderDetail = lazy(() => import("@/pages/orders/SalesOrderDetail"));
const Invoices = lazy(() => import("@/pages/orders/Invoices"));
const InvoiceDetail = lazy(() => import("@/pages/orders/InvoiceDetail"));
const Communications = lazy(() => import("@/pages/Communications"));
const Financials = lazy(() => import("@/pages/Financials"));
const OwnerDashboard = lazy(() => import("@/pages/OwnerDashboard"));
const Settings = lazy(() => import("@/pages/Settings"));
const AdminUsers = lazy(() => import("@/pages/admin/AdminUsers"));
const AdminLocations = lazy(() => import("@/pages/admin/AdminLocations"));
const LocationSettings = lazy(() => import("@/pages/admin/LocationSettings"));
const AdminTailors = lazy(() => import("@/pages/admin/AdminTailors"));
const AdminOverview = lazy(() => import("@/pages/admin/AdminOverview"));
const AdminBoard = lazy(() => import("@/pages/admin/AdminBoard"));
const OrdersAlterations = lazy(() => import("@/pages/orders/OrdersAlterations"));
const TicketDetail = lazy(() => import("@/pages/intake/TicketDetail"));
const FabricPricingPage = lazy(() => import("@/pages/reference/FabricPricingPage"));
const StyleLibraryPage = lazy(() => import("@/pages/reference/StyleLibraryPage"));
const Academy = lazy(() => import("@/pages/Academy"));
const MissionControl = lazy(() => import("@/pages/MissionControl"));
const AgentDetail = lazy(() => import("@/pages/mission-control/AgentDetail"));
const ApprovalsPage = lazy(() => import("@/pages/Approvals"));
const House = lazy(() => import("@/pages/house/House"));
const Tasks = lazy(() => import("@/pages/Tasks"));
const Comms = lazy(() => import("@/pages/Comms"));
const SofiaChat = lazy(() => import("@/pages/SofiaChat"));
const SofiaDispatch = lazy(() => import("@/pages/SofiaDispatch"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerDetail = lazy(() => import("@/pages/CustomerDetail"));
const CalendarPage = lazy(() => import("@/pages/Calendar"));
const AppointmentsPage = lazy(() => import("@/pages/Appointments"));
const Helpdesk = lazy(() => import("@/pages/Helpdesk"));
const HelpdeskTicketDetail = lazy(() => import("@/pages/helpdesk/HelpdeskTicketDetail"));

const MGMT: UserRole[] = ["super_admin", "store_manager"];
const SALES: UserRole[] = ["super_admin", "store_manager", "salesperson"];

function guard(allow: UserRole[], node: JSX.Element) {
  return <RoleGuard allow={allow}>{node}</RoleGuard>;
}

function RedirectKeepParams({ to }: { to: string }) {
  const params = useParams();
  let dest = to;
  for (const [key, value] of Object.entries(params)) {
    dest = dest.replace(`:${key}`, encodeURIComponent(String(value ?? "")));
  }
  return <Navigate to={dest} replace />;
}

/** House admin (webapp) nested under /admin — floor hub stays at /. */
export function AdminRouteTree() {
  return (
    <>
      <Route path="/admin" element={<AppShell />}>
        <Route index element={guard(MGMT, <Dashboard />)} />
        <Route path="mission-control" element={guard(MGMT, <MissionControl />)} />
        <Route path="mission-control/agents/:slug" element={guard(MGMT, <AgentDetail />)} />
        <Route path="approvals" element={guard(MGMT, <ApprovalsPage />)} />
        <Route path="house" element={guard(MGMT, <House />)} />
        <Route path="intake/custom" element={guard(SALES, <IntakeCustom />)} />
        <Route path="orders/custom" element={guard(SALES, <OrdersCustom />)} />
        <Route path="orders/custom/:id" element={guard(SALES, <CustomOrderDetail />)} />
        <Route path="orders/alterations" element={guard([...SALES, "tailor"], <OrdersAlterations />)} />
        <Route path="orders/alterations/:ticketName" element={guard([...SALES, "tailor"], <TicketDetail />)} />
        <Route path="sales-orders" element={guard(MGMT, <SalesOrders />)} />
        <Route path="sales-orders/:id" element={guard(MGMT, <SalesOrderDetail />)} />
        <Route path="invoices" element={guard(MGMT, <Invoices />)} />
        <Route path="invoices/:id" element={guard(MGMT, <InvoiceDetail />)} />
        <Route path="communications" element={guard(SALES, <Communications />)} />
        <Route path="financials" element={guard(MGMT, <Financials />)} />
        <Route path="owner" element={guard(["super_admin"], <OwnerDashboard />)} />
        <Route path="settings" element={<Settings />} />
        <Route path="reference/fabrics" element={guard(MGMT, <FabricPricingPage />)} />
        <Route path="reference/styles" element={guard(MGMT, <StyleLibraryPage />)} />
        <Route path="users" element={guard(["super_admin"], <AdminUsers />)} />
        <Route path="locations" element={guard(["super_admin"], <AdminLocations />)} />
        <Route path="locations/:code" element={guard(["super_admin"], <LocationSettings />)} />
        <Route path="tailors" element={guard(["super_admin"], <AdminTailors />)} />
        <Route path="overview" element={guard(["super_admin"], <AdminOverview />)} />
        <Route path="board" element={guard(["super_admin", "salesperson"], <AdminBoard />)} />
        <Route path="academy" element={<Academy />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="comms" element={<Comms />} />
        <Route path="sofia" element={<SofiaChat />} />
        <Route path="dispatch" element={<SofiaDispatch />} />
        <Route path="customers" element={guard(SALES, <Customers />)} />
        <Route path="customers/new" element={guard(SALES, <CustomerDetail />)} />
        <Route path="customers/:id" element={guard(SALES, <CustomerDetail />)} />
        <Route path="calendar" element={guard(SALES, <CalendarPage />)} />
        <Route path="appointments" element={guard([...SALES, "tailor"], <AppointmentsPage />)} />
        <Route path="helpdesk" element={guard(SALES, <Helpdesk />)} />
        <Route path="helpdesk/:id" element={guard(SALES, <HelpdeskTicketDetail />)} />
      </Route>

      {/* Old app.lstailors bookmarks → admin section (paths that do not clash with the floor hub) */}
      <Route path="/dashboard" element={<Navigate to="/admin" replace />} />
      <Route path="/mission-control" element={<Navigate to="/admin/mission-control" replace />} />
      <Route path="/mission-control/agents/:slug" element={<RedirectKeepParams to="/admin/mission-control/agents/:slug" />} />
      <Route path="/approvals" element={<Navigate to="/admin/approvals" replace />} />
      <Route path="/communications" element={<Navigate to="/admin/communications" replace />} />
      <Route path="/financials" element={<Navigate to="/admin/financials" replace />} />
      <Route path="/owner" element={<Navigate to="/admin/owner" replace />} />
      <Route path="/reference/fabrics" element={<Navigate to="/admin/reference/fabrics" replace />} />
      <Route path="/reference/styles" element={<Navigate to="/admin/reference/styles" replace />} />
      <Route path="/sales-orders" element={<Navigate to="/admin/sales-orders" replace />} />
      <Route path="/sales-orders/:id" element={<RedirectKeepParams to="/admin/sales-orders/:id" />} />
      <Route path="/orders/custom" element={<Navigate to="/admin/orders/custom" replace />} />
      <Route path="/orders/custom/:id" element={<RedirectKeepParams to="/admin/orders/custom/:id" />} />
      <Route path="/comms" element={<Navigate to="/admin/comms" replace />} />
      <Route path="/sofia" element={<Navigate to="/admin/sofia" replace />} />
      <Route path="/calendar" element={<Navigate to="/admin/calendar" replace />} />
      <Route path="/helpdesk" element={<Navigate to="/admin/helpdesk" replace />} />
      <Route path="/helpdesk/:id" element={<RedirectKeepParams to="/admin/helpdesk/:id" />} />
      <Route path="/academy" element={<Navigate to="/admin/academy" replace />} />
      <Route path="/intake/custom" element={<Navigate to="/admin/intake/custom" replace />} />
    </>
  );
}
