/**
 * Client-side filter, sort, and Desk links for the logistics heat map.
 * Data shape stays in data.json; this file does not invent coordinates or ids.
 *
 * Desk URL matches house-app helpers (webapp/src/lib/scanRoutes.ts openPathForResult
 * and backend YZ links): https://erp.lstailors.com/app/{doctype-slug}/{name}
 * There is no desk.lstailors.com host in this repo. ERPNext Desk is erp.lstailors.com.
 */

export const DESK_ORIGIN = "https://erp.lstailors.com";
export const TRACKER_DOCTYPE = "LSH Logistics Tracker";

export const BANDS = ["on-time", "watch", "alert", "critical"];

export const BAND_RANK = {
  critical: 0,
  alert: 1,
  watch: 2,
  "on-time": 3,
};

/** DocType names for link fields that store a real document name. */
export const LINK_DOCTYPES = {
  sales_order: "Sales Order",
  yz_production_tracker: "YZ Production Tracker",
  purchase_order: "Purchase Order",
};

export function deskSlug(doctype) {
  return String(doctype || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/** Null when name is missing — callers hide the link instead of inventing an id. */
export function deskDocUrl(doctype, name) {
  const id = name == null ? "" : String(name).trim();
  const slug = deskSlug(doctype);
  if (!id || !slug) return null;
  return `${DESK_ORIGIN}/app/${slug}/${encodeURIComponent(id)}`;
}

export function trackerDeskUrl(name) {
  return deskDocUrl(TRACKER_DOCTYPE, name);
}

export function safeHref(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function initialState() {
  return {
    lane: "all",
    status: "all",
    band: "all",
    party: "all",
    node: "all",
    customs: null,
    link: null,
    q: "",
    selected: null,
    sortKey: "band",
    sortDir: "asc",
  };
}

export function partyValues(row) {
  const seen = [];
  for (const raw of [row.fabric_mill, row.supplier]) {
    const value = String(raw || "").trim();
    if (value && !seen.includes(value)) seen.push(value);
  }
  return seen;
}

export function millSupplierLabel(row) {
  return partyValues(row).join(" · ");
}

export function rowMatchesParty(row, party) {
  if (!party || party === "all") return true;
  return partyValues(row).includes(party);
}

/** Schematic node: shipment touches that node as origin or destination. */
export function rowMatchesNode(row, node) {
  if (!node || node === "all") return true;
  return row.from_node === node || row.to_node === node;
}

export function searchHay(row) {
  return [
    row.tracking_number,
    row.name,
    row.sales_order,
    row.purchase_order,
    row.yz_production_tracker,
    row.customer,
    row.supplier,
    row.fabric_mill,
    row.carrier,
    row.origin,
    row.destination,
    row.contents_summary,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

export function rowMatchesQuery(row, q) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return true;
  return searchHay(row).includes(query);
}

export function rowMatchesFilters(row, state) {
  if (state.lane !== "all" && row.lane_canonical !== state.lane) return false;
  if (state.status !== "all" && row.status !== state.status) return false;
  if (state.band !== "all" && row.delay_band !== state.band) return false;
  if (!rowMatchesParty(row, state.party)) return false;
  if (!rowMatchesNode(row, state.node)) return false;
  if (state.customs === "1" && !row.customs_flag) return false;
  if (state.link === "so" && !row.has_so) return false;
  if (state.link === "yz" && !row.has_yz) return false;
  if (!rowMatchesQuery(row, state.q)) return false;
  return true;
}

export function filterRows(rows, state) {
  return rows.filter((row) => rowMatchesFilters(row, state));
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortValue(row, key) {
  switch (key) {
    case "band":
      return BAND_RANK[row.delay_band] ?? 9;
    case "tracking":
      return row.tracking_number || "";
    case "carrier":
      return row.carrier || "";
    case "status":
      return row.status || "";
    case "lane":
      return row.lane_canonical || "";
    case "mill":
      return millSupplierLabel(row);
    case "customer":
      return row.customer || "";
    case "so":
      return row.sales_order || "";
    case "ship":
      return row.ship_date || "";
    case "eta":
      return row.eta_current || row.eta_original || "";
    case "slip":
      return row.eta_slip_days == null || row.eta_slip_days === "" ? null : Number(row.eta_slip_days);
    case "name":
      return row.name || "";
    default:
      return "";
  }
}

const EMPTY_LAST = new Set([
  "tracking",
  "carrier",
  "status",
  "lane",
  "mill",
  "customer",
  "so",
  "ship",
  "eta",
  "slip",
]);

export function compareRows(a, b, key, dir) {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  const aEmpty = va == null || va === "";
  const bEmpty = vb == null || vb === "";
  if (EMPTY_LAST.has(key) && aEmpty !== bEmpty) return aEmpty ? 1 : -1;
  let cmp = 0;
  if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
  else cmp = compareText(va, vb);
  if (dir === "desc") cmp = -cmp;
  if (cmp === 0) cmp = compareText(a.name, b.name);
  return cmp;
}

export function sortRows(rows, key, dir) {
  return [...rows].sort((a, b) => compareRows(a, b, key, dir));
}

/** [label, rowCount] sorted by count desc, then label. A row counts once per label. */
export function uniqueParties(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const party of partyValues(row)) {
      counts.set(party, (counts.get(party) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function activeFilterChips(state) {
  const chips = [];
  if (state.lane !== "all") chips.push({ key: "lane", label: `Lane · ${state.lane}` });
  if (state.band !== "all") chips.push({ key: "band", label: `Band · ${state.band}` });
  if (state.status !== "all") chips.push({ key: "status", label: `Status · ${state.status}` });
  if (state.party !== "all") chips.push({ key: "party", label: `Mill/supplier · ${state.party}` });
  if (state.node !== "all") chips.push({ key: "node", label: `Node · ${state.node}` });
  if (state.customs === "1") chips.push({ key: "customs", label: "Customs" });
  if (state.link === "so") chips.push({ key: "link", label: "Has SO" });
  if (state.link === "yz") chips.push({ key: "link", label: "Has YZ" });
  if (String(state.q || "").trim()) chips.push({ key: "q", label: `Search · ${String(state.q).trim()}` });
  return chips;
}

export function hasActiveFilters(state) {
  return activeFilterChips(state).length > 0;
}

export function clearFilterKey(state, key) {
  const next = { ...state };
  if (key === "customs" || key === "link") next[key] = null;
  else if (key === "q") next.q = "";
  else next[key] = "all";
  return next;
}

export function clearAllFilters(state) {
  return {
    ...state,
    lane: "all",
    status: "all",
    band: "all",
    party: "all",
    node: "all",
    customs: null,
    link: null,
    q: "",
  };
}

/** Exclusive chip groups toggle off when the active value is clicked again. */
export function toggleFilter(state, key, value) {
  const next = { ...state };
  if (key === "customs" || key === "link") {
    next[key] = state[key] === value ? null : value;
    return next;
  }
  next[key] = state[key] === value ? "all" : value;
  return next;
}

export function applyMatrixCell(state, lane, band) {
  const next = { ...state };
  if (!lane) {
    const turnOff = state.band === band && state.lane === "all";
    next.lane = "all";
    next.band = turnOff ? "all" : band;
    return next;
  }
  if (state.lane === lane && state.band === band) {
    next.lane = "all";
    next.band = "all";
    return next;
  }
  next.lane = lane;
  next.band = band;
  return next;
}

export function applyNode(state, node) {
  return { ...state, node: state.node === node ? "all" : node };
}

export function toggleSort(state, key) {
  if (state.sortKey === key) {
    return { ...state, sortDir: state.sortDir === "asc" ? "desc" : "asc" };
  }
  return { ...state, sortKey: key, sortDir: "asc" };
}
