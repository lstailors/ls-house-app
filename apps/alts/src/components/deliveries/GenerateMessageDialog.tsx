import { useEffect, useState } from "react";
import { Sparkles, Copy, CheckCheck, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ls/design/ui/dialog";
import { Button } from "@ls/design/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ls/design/ui/select";
import { Textarea } from "@ls/design/ui/textarea";
import { ConfirmDialog } from "@alts/components/ConfirmDialog";
import { useDeliveryGenerateMessage, useDeliverySendMessage } from "@alts/lib/queries";

const MESSAGE_TYPES = [
  { value: "out_for_delivery", label: "On the way" },
  { value: "delay_apology", label: "Running late" },
  { value: "delivered_confirmation", label: "Delivered confirmation" },
  { value: "pickup_reminder", label: "Ready for pickup" },
  { value: "custom", label: "Custom message" },
] as const;

interface Props {
  deliveryId: string | null;
  customerName?: string | null;
  /** Prefill when detail already knows the number */
  phoneHint?: string | null;
  onClose: () => void;
}

export function GenerateMessageDialog({ deliveryId, customerName, phoneHint, onClose }: Props) {
  const [type, setType] = useState<string>("out_for_delivery");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [custom, setCustom] = useState("");
  const [draft, setDraft] = useState("");
  const [phone, setPhone] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  const generate = useDeliveryGenerateMessage();
  const send = useDeliverySendMessage();

  // Reset when dialog opens on a new delivery
  useEffect(() => {
    if (!deliveryId) return;
    setDraft("");
    setCustom("");
    setPhone(phoneHint?.trim() || "");
    setCopied(false);
    setConfirmSend(false);
    generate.reset();
    send.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryId]);

  // Pull AI text + phone into editable fields when generate succeeds
  useEffect(() => {
    if (!generate.data?.message) return;
    setDraft(generate.data.message);
    if (generate.data.phone) setPhone(generate.data.phone);
  }, [generate.data]);

  const handleGenerate = () => {
    if (!deliveryId) return;
    generate.mutate({ id: deliveryId, type, channel, customContext: custom || undefined });
  };

  const handleCopy = async () => {
    if (!draft.trim()) return;
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const smsLen = draft.trim().length;
  const canSendSms =
    channel === "sms" &&
    !!deliveryId &&
    smsLen >= 3 &&
    phone.replace(/\D/g, "").length >= 10 &&
    !send.isPending;

  const handleSend = () => {
    if (!deliveryId || !canSendSms) return;
    send.mutate(
      {
        id: deliveryId,
        message: draft.trim(),
        channel: "sms",
        phone: phone.trim(),
        confirm: true,
      },
      {
        onSuccess: (data) => {
          toast.success(`SMS sent · ${data.phone || phone}`);
          setConfirmSend(false);
          onClose();
        },
        onError: (e: Error) => {
          toast.error(e.message || "Could not send SMS");
          setConfirmSend(false);
        },
      },
    );
  };

  return (
    <>
      <Dialog open={!!deliveryId} onOpenChange={() => onClose()}>
        <DialogContent className="bg-forest-deep border border-brass/20 text-cream max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-cream flex items-center gap-2 text-base font-medium">
              <Sparkles className="h-4 w-4 text-brass-light/70" />
              Draft customer message
              {customerName ? (
                <span className="text-cream-dim font-normal">— {customerName}</span>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-cream-dim">
                  Message type
                </label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="bg-forest-raised/40 border-brass/20 text-cream text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-forest-deep border-brass/20">
                    {MESSAGE_TYPES.map((t) => (
                      <SelectItem
                        key={t.value}
                        value={t.value}
                        className="text-cream focus:bg-brass/10"
                      >
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-widest text-cream-dim">
                  Channel
                </label>
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
                <label className="text-[10px] uppercase tracking-widest text-cream-dim">
                  Custom context (for AI)
                </label>
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
              {generate.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Drafting…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {draft ? "Regenerate draft" : "Generate draft"}
                </>
              )}
            </Button>

            {generate.isError ? (
              <div className="text-xs text-signal-rose">
                Could not generate — {(generate.error as Error)?.message || "AI unavailable"}
              </div>
            ) : null}

            {/* Editable draft — always available once we have text (AI or typed) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] uppercase tracking-widest text-cream-dim">
                  Message {draft ? "(edit before send)" : ""}
                </label>
                {channel === "sms" && draft ? (
                  <span
                    className={`text-[10px] tabular-nums ${
                      smsLen > 160 ? "text-signal-amber" : "text-cream-dim"
                    }`}
                  >
                    {smsLen} chars
                    {smsLen > 160 ? " · multi-segment" : ""}
                  </span>
                ) : null}
              </div>
              <Textarea
                placeholder={
                  channel === "sms"
                    ? "Generate a draft, or type the SMS yourself…"
                    : "Generate a draft, or type the email yourself…"
                }
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="bg-forest-raised/40 border-brass/20 text-cream placeholder:text-cream-dim text-sm resize-none min-h-[120px] font-mono leading-relaxed"
              />

              {channel === "sms" ? (
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest text-cream-dim">
                    Send to phone
                  </label>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1…"
                    className="w-full h-11 rounded-md bg-forest-raised/40 border border-brass/20 px-3 text-sm text-cream placeholder:text-cream-dim outline-none focus:border-brass/50"
                  />
                </div>
              ) : (
                <p className="text-[11px] text-cream-dim leading-snug">
                  Email send from this dialog is not wired yet — edit + copy into Concierge, or switch
                  to SMS.
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!draft.trim()}
                  onClick={handleCopy}
                  className="border-brass/30 text-cream-muted hover:bg-brass/10 gap-1.5"
                >
                  {copied ? (
                    <>
                      <CheckCheck className="h-4 w-4" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> Copy
                    </>
                  )}
                </Button>

                {channel === "sms" ? (
                  <Button
                    type="button"
                    disabled={!canSendSms}
                    onClick={() => setConfirmSend(true)}
                    className="btn-brass gap-1.5 flex-1 min-w-[10rem]"
                  >
                    {send.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" /> Send SMS
                      </>
                    )}
                  </Button>
                ) : null}
              </div>

              {generate.data?.model ? (
                <div className="text-[9px] text-cream-dim/50 font-mono">model · {generate.data.model}</div>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmSend}
        onClose={() => !send.isPending && setConfirmSend(false)}
        title="Send this SMS?"
        tone="brass"
        confirmLabel={send.isPending ? "Sending…" : "Send now"}
        body={
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-cream-dim">To · </span>
              <span className="text-cream font-mono">{phone || "—"}</span>
            </p>
            {customerName ? (
              <p>
                <span className="text-cream-dim">Client · </span>
                {customerName}
              </p>
            ) : null}
            <div className="rounded-lg border border-brass/25 bg-black/25 p-3 text-xs text-cream-muted whitespace-pre-wrap max-h-40 overflow-y-auto">
              {draft}
            </div>
            <p className="text-[11px] text-cream-dim">Sends via house Twilio. Not reversible.</p>
          </div>
        }
        onConfirm={handleSend}
      />
    </>
  );
}
