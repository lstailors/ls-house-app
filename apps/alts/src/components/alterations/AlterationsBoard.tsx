import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { computeFulfillment } from "@alts/lib/fulfillment";

export interface AlterationRow {
  name: string; customerName: string; location: string; garmentCount: number; garmentSummary: string;
  tailor: string | null; dueDate: string | null; isRush: boolean; status: string;
  paymentStatus: string; price: number; invoice: string | null; deliveryMethod: string | null;
}

const CREAM = "#F1E9D6", CREAM_DIM = "rgba(241,233,214,0.45)", BRASS = "#B08D57", SAGE = "#8FA98C", RED = "#E89494", GREEN = "#7FD4B5";
type SortKey = "customerName" | "dueDate" | "price" | "status";
type SortDir = "asc" | "desc";
const isReady = (s: string) => /ready|complete|delivered/i.test(s);
const isDelivered = (s: string) => /delivered/i.test(s);
function isPickupBlocked(r: AlterationRow) { return isReady(r.status) && !isDelivered(r.status) && r.paymentStatus !== "Paid"; }
function daysUntil(d: string | null) {
  if (!d) return null;
  const ms = new Date(d + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime();
  return Math.round(ms / 86400000);
}

export function AlterationsBoard({ rows }: { rows: AlterationRow[] }) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const stats = useMemo(() => {
    let rush = 0, overdue = 0, ready = 0, blocked = 0, unpaid = 0;
    for (const r of rows) {
      if (r.isRush && !isDelivered(r.status)) rush++;
      const n = daysUntil(r.dueDate);
      if (n !== null && n < 0 && !isDelivered(r.status)) overdue++;
      if (isReady(r.status) && !isDelivered(r.status)) ready++;
      if (isPickupBlocked(r)) blocked++;
      if (r.paymentStatus !== "Paid" && !isDelivered(r.status)) unpaid += r.price;
    }
    return { rush, overdue, ready, blocked, unpaid };
  }, [rows]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let av: any = a[sortKey], bv: any = b[sortKey];
      if (sortKey === "dueDate") { av = av ?? ""; bv = bv ?? ""; }
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "price" ? "desc" : "asc"); }
  }

  const Th = ({ k, label, align = "left" }: { k?: SortKey; label: string; align?: "left" | "right" }) => (
    <button onClick={k ? () => toggleSort(k) : undefined} disabled={!k}
      style={{ background: "none", border: "none", padding: 0, cursor: k ? "pointer" : "default", font: "inherit",
        fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: k === sortKey ? BRASS : CREAM_DIM,
        display: "flex", gap: 4, alignItems: "center", justifyContent: align === "right" ? "flex-end" : "flex-start", width: "100%" }}>
      {label}{k === sortKey && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );

  return (
    <div style={{ color: CREAM }} className="alts-admin-board">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Metric label="Pickup blocked" value={stats.blocked} tone={stats.blocked ? "red" : "dim"} />
        <Metric label="Overdue" value={stats.overdue} tone={stats.overdue ? "red" : "dim"} />
        <Metric label="Rush" value={stats.rush} tone={stats.rush ? "amber" : "dim"} />
        <Metric label="Ready" value={stats.ready} tone="green" />
        <Metric label="Unpaid" value={`$${Math.round(stats.unpaid).toLocaleString()}`} tone="brass" />
      </div>

      {/* Desktop / tablet table */}
      <div className="alts-board-desk admin-desk-shell">
      <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "0 4px 12px", borderBottom: "0.5px solid rgba(241,233,214,0.12)" }}>
        <Th k="customerName" label="Customer" />
        <span style={hLabel}>Garments</span>
        <span style={hLabel}>Tailor</span>
        <Th k="dueDate" label="Due" />
        <Th k="status" label="Status" />
        <span style={hLabel}>Pay</span>
        <Th k="price" label="Price" align="right" />
      </div>
      {sorted.map((r) => {
        const blocked = isPickupBlocked(r);
        return (
          <div key={r.name} title={blocked ? "Ready but unpaid — collect payment before pickup" : r.name}
            onClick={() => navigate(`/orders/alterations/${r.name}`)}
            style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center", padding: "14px 4px 14px 8px",
              borderBottom: "0.5px solid rgba(241,233,214,0.07)", borderLeft: blocked ? `2px solid ${RED}` : "2px solid transparent",
              cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", flex: "none", background: "rgba(176,141,87,0.18)", color: BRASS, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{initials(r.customerName)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15 }}>{r.customerName}</div>
                <div style={ellipsis}>{r.name} · <span style={{ color: SAGE }}>{r.location}</span></div>
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>{r.garmentCount} {r.garmentCount === 1 ? "garment" : "garments"}</div>
              <div style={ellipsis}>{r.garmentSummary || "—"}</div>
            </div>
            <div style={{ fontSize: 13, color: r.tailor ? CREAM : "rgba(241,233,214,0.5)", fontStyle: r.tailor ? "normal" : "italic" }}>{r.tailor ?? "Unassigned"}</div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13 }}>{fmtDate(r.dueDate)}</span>
                {r.isRush && <span style={pill("rgba(239,159,39,0.18)", "#EFB45C")}>RUSH</span>}
              </div>
              <div style={{ fontSize: 11, color: dueColor(r.dueDate) }}>{relDue(r.dueDate)}</div>
            </div>
            <div>
              {(() => {
                const f = computeFulfillment({
                  workflow_state: r.status,
                  assigned_tailor_name: r.tailor,
                  delivery_method: r.deliveryMethod,
                  origin_location: r.location,
                });
                return (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{f.label}</div>
                    <div style={{ fontSize: 10, color: CREAM_DIM }}>{r.status}{f.detail ? ` · ${f.detail}` : ""}</div>
                  </>
                );
              })()}
            </div>
            <div><span style={r.paymentStatus === "Paid" ? pill("rgba(93,202,165,0.14)", GREEN) : pill("rgba(226,75,74,0.14)", RED)}>{r.paymentStatus}</span></div>
            <div style={{ fontSize: 14, textAlign: "right" }}>${r.price.toFixed(0)}</div>
          </div>
        );
      })}
      </div>

      {/* Phone card list */}
      <div className="alts-board-phone" style={{ display: "none" }}>
        {sorted.map((r) => {
          const blocked = isPickupBlocked(r);
          return (
            <button
              key={`m-${r.name}`}
              type="button"
              className="admin-phone-card"
              onClick={() => navigate(`/orders/alterations/${r.name}`)}
              style={{
                textAlign: "left",
                width: "100%",
                background: "rgba(241,233,214,0.04)",
                border: "0.5px solid rgba(241,233,214,0.12)",
                borderLeft: blocked ? `3px solid ${RED}` : "3px solid transparent",
                borderRadius: 12,
                padding: "14px 14px 14px 12px",
                color: CREAM,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{r.customerName}</div>
                <div style={{ fontSize: 15, color: BRASS }}>${r.price.toFixed(0)}</div>
              </div>
              <div style={{ fontSize: 12, color: CREAM_DIM, marginBottom: 8 }}>{r.name} · {r.location}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <span style={statusPill(r.status)}>{r.status}</span>
                {(() => {
                  const f = computeFulfillment({
                    workflow_state: r.status,
                    assigned_tailor_name: r.tailor,
                    delivery_method: r.deliveryMethod,
                    origin_location: r.location,
                  });
                  return <span style={pill("rgba(176,141,87,0.16)", BRASS)}>{f.shop} · {f.label}</span>;
                })()}
                <span style={r.paymentStatus === "Paid" ? pill("rgba(93,202,165,0.14)", GREEN) : pill("rgba(226,75,74,0.14)", RED)}>{r.paymentStatus}</span>
                {r.isRush && <span style={pill("rgba(239,159,39,0.18)", "#EFB45C")}>RUSH</span>}
                <span style={{ fontSize: 12, color: dueColor(r.dueDate) }}>{fmtDate(r.dueDate)} · {relDue(r.dueDate)}</span>
              </div>
              <div style={{ fontSize: 12, color: CREAM_DIM, marginTop: 8 }}>
                {r.garmentCount} garment{r.garmentCount === 1 ? "" : "s"}
                {r.tailor ? ` · ${r.tailor}` : " · Unassigned"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: "red" | "amber" | "green" | "brass" | "dim" }) {
  const color = { red: RED, amber: "#EFB45C", green: GREEN, brass: BRASS, dim: CREAM_DIM }[tone];
  return (
    <div className="admin-metric" style={{ background: "rgba(241,233,214,0.04)", border: "0.5px solid rgba(241,233,214,0.1)", borderRadius: 10, padding: "8px 14px", minWidth: 96 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: CREAM_DIM }}>{label}</div>
      <div style={{ fontSize: 20, color }}>{value}</div>
    </div>
  );
}

const GRID = "1.6fr 1fr 0.9fr 1.1fr 0.9fr 0.7fr 0.6fr";
const hLabel: React.CSSProperties = { fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: CREAM_DIM };
const ellipsis: React.CSSProperties = { fontSize: 11, color: CREAM_DIM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
function pill(bg: string, color: string): React.CSSProperties { return { fontSize: 11, padding: "3px 9px", borderRadius: 20, background: bg, color, border: `0.5px solid ${color}55` }; }
function statusPill(status: string): React.CSSProperties { return isReady(status) ? pill("rgba(176,141,87,0.16)", "#D8B985") : pill("rgba(93,202,165,0.14)", GREEN); }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join(""); }
function fmtDate(d: string | null) { return d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"; }
function relDue(d: string | null) {
  const n = daysUntil(d);
  if (n === null) return "";
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return "due today";
  return `in ${n} day${n === 1 ? "" : "s"}`;
}
function dueColor(d: string | null) { const n = daysUntil(d); return n !== null && n <= 2 ? RED : CREAM_DIM; }
