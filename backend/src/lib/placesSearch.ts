export type PlaceSuggestion = {
  id: string;
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
};

const STREET_SUFFIX: Record<string, string> = {
  rd: "road",
  st: "street",
  ave: "avenue",
  blvd: "boulevard",
  dr: "drive",
  ln: "lane",
  ct: "court",
  pl: "place",
  pkwy: "parkway",
  hwy: "highway",
  cir: "circle",
  ter: "terrace",
  trl: "trail",
};

const NEAR_BIAS: Record<string, { lat: number; lon: number }> = {
  nyc: { lat: 40.76289, lon: -73.9665 },
  ny: { lat: 40.76289, lon: -73.9665 },
  nj: { lat: 40.0583, lon: -74.4057 },
  fl: { lat: 26.1224, lon: -80.1373 },
};

const STATE_ABBR: Record<string, string> = {
  "new york": "NY",
  "new jersey": "NJ",
  connecticut: "CT",
  florida: "FL",
  california: "CA",
  pennsylvania: "PA",
  massachusetts: "MA",
};

export function biasForNear(near?: string | null): { lat: number; lon: number } {
  const key = (near ?? "nyc").trim().toLowerCase();
  return NEAR_BIAS[key] ?? { lat: 40.76289, lon: -73.9665 };
}

export function abbreviateState(state: string): string {
  const trimmed = state.trim();
  if (!trimmed) return "";
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return STATE_ABBR[trimmed.toLowerCase()] ?? trimmed;
}

export function houseNumber(query: string): string | null {
  const match = query.trim().match(/\b(\d+[a-z]?)\b/i);
  return match?.[1] ?? null;
}

export function significantTokens(query: string): string[] {
  const raw = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const tokens: string[] = [];
  for (const part of raw) {
    if (/^\d+[a-z]?$/.test(part)) continue;
    const expanded = STREET_SUFFIX[part] ?? part;
    if (expanded.length < 3) continue;
    if (!tokens.includes(expanded)) tokens.push(expanded);
  }
  return tokens;
}

export function normalizeAddressText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => STREET_SUFFIX[part] ?? part)
    .join(" ");
}

export function suggestionMatchesQuery(query: string, suggestion: PlaceSuggestion): boolean {
  const tokens = significantTokens(query);
  if (tokens.length === 0) return true;
  const haystack = normalizeAddressText(`${suggestion.label} ${suggestion.street}`);
  return tokens.every((token) => haystack.includes(token));
}

export function hasHouseAndStreetMatch(query: string, suggestions: PlaceSuggestion[]): boolean {
  const num = houseNumber(query);
  if (!num) return suggestions.some((item) => suggestionMatchesQuery(query, item));
  const prefix = num.toLowerCase();
  return suggestions.some(
    (item) =>
      suggestionMatchesQuery(query, item) &&
      normalizeAddressText(item.street).startsWith(prefix),
  );
}

export function rankSuggestions(query: string, suggestions: PlaceSuggestion[]): PlaceSuggestion[] {
  const tokens = significantTokens(query);
  const seen = new Set<string>();
  const unique = suggestions.filter((item) => {
    const key = normalizeAddressText(item.label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .filter((item) => suggestionMatchesQuery(query, item))
    .sort((a, b) => score(query, tokens, b) - score(query, tokens, a));
}

function score(query: string, tokens: string[], item: PlaceSuggestion): number {
  const haystack = normalizeAddressText(`${item.label} ${item.street}`);
  const num = houseNumber(query);
  let value = 0;
  if (/\b(ny|nj|ct|new york|new jersey|connecticut)\b/i.test(item.label)) value += 8;
  if (/\bfl\b|florida/i.test(item.label)) value += 4;
  if (tokens.some((token) => normalizeAddressText(item.street).includes(token))) value += 6;
  if (num && normalizeAddressText(item.street).startsWith(num.toLowerCase())) value += 12;
  if (haystack.includes(normalizeAddressText(query))) value += 10;
  return value;
}
