"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, formatDate, usd } from "@/components/api";
import { useMe } from "@/components/useMe";

interface QuoteRow {
  name: string;
  end_customer: string | null;
  quote_date: string | null;
  fabric_item: string | null;
  fabric_vendor: string | null;
  garment_type: string | null;
  make_level: string | null;
  total_cost: number | null;
  retail_price: number | null;
}

export default function QuotesPage() {
  const me = useMe();
  const [rows, setRows] = useState<QuoteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.get<QuoteRow[]>("/api/quotes").then(setRows).catch((e) => setError(e.message));
  }, []);

  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter(
    (r) => !needle || [r.end_customer, r.fabric_item, r.name].some((s) => s?.toLowerCase().includes(needle)),
  );

  return (
    <Shell account={me?.account}>
      <div className="space-y-3">
        <input className="field" placeholder="Search client or fabric" value={q} onChange={(e) => setQ(e.target.value)} />
        {error && <div className="glass p-6 text-center text-sm text-signal-rose">{error}</div>}
        {!rows && !error && <div className="glass p-6 text-center text-sm text-cream-dim">Loading…</div>}
        {rows && !shown.length && (
          <div className="glass p-6 text-center text-sm text-cream-dim">
            {rows.length ? "No quotes match" : "No saved quotes yet."}
          </div>
        )}
        {shown.map((r) => (
          <Link key={r.name} href={`/quotes/${encodeURIComponent(r.name)}`} className="glass block p-4 transition hover:border-brass/40">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-display text-xl italic">{r.end_customer || "—"}</span>
              <span className="money shrink-0 font-semibold">{usd(r.retail_price ?? r.total_cost)}</span>
            </div>
            <div className="mt-1 flex justify-between gap-3 text-xs text-cream-dim">
              <span className="truncate">
                {r.garment_type} · {r.fabric_vendor} {r.fabric_item?.replace(/^[A-Z]+-[A-Z]+-/, "")}
              </span>
              <span className="shrink-0">{formatDate(r.quote_date)}</span>
            </div>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
