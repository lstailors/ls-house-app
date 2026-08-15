import type { ReactNode } from "react";
import { cn } from "@ls/design/utils";
import LuxuryLayer from "@alts/components/LuxuryLayer";

/** Shared confirm sheet — QC all-pass, pickup charge, multi-client bag. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "brass",
  onConfirm,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "brass" | "rose" | "amber";
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <LuxuryLayer open={open} onClose={onClose} variant="modal" label={title} z={90}>
      <div
        className="w-full max-w-md mx-auto rounded-2xl border border-brass/30 px-5 pt-4 pb-5"
        style={{ background: "linear-gradient(180deg,#152A1E,#0D1A10)" }}
      >
        <h2 className="display text-[26px] leading-tight m-0">{title}</h2>
        <div className="text-sm text-cream-dim mt-3 space-y-2">{body}</div>
        <div className="grid grid-cols-2 gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-xl border border-brass/30 text-[11px] font-bold uppercase tracking-widest"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={cn(
              "h-12 rounded-xl text-[11px] font-bold uppercase tracking-widest disabled:opacity-40",
              tone === "rose" && "bg-signal-rose text-forest-deep",
              tone === "amber" && "bg-signal-amber text-forest-deep",
              tone === "brass" && "bg-brass text-forest-deep",
            )}
          >
            {pending ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </LuxuryLayer>
  );
}
