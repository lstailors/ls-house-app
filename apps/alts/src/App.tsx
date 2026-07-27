import { Toaster as Sonner } from "@ls/design/ui/sonner";
import { TooltipProvider } from "@ls/design/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { RoleGuard } from "@/components/shell/RoleGuard";
import Login from "@/pages/Login";
import HomeTiles from "@alts/pages/HomeTiles";
import AltsShell from "@alts/components/AltsShell";
import IntakeStepped from "@alts/pages/IntakeStepped";
import ShopFloorBoard from "@alts/pages/ShopFloorBoard";
import PickupCounter from "@alts/pages/PickupCounter";
import ParkedTray from "@alts/pages/ParkedTray";
import Transfers from "@alts/pages/Transfers";
import OrdersGlass from "@alts/pages/OrdersGlass";
import Lookup from "@alts/pages/Lookup";
import TicketPhotos from "@alts/pages/TicketPhotos";
import TicketDetail from "@/pages/intake/TicketDetail";

const AlterationTags = lazy(() => import("@/pages/intake/AlterationTags"));
const AlterationReceipt = lazy(() => import("@/pages/intake/AlterationReceipt"));
const ETicket = lazy(() => import("@/pages/ETicket"));
const Scanner = lazy(() => import("@/pages/Scanner"));
const GarmentJobCard = lazy(() => import("@/pages/GarmentJobCard"));
const AdminBoard = lazy(() => import("@/pages/admin/AdminBoard"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerDetail = lazy(() => import("@/pages/CustomerDetail"));
const Deliveries = lazy(() => import("@/pages/Deliveries"));
const DeliveryDetail = lazy(() => import("@/pages/DeliveryDetail"));
const DeliveryLabel = lazy(() => import("@/pages/DeliveryLabel"));
const GarmentTagRedirect = lazy(() => import("@/components/garment/GarmentTagRedirect"));

const FOH = ["super_admin", "store_manager", "salesperson", "tailor"] as const;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function Spin() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-forest-deep">
      <div className="h-6 w-6 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
    </div>
  );
}

export default function App() {
  return (
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
          <Suspense fallback={<Spin />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/e-ticket/:ticketName" element={<ETicket />} />
              <Route path="/t/:ticketName" element={<ETicket />} />
              <Route
                path="/scanner"
                element={
                  <RoleGuard allow={[...FOH, "driver"]}>
                    <Scanner />
                  </RoleGuard>
                }
              />
              <Route path="/orders/alterations/:ticketName/tags" element={<AlterationTags />} />
              <Route path="/orders/alterations/:ticketName/receipt" element={<AlterationReceipt />} />
              <Route path="/deliveries/:id/label" element={<DeliveryLabel />} />
              <Route path="/g/:ticket/:garmentId" element={<GarmentJobCard />} />
              <Route path="/garments/:token" element={<GarmentTagRedirect />} />

              <Route
                path="/intake/alterations"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <IntakeStepped />
                  </RoleGuard>
                }
              />
              <Route
                path="/shop-floor"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <ShopFloorBoard />
                  </RoleGuard>
                }
              />
              <Route
                path="/pickup"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <PickupCounter />
                  </RoleGuard>
                }
              />
              <Route
                path="/parked"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <ParkedTray />
                  </RoleGuard>
                }
              />
              <Route
                path="/transfers"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <Transfers />
                  </RoleGuard>
                }
              />
              <Route
                path="/orders/alterations"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <OrdersGlass />
                  </RoleGuard>
                }
              />
              <Route
                path="/lookup"
                element={
                  <RoleGuard allow={[...FOH, "driver"]}>
                    <Lookup />
                  </RoleGuard>
                }
              />
              <Route
                path="/orders/alterations/:ticketName/photos"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <TicketPhotos />
                  </RoleGuard>
                }
              />

              <Route element={<AltsShell />}>
                <Route
                  path="/"
                  element={
                    <RoleGuard allow={[...FOH, "driver"]}>
                      <HomeTiles />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/orders/alterations/:ticketName"
                  element={
                    <RoleGuard allow={[...FOH]}>
                      <TicketDetail />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/board"
                  element={
                    <RoleGuard allow={[...FOH]}>
                      <AdminBoard />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/customers"
                  element={
                    <RoleGuard allow={[...FOH]}>
                      <Customers />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/customers/:id"
                  element={
                    <RoleGuard allow={[...FOH]}>
                      <CustomerDetail />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/customers/new"
                  element={
                    <RoleGuard allow={[...FOH]}>
                      <CustomerDetail />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/deliveries"
                  element={
                    <RoleGuard allow={[...FOH, "driver"]}>
                      <Deliveries />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/deliveries/:id"
                  element={
                    <RoleGuard allow={[...FOH, "driver"]}>
                      <DeliveryDetail />
                    </RoleGuard>
                  }
                />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
