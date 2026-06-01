import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { RoleGuard } from "@/components/shell/RoleGuard";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import IntakeAlterations from "./pages/intake/IntakeAlterations";
import IntakeCustom from "./pages/intake/IntakeCustom";
import OrdersAlterations from "./pages/orders/OrdersAlterations";
import OrdersCustom from "./pages/orders/OrdersCustom";
import CustomOrderDetail from "./pages/orders/CustomOrderDetail";
import SalesOrders from "./pages/orders/SalesOrders";
import Invoices from "./pages/orders/Invoices";
import Deliveries from "./pages/Deliveries";
import DeliveryTracking from "./pages/DeliveryTracking";
import DeliveryLabel from "./pages/DeliveryLabel";
import DeliveryDetail from "./pages/DeliveryDetail";
import Communications from "./pages/Communications";
import Financials from "./pages/Financials";
import Settings from "./pages/Settings";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminLocations from "./pages/admin/AdminLocations";
import AdminTailors from "./pages/admin/AdminTailors";
import AdminOverview from "./pages/admin/AdminOverview";
import FabricPricingPage from "./pages/reference/FabricPricingPage";
import StyleLibraryPage from "./pages/reference/StyleLibraryPage";
import Academy from "./pages/Academy";
import MissionControl from "./pages/MissionControl";
import AgentDetail from "./pages/mission-control/AgentDetail";
import NotFound from "./pages/NotFound";
import TicketDetail from "./pages/intake/TicketDetail";
import QRScanner from "./pages/intake/QRScanner";

const Tasks = lazy(() => import('./pages/Tasks'));
const Comms = lazy(() => import('./pages/Comms'));
const SofiaChat = lazy(() => import('./pages/SofiaChat'));
const Customers = lazy(() => import('./pages/Customers'));

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
        <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/d/:token" element={<DeliveryTracking />} />
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
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
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
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <OrdersAlterations />
                </RoleGuard>
              }
            />
            <Route
              path="/orders/alterations/:ticketName"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <TicketDetail />
                </RoleGuard>
              }
            />
            <Route
              path="/scan"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson", "driver"]}>
                  <QRScanner />
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
              path="/invoices"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <Invoices />
                </RoleGuard>
              }
            />

            <Route path="/deliveries" element={<Deliveries />} />
            <Route path="/deliveries/:id" element={<DeliveryDetail />} />
            <Route path="/deliveries/:id/label" element={<DeliveryLabel />} />
            <Route
              path="/communications"
              element={
                <RoleGuard allow={["super_admin", "store_manager", "salesperson"]}>
                  <Communications />
                </RoleGuard>
              }
            />
            <Route
              path="/financials"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <Financials />
                </RoleGuard>
              }
            />

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

            <Route path="/academy" element={<Academy />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/comms" element={<Comms />} />
            <Route path="/sofia" element={<SofiaChat />} />
            <Route
              path="/customers"
              element={
                <RoleGuard allow={["super_admin", "store_manager"]}>
                  <Customers />
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
