import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useMe } from "@ls/auth/session";
import { signOut } from "@ls/auth/authClient";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@ls/design/utils";
import { UniversalSearchInline } from "@alts/components/UniversalSearch";
import { BrandSeal } from "@alts/components/BrandSeal";
import { clearAltsPrivateStorage } from "@alts/lib/logoutPrivacy";

/** Minimal chrome for FOH — tile home owns its own header; nested pages get a slim top bar + universal search. */
export default function AltsShell() {
  const { data: me } = useMe();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const isHome = loc.pathname === "/";

  const logout = async () => {
    // Clear customer data synchronously before the shared device changes hands.
    clearAltsPrivateStorage();
    qc.clear();
    await signOut();
    nav("/login", { replace: true });
  };

  if (isHome) {
    return (
      <div className="h-dvh max-h-dvh overflow-hidden bg-forest-deep text-cream">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-forest-deep text-cream flex flex-col">
      <header
        className={cn(
          "flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 border-b border-brass/20",
          "bg-forest-deep/90 backdrop-blur-xl sticky top-0 z-40",
        )}
      >
        <Link to="/" className="flex items-center gap-2 min-w-0 shrink-0" aria-label="Home">
          <BrandSeal to={null} size={36} className="shrink-0" />
          <span className="truncate hidden md:block">
            <span className="font-display italic text-lg block leading-tight">Alterations</span>
            <span className="text-[11px] uppercase tracking-[0.18em] text-cream-dim">Home</span>
          </span>
        </Link>
        <UniversalSearchInline className="mx-1" />
        {me && (
          <button
            type="button"
            onClick={logout}
            className="text-[11px] sm:text-xs uppercase tracking-widest text-cream-dim hover:text-cream px-2 sm:px-3 py-2 shrink-0"
          >
            <span className="hidden sm:inline">{me.name?.split(" ")[0] ?? "Staff"} · </span>
            Out
          </button>
        )}
      </header>
      <main className="flex-1 min-h-0">
        <div key={loc.pathname} className="lux-page-enter h-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
