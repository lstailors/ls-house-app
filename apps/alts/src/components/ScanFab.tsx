import { Link, useLocation } from "react-router-dom";
import { cn } from "@ls/design/utils";
import { kioskFromSearch } from "@alts/lib/kiosk";

/**
 * Global corner scan control for alts FOH.
 * Hides on the scanner itself, auth, print surfaces, and public e-ticket.
 * Opens the in-app scanner (ERP resolve_qr under the hood) — not the Frappe desk.
 */
function shouldHide(pathname: string, search = ""): boolean {
  if (kioskFromSearch(search)) return true;
  // Home owns the full viewport — FAB steals bottom-right tile space
  if (pathname === "/" || pathname === "") return true;
  if (/^\/(login|scanner)(\/|$)/i.test(pathname)) return true;
  if (/^\/intake(\/|$)/i.test(pathname)) return true;
  if (/^\/(e-ticket|t)\//i.test(pathname)) return true;
  // Print / label routes — camera FAB would land on paper previews
  if (/\/(tags|thermal|receipt|label)(\/|$)/i.test(pathname)) return true;
  // Already on a post-scan garment card — back/home is enough
  if (/^\/g\//i.test(pathname)) return true;
  if (/^\/garments\//i.test(pathname)) return true;
  if (/^\/qc(\/|$)/i.test(pathname)) return true;
  if (/^\/settings(\/|$)/i.test(pathname)) return true;
  return false;
}

export default function ScanFab() {
  const { pathname, search } = useLocation();
  if (shouldHide(pathname, search)) return null;

  return (
    <Link
      to="/scanner"
      aria-label="Open scanner"
      className={cn(
        "scan-fab fixed z-[60] flex items-center justify-center",
        "right-[max(1rem,env(safe-area-inset-right))]",
        "bottom-[max(1.25rem,env(safe-area-inset-bottom))]",
        "h-14 w-14 min-h-[56px] min-w-[56px] rounded-full",
        "border border-brass/45 bg-forest-deep/92 text-brass-light",
        "shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur-xl",
        "hover:border-brass hover:bg-brass/15 hover:text-cream",
        "active:scale-95 transition-transform duration-150",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
      )}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 26 26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 9V5a1 1 0 0 1 1-1h4" />
        <path d="M22 9V5a1 1 0 0 0-1-1h-4" />
        <path d="M4 17v4a1 1 0 0 0 1 1h4" />
        <path d="M22 17v4a1 1 0 0 1-1 1h-4" />
        <rect x="8" y="8" width="4.5" height="4.5" rx="0.6" />
        <rect x="13.5" y="8" width="4.5" height="4.5" rx="0.6" />
        <rect x="8" y="13.5" width="4.5" height="4.5" rx="0.6" />
        <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5z" />
      </svg>
    </Link>
  );
}
