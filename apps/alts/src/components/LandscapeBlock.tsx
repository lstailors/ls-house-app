/**
 * CSS-only landscape interstitial — ONLY for print / counter-print routes.
 * Public + phone-first FOH pages must work in iPad portrait.
 * Never unmounts routes; never calls screen.orientation.lock().
 */
import { useLocation } from "react-router-dom";
import "@alts/styles/alts-pos.css";

const PRINT_PATH =
  /\/(tags|thermal|receipt|label)(\/|$)/i;

export default function LandscapeBlock() {
  const { pathname } = useLocation();
  if (!PRINT_PATH.test(pathname)) return null;

  return (
    <div
      className="alts-landscape-block"
      role="dialog"
      aria-modal="true"
      aria-label="Rotate tablet to landscape"
    >
      <div>
        <p className="alts-landscape-block__line">Rotate the tablet to landscape</p>
        <p className="alts-landscape-block__hint">Print layout · landscape</p>
      </div>
    </div>
  );
}
