import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@checkout/lib/api";
import { useSession } from "@checkout/lib/session";
import { bagList, bagTotalDue } from "@checkout/lib/bag";
import { usd } from "@checkout/lib/money";
import { Chrome, PrimaryButton, SectionLabel } from "@checkout/components/Chrome";
import { useMemo, useState } from "react";

export default function HomePage() {
  const { staff, logout } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const dash = useQuery({ queryKey: ["checkout-dash"], queryFn: () => api.dashboard(), refetchInterval: 30_000 });
  const bag = useMemo(() => bagList(), [dash.dataUpdatedAt]);
  const bagDue = bagTotalDue();

  async function lookup() {
    const code = q.trim();
    if (!code) return;
    try {
      const card = await api.resolve(code);
      if (card.kind === "search" && card.hits?.length) {
        nav(`/search?q=${encodeURIComponent(code)}`);
        return;
      }
      if (card.kind === "ticket") nav(`/t/${encodeURIComponent(card.id!)}`);
      else if (card.kind === "invoice") nav(`/i/${encodeURIComponent(card.id!)}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Not found");
    }
  }

  return (
    <div className="checkout-shell">
      <Chrome
        title="Desk"
        sub={staff ? `${staff} · money` : "Checkout"}
        right={
          <button
            type="button"
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--cd)]"
            onClick={() => void logout().then(() => nav("/pin", { replace: true }))}
          >
            Lock
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 px-4">
        <div className="glass p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--cd)]">Unpaid</div>
          <div className="display mt-2 text-3xl text-[var(--bl)]">{dash.data?.unpaidCount ?? "—"}</div>
        </div>
        <div className="glass p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--cd)]">Ready out</div>
          <div className="display mt-2 text-3xl text-[var(--bl)]">{dash.data?.readyOutCount ?? "—"}</div>
        </div>
      </div>

      <div className="mt-4 px-4">
        <Link to="/scan" className="btn-brass flex min-h-[56px] items-center justify-center text-[13px]">
          Scan ticket
        </Link>
      </div>

      <div className="mt-3 flex gap-2 px-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void lookup()}
          placeholder="ALT-… or SI or name"
          className="glass min-h-[48px] flex-1 px-3 text-sm text-[var(--cr)] outline-none placeholder:text-[var(--cd)]"
        />
        <button type="button" className="btn-ghost min-h-[48px] px-4 text-xs font-bold uppercase tracking-wider" onClick={() => void lookup()}>
          Go
        </button>
      </div>

      {bag.length > 0 ? (
        <div className="mx-4 mt-4 glass p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cd)]">Bag</div>
              <div className="mt-1 text-sm font-semibold">{bag.length} ticket{bag.length === 1 ? "" : "s"}</div>
            </div>
            <div className="display text-xl text-[var(--bl)]">{usd(bagDue)}</div>
          </div>
          <button type="button" className="btn-brass mt-3 w-full min-h-[44px] text-xs" onClick={() => nav("/bag")}>
            Open bag
          </button>
        </div>
      ) : null}

      <SectionLabel>Feed</SectionLabel>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-8">
        {(dash.data?.feed || []).map((row: any) => (
          <button
            key={`${row.kind}-${row.id}`}
            type="button"
            className="glass flex w-full items-center justify-between gap-3 p-3 text-left"
            onClick={() =>
              nav(row.kind === "ticket" ? `/t/${encodeURIComponent(row.id)}` : `/i/${encodeURIComponent(row.id)}`)
            }
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{row.customer}</div>
              <div className="mt-0.5 truncate text-xs text-[var(--cm)]">
                {row.id} · {row.label || row.status}
              </div>
            </div>
            <div className="display text-lg text-[var(--bl)]">{usd(row.outstanding)}</div>
          </button>
        ))}
        {dash.isLoading ? <div className="text-center text-sm text-[var(--cd)]">Loading…</div> : null}
        {!dash.isLoading && !(dash.data?.feed || []).length ? (
          <div className="text-center text-sm text-[var(--cd)]">No ready / unpaid rows</div>
        ) : null}
      </div>
    </div>
  );
}
