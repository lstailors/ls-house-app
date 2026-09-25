"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SaveQuoteSheet } from "@/components/SaveQuoteSheet";
import { Shell } from "@/components/Shell";
import { ApiError, api, formatDate, usd, yd } from "@/components/api";
import { useMe } from "@/components/useMe";

type Garment = "Jacket" | "Trouser" | "Vest" | "Overcoat" | "Two Piece" | "Three Piece";
type Make = "Classico" | "Mezza Mano" | "Fatto a Mano";
const GARMENTS: Garment[] = ["Jacket", "Trouser", "Vest", "Overcoat", "Two Piece", "Three Piece"];
const MAKES: Make[] = ["Classico", "Mezza Mano", "Fatto a Mano"];
const HAS = {
  jacket: (g: Garment) => g === "Jacket" || g === "Two Piece" || g === "Three Piece",
  trouser: (g: Garment) => g === "Trouser" || g === "Two Piece" || g === "Three Piece",
  vest: (g: Garment) => g === "Vest" || g === "Three Piece",
};

interface Vendor {
  code: string;
  name: string;
  provisional: boolean;
}
interface Fabric {
  item_code: string;
  item_name: string;
  composition: string | null;
  image: string | null;
  width_in: number | null;
  out_of_stock: boolean;
}
interface Line {
  type: string;
  yardage: number;
  cmt: number;
  fabric: number;
  shipping: number;
  unit_cost: number;
  alterations_fee: number;
}
export interface Estimate {
  account: { name: string };
  fabric: Fabric & { vendor_code: string; vendor_name: string };
  garment_type: Garment;
  make_level: Make;
  garments: Line[];
  totals: Omit<Line, "type">;
  retail: { multiplier: number; list_price: number; discount_pct: number; retail_price: number } | null;
  flags: {
    stale_price: boolean;
    price_valid_upto: string | null;
    provisional_vendor: boolean;
    fx_fallback: boolean;
    width_assumed: boolean;
    out_of_stock: boolean;
  };
  margin?: {
    garments: { type: string; real_cost: number; billed: number; profit: number }[];
    totals: { real_cost: number; billed: number; profit: number };
  };
}
export interface Options {
  narrow_cloth: boolean;
  large_check: boolean;
  stripe_plaid: boolean;
  tall: boolean;
}
const NO_OPTIONS: Options = { narrow_cloth: false, large_check: false, stripe_plaid: false, tall: false };

export default function EstimatePage() {
  return (
    <Suspense>
      <Estimator />
    </Suspense>
  );
}

function Estimator() {
  const me = useMe();
  const params = useSearchParams();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendor, setVendor] = useState("");
  const [fabric, setFabric] = useState<Fabric | null>(null);
  const [garment, setGarment] = useState<Garment>("Two Piece");
  const [make, setMake] = useState<Make | null>(null);
  const [options, setOptions] = useState<Options>(NO_OPTIONS);
  const [discount, setDiscount] = useState<number | null>(null);
  const [asCustomer, setAsCustomer] = useState("");
  const [tab, setTab] = useState<"retail" | "cost" | "margin">("retail");
  const [est, setEst] = useState<Estimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const reopened = useRef(false);

  useEffect(() => {
    api.get<Vendor[]>("/api/vendors").then(setVendors).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!me) return;
    setMake((m) => m ?? me.default_make_level);
    setDiscount((d) => d ?? me.default_discount_pct);
  }, [me]);

  // Reopen a saved quote: /estimate?quote=FQ-2026-00001
  useEffect(() => {
    const id = params.get("quote");
    if (!id || reopened.current || !vendors.length) return;
    reopened.current = true;
    (async () => {
      const q = await api.get<{
        fabric_item: string | null;
        garment_type: Garment | null;
        make_level: Make | null;
        discount_pct: number | null;
        options: Options;
      }>(`/api/quotes/${encodeURIComponent(id)}`);
      if (!q.fabric_item) return;
      const v = [...vendors].sort((a, b) => b.code.length - a.code.length).find((x) => q.fabric_item!.startsWith(x.code + "-"));
      if (!v) return;
      const hits = await api.get<Fabric[]>(`/api/fabrics/search?vendor=${v.code}&q=${encodeURIComponent(q.fabric_item)}`);
      setVendor(v.code);
      setFabric(hits.find((h) => h.item_code === q.fabric_item) ?? null);
      if (q.garment_type) setGarment(q.garment_type);
      if (q.make_level) setMake(q.make_level);
      if (q.discount_pct !== null) setDiscount(q.discount_pct);
      setOptions(q.options);
    })().catch((e) => setError(e.message));
  }, [params, vendors]);

  // Live estimate. Discount is applied client-side from server-provided list price.
  useEffect(() => {
    if (!fabric || !make) {
      setEst(null);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      api
        .post<Estimate>(
          "/api/estimate",
          {
            fabric_item: fabric.item_code,
            garment_type: garment,
            make_level: make,
            options,
            as_customer: asCustomer || undefined,
          },
          ctl.signal,
        )
        .then((r) => {
          setEst(r);
          setError(null);
          if (asCustomer && r.retail) setDiscount((d) => d ?? r.retail!.discount_pct);
        })
        .catch((e) => {
          if (e.name === "AbortError") return;
          setEst(null);
          setError(e instanceof ApiError ? e.message : "Could not reach L&S — check your connection");
        })
        .finally(() => !ctl.signal.aborted && setLoading(false));
    }, 120);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [fabric, garment, make, options, asCustomer]);

  const disc = discount ?? est?.retail?.discount_pct ?? 0;
  const retailPrice = est?.retail ? est.retail.list_price * (1 - disc / 100) + est.totals.alterations_fee : null;
  const toggle = (k: keyof Options) => setOptions((o) => ({ ...o, [k]: !o[k] }));

  return (
    <Shell account={est?.account.name ?? me?.account}>
      <div className="space-y-4">
        <section className="glass space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            <label className="block space-y-1.5">
              <span className="label">Mill</span>
              <select
                className="field appearance-none"
                value={vendor}
                onChange={(e) => {
                  setVendor(e.target.value);
                  setFabric(null);
                }}
              >
                <option value="">Choose a mill…</option>
                {vendors.map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <FabricSearch vendor={vendor} value={fabric} onPick={setFabric} />
          </div>
          {fabric && <FabricCard fabric={fabric} jacket={HAS.jacket(garment)} />}
        </section>

        <section className="glass space-y-4 p-4">
          <div className="space-y-2">
            <span className="label">Garment</span>
            <div className="grid grid-cols-3 gap-2">
              {GARMENTS.map((g) => (
                <button key={g} className="seg" data-on={garment === g} onClick={() => setGarment(g)}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <span className="label">Make</span>
            <div className="grid grid-cols-3 gap-2">
              {MAKES.map((m) => (
                <button key={m} className="seg" data-on={make === m} onClick={() => setMake(m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {HAS.jacket(garment) && fabric?.width_in == null && (
              <Toggle on={options.narrow_cloth} onClick={() => toggle("narrow_cloth")}>
                Narrow cloth (under 57&Prime;)?
              </Toggle>
            )}
            {HAS.jacket(garment) && (
              <Toggle on={options.large_check} onClick={() => toggle("large_check")}>
                Large check
              </Toggle>
            )}
            {HAS.vest(garment) && (
              <Toggle on={options.stripe_plaid} onClick={() => toggle("stripe_plaid")}>
                Stripe / plaid
              </Toggle>
            )}
            {HAS.trouser(garment) && (
              <Toggle on={options.tall} onClick={() => toggle("tall")}>
                Very tall (6&prime;3&Prime;+)
              </Toggle>
            )}
          </div>
          {me?.is_internal && <AccountPicker value={asCustomer} onChange={(v) => { setAsCustomer(v); setDiscount(null); }} />}
        </section>

        {!fabric ? (
          <div className="glass p-6 text-center text-sm text-cream-dim">Choose a mill and fabric number to see pricing.</div>
        ) : error ? (
          <div className="glass border-signal-rose/40 p-6 text-center">
            <p className="font-display text-xl italic text-cream">{error}</p>
          </div>
        ) : est ? (
          <section className={`glass-strong p-4 transition ${loading ? "opacity-60" : ""}`}>
            <Flags est={est} />
            <div className="mb-4 grid grid-flow-col gap-1 rounded-xl bg-forest-deep/60 p-1">
              <TabBtn on={tab === "retail"} onClick={() => setTab("retail")}>Retail</TabBtn>
              <TabBtn on={tab === "cost"} onClick={() => setTab("cost")}>Cost</TabBtn>
              {est.margin && <TabBtn on={tab === "margin"} onClick={() => setTab("margin")}>Margin</TabBtn>}
            </div>
            {tab === "retail" && (
              <RetailTab est={est} discount={disc} retailPrice={retailPrice} onDiscount={setDiscount} />
            )}
            {tab === "cost" && <CostTab est={est} />}
            {tab === "margin" && est.margin && <MarginTab est={est} />}
            <button
              className="btn-brass mt-5 w-full"
              disabled={loading || (!me?.can_save && !asCustomer)}
              onClick={() => setSaving(true)}
            >
              Save quote
            </button>
          </section>
        ) : (
          <div className="glass p-6 text-center text-sm text-cream-dim">Pricing…</div>
        )}
      </div>
      {saving && est && fabric && (
        <SaveQuoteSheet
          payload={{
            fabric_item: fabric.item_code,
            garment_type: garment,
            make_level: make,
            discount_pct: disc,
            options,
            as_customer: asCustomer || undefined,
          }}
          summary={`${est.garment_type} · ${est.fabric.vendor_name} ${est.fabric.item_code.replace(est.fabric.vendor_code + "-", "")}`}
          onClose={() => setSaving(false)}
        />
      )}
    </Shell>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="seg flex items-center justify-between gap-2 text-left" data-on={on} onClick={onClick} role="switch" aria-checked={on}>
      <span>{children}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-brass" : "bg-cream/15"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-cream transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg py-2.5 text-sm font-semibold transition ${on ? "bg-brass text-forest-deep" : "text-cream-dim"}`}
    >
      {children}
    </button>
  );
}

function FabricSearch({ vendor, value, onPick }: { vendor: string; value: Fabric | null; onPick: (f: Fabric | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Fabric[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQ(value ? value.item_code.replace(/^[A-Z]+-[A-Z]+-/, "") : "");
  }, [value]);

  useEffect(() => {
    if (!vendor || !open) return;
    const ctl = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      api
        .get<Fabric[]>(`/api/fabrics/search?vendor=${encodeURIComponent(vendor)}&q=${encodeURIComponent(q)}`, ctl.signal)
        .then(setHits)
        .catch(() => undefined)
        .finally(() => !ctl.signal.aborted && setBusy(false));
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [vendor, q, open]);

  return (
    <div className="relative space-y-1.5">
      <span className="label">Fabric number</span>
      <input
        className="field"
        placeholder={vendor ? "Search number or name" : "Choose a mill first"}
        disabled={!vendor}
        value={q}
        inputMode="search"
        autoCapitalize="characters"
        autoCorrect="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (value) onPick(null);
        }}
      />
      {open && vendor && (
        <ul className="glass-strong absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto p-1">
          {busy && !hits.length && <li className="px-3 py-3 text-sm text-cream-dim">Searching…</li>}
          {!busy && !hits.length && <li className="px-3 py-3 text-sm text-cream-dim">No fabrics match</li>}
          {hits.map((h) => (
            <li key={h.item_code}>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-brass/10"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(h);
                  setOpen(false);
                }}
              >
                <Swatch src={h.image} className="h-10 w-10" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{h.item_code}</span>
                  <span className="block truncate text-xs text-cream-dim">{h.composition ?? h.item_name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Swatch({ src, className }: { src: string | null; className: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={`${className} shrink-0 rounded-lg object-cover`} />
  ) : (
    <span className={`${className} shrink-0 rounded-lg bg-gradient-to-br from-forest-highlight to-forest-deep`} />
  );
}

function FabricCard({ fabric, jacket }: { fabric: Fabric; jacket: boolean }) {
  const w = fabric.width_in;
  return (
    <div className="flex gap-3 rounded-xl border border-brass/10 bg-forest-deep/40 p-3">
      <Swatch src={fabric.image} className="h-20 w-20" />
      <div className="min-w-0 space-y-1 text-sm">
        <div className="font-semibold">{fabric.item_name}</div>
        {fabric.composition && <div className="text-cream-muted">{fabric.composition}</div>}
        {w != null && (
          <div className="text-xs text-cream-dim">
            {w < 57 ? `${w}″ — narrow${jacket ? ", +0.5 yd on jacket" : ""}` : `${w}″ wide — standard`}
          </div>
        )}
      </div>
    </div>
  );
}

function Flags({ est }: { est: Estimate }) {
  const f = est.flags;
  const chips: string[] = [];
  if (f.out_of_stock) chips.push("Out of stock at mill");
  if (f.stale_price) chips.push(f.price_valid_upto ? `Price list expired ${formatDate(f.price_valid_upto).replace(/, \d{4}$/, "")}` : "Price list expired");
  if (f.provisional_vendor) chips.push("Provisional pricing");
  if (f.width_assumed) chips.push("Width assumed");
  if (f.fx_fallback) chips.push("Estimated exchange rate");
  if (!chips.length) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c} className="chip">
          {c}
        </span>
      ))}
    </div>
  );
}

function Row({ label, value, strong, sub }: { label: string; value: string; strong?: boolean; sub?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "border-t border-brass/20 pt-3" : ""}`}>
      <span className={strong ? "font-semibold" : "text-cream-muted"}>
        {label}
        {sub && <span className="ml-1.5 text-xs text-cream-dim">{sub}</span>}
      </span>
      <span className={`money ${strong ? "font-display text-2xl" : ""}`}>{value}</span>
    </div>
  );
}

function RetailTab({
  est,
  discount,
  retailPrice,
  onDiscount,
}: {
  est: Estimate;
  discount: number;
  retailPrice: number | null;
  onDiscount: (n: number) => void;
}) {
  if (!est.retail)
    return <p className="py-6 text-center text-sm text-cream-dim">Retail pricing isn&apos;t set up for this account — see the Cost tab.</p>;
  return (
    <div>
      <div className="pb-4 text-center">
        <div className="label">Client price</div>
        <div className="money font-display text-5xl">{usd(retailPrice)}</div>
        <div className="mt-1 text-xs text-cream-dim">incl. {usd(est.totals.alterations_fee)} fitting &amp; alterations</div>
      </div>
      <Row label="List price" value={usd(est.retail.list_price)} />
      <div className="py-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-cream-muted">Client discount</span>
          <span className="money font-semibold">{discount}%</span>
        </div>
        <input
          type="range"
          className="slider"
          min={0}
          max={50}
          step={1}
          value={discount}
          style={{ ["--pct" as string]: `${(discount / 50) * 100}%` }}
          onChange={(e) => onDiscount(Number(e.target.value))}
          aria-label="Client discount percent"
        />
      </div>
      <Row label="After discount" value={usd(est.retail.list_price * (1 - discount / 100))} />
      <Row label="Alterations fee" sub="L&S, billed separately" value={usd(est.totals.alterations_fee)} />
      <Row label="Client price" value={usd(retailPrice)} strong />
    </div>
  );
}

function CostTab({ est }: { est: Estimate }) {
  const multi = est.garments.length > 1;
  return (
    <div>
      <div className="pb-4 text-center">
        <div className="label">Unit cost from L&amp;S</div>
        <div className="money font-display text-5xl">{usd(est.totals.unit_cost)}</div>
        <div className="mt-1 text-xs text-cream-dim">
          {est.make_level} · {yd(est.totals.yardage)}
        </div>
      </div>
      {multi &&
        est.garments.map((g) => (
          <div key={g.type} className="mb-2 rounded-xl bg-forest-deep/40 px-3 py-1 text-sm">
            <Row label={g.type} sub={yd(g.yardage)} value={usd(g.unit_cost)} />
          </div>
        ))}
      <Row label="Make (CMT)" value={usd(est.totals.cmt)} />
      <Row label="Fabric" sub={yd(est.totals.yardage)} value={usd(est.totals.fabric)} />
      <Row label="Shipping & duties" value={usd(est.totals.shipping)} />
      <Row label="Unit cost" value={usd(est.totals.unit_cost)} strong />
      <div className="mt-3 rounded-xl border border-brass/15 px-3 py-1">
        <Row label="Alterations fee" sub="separate L&S invoice" value={usd(est.totals.alterations_fee)} />
      </div>
    </div>
  );
}

function MarginTab({ est }: { est: Estimate }) {
  const m = est.margin!;
  return (
    <div>
      <div className="pb-4 text-center">
        <div className="label">L&amp;S profit · {est.account.name}</div>
        <div className="money font-display text-5xl">{usd(m.totals.profit)}</div>
        <div className="mt-1 text-xs text-cream-dim">
          billed {usd(m.totals.billed)} vs. cost {usd(m.totals.real_cost)}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 border-b border-brass/20 pb-2 text-[11px] uppercase tracking-wider text-cream-dim">
        <span>Garment</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Billed</span>
        <span className="text-right">Profit</span>
      </div>
      {m.garments.map((g) => (
        <div key={g.type} className="money grid grid-cols-4 gap-2 py-2 text-sm">
          <span>{g.type}</span>
          <span className="text-right text-cream-muted">{usd(g.real_cost)}</span>
          <span className="text-right text-cream-muted">{usd(g.billed)}</span>
          <span className="text-right font-semibold">{usd(g.profit)}</span>
        </div>
      ))}
      <p className="mt-3 text-xs text-cream-dim">Cost = CMT + fabric at buying price. Profit = fabric markup + shipping charged.</p>
    </div>
  );
}

function AccountPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const load = useCallback(() => api.get<{ id: string; name: string }[]>("/api/accounts").then(setAccounts).catch(() => undefined), []);
  useEffect(() => {
    load();
  }, [load]);
  const opts = useMemo(() => accounts, [accounts]);
  return (
    <label className="block space-y-1.5 border-t border-brass/10 pt-3">
      <span className="label">Internal · price as account</span>
      <select className="field appearance-none" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">My account (true cost)</option>
        {opts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}
