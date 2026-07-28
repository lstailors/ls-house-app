/**
 * CSS-only landscape interstitial for shop tablets (≥768px + portrait).
 * Always mounted — visibility pure CSS in alts-pos.css.
 * Never unmounts routes; never calls screen.orientation.lock().
 * Phones (<768px) never see this gate.
 */
import "@alts/styles/alts-pos.css";

export default function LandscapeBlock() {
  return (
    <div
      className="alts-landscape-block"
      role="dialog"
      aria-modal="true"
      aria-label="Rotate tablet to landscape"
    >
      <div>
        <p className="alts-landscape-block__line">Rotate the tablet to landscape</p>
        <p className="alts-landscape-block__hint">Shop floor · landscape only</p>
      </div>
    </div>
  );
}
