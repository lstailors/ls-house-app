import { useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useMe } from "@/lib/session";
import { LocationProvider } from "@/lib/locationContext";
import { Monogram } from "../glass/Monogram";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

export function AppShell() {
  const { data: user, isLoading } = useMe();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Monogram size="lg" className="animate-glow-pulse" />
          <div className="ui-label">Preparing the atelier…</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <LocationProvider user={user}>
      <div className="flex h-screen overflow-hidden">
        <div className="hidden lg:block">
          <Sidebar role={user.role} />
        </div>

        {/* Mobile/tablet drawer */}
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent
            side="left"
            className="p-0 w-72 max-w-[85vw] border-r border-brass/20 bg-forest-deep/95 backdrop-blur-2xl lg:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Main menu</SheetDescription>
            <Sidebar role={user.role} onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar user={user} onMenuClick={() => setNavOpen(true)} />
          <main className="flex-1 overflow-y-auto pb-safe">
            <div className="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6 py-4 md:py-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </LocationProvider>
  );
}
