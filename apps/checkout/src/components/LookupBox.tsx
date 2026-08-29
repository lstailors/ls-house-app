import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type CheckoutHit } from "@checkout/lib/api";
import { usd } from "@checkout/lib/money";

const PLACEHOLDER = "Name, ticket, invoice, order";

function hitPath(h: CheckoutHit): string | null {
  if (h.kind === "ticket") return `/t/${encodeURIComponent(h.id)}`;
  if (h.kind === "invoice") return `/i/${encodeURIComponent(h.id)}`;
  // Custom order often links an SO id in invoiceId — no card page yet
  return null;
}

export function LookupBox({
  autoFocus = false,
  className = "",
}: {
  autoFocus?: boolean;
  className?: string;
}) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CheckoutHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const raw = q.trim();
    if (raw.length < 2) {
      setHits([]);
      setErr(null);
      setSearched(false);
      setBusy(false);
      return;
    }
    const my = ++seq.current;
    setBusy(true);
    setErr(null);
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const card = await api.resolve(raw);
          if (my !== seq.current) return;
          if (card.kind === "search") {
            setHits(card.hits || []);
            setSearched(true);
            return;
          }
          // Exact scan/paste → open card
          if (card.kind === "ticket" && card.id) {
            nav(`/t/${encodeURIComponent(card.id)}`, { replace: false });
            return;
          }
          if (card.kind === "invoice" && card.id) {
            nav(`/i/${encodeURIComponent(card.id)}`, { replace: false });
            return;
          }
          setHits([]);
          setSearched(true);
        } catch (e) {
          if (my !== seq.current) return;
          setHits([]);
          setSearched(true);
          setErr(e instanceof Error ? e.message : "Lookup failed");
        } finally {
          if (my === seq.current) setBusy(false);
        }
      })();
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, nav]);

  function openHit(h: CheckoutHit) {
    const path = hitPath(h);
    if (path) {
      nav(path);
      return;
    }
    // Non-card kinds: keep list, surface note
    setErr(
      h.kind === "sales_order"
        ? `Order ${h.id} — open ticket/invoice for pay`
        : h.kind === "customer"
          ? `${h.customer || h.id} — no open ticket`
          : `${h.label || h.kind} ${h.id}`,
    );
  }

  return (
    <div className={className}>
      <div className="flex gap-2">
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          placeholder={PLACEHOLDER}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="glass min-h-[48px] flex-1 px-3 text-sm text-[var(--cr)] outline-none placeholder:text-[var(--cd)]"
          aria-label="Look up"
        />
        {busy ? (
          <div className="flex min-h-[48px] items-center px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--cd)]">
            …
          </div>
        ) : null}
      </div>

      {err ? <p className="mt-2 text-center text-xs text-red-300">{err}</p> : null}

      {searched && !busy && hits.length === 0 && q.trim().length >= 2 ? (
        <p className="mt-3 text-center text-sm text-[var(--cd)]">No matches for “{q.trim()}”</p>
      ) : null}

      {hits.length > 0 ? (
        <div className="mt-3 max-h-[48vh] space-y-2 overflow-y-auto">
          {hits.map((h) => {
            const tappable = !!hitPath(h);
            return (
              <button
                key={`${h.kind}-${h.id}`}
                type="button"
                className="glass flex w-full items-center justify-between gap-3 p-3 text-left"
                onClick={() => openHit(h)}
                disabled={!tappable && h.kind !== "sales_order" && h.kind !== "customer" && h.kind !== "custom_order"}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{h.customer || h.id}</div>
                  <div className="mt-0.5 truncate text-xs text-[var(--cm)]">
                    {[h.label || h.kind, h.id, h.subtitle || h.status].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {typeof h.outstanding === "number" && h.kind !== "customer" ? (
                  <div className="display shrink-0 text-lg text-[var(--bl)]">{usd(h.outstanding)}</div>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
