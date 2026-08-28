import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import AuthImage from "@alts/components/AuthImage";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";

type WardrobeRow = {
  id: string;
  orderType: string;
  orderDate: string | null;
  mill: string | null;
  article: string | null;
  description: string | null;
  garmentNumber: string | null;
  length: number | null;
  fabricStatus: string | null;
  historicalOrder: string | null;
  mtmproOrder: string | null;
  salesOrder: string | null;
  fabricSwatch: string | null;
  photoUrl: string | null;
  photoSource: "swatch" | "mtmpro" | null;
};

type WardrobeGroup = {
  orderType: string;
  count: number;
  rows: WardrobeRow[];
};

type WardrobeData = {
  customer: string;
  total: number;
  groups: WardrobeGroup[];
  generatedAt: string;
};

type CustHit = { id: string; name: string; phone: string | null; email: string | null };

type GarmentDetail = {
  garment: WardrobeRow & {
    factory: string | null;
    slot: string | number | null;
    mtmproOrderId: string | null;
    mtmproGarmentId: string | null;
    importStatus: string | null;
  };
  historicalOrder: {
    name: string;
    orderDate: string | null;
    existingSalesOrder: string | null;
    existingMtmproOrder: string | null;
    salesOrders: string[];
  } | null;
  mtmpro: {
    name: string;
    customer: string | null;
    orderType: string | null;
    orderDate: string | null;
    orderStatus: string | null;
    fabricSupplier: string | null;
    fabricArticle: string | null;
    fabricDescription: string | null;
    fabricYards: number | null;
    fabricCost: number | null;
    liningNumber: string | null;
    liningCoverage: string | null;
    makeType: string | null;
    salesOrder: string | null;
    historicalGarment: string | null;
    photos: string[];
  } | null;
  photos: string[];
  erpLinks: {
    historicalGarment: string;
    historicalOrder: string | null;
    mtmproOrder: string | null;
  };
};

function useDebounced(value: string, ms = 280) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function GarmentCard({ row, customer }: { row: WardrobeRow; customer: string }) {
  const [failed, setFailed] = useState(false);
  const show = row.photoUrl && !failed;

  return (
    <Link
      to={`/wardrobe/garment/${encodeURIComponent(row.id)}?customer=${encodeURIComponent(customer)}`}
      className="overflow-hidden rounded-2xl border border-brass/30 bg-[#14261c] shadow-glass flex flex-col min-w-0 active:scale-[0.99] transition-transform"
    >
      <div className="relative aspect-[4/3] bg-black/50">
        {show ? (
          <AuthImage
            path={row.photoUrl!}
            alt={row.article || row.garmentNumber || row.id}
            className="absolute inset-0"
            fit="cover"
            onFail={() => setFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-dim text-xs italic px-3 text-center">
            No fabric photo
          </div>
        )}
        <div className="absolute top-2 left-2 rounded-full bg-black/55 border border-brass/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-brass-light">
          {row.orderType}
        </div>
      </div>
      <div className="p-3 space-y-1.5 flex-1 flex flex-col min-w-0">
        <div className="font-display italic text-cream text-[17px] leading-tight truncate">
          {row.mill || "—"}
        </div>
        <div className="font-mono text-brass-light text-xs truncate">{row.article || "—"}</div>
        {row.description ? (
          <div className="text-cream-muted text-[12px] leading-snug line-clamp-2">{row.description}</div>
        ) : null}
        <div className="mt-auto pt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-cream-dim">
          {row.orderDate ? <span>{row.orderDate}</span> : null}
          {row.garmentNumber ? <span className="font-mono">{row.garmentNumber}</span> : null}
          {row.length != null ? <span>{row.length} yd</span> : null}
        </div>
      </div>
    </Link>
  );
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-brass/10 text-sm">
      <span className="text-cream-dim shrink-0">{label}</span>
      <span className="text-cream text-right min-w-0 break-words">{value}</span>
    </div>
  );
}

export function WardrobeGarmentDetailPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const customer = params.get("customer") || "";
  const garmentId = id ? decodeURIComponent(id) : "";

  const q = useQuery({
    queryKey: ["wardrobe-garment", garmentId],
    queryFn: () => api.get<GarmentDetail>(`/api/wardrobe/garments/${encodeURIComponent(garmentId)}`),
    enabled: !!garmentId,
    staleTime: 60_000,
  });

  const d = q.data;
  const g = d?.garment;
  const photos = d?.photos?.length ? d.photos : g?.photoUrl ? [g.photoUrl] : [];
  const [photoIdx, setPhotoIdx] = useState(0);
  const [imgFail, setImgFail] = useState(false);

  useEffect(() => {
    setPhotoIdx(0);
    setImgFail(false);
  }, [garmentId]);

  return (
    <div className="alts-root min-h-dvh bg-forest-deep text-cream px-3 sm:px-5 pt-[max(10px,env(safe-area-inset-top))] pb-[max(5rem,env(safe-area-inset-bottom))] space-y-4">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() =>
            customer
              ? nav(`/wardrobe?customer=${encodeURIComponent(customer)}`)
              : nav(-1)
          }
          className="shrink-0 rounded-lg border border-brass/25 px-2.5 py-1.5 text-xs text-cream-muted hover:bg-brass/10"
        >
          ← Closet
        </button>
        <div className="min-w-0 flex-1">
          <div className="ui-label text-brass-light text-[10px] tracking-[0.14em]">GARMENT</div>
          <h1 className="font-display italic text-xl text-cream truncate">
            {g?.mill || "Garment"} · <span className="text-brass-shimmer">{g?.article || garmentId}</span>
          </h1>
        </div>
      </header>

      {q.isLoading ? (
        <div className="text-cream-muted text-sm py-12 text-center">Loading order…</div>
      ) : q.isError ? (
        <QueryErrorPanel
          title="Could not load garment"
          message={(q.error as Error)?.message || "Desk unavailable"}
          onRetry={() => void q.refetch()}
        />
      ) : !d || !g ? (
        <div className="text-center text-cream-dim py-12">Not found</div>
      ) : (
        <>
          <div className="relative rounded-2xl overflow-hidden border border-brass/30 bg-black aspect-[4/3]">
            {photos[photoIdx] && !imgFail ? (
              <AuthImage
                path={photos[photoIdx]!}
                alt={g.article || g.id}
                className="absolute inset-0"
                fit="contain"
                onFail={() => {
                  if (photoIdx < photos.length - 1) setPhotoIdx((i) => i + 1);
                  else setImgFail(true);
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-cream-dim text-sm italic">
                No fabric photo on file
              </div>
            )}
            {g.orderType ? (
              <div className="absolute top-3 left-3 rounded-full bg-black/55 border border-brass/30 px-2.5 py-1 text-[10px] uppercase tracking-wider text-brass-light">
                {g.orderType}
              </div>
            ) : null}
          </div>
          {photos.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto">
              {photos.map((p, i) => (
                <button
                  key={p + i}
                  type="button"
                  onClick={() => {
                    setPhotoIdx(i);
                    setImgFail(false);
                  }}
                  className={cn(
                    "shrink-0 w-16 h-16 rounded-lg overflow-hidden border",
                    i === photoIdx ? "border-brass" : "border-brass/25 opacity-70",
                  )}
                >
                  <AuthImage path={p} alt="" className="w-full h-full" fit="cover" />
                </button>
              ))}
            </div>
          ) : null}

          <section className="rounded-2xl border border-brass/25 bg-black/25 p-4 space-y-0.5">
            <h2 className="font-display italic text-lg text-brass-shimmer mb-2">Fabric</h2>
            <Row label="Mill" value={g.mill} />
            <Row label="Article" value={<span className="font-mono">{g.article}</span>} />
            <Row label="Description" value={g.description} />
            <Row label="Yards" value={g.length != null ? `${g.length}` : null} />
            <Row label="Fabric status" value={g.fabricStatus} />
            <Row label="Photo" value={g.photoSource === "swatch" ? "Lookbook swatch" : g.photoSource === "mtmpro" ? "MTMPro attachment" : "—"} />
          </section>

          <section className="rounded-2xl border border-brass/25 bg-black/25 p-4 space-y-0.5">
            <h2 className="font-display italic text-lg text-brass-shimmer mb-2">Garment</h2>
            <Row label="Type" value={g.orderType} />
            <Row label="Garment #" value={<span className="font-mono">{g.garmentNumber || g.id}</span>} />
            <Row label="HG id" value={<span className="font-mono text-xs">{g.id}</span>} />
            <Row label="Factory" value={g.factory} />
            <Row label="Order date" value={g.orderDate} />
            <Row label="Historical order" value={g.historicalOrder} />
            <Row label="Sales order" value={g.salesOrder} />
          </section>

          {d.mtmpro ? (
            <section className="rounded-2xl border border-brass/25 bg-black/25 p-4 space-y-0.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="font-display italic text-lg text-brass-shimmer">MTMPro order</h2>
                {d.erpLinks.mtmproOrder ? (
                  <a
                    href={d.erpLinks.mtmproOrder}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-brass-light underline underline-offset-2"
                  >
                    Open in Desk ↗
                  </a>
                ) : null}
              </div>
              <Row label="Order" value={<span className="font-mono">{d.mtmpro.name}</span>} />
              <Row label="Status" value={d.mtmpro.orderStatus} />
              <Row label="Type" value={d.mtmpro.orderType} />
              <Row label="Date" value={d.mtmpro.orderDate} />
              <Row label="Make" value={d.mtmpro.makeType} />
              <Row label="Mill" value={d.mtmpro.fabricSupplier} />
              <Row label="Article" value={<span className="font-mono">{d.mtmpro.fabricArticle}</span>} />
              <Row label="Fabric" value={d.mtmpro.fabricDescription} />
              <Row label="Yards" value={d.mtmpro.fabricYards != null ? String(d.mtmpro.fabricYards) : null} />
              <Row label="Lining" value={[d.mtmpro.liningNumber, d.mtmpro.liningCoverage].filter(Boolean).join(" · ") || null} />
              <Row label="Sales order" value={d.mtmpro.salesOrder} />
            </section>
          ) : (
            <section className="rounded-2xl border border-dashed border-brass/20 p-4 text-sm text-cream-dim">
              No live MTMPro order linked yet for this garment.
              {g.mtmproOrderId ? (
                <div className="mt-1 font-mono text-xs">Portal id {g.mtmproOrderId}</div>
              ) : null}
            </section>
          )}

          {d.historicalOrder ? (
            <section className="rounded-2xl border border-brass/25 bg-black/25 p-4 space-y-0.5">
              <h2 className="font-display italic text-lg text-brass-shimmer mb-2">Historical order</h2>
              <Row label="HO" value={d.historicalOrder.name} />
              <Row label="Date" value={d.historicalOrder.orderDate} />
              <Row
                label="Sales orders"
                value={
                  d.historicalOrder.salesOrders.length
                    ? d.historicalOrder.salesOrders.join(", ")
                    : d.historicalOrder.existingSalesOrder
                }
              />
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {customer ? (
              <Link
                to={`/customers/${encodeURIComponent(customer)}`}
                className="rounded-xl border border-brass/35 px-3 py-2 text-xs text-brass-light"
              >
                Client profile
              </Link>
            ) : null}
            {d.erpLinks.historicalGarment ? (
              <a
                href={d.erpLinks.historicalGarment}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-brass/35 px-3 py-2 text-xs text-cream-muted"
              >
                HG in Desk ↗
              </a>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export default function WardrobePage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const customer = (params.get("customer") || "").trim();
  const orderType = (params.get("type") || "").trim();

  const [search, setSearch] = useState(customer || "Arthur Luxenberg");
  const dq = useDebounced(search.trim(), 300);

  const picks = useQuery({
    queryKey: ["wardrobe-customers", dq],
    queryFn: () => api.get<{ rows: CustHit[] }>(`/api/wardrobe/customers?q=${encodeURIComponent(dq)}`),
    enabled: dq.length >= 2 && !customer,
    staleTime: 30_000,
  });

  const closet = useQuery({
    queryKey: ["wardrobe", customer, orderType],
    queryFn: () => {
      const qs = new URLSearchParams({ customer });
      if (orderType) qs.set("order_type", orderType);
      return api.get<WardrobeData>(`/api/wardrobe?${qs.toString()}`);
    },
    enabled: !!customer,
    staleTime: 60_000,
  });

  const setCustomer = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("customer", id);
    next.delete("type");
    setParams(next, { replace: false });
    setSearch(id);
  };

  const setType = (t: string | null) => {
    const next = new URLSearchParams(params);
    if (t) next.set("type", t);
    else next.delete("type");
    setParams(next, { replace: true });
  };

  const groups = closet.data?.groups ?? [];
  const types = useMemo(() => groups.map((g) => ({ t: g.orderType, c: g.count })), [groups]);

  return (
    <div className="alts-root min-h-dvh bg-forest-deep text-cream px-3 sm:px-5 pt-[max(10px,env(safe-area-inset-top))] pb-[max(5rem,env(safe-area-inset-bottom))] space-y-4">
      <header className="flex items-start gap-3 min-w-0">
        <button
          type="button"
          onClick={() => nav(-1)}
          className="mt-1 shrink-0 rounded-lg border border-brass/25 px-2.5 py-1.5 text-xs text-cream-muted hover:bg-brass/10"
        >
          ← Back
        </button>
        <div className="min-w-0 flex-1">
          <div className="ui-label text-brass-light text-[10px] tracking-[0.14em]">REFERENCE · CLOSET</div>
          <h1 className="font-display italic text-2xl sm:text-3xl text-cream leading-tight">
            Customer <span className="text-brass-shimmer">Wardrobe</span>
          </h1>
          <p className="text-cream-dim text-xs mt-0.5">
            Tap a tile for full order · MTMPro · fabric photos
          </p>
        </div>
        {customer ? (
          <Link
            to={`/customers/${encodeURIComponent(customer)}`}
            className="shrink-0 text-xs text-brass-light underline underline-offset-2 mt-2"
          >
            Profile
          </Link>
        ) : null}
      </header>

      <div className="rounded-2xl border border-brass/25 bg-black/25 p-3 sm:p-4 space-y-2">
        <label className="ui-label text-cream-dim text-[10px]">Client</label>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (customer) {
                const next = new URLSearchParams(params);
                next.delete("customer");
                next.delete("type");
                setParams(next, { replace: true });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && search.trim().length >= 2) setCustomer(search.trim());
            }}
            placeholder="Search name — Arthur Luxenberg"
            className="flex-1 min-w-0 rounded-xl border border-brass/30 bg-black/35 px-3 py-2.5 text-sm text-cream placeholder:text-cream-dim/70 outline-none focus:border-brass/60"
          />
          <button
            type="button"
            className="shrink-0 rounded-xl bg-brass/25 border border-brass/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-brass-light hover:bg-brass/35"
            onClick={() => search.trim().length >= 2 && setCustomer(search.trim())}
          >
            Open
          </button>
        </div>

        {!customer && dq.length >= 2 ? (
          picks.isLoading ? (
            <div className="text-cream-dim text-xs py-2">Searching…</div>
          ) : picks.data?.rows?.length ? (
            <ul className="divide-y divide-brass/15 rounded-xl border border-brass/20 overflow-hidden">
              {picks.data.rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setCustomer(r.id)}
                    className="w-full text-left px-3 py-2.5 hover:bg-brass/10 flex flex-col gap-0.5"
                  >
                    <span className="text-cream text-sm font-medium">{r.name}</span>
                    <span className="text-[11px] text-cream-dim font-mono">
                      {r.id}
                      {r.phone ? ` · ${r.phone}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-cream-dim text-xs py-2">No matches — try full name, then Open.</div>
          )
        ) : null}
      </div>

      {customer ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm text-cream">
              <span className="font-display italic text-lg text-brass-shimmer">{customer}</span>
              {closet.data ? (
                <span className="text-cream-dim text-xs ml-2 tabular-nums">{closet.data.total} garments</span>
              ) : null}
            </div>
          </div>

          {types.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              <button
                type="button"
                onClick={() => setType(null)}
                className={cn(
                  "shrink-0 h-9 px-3 rounded-full border text-[11px] font-semibold uppercase tracking-wider",
                  !orderType
                    ? "bg-brass/25 border-brass text-brass-light"
                    : "bg-black/20 border-brass/30 text-cream-muted",
                )}
              >
                All
                {closet.data ? <span className="ml-1.5 tabular-nums">{closet.data.total}</span> : null}
              </button>
              {types.map(({ t, c }) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "shrink-0 h-9 px-3 rounded-full border text-[11px] font-semibold uppercase tracking-wider",
                    orderType === t
                      ? "bg-brass/25 border-brass text-brass-light"
                      : "bg-black/20 border-brass/30 text-cream-muted",
                  )}
                >
                  {t}
                  <span className="ml-1.5 tabular-nums text-cream">{c}</span>
                </button>
              ))}
            </div>
          ) : null}

          {closet.isLoading ? (
            <div className="text-cream-muted text-sm py-8 text-center">Pulling the closet from Desk…</div>
          ) : closet.isError ? (
            <QueryErrorPanel
              title="Could not load wardrobe"
              message={(closet.error as Error)?.message || "Desk unavailable"}
              onRetry={() => void closet.refetch()}
            />
          ) : !closet.data || closet.data.total === 0 ? (
            <div className="rounded-2xl border border-brass/20 bg-black/20 px-4 py-10 text-center text-cream-dim text-sm">
              No historical garments for this client.
            </div>
          ) : (
            <div className="space-y-8">
              {(orderType ? groups.filter((g) => g.orderType === orderType) : groups).map((g) => (
                <section key={g.orderType} className="space-y-3">
                  <div className="flex items-baseline gap-2 border-b border-brass/20 pb-1.5">
                    <h2 className="font-display italic text-xl text-cream">{g.orderType}</h2>
                    <span className="text-cream-dim text-xs tabular-nums">{g.count}</span>
                    <span className="text-cream-dim text-[10px] ml-auto">
                      {g.rows.filter((r) => r.photoUrl).length} with photo
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {g.rows.map((r) => (
                      <GarmentCard key={r.id} row={r} customer={customer} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-brass/25 px-4 py-12 text-center text-cream-dim text-sm">
          Search a client to open their closet.
          <div className="mt-3">
            <button
              type="button"
              className="text-brass-light underline underline-offset-2 text-xs"
              onClick={() => setCustomer("Arthur Luxenberg")}
            >
              Open Arthur Luxenberg →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
