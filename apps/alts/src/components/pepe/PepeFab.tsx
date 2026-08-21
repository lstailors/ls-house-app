import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { cn } from "@ls/design/utils";
import { usePepePanel } from "./PepeContext";
import { isAltsHome, shouldHidePepeFab } from "./pepeHide";

export { shouldHidePepeFab };

export default function PepeFab({ unread }: { unread?: boolean }) {
  const { pathname, search } = useLocation();
  const { open, openAsk } = usePepePanel();
  if (shouldHidePepeFab(pathname, search) || open) return null;
  if (typeof document === "undefined") return null;

  const home = isAltsHome(pathname);

  return createPortal(
    <button
      type="button"
      aria-label="Open Pepe"
      onClick={() => openAsk()}
      className={cn(
        "pepe-fab fixed z-[55] flex items-center justify-center",
        "right-[max(1rem,env(safe-area-inset-right))]",
        home
          ? "bottom-[max(1.25rem,env(safe-area-inset-bottom))]"
          : "bottom-[max(5.75rem,calc(env(safe-area-inset-bottom)+4.5rem))]",
        "h-14 w-14 min-h-[56px] min-w-[56px] rounded-full",
        "border border-brass/45 bg-[#1F3A2E]/92 text-[#F1E9D6]",
        "shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur-xl",
        "hover:border-[#B08D57] hover:bg-brass/15",
        "active:scale-95 transition-transform duration-150",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
      )}
    >
      <span className="font-display italic text-[22px] leading-none">P</span>
      {unread && (
        <span
          className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-brass"
          aria-hidden
        />
      )}
    </button>,
    document.body,
  );
}
