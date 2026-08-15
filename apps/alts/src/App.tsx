import { Toaster as Sonner } from "@ls/design/ui/sonner";
import { TooltipProvider } from "@ls/design/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { RoleGuard } from "@ls/auth/RoleGuard";
import Login from "@ls/auth/Login";
import HomeTiles from "@alts/pages/HomeTiles";
import AltsShell from "@alts/components/AltsShell";
import LandscapeGate from "@alts/components/LandscapeGate";
import PrintSurface from "@alts/components/PrintSurface";
import ScanFab from "@alts/components/ScanFab";
import UniversalSearchHost from "@alts/components/UniversalSearch";
import IntakeStepped from "@alts/pages/IntakeStepped";
import TicketKind from "@alts/pages/TicketKind";
import ShopFloorBoard from "@alts/pages/ShopFloorBoard";
import PickupCounter from "@alts/pages/PickupCounter";
import ParkedTray from "@alts/pages/ParkedTray";
import Transfers from "@alts/pages/Transfers";
import OrdersGlass from "@alts/pages/OrdersGlass";
import Lookup from "@alts/pages/Lookup";
import ProgressBoard from "@alts/pages/ProgressBoard";
import TicketPhotos from "@alts/pages/TicketPhotos";
import Dispatch from "@alts/pages/Dispatch";
import QuoteComposer from "@alts/pages/QuoteComposer";
import AppointmentsGlass from "@alts/pages/AppointmentsGlass";
import TasksGlass from "@alts/pages/TasksGlass";
import MessagesGlass from "@alts/pages/MessagesGlass";
import HouseFind from "@alts/pages/HouseFind";
import QcGlass from "@alts/pages/QcGlass";
import QcInspection from "@alts/pages/QcInspection";
import AltsSettings from "@alts/pages/AltsSettings";
import TicketDetail from "@alts/pages/intake/TicketDetail";
import { startOfflineQueueWatcher } from "@alts/lib/offlineQueue";
import { toast } from "sonner";
import TimedSpinner from "@alts/components/TimedSpinner";
import NotFound from "@alts/pages/NotFound";

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
const Invoices = lazy(() => import("@alts/pages/Invoices"));
const InvoiceDetail = lazy(() => import("@alts/pages/InvoiceDetail"));
const AddWork = lazy(() => import("@alts/pages/AddWork"));
const FloorPerformance = lazy(() => import("@alts/pages/FloorPerformance"));
const Reports = lazy(() => import("@alts/pages/Reports"));

const FOH = ["super_admin", "store_manager", "salesperson", "tailor"] as const;
const QC = ["super_admin", "tailor"] as const;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

function Spin() {
  return <TimedSpinner fullscreen label="Opening…" />;
}

/** Print routes: preview on any device; tip on phone for counter printers. */
function printSurface(node: ReactNode, feature?: string) {
  return <PrintSurface feature={feature}>{node}</PrintSurface>;
}

export default function App() {
  useEffect(() => {
    return startOfflineQueueWatcher((r) => {
      if (r.ok > 0) toast.success(`Sent ${r.ok} offline ticket${r.ok === 1 ? "" : "s"}`);
      if (r.failed > 0) toast.error(`${r.failed} offline ticket${r.failed === 1 ? "" : "s"} still failing`);
    });
  }, []);

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
            Print routes: LandscapeGate only on tags/thermal/receipt/label when tablet portrait.
            Dispatch / Transfers / Quote adapt via phone-stack (no TabletOnly gate).
          */}
          <Suspense fallback={<Spin />}>
            <Routes>
              {/* Phone-tier (portrait first-class) */}
              <Route path="/login" element={<div className="alts-root"><Login /></div>} />
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
              {/* SPEC 061 — Tailor productivity / Floor Performance */}
              <Route
                path="/floor-performance"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <FloorPerformance />
                  </RoleGuard>
                }
              />
              <Route
                path="/progress"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <ProgressBoard />
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
                path="/appointments"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <AppointmentsGlass />
                  </RoleGuard>
                }
              />
              <Route
                path="/tasks"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <TasksGlass />
                  </RoleGuard>
                }
              />
              <Route
                path="/messages"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <MessagesGlass />
                  </RoleGuard>
                }
              />
              <Route
                path="/house"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <HouseFind />
                  </RoleGuard>
                }
              />
              <Route
                path="/qc"
                element={
                  <RoleGuard allow={[...QC]}>
                    <QcGlass />
                  </RoleGuard>
                }
              />
              <Route
                path="/qc/:id"
                element={
                  <RoleGuard allow={[...QC]}>
                    <QcInspection />
                  </RoleGuard>
                }
              />
              <Route
                path="/settings"
                element={
                  <RoleGuard allow={[...FOH, "driver"]}>
                    <AltsSettings />
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
              {/* Scan / QR entry — phone tier; require FOH session (API is authed) */}
              <Route
                path="/g/:ticket/:garmentId"
                element={
                  <RoleGuard allow={[...FOH, "driver"]}>
                    <GarmentJobCard />
                  </RoleGuard>
                }
              />
              {/* Legacy hang-tag shape — redirect to /g/:ticket/:garmentId */}
              <Route
                path="/garments/:ticketId/:garmentId"
                element={
                  <RoleGuard allow={[...FOH, "driver"]}>
                    <GarmentTagRedirect />
                  </RoleGuard>
                }
              />
              <Route
                path="/garments/:token"
                element={
                  <RoleGuard allow={[...FOH, "driver"]}>
                    <GarmentTagRedirect />
                  </RoleGuard>
                }
              />
              {/* SPEC 012 — driver/staff POD capture (phone) */}
              <Route
                path="/deliveries/:id/pod"
                element={
                  <RoleGuard allow={[...FOH, "driver"]}>
                    <PodCapture />
                  </RoleGuard>
                }
              />

              {/* Print surfaces — RoleGuard + preview; landscape tip on tablet */}
              <Route
                path="/orders/alterations/:ticketName/tags"
                element={
                  <RoleGuard allow={[...FOH]}>
                    {printSurface(<AlterationTags />, "Garment tags")}
                  </RoleGuard>
                }
              />
              <Route
                path="/orders/alterations/:ticketName/thermal"
                element={
                  <RoleGuard allow={[...FOH]}>
                    {printSurface(<ThermalTicketPrint />, "Thermal ticket")}
                  </RoleGuard>
                }
              />
              <Route
                path="/orders/alterations/:ticketName/receipt"
                element={
                  <RoleGuard allow={[...FOH]}>
                    {printSurface(<AlterationReceipt />, "Receipt print")}
                  </RoleGuard>
                }
              />
              <Route
                path="/deliveries/:id/label"
                element={
                  <RoleGuard allow={[...FOH, "driver"]}>
                    {printSurface(<DeliveryLabel />, "Delivery label")}
                  </RoleGuard>
                }
              />

              {/* SPEC 014 — add work on live ticket (phone-tier) */}
              <Route
                path="/orders/alterations/:ticketName/add-work"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <AddWork />
                  </RoleGuard>
                }
              />
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
              {/* Dispatch / Transfers / Quote — adaptive (phone stack + tablet/desktop columns) */}
              <Route
                path="/transfers"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <Transfers />
                  </RoleGuard>
                }
              />
              <Route
                path="/dispatch"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <Dispatch />
                  </RoleGuard>
                }
              />
              <Route
                path="/quote"
                element={
                  <RoleGuard allow={[...FOH]}>
                    <QuoteComposer />
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
                  path="/reports/:tab?"
                  element={
                    <RoleGuard allow={[...FOH]}>
                      <Reports />
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
                {/* /new before :id so it does not get captured as a customer id */}
                <Route
                  path="/customers/new"
                  element={
                    <RoleGuard allow={[...FOH]}>
                      <CustomerDetail />
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

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <LandscapeGate />
          <UniversalSearchHost />
          <ScanFab />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
