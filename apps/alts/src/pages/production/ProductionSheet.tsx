import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { YZOrder } from "@ls/types";
import { cn } from "@ls/design/utils";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { useYzProduction } from "@alts/lib/queries";
import "@alts/styles/production-sheet.css";
import {
  filterRows,
  kpiCounts,
  overviewPayload,
  paginate,
  serializeRow,
  type SheetRow,
  type StatusKey,
  yzAsRecord,
} from "@alts/lib/productionSheet";

const FILTERS: Array<[string, string]> = [
  ["all", "All"],
  ["prod", "In Production"],
  ["fab", "Awaiting Fabric"],
  ["rush", "Rush"],
  ["ship", "Shipped"],
  ["pause", "On Pause"],
  ["cxl", "Canceled"],
];

const KPI_ITEMS: Array<[StatusKey, string, string]> = [
  ["prod", "In Production", ""],
  ["ship", "Shipped", "ship"],
  ["fab", "Awaiting Fabric", "fab"],
  ["rush", "Rush Orders", "hot"],
  ["pause", "On Pause", ""],
  ["cxl", "Canceled", ""],
];

function Mark() {
  return (
    <div className="mark">
      <span className="m1">CUSTOM</span>
      <span className="m2">L&S</span>
      <span className="m3">TAILORS</span>
    </div>
  );
}

function SyncSlip({
  count,
  garments,
  fetching,
  error,
}: {
  count: number;
  garments: number;
  fetching?: boolean;
  error?: boolean;
}) {
  return (
    <div className="sync-slip">
      <div>
        <span className="dot" />
        <b>{error ? "ERPNext feed failed" : fetching ? "Syncing…" : "Synced with ERPNext"}</b>
      </div>
      <div>YZ Production Tracker</div>
      <div>
        {count} orders on file · {garments} garments
      </div>
    </div>
  );
}

function Masthead({
  title,
  sub,
  active,
  count,
  garments,
  fetching,
  error,
}: {
  title: string;
  sub: string;
  active: "board" | "week";
  count: number;
  garments: number;
  fetching?: boolean;
  error?: boolean;
}) {
  return (
    <>
      <div className="masthead">
        <div className="lockup">
          <Mark />
          <div>
            <div className="sub">{sub}</div>
            <h1>{title}</h1>
            <div className="view-switch">
              <Link to="/">House</Link>
              <Link to="/production" className={active === "board" ? "on" : ""}>
                Board
              </Link>
              <Link to="/production/week" className={active === "week" ? "on" : ""}>
                Week
              </Link>
            </div>
          </div>
        </div>
        <SyncSlip count={count} garments={garments} fetching={fetching} error={error} />
      </div>
      <div className="rule" />
    </>
  );
}

function Chip({ statusKey, label }: { statusKey: string; label: string }) {
  return <span className={cn("chip", `c-${statusKey}`)}>{label}</span>;
}

function DateCell({ row }: { row: SheetRow }) {
  const rush =
    row.is_rush && row.status_key !== "ship" && row.status_key !== "cxl" ? (
      <span className="rushtag">RUSH −{row.rush_days}d</span>
    ) : null;
  if (row.status_key === "fab") {
    return (
      <>
        Received <b>{row.date_received_label || "—"}</b>
        <br />
        Awaiting mill
      </>
    );
  }
  if (row.status_key === "ship") {
    return (
      <>
        Placed <b>{row.date_placed_label || "—"}</b>
        <br />
        Shipped <b>{row.ship_date_label || "—"}</b>
      </>
    );
  }
  if (row.status_key === "pause") {
    return (
      <>
        Placed <b>{row.date_placed_label || "—"}</b>
        <br />
        Was due <b>{row.ship_date_label || "—"}</b>
      </>
    );
  }
  if (row.status_key === "cxl") return <>{"—"}</>;
  return (
    <span className={cn("dates", row.is_rush && "late")}>
      Placed <b>{row.date_placed_label || "—"}</b>
      <br />
      Ships <b>{row.ship_date_label || "—"}</b>
      {rush}
    </span>
  );
}

function PageButtons({
  paging,
  onPage,
}: {
  paging: { page: number; pages: number };
  onPage: (n: number) => void;
}) {
  if (paging.pages <= 1) return null;
  const current = paging.page;
  const last = paging.pages;
  const nums: Array<number | "…"> = [1];
  if (current > 3) nums.push("…");
  for (let n = Math.max(2, current - 1); n <= Math.min(last - 1, current + 1); n++) nums.push(n);
  if (current < last - 2) nums.push("…");
  if (last > 1) nums.push(last);
  return (
    <span className="pg">
      Page{" "}
      {nums.map((n, i) =>
        n === "…" ? (
          <button key={`e${i}`} type="button" disabled>
            …
          </button>
        ) : (
          <button key={n} type="button" className={n === current ? "on" : ""} onClick={() => onPage(n)}>
            {n}
          </button>
        ),
      )}
    </span>
  );
}

function BoardView({ orders }: { orders: YZOrder[] }) {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const filter = params.get("filter") || "all";
  const search = params.get("q") || "";
  const page = Number(params.get("page") || "1") || 1;
  const [draft, setDraft] = useState(search);

  const records = useMemo(() => orders.map(yzAsRecord), [orders]);
  const kpis = useMemo(() => kpiCounts(records), [records]);
  const filtered = useMemo(() => filterRows(records, filter, search), [records, filter, search]);
  const { rows, paging } = useMemo(() => paginate(filtered, page), [filtered, page]);
  const sheetRows = rows.map(serializeRow);

  const setFilter = (next: string) => {
    const nx = new URLSearchParams(params);
    nx.set("filter", next);
    nx.delete("page");
    setParams(nx);
  };
  const commitSearch = (value: string) => {
    const nx = new URLSearchParams(params);
    if (value) nx.set("q", value);
    else nx.delete("q");
    nx.delete("page");
    setParams(nx);
  };

  return (
    <>
      <div className="kpis">
        {KPI_ITEMS.map(([key, label, klass]) => (
          <button
            key={key}
            type="button"
            className={cn("kpi", klass, filter === key && "on")}
            onClick={() => setFilter(key)}
          >
            <div className="n">{kpis[key] ?? 0}</div>
            <div className="l">{label}</div>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <label className="search">
          ⌕&nbsp;
          <input
            type="search"
            placeholder="Search order no., client, PO, fabric, tracking…"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              window.clearTimeout((commitSearch as { t?: number }).t);
              const t = window.setTimeout(() => commitSearch(e.target.value), 220);
              (commitSearch as { t?: number }).t = t;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSearch(draft);
            }}
          />
        </label>
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={cn("fchip", filter === key && "on")}
            onClick={() => setFilter(key)}
          >
            {label} <span className="ct">{kpis[key] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="sheet">
        <div className="sheet-head">
          <div>Order</div>
          <div>Client</div>
          <div>Garments</div>
          <div>Fabric</div>
          <div>Timeline</div>
          <div>Delivery</div>
          <div>Status</div>
        </div>
        {sheetRows.length ? (
          sheetRows.map((row) => (
            <button
              key={row.name}
              type="button"
              className={cn("row", `s-${row.status_key}`)}
              onClick={() => nav(`/production/${encodeURIComponent(row.order_no)}`)}
            >
              <div className="ord">
                {row.order_no}
                {row.po_no ? <small>PO {row.po_no}</small> : null}
              </div>
              <div className="cust">
                {row.customer_name || "—"}
                <small>{row.make ? `${row.make} make` : ""}</small>
              </div>
              <div className="garm">
                {row.garments.length
                  ? row.garments.map((g) => (
                      <span key={g.label} className="gpill">
                        <b>{g.qty}</b>
                        {g.label}
                      </span>
                    ))
                  : "—"}
              </div>
              <div className="fabno">
                {row.fabric_number || "—"}
                <small>
                  {[row.solid_fabric === "Y" ? "Solid" : "", row.fully_lined === "Y" ? "Full lining" : row.fully_lined === "N" ? "Unlined" : ""]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </small>
              </div>
              <div className="dates">
                <DateCell row={row} />
              </div>
              <div className="trkcell">
                {row.tracking_no ? (
                  row.tracking_url ? (
                    <a href={row.tracking_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                      UPS {row.tracking_short}
                    </a>
                  ) : (
                    row.tracking_short
                  )
                ) : (
                  "—"
                )}
              </div>
              <div>
                <Chip statusKey={row.status_key} label={row.status_label} />
              </div>
            </button>
          ))
        ) : (
          <div className="empty">No orders match this filter.</div>
        )}
        <div className="board-foot">
          <span>
            Showing {paging.from}–{paging.to} of {paging.total} · Sorted by order no., newest first
          </span>
          <PageButtons
            paging={paging}
            onPage={(n) => {
              const nx = new URLSearchParams(params);
              nx.set("page", String(n));
              setParams(nx);
            }}
          />
        </div>
      </div>
    </>
  );
}

function WeekView({ orders }: { orders: YZOrder[] }) {
  const nav = useNavigate();
  const overview = useMemo(() => overviewPayload(orders.map(yzAsRecord)), [orders]);
  const total = Math.max(overview.order_count, 1);
  const barColor: Record<string, string> = {
    ship: "var(--st-ship)",
    prod: "var(--st-prod)",
    fab: "var(--st-fab)",
    cxl: "var(--st-cxl)",
    pause: "var(--st-pause)",
    rush: "var(--st-rush)",
  };
  const gorder: Array<[string, string]> = [
    ["Coat", "Suit Coats"],
    ["Trouser", "Trousers"],
    ["Vest", "Vests"],
    ["Tux Coat", "Tux Coats"],
    ["Tux Trouser", "Tux Trousers"],
    ["Overcoat", "Overcoats"],
  ];

  return (
    <div className="dash-grid">
      <div>
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Status · {overview.order_count} Orders</h3>
          {overview.status_bars.map((bar) => (
            <div key={bar.key} className="bar-row">
              <span className="bl">{bar.label}</span>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${Math.round((bar.count / total) * 100)}%`, background: barColor[bar.key] }}
                />
              </div>
              <span className="bn">{bar.count}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Rush Queue · {overview.rush_total} Orders</h3>
          <div className="rushlist">
            {overview.rush_queue.length ? (
              overview.rush_queue.map((row) => (
                <button
                  key={row.order_no}
                  type="button"
                  className="row2"
                  onClick={() => nav(`/production/${encodeURIComponent(row.order_no)}`)}
                >
                  <span className="ro">{row.order_no}</span>
                  <span className="rc">{row.customer_name || "—"}</span>
                  <span className="rd">
                    {row.status_key === "ship" ? `Shipped ${row.ship_date_label}` : `Ships ${row.ship_date_label || "—"}`}
                  </span>
                  <span className="rr">−{row.rush_days} days</span>
                </button>
              ))
            ) : (
              <div className="empty">No rush orders.</div>
            )}
          </div>
          <p style={{ fontSize: ".66rem", color: "var(--cream-faint)", marginTop: 12 }}>
            Sorted by days expedited ·{" "}
            <Link to="/production?filter=rush">View all {overview.rush_total} →</Link>
          </p>
        </div>
      </div>
      <div>
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Ship Schedule · Planned</h3>
          {overview.ship_weeks.length ? (
            overview.ship_weeks.map((week) => (
              <div key={week.start || "none"} className="ship-week">
                <div>
                  <div className="wk">{week.label}</div>
                  <div className="wd">{week.range}</div>
                </div>
                <span className="wc">{week.count} orders</span>
              </div>
            ))
          ) : (
            <div className="empty">No open ship dates.</div>
          )}
        </div>
        <div className="card">
          <h3>Garments on the List · {overview.garment_total}</h3>
          <div className="gtotal">
            {gorder.map(([key, label]) => (
              <div key={key} className="gt">
                <div className="n">{overview.garments[key] ?? 0}</div>
                <div className="l">{label}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: ".66rem", color: "var(--cream-faint)", marginTop: 14, lineHeight: 1.7 }}>
            Make: {overview.make.machine} machine · {overview.make.half_hand} half-hand · {overview.make.hand} full hand
          </p>
        </div>
      </div>
    </div>
  );
}

function DetailView({ orders, orderNo }: { orders: YZOrder[]; orderNo: string }) {
  const needle = decodeURIComponent(orderNo).toUpperCase();
  const match = orders.find(
    (o) => o.order_no.toUpperCase() === needle || o.name.toUpperCase() === needle,
  );
  if (!match) {
    return (
      <>
        <div className="crumb">
          <Link to="/production">Production Sheet</Link>
        </div>
        <div className="empty">Order {orderNo} was not found on the YZ Production Tracker.</div>
      </>
    );
  }
  const order = serializeRow(yzAsRecord(match));
  const siblings = orders
    .filter((o) => o.customer_name && o.customer_name === match.customer_name && o.name !== match.name)
    .slice(0, 6)
    .map(yzAsRecord)
    .map(serializeRow);
  const liningBits = [
    order.make ? `${order.make} make` : "",
    order.fully_lined === "Y" ? "Full lining" : "",
    order.half_canvas === "Y" ? "Half canvas" : "",
  ].filter(Boolean);

  return (
    <>
      <div className="crumb">
        <Link to="/production">Production Sheet</Link>
        {" · "}
        Atelier
        {" / "}
        <b>{order.order_no}</b>
      </div>
      <div className="dhead">
        <div>
          <h2>{order.customer_name || order.order_no}</h2>
          <div className="who">
            Order <b>{order.order_no}</b>
            {" · "}
            PO <b>{order.po_no || "—"}</b>
            {" · "}
            <Chip statusKey={order.status_key} label={order.status_label} />
          </div>
        </div>
        <div className="dactions">
          {order.erpUrl ? (
            <a className="btn btn-ghost" href={order.erpUrl} target="_blank" rel="noopener noreferrer">
              Open Tracker
            </a>
          ) : null}
          {order.tracking_url ? (
            <a className="btn btn-brass" href={order.tracking_url} target="_blank" rel="noopener noreferrer">
              Track Shipment
            </a>
          ) : (
            <button type="button" className="btn btn-brass" disabled>
              Track Shipment
            </button>
          )}
        </div>
      </div>
      <div className="rule" />
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Order Timeline</h3>
        <div className="timeline">
          {order.timeline.map((step) => (
            <div key={step.label} className={cn("tstep", step.state)}>
              <div className="tl">{step.label}</div>
              <div className="td">{step.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="dgrid">
        <div>
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Garments · {order.total_pieces} pieces</h3>
          {order.garments.map((g) => (
            <div key={g.label} className="gline">
              <span className="gn">{g.label}</span>
              <span className="gs">{liningBits.join(" · ")}</span>
              <span className="gq">× {g.qty}</span>
            </div>
          ))}
          {order.embroidery_name && order.embroidery_qty ? (
            <div className="mono-spec">
              <span className="sig">{order.embroidery_name}</span>
              <span className="ms">
                EMBROIDERY · {order.embroidery_qty} PIECE{order.embroidery_qty === 1 ? "" : "S"}
              </span>
            </div>
          ) : null}
          <div className="flags">
            {[
              ["Solid fabric", order.solid_fabric],
              ["Full lining", order.fully_lined],
              ["Half canvas", order.half_canvas],
              ["Basted fitting", order.basted_note ? "Y" : "N"],
              ["Customs declaration", order.customs_flag ? "Y" : "N"],
            ].map(([label, value]) => (
              <span key={label} className={cn("flag", value === "Y" && "yes")}>
                {label} · {value || "—"}
              </span>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Factory Notes · Translated</h3>
          <p className="note-en">{order.comment || "No factory notes on this order."}</p>
          {order.remarks ? <p className="note-en" style={{ marginTop: 10 }}>{order.remarks}</p> : null}
        </div>
        </div>
        <div>
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Order Record</h3>
          <div className="kv">
            <div>
              <div className="k">Fabric</div>
              <div className="v">{order.fabric_number || "—"}</div>
            </div>
            <div>
              <div className="k">MTM Pro</div>
              <div className="v">{order.po_no || "—"}</div>
            </div>
            <div>
              <div className="k">Received</div>
              <div className="v">{order.date_received_long || "—"}</div>
            </div>
            <div>
              <div className="k">Placed with YZ</div>
              <div className="v">{order.date_placed_long || "—"}</div>
            </div>
            <div>
              <div className="k">Ship Plan</div>
              <div className="v">{order.ship_date_long || "—"}</div>
            </div>
            <div>
              <div className="k">Rush</div>
              <div className="v" style={order.is_rush ? { color: "var(--st-rush)" } : undefined}>
                {order.is_rush ? `${order.rush_days} days ahead` : "—"}
              </div>
            </div>
            <div>
              <div className="k">Tracking</div>
              <div className="v">
                {order.tracking_url ? (
                  <a href={order.tracking_url} target="_blank" rel="noopener noreferrer">
                    {order.tracking_no}
                  </a>
                ) : (
                  "— pending"
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <h3>Client</h3>
          <div className="kv">
            <div>
              <div className="k">Name</div>
              <div className="v serif">{order.customer_name || "—"}</div>
            </div>
            <div>
              <div className="k">Open Orders</div>
              <div className="v">{siblings.length + 1} this list</div>
            </div>
          </div>
          {siblings.length ? (
            <p style={{ fontSize: ".7rem", color: "var(--cream-faint)", marginTop: 14, lineHeight: 1.7 }}>
              Also on this list:
              <br />
              {siblings.map((s) => (
                <span key={s.order_no}>
                  <Link to={`/production/${encodeURIComponent(s.order_no)}`}>{s.order_no}</Link> {s.status_label}
                  <br />
                </span>
              ))}
            </p>
          ) : null}
        </div>
        </div>
      </div>
    </>
  );
}

export default function ProductionSheet() {
  const { orderNo } = useParams();
  const loc = useLocation();
  const week = !orderNo && loc.pathname.endsWith("/week");
  const prod = useYzProduction();
  const orders = Array.isArray(prod.data) ? prod.data : [];
  const garments = orders.reduce((s, o) => s + (o.total_pieces || 0), 0);

  return (
    <div className="lsh-prod">
      <div className="wrap">
        {orderNo ? null : (
          <Masthead
            title={week ? "The Factory Floor, at a Glance" : "Production Sheet"}
            sub={week ? "Production · Week Overview" : "Atelier Production Sheet"}
            active={week ? "week" : "board"}
            count={orders.length}
            garments={garments}
            fetching={prod.isFetching}
            error={prod.isError}
          />
        )}
        {prod.isError && !orders.length ? (
          <QueryErrorPanel
            title="Could not load production"
            message="The house app could not read YZ Production Tracker from ERPNext."
            onRetry={() => void prod.refetch()}
          />
        ) : prod.isLoading && !orders.length ? (
          <div className="empty">Loading YZ Production Tracker…</div>
        ) : orderNo ? (
          <DetailView orders={orders} orderNo={orderNo} />
        ) : week ? (
          <WeekView orders={orders} />
        ) : (
          <BoardView orders={orders} />
        )}
      </div>
    </div>
  );
}
