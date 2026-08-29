import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@checkout/lib/api";
import { bagAdd, bagList, bagRemove, bagTotalDue } from "@checkout/lib/bag";
import { usd } from "@checkout/lib/money";
import { Chrome, MoneyDue, PrimaryButton, SectionLabel } from "@checkout/components/Chrome";

export function BagPage() {
  const nav = useNavigate();
  const [, tick] = useState(0);
  const items = bagList();
  const due = bagTotalDue();

  return (
    <div className="checkout-shell">
      <Chrome title="Bag" sub="App-local · one trip" backTo="/" />
      <div className="glass mx-4 mb-3 flex justify-between p-4">
        <div className="text-sm font-semibold">{items.length} ticket(s)</div>
        <MoneyDue amount={due} />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4">
        {items.map((it) => (
          <div key={it.id} className="glass flex items-center justify-between gap-2 p-3">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => nav(it.kind === "ticket" ? `/t/${it.id}` : `/i/${it.id}`)}
            >
              <div className="truncate text-sm font-semibold">{it.customer}</div>
              <div className="truncate text-xs text-[var(--cm)]">{it.id}</div>
            </button>
            <div className="display text-[var(--bl)]">{usd(it.outstanding)}</div>
            <button
              type="button"
              className="text-xs text-[var(--cd)]"
              onClick={() => {
                bagRemove(it.id);
                tick((n) => n + 1);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="space-y-2 px-4 pb-8 pt-4">
        <PrimaryButton
          disabled={!items.length}
          onClick={() => {
            const first = items[0];
            nav(
              `/pay?${new URLSearchParams({
                ...(first?.ticketId || first?.kind === "ticket" ? { ticket: first.ticketId || first.id } : {}),
                ...(first?.invoiceId ? { invoice: first.invoiceId } : {}),
              }).toString()}`,
            );
          }}
          label={`Pay bag · ${usd(due)}`}
        />
        <button
          type="button"
          className="btn-ghost w-full min-h-[48px] text-xs font-bold uppercase tracking-wider"
          onClick={() =>
            nav(
              `/bag/add?customer=${encodeURIComponent(items[0]?.customerId || "")}&name=${encodeURIComponent(items[0]?.customer || "")}`,
            )
          }
        >
          Add ticket
        </button>
      </div>
    </div>
  );
}

export function BagAddPage() {
  const [sp] = useSearchParams();
  const customer = sp.get("customer") || "";
  const name = sp.get("name") || "";
  const [mode, setMode] = useState<"same" | "other">("same");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function load() {
    setBusy(true);
    try {
      const r = await api.openForCustomer(
        mode === "same" && customer ? { customer } : { q: q || name },
      );
      setRows(r.rows || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Load failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (mode === "same" && customer) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, customer]);

  return (
    <div className="checkout-shell">
      <Chrome title="Add ticket" sub="Same client or house/friend" backTo="/bag" />
      <div className="mb-3 flex gap-2 px-4">
        <button
          type="button"
          className={`flex-1 min-h-[44px] rounded-2xl border text-xs font-bold uppercase tracking-wider ${
            mode === "same" ? "border-[var(--br)] text-[var(--bl)]" : "border-[var(--line)]"
          }`}
          onClick={() => setMode("same")}
        >
          Same customer
        </button>
        <button
          type="button"
          className={`flex-1 min-h-[44px] rounded-2xl border text-xs font-bold uppercase tracking-wider ${
            mode === "other" ? "border-[var(--br)] text-[var(--bl)]" : "border-[var(--line)]"
          }`}
          onClick={() => setMode("other")}
        >
          Another (friend)
        </button>
      </div>
      {mode === "other" ? (
        <div className="mb-3 flex gap-2 px-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name"
            className="glass min-h-[44px] flex-1 px-3 text-sm outline-none"
          />
          <button type="button" className="btn-ghost px-4 text-xs font-bold uppercase" onClick={() => void load()}>
            Find
          </button>
        </div>
      ) : null}
      <SectionLabel>Open tickets</SectionLabel>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-8">
        {busy ? <div className="text-center text-sm text-[var(--cd)]">Loading…</div> : null}
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            className="glass flex w-full items-center justify-between p-3 text-left"
            onClick={async () => {
              const card = await api.ticket(r.id);
              bagAdd(card);
              nav("/bag");
            }}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{r.customer}</div>
              <div className="truncate text-xs text-[var(--cm)]">
                {r.id} · {r.status}
              </div>
            </div>
            <div className="display text-[var(--bl)]">{usd(r.outstanding)}</div>
          </button>
        ))}
        {!busy && !rows.length ? <div className="text-center text-sm text-[var(--cd)]">No open tickets</div> : null}
      </div>
    </div>
  );
}
