import { useEffect, useState } from "react";
import { CreditCard, CheckCircle2, Loader2, Smartphone, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";

type Stage = "idle" | "waiting" | "reading" | "processing" | "approved" | "declined";

interface Props {
  open: boolean;
  amount: number;
  customerName: string;
  onCancel: () => void;
  onApproved: () => void;
}

export function SquareTerminal({ open, amount, customerName, onCancel, onApproved }: Props) {
  const [stage, setStage] = useState<Stage>("idle");

  useEffect(() => {
    if (!open) {
      setStage("idle");
      return;
    }
    setStage("waiting");
  }, [open]);

  const handleTap = () => {
    if (stage !== "waiting") return;
    setStage("reading");
    setTimeout(() => setStage("processing"), 800);
    setTimeout(() => setStage("approved"), 2200);
    setTimeout(() => onApproved(), 3200);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="bg-forest-raised/95 border-brass/30 text-cream sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="display-heading text-2xl">Card-Present Sale</DialogTitle>
              <DialogDescription className="text-cream-muted text-xs mt-0.5">
                Square Terminal · {customerName}
              </DialogDescription>
            </div>
            <div className="ui-label text-[10px] text-cream-dim">SIMULATED</div>
          </div>
        </DialogHeader>

        <div className="px-6">
          {/* Terminal device frame */}
          <div className="relative rounded-2xl bg-gradient-to-b from-forest-deep to-forest p-5 border border-brass/20 shadow-glass-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-widerer text-cream-dim font-medium">
                Square Terminal
              </div>
              <div className="flex items-center gap-1">
                <div className="h-1.5 w-1.5 rounded-full bg-signal-emerald animate-glow-pulse" />
                <span className="text-[9px] text-cream-dim">ONLINE</span>
              </div>
            </div>

            <div className="rounded-lg bg-forest-deep/80 border border-brass/10 p-5 min-h-[200px] flex flex-col items-center justify-center">
              <StageContent stage={stage} amount={amount} onTap={handleTap} />
            </div>

            <div className="mt-3 flex items-center justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-1 w-6 rounded-full bg-brass/30" />
              ))}
            </div>
          </div>

          <div className="my-4 flex items-center justify-between text-sm">
            <span className="text-cream-muted">Amount</span>
            <span className="font-display italic text-3xl text-brass-shimmer">
              {formatUSD(amount)}
            </span>
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-2">
          <Button
            variant="outline"
            className="flex-1 border-brass/20 text-cream-muted hover:bg-brass/10"
            onClick={onCancel}
            disabled={stage === "processing" || stage === "approved"}
          >
            <X className="h-4 w-4 mr-1.5" /> Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StageContent({ stage, amount, onTap }: { stage: Stage; amount: number; onTap: () => void }) {
  if (stage === "waiting") {
    return (
      <div className="text-center w-full">
        <div className="display-heading text-3xl mb-1">{formatUSD(amount)}</div>
        <div className="text-xs text-cream-dim uppercase tracking-widerer mb-6">
          Present Card
        </div>
        <button
          onClick={onTap}
          className="group relative inline-flex flex-col items-center gap-2 cursor-pointer"
        >
          <div className="absolute inset-0 rounded-full bg-brass/20 animate-glow-pulse blur-xl" />
          <div className="relative h-20 w-20 rounded-full border-2 border-brass/50 flex items-center justify-center hover:border-brass transition-colors">
            <CreditCard className="h-9 w-9 text-brass-light group-hover:text-brass transition-colors" />
          </div>
          <span className="text-[10px] text-cream-dim mt-1">Tap to simulate tap / insert</span>
        </button>
        <div className="mt-4 flex items-center justify-center gap-3 text-cream-dim">
          <Icon><CreditCard className="h-3.5 w-3.5" /></Icon>
          <Icon><Smartphone className="h-3.5 w-3.5" /></Icon>
          <Icon><Chip /></Icon>
        </div>
      </div>
    );
  }
  if (stage === "reading") {
    return (
      <div className="text-center">
        <Loader2 className="h-10 w-10 text-brass-light mx-auto mb-3 animate-spin" />
        <div className="display-heading text-xl text-cream mb-1">Reading card…</div>
        <div className="text-xs text-cream-dim">Do not remove</div>
      </div>
    );
  }
  if (stage === "processing") {
    return (
      <div className="text-center">
        <Loader2 className="h-10 w-10 text-brass-light mx-auto mb-3 animate-spin" />
        <div className="display-heading text-xl text-cream mb-1">Authorizing…</div>
        <div className="text-xs text-cream-dim">Contacting issuer</div>
      </div>
    );
  }
  if (stage === "approved") {
    return (
      <div className="text-center animate-fade-up">
        <div className="relative inline-flex items-center justify-center mb-3">
          <div className="absolute inset-0 rounded-full bg-signal-emerald/30 blur-2xl" />
          <CheckCircle2 className="relative h-14 w-14 text-signal-emerald" />
        </div>
        <div className="display-heading text-2xl text-cream mb-1">Approved</div>
        <div className="text-xs text-cream-muted">Card ending •••• 4242</div>
        <div className="text-[10px] text-cream-dim mt-2 tracking-widerer uppercase">
          Auth · Visa Credit
        </div>
      </div>
    );
  }
  return null;
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-6 w-6 rounded-full bg-brass/10 border border-brass/20 flex items-center justify-center">
      {children}
    </div>
  );
}

function Chip() {
  return (
    <div className={cn("h-2.5 w-3 rounded-sm bg-gradient-to-br from-brass to-brass-deep")} />
  );
}
