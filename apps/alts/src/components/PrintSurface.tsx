import type { ReactNode } from "react";
import "@alts/styles/alts-pos.css";

/**
 * Print surfaces: always render content (phone can preview).
 * On narrow screens, show a tip that shop printers live on the counter iPad.
 */
export default function PrintSurface({
  children,
  feature = "Print",
}: {
  children: ReactNode;
  feature?: string;
}) {
  return (
    <>
      <div className="alts-print-phone-tip" role="note">
        <strong>{feature}</strong>
        <span> — preview on phone · for shop printers, use the counter iPad.</span>
      </div>
      <div className="alts-print-surface">{children}</div>
    </>
  );
}
