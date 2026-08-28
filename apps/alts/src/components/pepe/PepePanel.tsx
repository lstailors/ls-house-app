import { createPortal } from "react-dom";
import { X, Sparkles, ListTodo } from "lucide-react";
import { cn } from "@ls/design/utils";
import { useBodyLock, useOverlayEscape, usePresence, LUX_MS } from "@alts/lib/luxuryMotion";
import { usePepePanel } from "./PepeContext";
import PepeAsk from "./PepeAsk";
import PepeTodos from "./PepeTodos";
import { useState } from "react";

type Tab = "ask" | "list";

/** Dropdown chat panel anchored under the top-bar AI button. */
export default function PepePanel({
  wired,
  todoCount = 0,
}: {
  wired: boolean;
  todoCount?: number;
}) {
  const { open, close } = usePepePanel();
  const { shown, entered } = usePresence(open, LUX_MS);
  const [tab, setTab] = useState<Tab>("ask");
  useBodyLock(shown);
  useOverlayEscape(shown, close);

  if (!shown || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn("pepe-layer fixed inset-0", entered ? "opacity-100" : "opacity-0")}
      style={{ zIndex: 50 }}
      role="dialog"
      aria-modal="true"
      aria-label="Pepe AI"
    >
      <button type="button" aria-label="Close Pepe" onClick={close} className="pepe-scrim absolute inset-0" />
      <aside
        className={cn(
          "pepe-dropdown absolute flex flex-col",
          "transition-all duration-250 ease-out",
          entered ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-2 scale-[0.97]",
        )}
      >
        <header className="pepe-drop-hd">
          <div className="pepe-drop-brand">
            <span className="pepe-drop-avatar" aria-hidden>
              <Sparkles size={14} strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <h2 className="font-display italic text-[22px] leading-none text-cream">Pepe</h2>
              <p className="mt-0.5 text-[9.5px] font-bold uppercase tracking-[0.16em] text-brass-light">
                AI · ask · notify
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="pepe-drop-x"
          >
            <X size={15} />
          </button>
        </header>

        <div className="pepe-drop-tabs" role="tablist">
          {(
            [
              ["ask", "Chat", Sparkles],
              ["list", "To-dos", ListTodo],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn("pepe-drop-tab", tab === id && "is-on")}
            >
              <Icon size={13} strokeWidth={2.2} aria-hidden />
              {label}
              {id === "list" && todoCount > 0 && (
                <em className="pepe-tab-badge">{todoCount > 9 ? "9+" : todoCount}</em>
              )}
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
