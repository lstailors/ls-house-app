"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, formatDate, usd, yd } from "@/components/api";
import { useMe } from "@/components/useMe";

interface Quote {
  name: string;
  end_customer: string | null;
  quote_date: string | null;
  fabric_item: string | null;
  fabric_vendor: string | null;
  garment_type: string | null;
  make_level: string | null;
  yardage: number | null;
  cmt_cost: number | null;
  fabric_cost: number | null;
  shipping_cost: number | null;
  alterations_fee: number | null;
  total_cost: number | null;
  list_price: number | null;
  discount_pct: number | null;
  retail_price: number | null;
  notes: string;
  options: Record<string, boolean>;
  has_photo: boolean;
}

const OPT: Record<string, string> = {
  narrow_cloth: "Narrow cloth",
  large_check: "Large check",
  stripe_plaid: "Stripe/plaid",
  tall: "Tall",
};

export default function QuotePage({ params }: { params: { id: string } }) {
  const me = useMe();
  const [q, setQ] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = decodeURIComponent(params.id);

  useEffect(() => {
    api.get<Quote>(`/api/quotes/${encodeURIComponent(id)}`).then(setQ).catch((e) => setError(e.message));
  }, [id]);

  const line = (label: string, v: string) => (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-cream-muted">{label}</span>
      <span className="money">{v}</span>
    </div>
  );

  return (
    <Shell account={me?.account}>
      {error && <div className="glass p-6 text-center text-sm text-signal-rose">{error}</div>}
      {!q && !error && <div className="glass p-6 text-center text-sm text-cream-dim">Loading…</div>}
      {q && (
        <div className="space-y-4">
          <section className="glass-strong space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-3xl italic">{q.end_customer}</div>
                <div className="text-xs text-cream-dim">
                  {q.name} · {formatDate(q.quote_date)}
                </div>
              </div>
              {q.has_photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/quotes/${encodeURIComponent(q.name)}/photo`}
                  alt="Swatch"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                  className="h-20 w-20 rounded-xl object-cover"
                />
              )}
            </div>
            <div className="text-sm text-cream-muted">
              {q.garment_type} · {q.make_level} · {q.fabric_vendor} {q.fabric_item?.replace(/^[A-Z]+-[A-Z]+-/, "")}
            </div>
            {Object.entries(q.options).some(([, v]) => v) && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(q.options)
                  .filter(([, v]) => v)
                  .map(([k]) => (
                    <span key={k} className="rounded-full bg-brass/15 px-2.5 py-1 text-[11px]">
                      {OPT[k]}
                    </span>
                  ))}
              </div>
            )}
            {q.notes && <p className="whitespace-pre-wrap rounded-xl bg-forest-deep/40 p-3 text-sm">{q.notes}</p>}
          </section>
          {q.retail_price != null && (
            <section className="glass p-5">
              <div className="label mb-2">Retail (as quoted)</div>
              {line("List price", usd(q.list_price))}
              {line("Discount", `${q.discount_pct ?? 0}%`)}
              {line("Alterations fee", usd(q.alterations_fee))}
              <div className="mt-2 flex justify-between border-t border-brass/20 pt-3">
                <span className="font-semibold">Client price</span>
                <span className="money font-display text-2xl">{usd(q.retail_price)}</span>
              </div>
            </section>
          )}
          <section className="glass p-5">
            <div className="label mb-2">Cost from L&amp;S (as quoted)</div>
            {line("Make (CMT)", usd(q.cmt_cost))}
            {line(`Fabric${q.yardage ? ` · ${yd(q.yardage)}` : ""}`, usd(q.fabric_cost))}
            {line("Shipping & duties", usd(q.shipping_cost))}
            <div className="mt-2 flex justify-between border-t border-brass/20 pt-3">
              <span className="font-semibold">Unit cost</span>
              <span className="money font-display text-2xl">{usd(q.total_cost)}</span>
            </div>
          </section>
          <Link href={`/estimate?quote=${encodeURIComponent(q.name)}`} className="btn-brass w-full">
            Re-price in estimator
          </Link>
        </div>
      )}
    </Shell>
  );
}
