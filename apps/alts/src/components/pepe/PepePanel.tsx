import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@ls/design/utils";
import { useMinWidth, useBodyLock, useOverlayEscape, usePresence, LUX_MS } from "@alts/lib/luxuryMotion";
import { usePepePanel } from "./PepeContext";
import PepeAsk from "./PepeAsk";
import PepeTodos from "./PepeTodos";
import { useState } from "react";

type Tab = "ask" | "list";

export default function PepePanel({ wired }: { wired: boolean }) {
  const { open, close } = usePepePanel();
  const wide = useMinWidth(720);
  const { shown, entered } = usePresence(open, LUX_MS);
  const [tab, setTab] = useState<Tab>("ask");
  useBodyLock(shown);
  useOverlayEscape(shown, close);

  if (!shown || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn("pepe-layer fixed inset-0", entered ? "opacity-100" : "opacity-0")}
      style={{ zIndex: 45 }}
      role="dialog"
      aria-modal="true"
      aria-label="Pepe"
    >
      <button
        type="button"
        aria-label="Close Pepe"
        onClick={close}
        className="absolute inset-0 bg-black/45"
      />
      <aside
        className={cn(
          "absolute top-0 right-0 flex h-dvh flex-col border-l border-brass/25",
          "bg-[#0D1A10]/96 text-cream shadow-glass-lg backdrop-blur-xl",
          "transition-transform duration-300 ease-out",
          wide ? "w-[400px] max-w-[100vw]" : "w-full",
          entered ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-brass/20 px-4 py-3">
          <div>
            <h2 className="font-display italic text-[28px] leading-none text-cream">Pepe</h2>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cream-dim">
              The counter
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-brass/30 text-cream hover:bg-brass/15"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex border-b border-brass/20">
          {(
            [
              ["ask", "Ask"],
              ["list", "My list"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em]",
                tab === id ? "border-b-2 border-brass text-cream" : "text-cream-dim",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("flex min-h-0 flex-1 flex-col", tab !== "ask" && "hidden")}>
            <PepeAsk wired={wired} />
          </div>
          <div className={cn("flex min-h-0 flex-1 flex-col", tab !== "list" && "hidden")}>
            <PepeTodos />
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
