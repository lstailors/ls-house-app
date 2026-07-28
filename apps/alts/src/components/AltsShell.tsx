import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useMe } from "@/lib/session";
import { signOut } from "@/lib/authClient";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@ls/design/utils";

/** Minimal chrome for FOH — tile home owns its own header; nested pages get a slim top bar. */
export default function AltsShell() {
  const { data: me } = useMe();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const isHome = loc.pathname === "/";

  const logout = async () => {
    // Clears HttpOnly lst_session cookie (SSO) + localStorage dual-write token
    await signOut();
    qc.clear();
    nav("/login", { replace: true });
  };

  if (isHome) {
    return (
      <div className="min-h-screen bg-forest-deep text-cream">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-forest-deep text-cream flex flex-col">
      <header
        className={cn(
          "flex items-center gap-3 px-4 py-3 border-b border-brass/20",
          "bg-forest-deep/90 backdrop-blur-xl sticky top-0 z-40",
        )}
      >
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-full border border-brass grid place-items-center font-display italic text-brass-light text-lg shrink-0">
            LS
          </span>
          <span className="truncate">
            <span className="font-display italic text-lg block leading-tight">Alterations</span>
            <span className="text-[12px] uppercase tracking-[0.18em] text-cream-dim">Home</span>
          </span>
        </Link>
        <div className="flex-1" />
        {me && (
          <button
            type="button"
            onClick={logout}
            className="text-xs uppercase tracking-widest text-cream-dim hover:text-cream px-3 py-2"
          >
            {me.name?.split(" ")[0] ?? "Staff"} · Sign out
          </button>
        )}
      </header>
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
