import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
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

type Phase = "methods" | "paylink-choice" | "qr" | "paid";

const METHODS: Array<{ id: Method; name: string; role: string; av: string }> = [
  { id: "terminal", name: "Terminal", role: "Phone pings paired Square Terminal", av: "T" },
  { id: "handheld", name: "Handheld", role: "Outside tender + optional photo", av: "HH" },
  { id: "cof", name: "Card on file", role: "Charge saved card (via Alts path later)", av: "COF" },
  { id: "cash", name: "Cash", role: "Record outside cash PE path", av: "$" },
  { id: "other", name: "Other", role: "Check / other outside tender", av: "···" },
  { id: "paylink", name: "Pay link", role: "Hosted Square / WF-10 link", av: "🔗" },
];

function extractUrl(r: any, fallback?: string | null): string | null {
  const cands = [
    r?.url,
    r?.payment_link,
    r?.payment_link_url,
    r?.link,
    r?.long_url,
    r?.payment_url,
    r?.checkout_url,
    typeof r?.payment_link === "object" ? r.payment_link?.url : null,
    fallback,
  ];
  for (const c of cands) {
    if (typeof c === "string" && /^https?:\/\//i.test(c.trim())) return c.trim();
  }
  return null;
}

function goOut(
  nav: ReturnType<typeof useNavigate>,
  t?: string,
  inv?: string,
) {
  nav(
    `/out?${new URLSearchParams({
      ...(t ? { ticket: t } : {}),
      ...(inv ? { invoice: inv } : {}),
    }).toString()}`,
  );
}

export default function PayPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const ticket = sp.get("ticket") || undefined;
  const invoice = sp.get("invoice") || undefined;
  const [method, setMethod] = useState<Method>("terminal");
  const [phase, setPhase] = useState<Phase>("methods");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const paidHandled = useRef(false);

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

  const ids = useMemo(() => {
    const t = ticket || (cardQ.data?.kind === "ticket" ? cardQ.data?.id : undefined);
    const inv =
      invoice ||
      cardQ.data?.invoiceId ||
      (cardQ.data?.kind === "invoice" ? cardQ.data.id : undefined) ||
      undefined;
    return { t: t || undefined, inv: inv || undefined };
  }, [ticket, invoice, cardQ.data]);

  const customerName = cardQ.data?.customer || "Bag";
  const refLabel = ids.t || ids.inv || (bag.length ? `${bag.length} in bag` : "—");

  // Paid loop while QR is up — ERP outstanding is truth (WF-10), ~2s poll
  const statusQ = useQuery({
    queryKey: ["pay-status", ids.t, ids.inv, phase],
    queryFn: () => api.payStatus({ ticket: ids.t, invoice: ids.inv }),
    enabled: phase === "qr" && !!(ids.t || ids.inv),
    refetchInterval: phase === "qr" ? 2000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (phase !== "qr" || paidHandled.current) return;
    const st = statusQ.data;
    if (!st) return;
    const paid =
      !!st.paid ||
      (typeof st.outstanding === "number" && st.outstanding <= 0.005);
    if (!paid) return;
    paidHandled.current = true;
    setPhase("paid");
    try {
      navigator.vibrate?.(180);
    } catch {
      /* desktop */
    }
    const t = window.setTimeout(() => {
      goOut(nav, ids.t, ids.inv);
    }, 900);
    return () => window.clearTimeout(t);
  }, [phase, statusQ.data, nav, ids.t, ids.inv]);

  async function mintPayLink(): Promise<string> {
    const r: any = await api.payLink({ ticket: ids.t, invoice: ids.inv });
    const url = extractUrl(r, cardQ.data?.payLink || null);
    if (!url) {
      throw new Error(
        typeof r === "object" ? `No pay URL in response: ${JSON.stringify(r).slice(0, 160)}` : "No pay URL",
      );
    }
    setPayUrl(url);
    return url;
  }

  async function openOnPhone() {
    setBusy(true);
    setMsg(null);
    try {
      const url = payUrl || (await mintPayLink());
      window.open(url, "_blank");
      setMsg("Opened hosted Square on this phone");
      goOut(nav, ids.t, ids.inv);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Pay link failed");
    } finally {
      setBusy(false);
    }
  }

  async function showQr() {
    setBusy(true);
    setMsg(null);
    paidHandled.current = false;
    try {
      await mintPayLink();
      setPhase("qr");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Pay link failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmOutsideOrTerminal() {
    setBusy(true);
    setMsg(null);
    try {
      const t = ids.t;
      const inv = ids.inv;

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

      goOut(nav, t, inv);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Pay failed");
    } finally {
      setBusy(false);
    }
  }

  function onPrimary() {
    if (method === "paylink") {
      setPhase("paylink-choice");
      setMsg(null);
      return;
    }
    void confirmOutsideOrTerminal();
  }

  // ─── Paid flash ───────────────────────────────────────────────────────────
  if (phase === "paid") {
    return (
      <div className="checkout-shell items-center justify-center gap-4 px-6 text-center">
        <div className="grid h-20 w-20 place-items-center rounded-full border-2 border-[var(--br)] bg-[rgba(176,141,87,0.18)] text-4xl text-[var(--bl)]">
          ✓
        </div>
        <h1 className="display text-3xl text-[var(--cr)]">Paid</h1>
        <p className="text-sm text-[var(--cm)]">ERP outstanding is zero · advancing to Out</p>
      </div>
    );
  }

  // ─── Show QR (mock 03) ────────────────────────────────────────────────────
  if (phase === "qr" && payUrl) {
    const liveDue =
      typeof statusQ.data?.outstanding === "number" ? statusQ.data.outstanding : due;
    return (
      <div className="checkout-shell">
        <Chrome
          title="Show QR"
          sub="Pay link · their phone"
          onBack={() => {
            paidHandled.current = false;
            setPhase("paylink-choice");
            setMsg(null);
          }}
          right={
            <span className="rounded-full border border-[rgba(176,141,87,0.4)] bg-[rgba(176,141,87,0.1)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--bl)]">
              {statusQ.isFetching ? "Checking…" : "Live"}
            </span>
          }
        />
        <div className="flex flex-1 flex-col items-center px-5 pt-1">
          <div className="display text-center text-[28px] leading-tight text-[var(--cr)]">
            {customerName}
          </div>
          <div className="mt-2.5 text-center text-xs text-[var(--cm)]">
            <span className="font-semibold tracking-wide text-[var(--bl)]">{refLabel}</span>
            {" · "}
            invoice due
          </div>
          <div className="mt-3.5 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--cd)]">
              Amount due
            </div>
            <div className="display mt-1 text-4xl leading-none text-[var(--bl)]">{usd(liveDue)}</div>
          </div>

          <div
            className="mt-4 rounded-3xl border border-[rgba(176,141,87,0.35)] p-[18px] shadow-[0_20px_48px_rgba(0,0,0,0.4),0_0_0_6px_rgba(176,141,87,0.12)]"
            style={{ background: "#F1E9D6" }}
          >
            <QRCodeSVG
              value={payUrl}
              size={248}
              level="M"
              bgColor="#F1E9D6"
              fgColor="#0D1A10"
              includeMargin={false}
            />
          </div>

          <div className="mt-4 text-center text-sm font-semibold tracking-wide text-[var(--cr)]">
            They scan with Camera
            <div className="mt-1.5 text-xs font-medium leading-snug text-[var(--cm)]">
              Pays on their phone · Apple Pay on Square’s page
            </div>
          </div>
          <div className="mt-3.5 rounded-xl border border-[var(--line)] bg-[rgba(0,0,0,0.22)] px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--cd)]">
            Staff keeps this phone
          </div>
          {msg ? <p className="mt-2 text-center text-xs text-[var(--cm)]">{msg}</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-3 px-4 pb-8 pt-3">
          <button
            type="button"
            className="btn-ghost min-h-14 text-xs font-bold uppercase tracking-[0.16em] text-[var(--bl)]"
            onClick={() => {
              paidHandled.current = false;
              setPhase("paylink-choice");
              setMsg(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-brass min-h-14 text-xs font-bold uppercase tracking-[0.16em]"
            onClick={() => goOut(nav, ids.t, ids.inv)}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ─── Pay link subchoice (mock 02) ─────────────────────────────────────────
  if (phase === "paylink-choice") {
    return (
      <div className="checkout-shell">
        <Chrome
          title="Pay link"
          sub="Same Square link · two ways"
          onBack={() => {
            setPhase("methods");
            setMsg(null);
          }}
        />
        <div className="mx-4 mb-3 flex items-center justify-between p-4 glass">
          <div>
            <div className="text-sm font-semibold">{customerName}</div>
            <div className="mt-1 text-xs text-[var(--cm)]">{refLabel}</div>
          </div>
          <MoneyDue amount={due} />
        </div>
        <div className="mx-4 mb-4 inline-flex items-center gap-2 self-start rounded-full border border-[rgba(176,141,87,0.4)] bg-[rgba(176,141,87,0.12)] px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--bl)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--br)]" />
          Method · Pay link
        </div>
        <SectionLabel>Choose</SectionLabel>
        <div className="flex flex-1 flex-col gap-3.5 px-4">
          <button
            type="button"
            disabled={busy || (!ids.t && !ids.inv)}
            onClick={() => void openOnPhone()}
            className="flex min-h-[148px] flex-col justify-center gap-2.5 rounded-[20px] border-[1.5px] border-[var(--br)] px-5 py-[22px] text-left disabled:opacity-50"
            style={{
              background: "linear-gradient(145deg,rgba(176,141,87,.22),rgba(176,141,87,.06))",
              boxShadow:
                "0 0 0 1px rgba(176,141,87,.28), 0 16px 40px rgba(0,0,0,.3), inset 0 1px 0 rgba(212,178,122,.18)",
            }}
          >
            <div className="grid h-11 w-11 place-items-center rounded-[14px] border border-[var(--br)] bg-[rgba(176,141,87,0.22)] text-lg font-bold text-[var(--cr)]">
              ↗
            </div>
            <div className="text-xl font-bold tracking-wide text-[var(--cr)]">Open on this phone</div>
            <div className="max-w-[300px] text-[13px] leading-snug text-[var(--cm)]">
              Hosted Square checkout opens here. Customer pays on staff device.
            </div>
          </button>

          <button
            type="button"
            disabled={busy || (!ids.t && !ids.inv)}
            onClick={() => void showQr()}
            className="flex min-h-[148px] flex-col justify-center gap-2.5 rounded-[20px] border-[1.5px] border-[var(--line)] bg-[var(--glass)] px-5 py-[22px] text-left shadow-[0_14px_36px_rgba(0,0,0,0.28)] disabled:opacity-50"
          >
            <div className="grid h-11 w-11 place-items-center rounded-[14px] border border-[rgba(176,141,87,0.4)] bg-[rgba(31,58,46,0.75)] text-lg font-bold text-[var(--bl)]">
              ▣
            </div>
            <div className="text-xl font-bold tracking-wide text-[var(--cr)]">Show QR for them</div>
            <div className="max-w-[300px] text-[13px] leading-snug text-[var(--cm)]">
              Large QR on this phone. They scan with Camera and pay on theirs — Apple Pay on Square.
            </div>
          </button>

          <p className="px-5 pt-2 text-center text-xs leading-snug text-[var(--cd)]">
            One pay link · <strong className="font-semibold text-[var(--cm)]">no Tap to Pay · no NFC · no card reader UI</strong>
          </p>
          {msg ? <p className="text-center text-sm text-[var(--cm)]">{msg}</p> : null}
          {busy ? <p className="text-center text-sm text-[var(--bl)]">Minting link…</p> : null}
        </div>
        <div className="px-4 pb-8 pt-3">
          <button
            type="button"
            className="btn-ghost w-full min-h-[52px] text-xs font-bold uppercase tracking-[0.16em] text-[var(--bl)]"
            onClick={() => {
              setPhase("methods");
              setMsg(null);
            }}
          >
            Back to methods
          </button>
        </div>
      </div>
    );
  }

  // ─── Methods (default) ────────────────────────────────────────────────────
  return (
    <div className="checkout-shell">
      <Chrome title="Pay" sub="How are they paying?" backTo={ticket ? `/t/${ticket}` : invoice ? `/i/${invoice}` : "/"} />

      <div className="glass mx-4 mb-3 flex items-center justify-between p-4">
        <div>
          <div className="text-sm font-semibold">{customerName}</div>
          <div className="mt-1 text-xs text-[var(--cm)]">{refLabel}</div>
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
        <PrimaryButton disabled={busy || (!ticket && !invoice)} onClick={onPrimary}>
          {busy
            ? "Working…"
            : method === "paylink"
              ? "Continue · Pay link"
              : method === "terminal"
                ? "Ping terminal (gated)"
                : `Confirm · ${usd(due)}`}
        </PrimaryButton>
        <p className="mt-2 text-center text-[11px] text-[var(--cd)]">
          No live card charge until Carl/Sarto yes in 1201.
        </p>
      </div>
    </div>
  );
}
