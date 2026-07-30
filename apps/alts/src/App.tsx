import { Toaster as Sonner } from "@ls/design/ui/sonner";
import { TooltipProvider } from "@ls/design/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { RoleGuard } from "@ls/auth/RoleGuard";
import Login from "@ls/auth/Login";
import HomeTiles from "@alts/pages/HomeTiles";
import AltsShell from "@alts/components/AltsShell";
import LandscapeGate from "@alts/components/LandscapeGate";
import TabletOnly from "@alts/components/TabletOnly";
import ScanFab from "@alts/components/ScanFab";
import IntakeStepped from "@alts/pages/IntakeStepped";
import TicketKind from "@alts/pages/TicketKind";
import ShopFloorBoard from "@alts/pages/ShopFloorBoard";
import PickupCounter from "@alts/pages/PickupCounter";
import ParkedTray from "@alts/pages/ParkedTray";
import Transfers from "@alts/pages/Transfers";
import OrdersGlass from "@alts/pages/OrdersGlass";
import Lookup from "@alts/pages/Lookup";
import TicketPhotos from "@alts/pages/TicketPhotos";
import Dispatch from "@alts/pages/Dispatch";
import QuoteComposer from "@alts/pages/QuoteComposer";
import TicketDetail from "@alts/pages/intake/TicketDetail";

const AlterationTags = lazy(() => import("@alts/pages/print/GarmentTagPrint"));
const AlterationReceipt = lazy(() => import("@alts/pages/intake/AlterationReceipt"));
const ThermalTicketPrint = lazy(() => import("@alts/pages/print/ThermalTicketPrint"));
const ETicket = lazy(() => import("@alts/pages/AltsETicket"));
const Scanner = lazy(() => import("@alts/pages/AltsScanner"));
const GarmentJobCard = lazy(() => import("@alts/pages/AltsGarmentJobCard"));
const AdminBoard = lazy(() => import("@alts/pages/admin/AdminBoard"));
const Customers = lazy(() => import("@alts/pages/Customers"));
const CustomerDetail = lazy(() => import("@alts/pages/CustomerDetail"));
const Deliveries = lazy(() => import("@alts/pages/Deliveries"));
const DeliveryDetail = lazy(() => import("@alts/pages/DeliveryDetail"));
const DeliveryLabel = lazy(() => import("@alts/pages/print/DeliveryLabelPrint"));
const GarmentTagRedirect = lazy(() => import("@alts/components/garment/GarmentTagRedirect"));
const PayInvoice = lazy(() => import("@alts/pages/PayInvoice"));
const PodCapture = lazy(() => import("@alts/pages/PodCapture"));
const InvoicesGlass = lazy(() => import("@alts/pages/InvoicesGlass"));
const InvoiceDetailAlts = lazy(() => import("@alts/pages/InvoiceDetailAlts"));
const Invoices = lazy(() => import("@alts/pages/Invoices"));
const InvoiceDetail = lazy(() => import("@alts/pages/InvoiceDetail"));

const FOH = ["super_admin", "store_manager", "salesperson", "tailor"] as const;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

function Spin() {
  return (
    <div className="flex items-center justify-center min-h-dvh bg-forest-deep">
      <div className="h-6 w-6 rounded-full border-2 border-brass/40 border-t-brass animate-spin" />
    </div>
  );
}

/** Tablet-tier: wrap so phone widths get “open on shop tablet” card (CSS). */
function tablet(node: ReactNode, feature?: string) {
  return <TabletOnly feature={feature}>{node}</TabletOnly>;
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
          {/*
            Routes always stay mounted.
            Tablet portrait → CSS LandscapeGate overlay (does not unmount).
            Phone width + tablet-tier path → CSS TabletOnly card (not a rotate prompt).
          */}
          <Suspense fallback={<Spin />}>
            <Routes>
              {/* Phone-tier (portrait first-class) */}
              <Route path="/login" element={<Login />} />
              <Route path="/e-ticket/:ticketName" element={<ETicket />} />
              <Route path="/t/:ticketName" element={<ETicket />} />
              {/* Public / staff pay surface after invoice QR scan */}
              <Route path="/pay/:invoiceId" element={<PayInvoice />} />
              <Route
                path="/scanner"
                element={
                  <RoleGuard allow={[...FOH, "driver"]}>
                    <Scanner />
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
              {/* Scan / QR entry — phone tier by definition (rack + phone) */}
              <Route path="/g/:ticket/:garmentId" element={<GarmentJobCard />} />
              <Route path="/garments/:token" element={<GarmentTagRedirect />} />
              {/* SPEC 012 — driver/staff POD capture (phone) */}
              <Route
                path="/deliveries/:id/pod"
                element={
                  <RoleGuard allow={[...FOH, "driver"]}>
                    <PodCapture />
                  </RoleGuard>
                }
              />

              {/* Tablet-tier (landscape counter + phone → shop-tablet card) */}
              <Route
                path="/orders/alterations/:ticketName/tags"
                element={tablet(<AlterationTags />, "Garment tags")}
              />
              <Route
                path="/orders/alterations/:ticketName/thermal"
                element={tablet(<ThermalTicketPrint />, "Thermal ticket")}
              />
              <Route
                path="/orders/alterations/:ticketName/receipt"
                element={tablet(<AlterationReceipt />, "Receipt print")}
              />
              <Route path="/deliveries/:id/label" element={tablet(<DeliveryLabel />, "Delivery label")} />

              {/* Intake is phone-first — C creates tickets on iPhone (HER-71) */}
              <Route
                path="/intake/kind"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <TicketKind />
                  </RoleGuard>
                }
              />
              <Route
                path="/intake/alterations"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <IntakeStepped />
                  </RoleGuard>
                }
              />
              <Route
                path="/transfers"
                element={
                  <RoleGuard allow={[...FOH]}>
                    {tablet(<Transfers />, "Transfers")}
                  </RoleGuard>
                }
              />
              <Route
                path="/dispatch"
                element={
                  <RoleGuard allow={[...FOH]}>
                    {tablet(<Dispatch />, "Dispatch")}
                  </RoleGuard>
                }
              />
              <Route
                path="/quote"
                element={
                  <RoleGuard allow={[...FOH]}>
                    {tablet(<QuoteComposer />, "Quote")}
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
                  path="/invoices"
                  element={
                    <RoleGuard allow={[...FOH]}>
                      <Invoices />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/invoices/:id"
                  element={
                    <RoleGuard allow={[...FOH]}>
                      <InvoiceDetail />
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
          <LandscapeGate />
          <ScanFab />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
