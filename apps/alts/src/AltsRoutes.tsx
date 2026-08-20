import { Route } from "react-router-dom";
import { lazy, type ReactNode } from "react";
import { RoleGuard } from "@ls/auth/RoleGuard";
import HomeTiles from "@alts/pages/HomeTiles";
import AltsShell from "@alts/components/AltsShell";
import PrintSurface from "@alts/components/PrintSurface";
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
import ProductionSheet from "@alts/pages/production/ProductionSheet";

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
const StockGallery = lazy(() => import("@alts/pages/StockGallery"));
const StockDetail = lazy(() => import("@alts/pages/StockDetail"));

const FOH = ["super_admin", "store_manager", "salesperson", "tailor"] as const;
const QC = ["super_admin", "tailor"] as const;

function printSurface(node: ReactNode, feature?: string) {
  return <PrintSurface feature={feature}>{node}</PrintSurface>;
}

/** Floor hub routes — home tiles stay at /. */
export function AltsRouteTree() {
  return (
    <>
      <Route path="/e-ticket/:ticketName" element={<ETicket />} />
      <Route path="/t/:ticketName" element={<ETicket />} />
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
        path="/production"
        element={
          <RoleGuard allow={[...FOH]}>
            <ProductionSheet />
          </RoleGuard>
        }
      />
      <Route
        path="/production/week"
        element={
          <RoleGuard allow={[...FOH]}>
            <ProductionSheet />
          </RoleGuard>
        }
      />
      <Route
        path="/production/:orderNo"
        element={
          <RoleGuard allow={[...FOH]}>
            <ProductionSheet />
          </RoleGuard>
        }
      />
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
        path="/stock"
        element={
          <RoleGuard allow={[...FOH]}>
            <StockGallery />
          </RoleGuard>
        }
      />
      <Route
        path="/stock/:id"
        element={
          <RoleGuard allow={[...FOH]}>
            <StockDetail />
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
      <Route
        path="/g/:ticket/:garmentId"
        element={
          <RoleGuard allow={[...FOH, "driver"]}>
            <GarmentJobCard />
          </RoleGuard>
        }
      />
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
      <Route
        path="/deliveries/:id/pod"
        element={
          <RoleGuard allow={[...FOH, "driver"]}>
            <PodCapture />
          </RoleGuard>
        }
      />
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
      <Route
        path="/orders/alterations/:ticketName/add-work"
        element={
          <RoleGuard allow={[...FOH]}>
            <AddWork />
          </RoleGuard>
        }
      />
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
    </>
  );
}
