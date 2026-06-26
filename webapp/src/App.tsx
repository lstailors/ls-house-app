import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { RoleGuard } from "@/components/shell/RoleGuard";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import IntakeAlterations from "./pages/intake/IntakeAlterations";
import IntakeCustom from "./pages/intake/IntakeCustom";
import OrdersAlterations from "./pages/orders/OrdersAlterations";
import OrdersCustom from "./pages/orders/OrdersCustom";
import CustomOrderDetail from "./pages/orders/CustomOrderDetail";
import TicketDetail from "./pages/intake/TicketDetail";

// Lazy-loaded pages — loaded on first visit only
const SalesOrders = lazy(() => import('./pages/orders/SalesOrders'));
const SalesOrderDetail = lazy(() => import('./pages/orders/SalesOrderDetail'));
const Invoices = lazy(() => import('./pages/orders/Invoices'));
const InvoiceDetail = lazy(() => import('./pages/orders/InvoiceDetail'));
const Deliveries = lazy(() => import('./pages/Deliveries'));
const DeliveryTracking = lazy(() => import('./pages/DeliveryTracking'));
const DeliveryLabel = lazy(() => import('./pages/DeliveryLabel'));
const DeliveryDetail = lazy(() => import('./pages/DeliveryDetail'));
const Communications = lazy(() => import('./pages/Communications'));
const Financials = lazy(() => import('./pages/Financials'));
const Settings = lazy(() => import('./pages/Settings'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminLocations = lazy(() => import('./pages/admin/AdminLocations'));
const LocationSettings = lazy(() => import('./pages/admin/LocationSettings'));
const AdminTailors = lazy(() => import('./pages/admin/AdminTailors'));
const AdminOverview = lazy(() => import('./pages/admin/AdminOverview'));
const AdminBoard = lazy(() => import('./pages/admin/AdminBoard'));
const FabricPricingPage = lazy(() => import('./pages/reference/FabricPricingPage'));
const StyleLibraryPage = lazy(() => import('./pages/reference/StyleLibraryPage'));
const Academy = lazy(() => import('./pages/Academy'));
const MissionControl = lazy(() => import('./pages/MissionControl'));
const AgentDetail = lazy(() => import('./pages/mission-control/AgentDetail'));
const House = lazy(() => import('./pages/house/House'));
const AlterationTags = lazy(() => import('./pages/intake/AlterationTags'));
const AlterationReceipt = lazy(() => import('./pages/intake/AlterationReceipt'));
const GarmentTag = lazy(() => import('./pages/GarmentTag'));
const PayInvoice = lazy(() => import('./pages/PayInvoice'));
const ETicket = lazy(() => import('./pages/ETicket'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Comms = lazy(() => import('./pages/Comms'));
const SofiaChat = lazy(() => import('./pages/SofiaChat'));
const Customers = lazy(() => import('./pages/Customers'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const AppointmentsPage = lazy(() => import('./pages/Appointments'));
const Helpdesk = lazy(() => import('./pages/Helpdesk'));
const HelpdeskTicketDetail = lazy(() => import('./pages/helpdesk/HelpdeskTicketDetail'));
const Scanner = lazy(() => import('./pages/Scanner'));
const GarmentJobCard = lazy(() => import('./pages/GarmentJobCard'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner
        toastOptions={{
          classNames: {
            toast:
              "!bg-forest-raised/95 !backdrop-blur-xl !border-brass/30 !text-cream !shadow-glass-lg",
            description: "!text-cream-muted",
          },
        }}
      />
      <BrowserRouter>
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="h-6 w-6 rounded-full border-2 border-brass/40 border-t-brass animate-spin" /></div>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/d/:token" element={<DeliveryTracking />} />
          {/* Customer-facing payment page — no AppShell, works for unauthenticated users */}
          <Route path="/pay/:invoiceId" element={<PayInvoice />} />
          {/* Customer-facing e-ticket — public, no auth */}
          <Route path="/e-ticket/:ticketName" element={<ETicket />} />
          {/* Full-screen in-app QR scanner — protected, but outside AppShell (no sidebar chrome) */}
          <Route
            path="/scanner"
            element={
              <RoleGuard allow={["super_admin", "store_manager", "salesperson", "driver", "tailor"]}>
                <Scanner />
              </RoleGuard>
            }
          />
          {/* Standalone print pages — outside AppShell so only content renders */}
          <Route path="/orders/alterations/:ticketName/tags" element={<AlterationTags />} />
          <Route path="/orders/alterations/:ticketName/receipt" element={<AlterationReceipt />} />
          <Route path="/deliveries/:id/label" element={<DeliveryLabel />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />

            <Route
              path="/mission-control"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <MissionControl />
                </RoleGuard>
              }
            />

            <Route
              path="/house"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <House />
                </RoleGuard>
              }
            />

            <Route
              path="/mission-control/agents/:slug"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <AgentDetail />
                </RoleGuard>
              }
            />

            <Route
              path="/intake/alterations"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson", "tailor"]}>
                  <IntakeAlterations />
                </RoleGuard>
              }
            />
            <Route
              path="/intake/custom"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <IntakeCustom />
                </RoleGuard>
              }
            />

            <Route
              path="/orders/alterations"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson", "tailor"]}>
                  <OrdersAlterations />
                </RoleGuard>
              }
            />
            <Route
              path="/orders/alterations/:ticketName"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson", "tailor"]}>
                  <TicketDetail />
                </RoleGuard>
              }
            />
            <Route
              path="/garments/:ticketId/:garmentId"
              element={<GarmentTag />}
            />
            {/* Garment job card — opened when shop-floor staff scan a garment tag QR */}
            <Route
              path="/g/:ticket/:garmentId"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson", "tailor"]}>
                  <GarmentJobCard />
                </RoleGuard>
              }
            />
            <Route
              path="/orders/custom"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <OrdersCustom />
                </RoleGuard>
              }
            />
            <Route
              path="/orders/custom/:id"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <CustomOrderDetail />
                </RoleGuard>
              }
            />
            <Route
              path="/sales-orders"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <SalesOrders />
                </RoleGuard>
              }
            />
            <Route
              path="/sales-orders/:id"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <SalesOrderDetail />
                </RoleGuard>
              }
            />
            <Route
              path="/invoices"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <Invoices />
                </RoleGuard>
              }
            />
            <Route
              path="/invoices/:id"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <InvoiceDetail />
                </RoleGuard>
              }
            />

            <Route path="/deliveries" element={<Deliveries />} />
            <Route path="/deliveries/:id" element={<DeliveryDetail />} />
            <Route
              path="/communications"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <Communications />
                </RoleGuard>
              }
            />
            <Route path="/financials" element={<Financials />} />

            <Route path="/settings" element={<Settings />} />

            <Route
              path="/reference/fabrics"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <FabricPricingPage />
                </RoleGuard>
              }
            />
            <Route
              path="/reference/styles"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <StyleLibraryPage />
                </RoleGuard>
              }
            />

            <Route
              path="/admin/users"
              element={
                <RoleGuard allow={["super_admin"]}>
                  <AdminUsers />
                </RoleGuard>
              }
            />
            <Route
              path="/admin/locations"
              element={
                <RoleGuard allow={["super_admin"]}>
                  <AdminLocations />
                </RoleGuard>
              }
            />
            <Route
              path="/admin/locations/:code"
              element={
                <RoleGuard allow={["super_admin"]}>
                  <LocationSettings />
                </RoleGuard>
              }
            />
            <Route
              path="/admin/tailors"
              element={
                <RoleGuard allow={["super_admin"]}>
                  <AdminTailors />
                </RoleGuard>
              }
            />
            <Route
              path="/admin/overview"
              element={
                <RoleGuard allow={["super_admin"]}>
                  <AdminOverview />
                </RoleGuard>
              }
            />
            <Route
              path="/admin/board"
              element={
                <RoleGuard allow={["super_admin", "salesperson"]}>
                  <AdminBoard />
                </RoleGuard>
              }
            />

            <Route path="/academy" element={<Academy />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/comms" element={<Comms />} />
            <Route path="/sofia" element={<SofiaChat />} />
            <Route
              path="/customers"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <Customers />
                </RoleGuard>
              }
            />
            <Route
              path="/customers/new"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <CustomerDetail />
                </RoleGuard>
              }
            />
            <Route
              path="/customers/:id"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <CustomerDetail />
                </RoleGuard>
              }
            />
            <Route
              path="/calendar"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <CalendarPage />
                </RoleGuard>
              }
            />
            <Route
              path="/appointments"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson", "tailor"]}>
                  <AppointmentsPage />
                </RoleGuard>
              }
            />
            <Route
              path="/helpdesk"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <Helpdesk />
                </RoleGuard>
              }
            />
            <Route
              path="/helpdesk/:id"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <HelpdeskTicketDetail />
                </RoleGuard>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
