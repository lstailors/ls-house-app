import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/** POS routes that must run landscape on tablet. Print/login exempt. */
const POS_PREFIXES = [
  "/",
  "/intake",
  "/shop-floor",
  "/pickup",
  "/parked",
  "/transfers",
  "/orders",
  "/lookup",
  "/dispatch",
  "/quote",
  "/board",
  "/customers",
  "/deliveries",
  "/scanner",
];

function isPosPath(pathname: string) {
  if (pathname === "/login") return false;
  if (pathname.startsWith("/e-ticket") || pathname.startsWith("/t/")) return false;
  if (pathname.includes("/tags") || pathname.includes("/thermal") || pathname.includes("/receipt")) return false;
  if (pathname.includes("/label") || pathname.startsWith("/g/") || pathname.startsWith("/garments/")) return false;
  return POS_PREFIXES.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/")));
}

function portraitNow() {
  if (typeof window === "undefined") return false;
  // matchMedia is reliable; fallback to dimensions
  if (window.matchMedia?.("(orientation: portrait)").matches) return true;
  return window.innerHeight > window.innerWidth;
}

/**
 * C ruling: alts POS is landscape-only.
 * Blocks portrait with rotate interstitial on FOH routes.
 */
export default function LandscapeGate({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    const sync = () => setPortrait(portraitNow());
    sync();
    const mql = window.matchMedia?.("(orientation: portrait)");
    mql?.addEventListener?.("change", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      mql?.removeEventListener?.("change", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  if (portrait && isPosPath(pathname)) {
    return (
      <div className="alts-root fixed inset-0 z-[9999] grid place-items-center px-8 text-center bg-[radial-gradient(ellipse_at_50%_-12%,#17321f,#0d1a10_58%)]">
        <div className="max-w-md">
          <div className="seal mx-auto mb-5">LS</div>
          <div className="display text-3xl text-cream mb-3">Rotate to landscape</div>
          <p className="text-[12px] text-cream-dim leading-relaxed tracking-wide">
            Alterations POS is built for landscape tablets on the counter. Turn the device sideways to continue.
          </p>
          <div className="mt-8 mx-auto w-16 h-24 rounded-xl border-2 border-brass/50 relative animate-pulse">
            <div className="absolute inset-x-2 top-2 h-1 rounded bg-brass/40" />
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-brass text-xl">↻</div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
