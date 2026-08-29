import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@checkout/lib/api";
import { bagList, bagTotalDue } from "@checkout/lib/bag";
import { usd } from "@checkout/lib/money";
import { Chrome, MoneyDue, PrimaryButton, SectionLabel } from "@checkout/components/Chrome";
import { useQuery } from "@tanstack/react-query";

type Method =
  | "terminal"
  | "handheld"
  | "cof"
  | "cash"
  | "other"
  | "paylink";

const METHODS: Array<{ id: Method; name: string; role: string; av: string }> = [
  { id: "terminal", name: "Terminal", role: "Phone pings paired Square Terminal", av: "T" },
  { id: "handheld", name: "Handheld", role: "Outside tender + optional photo", av: "HH" },
  { id: "cof", name: "Card on file", role: "Charge saved card (via Alts path later)", av: "COF" },
  { id: "cash", name: "Cash", role: "Record outside cash PE path", av: "$" },
  { id: "other", name: "Other", role: "Check / other outside tender", av: "···" },
  { id: "paylink", name: "Pay link", role: "Hosted Square / WF-10 link", av: "🔗" },
];

export default function PayPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const ticket = sp.get("ticket") || undefined;
  const invoice = sp.get("invoice") || undefined;
  const [method, setMethod] = useState<Method>("terminal");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  const cardQ = useQuery({
    queryKey: ["pay-card", ticket, invoice],
    queryFn: async () => {
      if (ticket) return api.ticket(ticket);
      if (invoice) return api.invoice(invoice);
      throw new Error("No ticket/invoice");
    },
    enabled: !!(ticket || invoice),
  });

  const bag = useMemo(() => bagList(), []);
  const due = cardQ.data ? Number(cardQ.data.outstanding) || 0 : bagTotalDue();

  async function confirm() {
    setBusy(true);
    setMsg(null);
    try {
      const t = ticket || (cardQ.data?.kind === "ticket" ? cardQ.data?.id : undefined);
      const inv =
        invoice ||
        cardQ.data?.invoiceId ||
        (cardQ.data?.kind === "invoice" ? cardQ.data.id : undefined);

      if (method === "terminal") {
        try {
          await api.payTerminal({ ticket: t, invoice: inv, allowCharge: false });
          setMsg("Terminal pinged");
        } catch (e: any) {
          if (e?.gated || e?.status === 403) {
            setMsg(
              "Terminal gated — no live $ until Carl/Sarto yes in topic 1201 (CHECKOUT_ALLOW_TERMINAL).",
            );
            return;
          }
          throw e;
        }
      } else if (method === "paylink") {
        const r: any = await api.payLink({ ticket: t, invoice: inv });
        const url =
          r?.url || r?.payment_link || r?.link || cardQ.data?.payLink || null;
        if (url && typeof url === "string") {
          setMsg(`Link ready: ${url}`);
          window.open(url, "_blank");
        } else if (cardQ.data?.payLink) {
          window.open(cardQ.data.payLink, "_blank");
          setMsg("Opened existing pay link");
        } else {
          setMsg(JSON.stringify(r).slice(0, 180));
        }
      } else if (method === "cof") {
        setMsg("Card on file — wire to existing Alts COF endpoint next; not charged here.");
        return;
      } else {
        const outsideMethod =
          method === "handheld" ? "square_handheld" : method === "cash" ? "cash" : "other";
        await api.payOutside({
          ticket: t,
          invoice: inv,
          method: outsideMethod,
          amount: due || undefined,
          reference: ref || (method === "other" ? "OTHER-checkout" : undefined),
        });
        if (photo && (t || inv)) {
          await api.proof(photo, { ticket: t, invoice: inv });
        }
        setMsg("Outside tender recorded");
      }

      nav(
        `/out?${new URLSearchParams({
          ...(t ? { ticket: t } : {}),
          ...(inv ? { invoice: inv } : {}),
        }).toString()}`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Pay failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="checkout-shell">
      <Chrome title="Pay" sub="How are they paying?" backTo={ticket ? `/t/${ticket}` : "/"} />

      <div className="glass mx-4 mb-3 flex items-center justify-between p-4">
        <div>
          <div className="text-sm font-semibold">{cardQ.data?.customer || "Bag"}</div>
          <div className="mt-1 text-xs text-[var(--cm)]">
            {ticket || invoice || (bag.length ? `${bag.length} in bag` : "—")}
          </div>
        </div>
        <MoneyDue amount={due} />
      </div>

      <SectionLabel>Method</SectionLabel>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMethod(m.id)}
            className={`flex min-h-[72px] items-center gap-3.5 rounded-2xl border-[1.5px] px-4 py-3 text-left ${
              method === m.id
                ? "border-[var(--br)] bg-[linear-gradient(145deg,rgba(176,141,87,0.18),rgba(176,141,87,0.05))]"
                : "border-[var(--line)] bg-[var(--glass)]"
            }`}
          >
            <div
              className={`grid h-11 w-11 flex-none place-items-center rounded-full border text-[11px] font-bold tracking-wide ${
                method === m.id
                  ? "border-[var(--br)] bg-[rgba(176,141,87,0.22)] text-[var(--cr)]"
                  : "border-[rgba(176,141,87,0.4)] bg-[rgba(31,58,46,0.8)] text-[var(--bl)]"
              }`}
            >
              {m.av}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{m.name}</div>
              <div className="mt-0.5 text-xs text-[var(--cm)]">{m.role}</div>
            </div>
            <div
              className={`grid h-6 w-6 place-items-center rounded-full border-[1.5px] text-xs ${
                method === m.id
                  ? "border-[var(--br)] bg-[var(--br)] text-[var(--fd)]"
                  : "border-[rgba(176,141,87,0.35)] text-transparent"
              }`}
            >
              ✓
            </div>
          </button>
        ))}
      </div>

      {(method === "handheld" || method === "other" || method === "cash") && (
        <div className="space-y-2 px-4 pt-3">
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={method === "other" ? "Check # or note" : "Optional Square ref"}
            className="glass w-full min-h-[44px] px-3 text-sm outline-none"
          />
          {method === "handheld" ? (
            <label className="btn-ghost flex min-h-[44px] cursor-pointer items-center justify-center text-xs font-bold uppercase tracking-wider">
              {photo ? photo.name : "Optional proof photo"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => setPhoto(e.target.files?.[0] || null)}
              />
            </label>
          ) : null}
        </div>
      )}

      {msg ? <p className="px-4 pt-2 text-center text-sm text-[var(--cm)]">{msg}</p> : null}

      <div className="px-4 pb-8 pt-3">
        <PrimaryButton disabled={busy || (!ticket && !invoice)} onClick={() => void confirm()}>
          {busy ? "Working…" : method === "terminal" ? "Ping terminal (gated)" : `Confirm · ${usd(due)}`}
        </PrimaryButton>
        <p className="mt-2 text-center text-[11px] text-[var(--cd)]">
          No live card charge until Carl/Sarto yes in 1201.
        </p>
      </div>
    </div>
  );
}
