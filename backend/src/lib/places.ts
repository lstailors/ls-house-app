/**
 * Address suggestion ranking for intake autocomplete.
 * Photon/OSM often returns the same house number on the wrong street
 * (e.g. "782 3rd Avenue" for "782 Tanglewood rd"). Rank by street tokens + ZIP.
 */

export type PlaceSuggestion = {
  id: string;
  label: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
};

const STREET_TYPES = new Set([
  "rd",
  "road",
  "st",
  "street",
  "ave",
  "avenue",
  "blvd",
  "boulevard",
  "dr",
  "drive",
  "ln",
  "lane",
  "ct",
  "court",
  "way",
  "pl",
  "place",
  "pkwy",
  "parkway",
  "hwy",
  "highway",
  "cir",
  "circle",
  "ter",
  "terrace",
]);

const NY_METRO_CITIES = new Set([
  "new york",
  "manhattan",
  "brooklyn",
  "queens",
  "bronx",
  "staten island",
  "west islip",
  "islip",
  "babylon",
  "huntington",
  "white plains",
  "yonkers",
  "jersey city",
  "hoboken",
  "weehawken",
  "long island city",
]);

export function tokenizeAddress(raw: string): string[] {
  return String(raw || "")
    .toLowerCase()
    .replace(/[.#]/g, " ")
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function distinctiveStreetTokens(raw: string): string[] {
  return tokenizeAddress(raw).filter((t) => !STREET_TYPES.has(t) && !/^\d+$/.test(t));
}

export function houseNumber(raw: string): string | null {
  const m = String(raw || "").trim().match(/^(\d+[a-z]?)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Fold ZIP / NY into the geocoder query so "782 Tanglewood rd" + 11795 actually resolves. */
export function buildSearchQuery(q: string, zip?: string | null): string {
  const query = String(q || "").trim();
  const z = String(zip || "").replace(/\D/g, "").slice(0, 5);
  if (!query) return z;
  if (z && !query.includes(z)) {
    if (/\bny\b/i.test(query) || /\bnew york\b/i.test(query)) return `${query} ${z}`;
    return `${query}, NY ${z}`;
  }
  if (/\d/.test(query) && !/\bny\b/i.test(query) && !/\bnew york\b/i.test(query) && !z) {
    return `${query}, NY`;
  }
  return query;
}

export function scoreSuggestion(
  query: string,
  s: PlaceSuggestion,
  zipHint?: string | null,
): number {
  const qStreet = distinctiveStreetTokens(query);
  const hay = `${s.street || ""} ${s.label || ""}`;
  const hayTokens = new Set(tokenizeAddress(hay));
  const qNum = houseNumber(query);
  const sNum = houseNumber(s.street || s.label || "");
  let score = 0;

  if (qNum && sNum && qNum === sNum) score += 40;
  else if (qNum && sNum && qNum !== sNum) score -= 20;

  let streetHits = 0;
  for (const t of qStreet) {
    if (hayTokens.has(t)) {
      streetHits += 1;
      score += 80;
    }
  }
  if (qStreet.length > 0 && streetHits === 0) score -= 120;

  const zip = (s.zip || "").replace(/\D/g, "").slice(0, 5);
  const hint = String(zipHint || "").replace(/\D/g, "").slice(0, 5);
  if (hint && zip === hint) score += 60;
  else if (hint && zip && zip !== hint) score -= 25;

  const state = String(s.state || "").toUpperCase();
  if (state === "NY" || state === "NEW YORK") score += 25;
  else if (state && state !== "NY" && state !== "NJ" && state !== "CT") score -= 40;

  const city = String(s.city || "").toLowerCase();
  if (NY_METRO_CITIES.has(city)) score += 10;

  return score;
}

export function rankSuggestions(
  query: string,
  items: PlaceSuggestion[],
  zipHint?: string | null,
): PlaceSuggestion[] {
  const scored = items.map((s) => ({ s, score: scoreSuggestion(query, s, zipHint) }));
  scored.sort((a, b) => b.score - a.score || a.s.label.localeCompare(b.s.label));
  return scored.filter((x) => x.score > -80).map((x) => x.s);
}

export function normalizeState(raw?: string | null): string {
  const s = String(raw || "").trim();
  if (!s) return "NY";
  if (s.length === 2) return s.toUpperCase();
  if (/^new york$/i.test(s)) return "NY";
  if (/^new jersey$/i.test(s)) return "NJ";
  if (/^connecticut$/i.test(s)) return "CT";
  return s.slice(0, 2).toUpperCase();
}

export function formatPlaceLabel(parts: {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}): string {
  const street = (parts.street || "").trim();
  const city = (parts.city || "").trim();
  const state = normalizeState(parts.state);
  const zip = String(parts.zip || "").replace(/\D/g, "").slice(0, 5);
  return [street, city, state, zip].filter(Boolean).join(", ");
}
