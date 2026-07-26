// Route tree for the alterations POS at alts.lstailors.com.
//
// Every page here is the SAME component the admin dashboard uses — this file
// selects which of them a counter needs and wraps them in the POS shell. It is
// deliberately not a fork: a fix to TicketDetail lands in both apps at once.
//
// What is NOT here, and why:
//   /pay, /e-ticket   — Apple Pay's domain association is served by the edge
//                       function on app.lstailors.com, and Square's dashboard
//                       plus every already-sent link point there. Customer-
//                       facing pages stay on the admin host.
//   /d/:token         — printed delivery labels hardcode delivered.lstailors.com.
//   /shop-floor       — YZ overseas production; belongs with custom orders.
//   custom orders, financials, admin, mission control — admin dashboard.

import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AltsShell } from "./AltsShell";
import { RoleGuard } from "@/components/shell/RoleGuard";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";
import PosHome from "./PosHome";
import IntakeAlterations from "@/pages/intake/IntakeAlterations";
import OrdersAlterations from "@/pages/orders/OrdersAlterations";
import TicketDetail from "@/pages/intake/TicketDetail";
import GarmentTagRedirect from "@/components/garment/GarmentTagRedirect";

const AlterationTags = lazy(() => import("@/pages/intake/AlterationTags"));
const AlterationReceipt = lazy(() => import("@/pages/intake/AlterationReceipt"));
const GarmentJobCard = lazy(() => import("@/pages/GarmentJobCard"));
const Scanner = lazy(() => import("@/pages/Scanner"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerDetail = lazy(() => import("@/pages/CustomerDetail"));
const Deliveries = lazy(() => import("@/pages/Deliveries"));
const DeliveryDetail = lazy(() => import("@/pages/DeliveryDetail"));
const DeliveryLabel = lazy(() => import("@/pages/DeliveryLabel"));
const AppointmentsPage = lazy(() => import("@/pages/Appointments"));
const CalendarPage = lazy(() => import("@/pages/Calendar"));
const SofiaChat = lazy(() => import("@/pages/SofiaChat"));
const SofiaDispatch = lazy(() => import("@/pages/SofiaDispatch"));
const Settings = lazy(() => import("@/pages/Settings"));

const queryClient = new QueryClient({
  defaultOptions: {
    // Unlike admin, refetch on focus: a counter iPad is put down and picked up
    // constantly, and stale ticket state in front of a customer is worse than
    // an extra request.
    queries: { retry: 1, refetchOnWindowFocus: true },
  },
});

// Everyone who works the counter. Mirrors the guards already on these routes in
// the admin app rather than inventing a new permission model.
const COUNTER = ["super_admin", "store_manager", "salesperson", "tailor"] as const;
const SALES = ["super_admin", "store_manager", "salesperson"] as const;
const WITH_DRIVER = ["super_admin", "store_manager", "salesperson", "driver", "tailor"] as const;

const AltsApp = () => (
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
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-brass/40 border-t-brass" />
            </div>
          }
        >
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* Full-screen, outside the shell chrome */}
            <Route
              path="/scanner"
              element={
                <RoleGuard allow={[...WITH_DRIVER]}>
                  <Scanner />
                </RoleGuard>
              }
            />

            {/* Print pages — content only, no chrome */}
            <Route path="/orders/alterations/:ticketName/tags" element={<AlterationTags />} />
            <Route path="/orders/alterations/:ticketName/receipt" element={<AlterationReceipt />} />
            <Route path="/deliveries/:id/label" element={<DeliveryLabel />} />

            <Route element={<AltsShell />}>
              <Route path="/" element={<PosHome />} />

              <Route
                path="/intake/alterations"
                element={
                  <RoleGuard allow={[...COUNTER]}>
                    <IntakeAlterations />
                  </RoleGuard>
                }
              />
              <Route
                path="/orders/alterations"
                element={
                  <RoleGuard allow={[...COUNTER]}>
                    <OrdersAlterations />
                  </RoleGuard>
                }
              />
              <Route
                path="/orders/alterations/:ticketName"
                element={
                  <RoleGuard allow={[...COUNTER]}>
                    <TicketDetail />
                  </RoleGuard>
                }
              />

              {/* Scanning a garment tag lands here. The legacy /garments/ path is
                  what older printed tags encode, so it must keep resolving. */}
              <Route path="/garments/:ticketId/:garmentId" element={<GarmentTagRedirect />} />
              <Route
                path="/g/:ticket/:garmentId"
                element={
                  <RoleGuard allow={[...COUNTER]}>
                    <GarmentJobCard />
                  </RoleGuard>
                }
              />

              <Route
                path="/customers"
                element={
                  <RoleGuard allow={[...SALES]}>
                    <Customers />
                  </RoleGuard>
                }
              />
              <Route
                path="/customers/new"
                element={
                  <RoleGuard allow={[...SALES]}>
                    <CustomerDetail />
                  </RoleGuard>
                }
              />
              <Route
                path="/customers/:id"
                element={
                  <RoleGuard allow={[...SALES]}>
                    <CustomerDetail />
                  </RoleGuard>
                }
              />

              {/* These four are unguarded in the admin app; the POS is a shared
                  shop-floor device, so they get explicit guards here. */}
              <Route
                path="/deliveries"
                element={
                  <RoleGuard allow={[...WITH_DRIVER]}>
                    <Deliveries />
                  </RoleGuard>
                }
              />
              <Route
                path="/deliveries/:id"
                element={
                  <RoleGuard allow={[...WITH_DRIVER]}>
                    <DeliveryDetail />
                  </RoleGuard>
                }
              />
              <Route
                path="/sofia"
                element={
                  <RoleGuard allow={[...COUNTER]}>
                    <SofiaChat />
                  </RoleGuard>
                }
              />
              <Route
                path="/dispatch"
                element={
                  <RoleGuard allow={[...COUNTER]}>
                    <SofiaDispatch />
                  </RoleGuard>
                }
              />

              <Route
                path="/appointments"
                element={
                  <RoleGuard allow={[...COUNTER]}>
                    <AppointmentsPage />
                  </RoleGuard>
                }
              />
              <Route
                path="/calendar"
                element={
                  <RoleGuard allow={[...SALES]}>
                    <CalendarPage />
                  </RoleGuard>
                }
              />

              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default AltsApp;
