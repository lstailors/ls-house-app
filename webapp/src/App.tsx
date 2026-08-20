import { Toaster as Sonner } from "@ls/design/ui/sonner";
import { TooltipProvider } from "@ls/design/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import { AltsRouteTree } from "@alts/AltsRoutes";
import { useAltsRuntime } from "@alts/AltsRuntime";
import { AdminRouteTree } from "@/admin/AdminRoutes";
import LandscapeGate from "@alts/components/LandscapeGate";
import ScanFab from "@alts/components/ScanFab";
import UniversalSearchHost from "@alts/components/UniversalSearch";
import { OfflineBanner } from "@alts/components/OfflineBanner";
import "@alts/styles/alts-pos.css";

const DeliveryTracking = lazy(() => import("./pages/DeliveryTracking"));
const PayInvoice = lazy(() => import("./pages/PayInvoice"));
const CustomerHome = lazy(() => import("./pages/CustomerHome"));
const CustomerProfile = lazy(() => import("./pages/CustomerProfile"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function Runtime() {
  useAltsRuntime(queryClient);
  return null;
}

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
        <Runtime />
        <OfflineBanner />
        <Suspense fallback={<div className="flex items-center justify-center min-h-dvh"><div className="h-6 w-6 rounded-full border-2 border-brass/40 border-t-brass animate-spin" /></div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/d/:token" element={<DeliveryTracking />} />
            <Route path="/i/:invoiceId" element={<PayInvoice />} />
            <Route path="/home" element={<CustomerHome />} />
            <Route path="/profile" element={<CustomerProfile />} />
            {AltsRouteTree()}
            {AdminRouteTree()}
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

export default App;
