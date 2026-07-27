import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { cn } from "@ls/design/utils";
import { TransferModal } from "./TransferModal";

export function TransferButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-40",
          "w-14 h-14 rounded-full",
          "bg-gradient-to-br from-brass to-brass/70",
          "border border-brass-shimmer/50",
          "shadow-[0_4px_24px_rgba(176,141,87,0.4)]",
          "flex items-center justify-center",
          "hover:shadow-[0_4px_32px_rgba(176,141,87,0.6)] hover:scale-105",
          "transition-all duration-200",
          "active:scale-95",
        )}
        aria-label="Transfer tickets"
      >
        <ArrowLeftRight className="h-6 w-6 text-forest-deep" />
      </button>
      {open && <TransferModal open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
