import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@ls/design/utils";
import { LUX_MS, useBodyLock, useOverlayEscape, usePresence } from "@alts/lib/luxuryMotion";

export type LuxuryVariant = "sheet" | "drawer" | "modal" | "search";

type Props = {
  open: boolean;
  onClose: () => void;
  variant?: LuxuryVariant;
  label?: string;
  z?: number;
  children: ReactNode;
  panelClassName?: string;
  scrimClassName?: string;
};

/**
 * One overlay language for the house:
 * sheet = up from the floor and back down
 * drawer = in from the right and back out
 * modal / search = fade + settle, then reverse
 */
export default function LuxuryLayer({
  open,
  onClose,
  variant = "sheet",
  label,
  z = 60,
  children,
  panelClassName,
  scrimClassName,
}: Props) {
  const { shown, entered } = usePresence(open, LUX_MS);
  useBodyLock(shown);
  useOverlayEscape(shown, onClose);

  if (!shown || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn("lux-layer", entered ? "is-in" : "is-out")}
      data-variant={variant}
      style={{ zIndex: z }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-hidden={!entered}
    >
      <button
        type="button"
        className={cn("lux-scrim", scrimClassName)}
        aria-label="Close"
        onClick={onClose}
      />
      <div className={cn("lux-panel", panelClassName)} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
