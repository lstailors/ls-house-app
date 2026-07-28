import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "@alts/styles/alts-pos.css";

/**
 * Tablet-tier surface: full UI on ≥768px; on phone widths show an explicit
 * "open on the shop tablet" card instead of a broken landscape layout.
 * Children stay mounted (CSS display) so foldables/state are safe.
 */
export default function TabletOnly({
  children,
  feature = "This screen",
}: {
  children: ReactNode;
  feature?: string;
}) {
  return (
    <>
      <div className="alts-tablet-desk">{children}</div>
      <div className="alts-tablet-phone-card" role="region" aria-label="Tablet only">
        <div className="seal" style={{ width: 48, height: 48, fontSize: 22 }}>
          LS
        </div>
        <h1 className="alts-tablet-phone-card__title">Open on the shop tablet</h1>
        <p className="alts-tablet-phone-card__body">
          {feature} needs the landscape counter layout. Use Lookup, Pickup, or Shop Floor on your
          phone — or open alts on the shop iPad.
        </p>
        <div className="alts-tablet-phone-card__actions">
          <Link className="primary" to="/">
            Back home
          </Link>
          <Link className="ghost" to="/lookup">
            Lookup
          </Link>
          <Link className="ghost" to="/pickup">
            Pickup
          </Link>
        </div>
      </div>
    </>
  );
}
