import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@checkout/lib/api";
import { Chrome, PrimaryButton } from "@checkout/components/Chrome";
import { useState } from "react";

export default function ReceiptPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const ticket = sp.get("ticket") || undefined;
  const invoice = sp.get("invoice") || undefined;
  const out = sp.get("out") || "Pickup";
  const [note, setNote] = useState<string | null>(null);

  const draft = useQuery({
    queryKey: ["receipt-draft", ticket, invoice],
    queryFn: () => api.receiptDraft({ ticket, invoice, channel: "sms" }),
    enabled: !!(ticket || invoice),
  });

  return (
    <div className="checkout-shell">
      <Chrome title="Receipt" sub={`${out} · optional send`} backTo="/" />

      <div className="glass mx-4 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cd)]">Draft SMS (Sofia gate)</div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--cm)]">
          {draft.data?.smsDraft || (draft.isLoading ? "Loading…" : "—")}
        </p>
        <div className="mt-3 text-xs text-[var(--cd)]">
          To: {draft.data?.phone || "no phone"} · Email: {draft.data?.email || "Customer.email_id"}
        </div>
        <div className="mt-2 text-[11px] text-[var(--cd)]">{draft.data?.note}</div>
      </div>

      {note ? <p className="px-4 pt-3 text-center text-sm text-[var(--bl)]">{note}</p> : null}

      <div className="mt-auto space-y-2 px-4 pb-8 pt-6">
        <PrimaryButton
          onClick={() => {
            setNote("SMS draft kept — Sofia send path gated (not auto-sent).");
          }}
          label="Text · draft only"
        />
        <button
          type="button"
          className="btn-ghost w-full min-h-[48px] text-xs font-bold uppercase tracking-wider"
          onClick={() => {
            setNote(
              draft.data?.email
                ? `Email draft to ${draft.data.email} — send via Concierge later`
                : "No Customer.email_id on file",
            );
          }}
        >
          Email · Customer.email_id
        </button>
        <button
          type="button"
          className="btn-ghost w-full min-h-[48px] text-xs font-bold uppercase tracking-wider"
          onClick={() => nav("/done")}
        >
          Skip
        </button>
        <PrimaryButton className="mt-2" onClick={() => nav("/done")} label="Done" />
      </div>
    </div>
  );
}
