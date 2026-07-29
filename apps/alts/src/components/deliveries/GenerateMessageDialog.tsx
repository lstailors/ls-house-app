import { useState } from "react";
import { Sparkles, Copy, CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ls/design/ui/dialog";
import { Button } from "@ls/design/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ls/design/ui/select";
import { Textarea } from "@ls/design/ui/textarea";
import { useDeliveryGenerateMessage } from "@alts/lib/queries";

const MESSAGE_TYPES = [
  { value: "out_for_delivery",        label: "On the way" },
  { value: "delay_apology",           label: "Running late" },
  { value: "delivered_confirmation",  label: "Delivered confirmation" },
  { value: "pickup_reminder",         label: "Ready for pickup" },
  { value: "custom",                  label: "Custom message" },
] as const;

interface Props {
  deliveryId: string | null;
  customerName?: string | null;
  onClose: () => void;
}

export function GenerateMessageDialog({ deliveryId, customerName, onClose }: Props) {
  const [type, setType]       = useState<string>("out_for_delivery");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [custom, setCustom]   = useState("");
  const [copied, setCopied]   = useState(false);

  const generate = useDeliveryGenerateMessage();

  const handleGenerate = () => {
    if (!deliveryId) return;
    generate.mutate({ id: deliveryId, type, channel, customContext: custom || undefined });
  };

  const handleCopy = async () => {
    if (!generate.data?.message) return;
    await navigator.clipboard.writeText(generate.data.message);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={!!deliveryId} onOpenChange={() => onClose()}>
      <DialogContent className="bg-forest-deep border border-brass/20 text-cream max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-cream flex items-center gap-2 text-base font-medium">
            <Sparkles className="h-4 w-4 text-brass-light/70" />
            Draft customer message
            {customerName ? <span className="text-cream-dim font-normal">— {customerName}</span> : null}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Controls */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-cream-dim">Message type</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="bg-forest-raised/40 border-brass/20 text-cream text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-forest-deep border-brass/20">
                  {MESSAGE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-cream focus:bg-brass/10">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-cream-dim">Channel</label>
              <div className="flex gap-1.5">
                {(["sms", "email"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChannel(c)}
                    className={`flex-1 h-9 rounded-md text-xs font-medium border transition-colors ${
                      channel === c
                        ? "bg-brass/20 border-brass/40 text-brass-light"
                        : "border-brass/15 text-cream-dim hover:text-cream"
                    }`}
                  >
                    {c.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {type === "custom" ? (
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest text-cream-dim">Custom context</label>
              <Textarea
                placeholder="e.g. Garments were left with the doorman at 3:15 PM"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="bg-forest-raised/40 border-brass/20 text-cream placeholder:text-cream-dim text-sm resize-none h-20"
              />
            </div>
          ) : null}

          <Button
            onClick={handleGenerate}
            disabled={generate.isPending}
            className="w-full btn-brass gap-2"
          >
            {generate.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Drafting…</>
              : <><Sparkles className="h-4 w-4" /> Generate draft</>
            }
          </Button>

          {/* Result */}
          {generate.data ? (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-cream-dim">Draft</div>
              <div className="relative">
                <div className="rounded-lg border border-brass/20 bg-forest-raised/30 p-3 text-sm text-cream-muted leading-relaxed whitespace-pre-wrap font-mono text-xs">
                  {generate.data.message}
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-brass-light/60 hover:text-brass-light transition-colors"
                >
                  {copied
                    ? <><CheckCheck className="h-3 w-3" /> Copied</>
                    : <><Copy className="h-3 w-3" /> Copy</>
                  }
                </button>
              </div>
              <div className="text-[9px] text-cream-dim/50 font-mono">{generate.data.model}</div>
            </div>
          ) : generate.isError ? (
            <div className="text-xs text-signal-rose">Could not generate message — check AI_GATEWAY_API_KEY.</div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
