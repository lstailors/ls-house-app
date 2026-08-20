import { Toaster as Sonner } from "@ls/design/ui/sonner";
import { TooltipProvider } from "@ls/design/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Suspense } from "react";
import Login from "@ls/auth/Login";
import LandscapeGate from "@alts/components/LandscapeGate";
import ScanFab from "@alts/components/ScanFab";
import PepeHost, { PepeProvider } from "@alts/components/pepe/PepeHost";
import UniversalSearchHost from "@alts/components/UniversalSearch";
import { OfflineBanner } from "@alts/components/OfflineBanner";
import TimedSpinner from "@alts/components/TimedSpinner";
import NotFound from "@alts/pages/NotFound";
import { AltsRouteTree } from "@alts/AltsRoutes";
import { useAltsRuntime } from "@alts/AltsRuntime";
import { AdminRouteTree } from "@/admin/AdminRoutes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

function Spin() {
  return <TimedSpinner fullscreen label="Opening…" />;
}

function Runtime() {
  useAltsRuntime(queryClient);
  return null;
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
          <PepeProvider>
            <Runtime />
            <OfflineBanner />
            <Suspense fallback={<Spin />}>
              <Routes>
                <Route path="/login" element={<div className="alts-root"><Login /></div>} />
                {AltsRouteTree()}
                {AdminRouteTree()}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            <LandscapeGate />
            <UniversalSearchHost />
            <ScanFab />
            <PepeHost />
          </PepeProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
