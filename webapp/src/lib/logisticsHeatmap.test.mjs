/**
 * Pure checks for the logistics heat map (no DOM).
 * Run: bun webapp/src/lib/logisticsHeatmap.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  applyMatrixCell,
  applyNode,
  clearAllFilters,
  deskDocUrl,
  deskSlug,
  filterRows,
  hasActiveFilters,
  initialState,
  millSupplierLabel,
  safeHref,
  sortRows,
  toggleFilter,
  toggleSort,
  trackerDeskUrl,
  uniqueParties,
} from "../../public/logistics/heatmap.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const data = JSON.parse(
  readFileSync(new URL("../../public/logistics/data.json", import.meta.url), "utf8"),
);
const rows = data.rows;

assert(deskSlug("LSH Logistics Tracker") === "lsh-logistics-tracker", "tracker slug");
assert(
  trackerDeskUrl("0gi8gc99t8") ===
    "https://erp.lstailors.com/app/lsh-logistics-tracker/0gi8gc99t8",
  "tracker desk url",
);
assert(trackerDeskUrl("  ") === null, "blank name hides desk link");
assert(trackerDeskUrl(null) === null, "missing name hides desk link");
assert(
  deskDocUrl("Sales Order", "LSTNY-SO-2026-00557") ===
    "https://erp.lstailors.com/app/sales-order/LSTNY-SO-2026-00557",
  "sales order desk url",
);
assert(
  deskDocUrl("YZ Production Tracker", "LST-26-372C") ===
    "https://erp.lstailors.com/app/yz-production-tracker/LST-26-372C",
  "yz desk url",
);
assert(deskDocUrl("LSH Logistics Tracker", "a/b c") ===
  "https://erp.lstailors.com/app/lsh-logistics-tracker/a%2Fb%20c", "encode name");
assert(safeHref("javascript:alert(1)") === null, "reject javascript url");
assert(safeHref("https://www.ups.com/track?tracknum=1")?.startsWith("https://"), "allow https");

const base = initialState();
assert(filterRows(rows, base).length === rows.length, "unfiltered is all open rows");

const critical = filterRows(rows, { ...base, band: "critical" });
assert(critical.length === 46, "critical band count");
assert(critical.every((row) => row.delay_band === "critical"), "critical only");

const millLane = filterRows(rows, { ...base, lane: "mill→factory" });
assert(millLane.length === 71, "mill lane");

const nelson = filterRows(rows, { ...base, q: "ken nelson" });
assert(nelson.length >= 1 && nelson.every((row) => /ken nelson/i.test(JSON.stringify(row))), "customer search");

const so = filterRows(rows, { ...base, q: "LSTNY-SO-2026-00557" });
assert(so.length === 1 && so[0].sales_order === "LSTNY-SO-2026-00557", "SO search");

const awb = filterRows(rows, { ...base, q: "1Z5Y78V00395701817" });
assert(awb.length === 1 && awb[0].tracking_number === "1Z5Y78V00395701817", "AWB search");

const albini = filterRows(rows, { ...base, party: "Albini Group" });
assert(albini.length === 4, "mill/supplier union count");
assert(
  albini.every((row) => row.fabric_mill === "Albini Group" || row.supplier === "Albini Group"),
  "party matches mill or supplier",
);

const millNode = filterRows(rows, { ...base, node: "Mill" });
assert(millNode.length === 74, "mill node touches from or to");
assert(millNode.every((row) => row.from_node === "Mill" || row.to_node === "Mill"), "node membership");

const stacked = filterRows(rows, { ...base, node: "Customer", band: "critical", q: "zzz-no-such" });
assert(stacked.length === 0, "filters AND together");

const watch = filterRows(rows, { ...base, band: "watch" });
assert(watch.length === 0, "watch band empty in this snapshot");

const byBand = sortRows(rows, "band", "asc");
assert(byBand[0].delay_band === "critical", "band sort critical first");
assert(byBand[byBand.length - 1].delay_band === "on-time", "band sort on-time last");
const byBandDesc = sortRows(rows, "band", "desc");
assert(byBandDesc[0].delay_band === "on-time", "band sort desc");

const byTrack = sortRows(rows, "tracking", "asc");
const blanks = byTrack.filter((row) => !row.tracking_number);
const filled = byTrack.filter((row) => row.tracking_number);
assert(blanks.length === 0 || byTrack.indexOf(blanks[0]) > byTrack.indexOf(filled[0]), "blank tracking last");

const parties = uniqueParties(rows);
assert(parties[0][0] === "Saviero Textiles" && parties[0][1] === 14, "top party");
const both = rows.find((row) => row.fabric_mill && row.supplier && row.fabric_mill !== row.supplier);
assert(both && millSupplierLabel(both).includes("·"), "mill and supplier both shown");

let state = toggleFilter(base, "lane", "mill→factory");
assert(state.lane === "mill→factory", "lane on");
state = toggleFilter(state, "lane", "mill→factory");
assert(state.lane === "all", "lane toggles off");
state = applyMatrixCell(base, "factory→showroom", "critical");
assert(state.lane === "factory→showroom" && state.band === "critical", "matrix sets lane and band");
state = applyMatrixCell(state, "factory→showroom", "critical");
assert(state.lane === "all" && state.band === "all", "matrix cell toggles off");
state = applyMatrixCell(base, "", "alert");
assert(state.lane === "all" && state.band === "alert", "band total sets band");
state = applyNode(base, "Showroom (NYC)");
assert(state.node === "Showroom (NYC)", "node on");
state = applyNode(state, "Showroom (NYC)");
assert(state.node === "all", "node toggles off");
state = toggleSort(base, "ship");
assert(state.sortKey === "ship" && state.sortDir === "asc", "sort key");
state = toggleSort(state, "ship");
assert(state.sortDir === "desc", "sort flips");
state = { ...base, q: "nelson", customs: "1", party: "Albini Group" };
assert(hasActiveFilters(state), "active filters");
state = clearAllFilters(state);
assert(!hasActiveFilters(state) && state.q === "" && state.party === "all", "clear all");
assert(state.sortKey === "band", "clear keeps sort");

console.log("logisticsHeatmap.test.mjs — all assertions passed");
