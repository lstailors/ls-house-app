import { useEffect, useState } from "react";

/** Shared luxury overlay timing — keep mounted while it slides back. */

export const LUX_MS = 420;

const escapeStack: Array<() => void> = [];
let bodyLocks = 0;
let priorOverflow = "";

export function usePresence(open: boolean, ms = LUX_MS) {
  const [shown, setShown] = useState(open);
  const [entered, setEntered] = useState(open);

  useEffect(() => {
    if (open) {
      setShown(true);
      const id = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setEntered(true));
      });
      return () => window.cancelAnimationFrame(id);
    }
    setEntered(false);
    const t = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(t);
  }, [open, ms]);

  return { shown, entered };
}

export function useBodyLock(lock: boolean) {
  useEffect(() => {
    if (!lock || typeof document === "undefined") return;
    if (bodyLocks === 0) {
      priorOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    bodyLocks += 1;
    return () => {
      bodyLocks = Math.max(0, bodyLocks - 1);
      if (bodyLocks === 0) document.body.style.overflow = priorOverflow;
    };
  }, [lock]);
}

export function useOverlayEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    escapeStack.push(onClose);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (escapeStack[escapeStack.length - 1] !== onClose) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = escapeStack.lastIndexOf(onClose);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active, onClose]);
}
