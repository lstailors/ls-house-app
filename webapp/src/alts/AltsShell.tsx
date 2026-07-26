// Shell for the alterations POS.
//
// Shares the auth gate, LocationProvider and Sidebar with the admin AppShell —
// what differs is the chrome. The admin TopBar carries a ⌘K palette, a
// notification poller and the unified activity feed; none of that belongs on a
// counter iPad, where the only two things that must always be one tap away are
// "scan a tag" and "new ticket".

import { useState } from "react";
import { Outlet, useNavigate, NavLink } from "react-router-dom";
import { Menu, ScanLine, Plus } from "lucide-react";
import { Sidebar } from "@/components/shell/Sidebar";
import { useAuthGate } from "@/components/shell/useAuthGate";
import { LocationProvider } from "@/lib/locationContext";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { ALTS_BRAND, ALTS_SECTIONS } from "./navSections.alts";

export function AltsShell() {
  const { user, gate } = useAuthGate("Opening the counter…");
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();

  if (gate || !user) return <>{gate}</>;

  return (
    <LocationProvider user={user}>
      <div className="flex h-screen overflow-hidden">
        {/* Desktop / landscape iPad */}
        <div className="hidden lg:block">
          <Sidebar role={user.role} sections={ALTS_SECTIONS} brand={ALTS_BRAND} />
        </div>

        {/* Portrait iPad and phone */}
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent
            side="left"
            className="p-0 w-72 max-w-[85vw] border-r border-brass/20 bg-forest-deep/95 backdrop-blur-2xl lg:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Counter menu</SheetDescription>
            <Sidebar
              role={user.role}
              sections={ALTS_SECTIONS}
              brand={ALTS_BRAND}
              onNavigate={() => setNavOpen(false)}
            />
          </SheetContent>
        </Sheet>

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Touch-sized bar: 44px minimum on every target. */}
          <header className="flex items-center gap-2 border-b border-brass/15 bg-forest-deep/70 px-3 py-2 backdrop-blur-xl">
            <button
              onClick={() => setNavOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-md text-cream-muted hover:bg-brass/10 hover:text-cream lg:hidden"
              aria-label="Menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <button
              onClick={() => navigate("/scanner")}
              className="flex h-11 items-center gap-2 rounded-md border border-brass/30 bg-brass/10 px-4 text-sm font-medium text-cream transition-colors hover:bg-brass/20"
            >
              <ScanLine className="h-5 w-5" />
              Scan
            </button>

            <button
              onClick={() => navigate("/intake/alterations")}
              className="flex h-11 items-center gap-2 rounded-md px-4 text-sm font-medium text-cream-muted transition-colors hover:bg-brass/10 hover:text-cream"
            >
              <Plus className="h-5 w-5" />
              New Ticket
            </button>

            <NavLink to="/settings" className="ml-auto flex h-11 w-11 items-center justify-center">
              <Avatar className="h-9 w-9 border border-brass/25">
                <AvatarImage src={user.image ?? undefined} />
                <AvatarFallback className="bg-forest-raised text-xs text-brass-light">
                  {initials(user.name ?? "?")}
                </AvatarFallback>
              </Avatar>
            </NavLink>
          </header>

          <main className="flex-1 overflow-y-auto pb-safe">
            <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-4 md:px-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </LocationProvider>
  );
}
