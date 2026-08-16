/**
 * Address autocomplete for alts delivery intake.
 * Prefers Google Places when GOOGLE_MAPS_API_KEY is set;
 * falls back to Photon + Nominatim. Results are ranked so a Long Island
 * street like "782 Tanglewood rd" is not replaced by random 782s.
 */
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import {
  buildSearchQuery,
  formatPlaceLabel,
  normalizeState,
  rankSuggestions,
  scoreSuggestion,
  type PlaceSuggestion,
} from "../lib/places";

export const placesRouter = new Hono();

const NYC = { lat: 40.76289, lng: -73.9665 };

function parseUsComponents(components: Array<{ long_name?: string; short_name?: string; types?: string[] }>) {
  const get = (type: string, short = false) => {
    const c = components.find((x) => (x.types || []).includes(type));
    if (!c) return "";
    return short ? c.short_name || c.long_name || "" : c.long_name || c.short_name || "";
  };
  const streetNum = get("street_number");
  const route = get("route");
  const street = [streetNum, route].filter(Boolean).join(" ");
  return {
    street,
    city: get("locality") || get("sublocality") || get("neighborhood") || "New York",
    state: get("administrative_area_level_1", true) || "NY",
    zip: get("postal_code"),
  };
}

async function googleAutocomplete(q: string): Promise<PlaceSuggestion[] | null> {
  const key = (process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (!key) return null;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", q);
    url.searchParams.set("key", key);
    url.searchParams.set("types", "address");
    url.searchParams.set("components", "country:us");
    // ~80mi bias covers Manhattan + Long Island + Westchester. Bias, not a hard fence.
    url.searchParams.set("location", `${NYC.lat},${NYC.lng}`);
    url.searchParams.set("radius", "130000");
    url.searchParams.set("origin", `${NYC.lat},${NYC.lng}`);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      predictions?: Array<{ place_id: string; description: string; structured_formatting?: { main_text?: string } }>;
    };
    if (json.status !== "OK" && json.status !== "ZERO_RESULTS") return null;
    const preds = json.predictions || [];
    const out: PlaceSuggestion[] = [];
    for (const p of preds.slice(0, 5)) {
      const detailUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      detailUrl.searchParams.set("place_id", p.place_id);
      detailUrl.searchParams.set("key", key);
      detailUrl.searchParams.set("fields", "address_component,formatted_address,geometry");
      const dres = await fetch(detailUrl.toString(), { signal: AbortSignal.timeout(5000) });
      if (!dres.ok) {
        out.push({
          id: p.place_id,
          label: p.description,
          street: p.structured_formatting?.main_text || p.description.split(",")[0],
        });
        continue;
      }
      const djson = (await dres.json()) as {
        result?: {
          address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>;
          formatted_address?: string;
          geometry?: { location?: { lat?: number; lng?: number } };
        };
      };
      const parsed = parseUsComponents(djson.result?.address_components || []);
      out.push({
        id: p.place_id,
        label: djson.result?.formatted_address || p.description,
        street: parsed.street || p.structured_formatting?.main_text,
        city: parsed.city,
        state: parsed.state,
        zip: parsed.zip,
        lat: djson.result?.geometry?.location?.lat,
        lng: djson.result?.geometry?.location?.lng,
      });
    }
    return out;
  } catch {
    return null;
  }
}

async function photonAutocomplete(q: string): Promise<PlaceSuggestion[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("lat", String(NYC.lat));
  url.searchParams.set("lon", String(NYC.lng));
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "en");
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "L&S-House-Alts/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: {
          osm_id?: number | string;
          name?: string;
          street?: string;
          housenumber?: string;
          city?: string;
          state?: string;
          postcode?: string;
          countrycode?: string;
          district?: string;
        };
      }>;
    };
    const out: PlaceSuggestion[] = [];
    for (const f of json.features || []) {
      const p = f.properties || {};
      if (p.countrycode && p.countrycode.toUpperCase() !== "US") continue;
      const street = [p.housenumber, p.street || p.name].filter(Boolean).join(" ").trim();
      if (!street) continue;
      const city = p.city || p.district || "New York";
      const state = normalizeState(p.state);
      const zip = (p.postcode || "").replace(/\D/g, "").slice(0, 5);
      const coords = f.geometry?.coordinates;
      out.push({
        id: `ph-${String(p.osm_id ?? street)}`,
        label: formatPlaceLabel({ street, city, state, zip }),
        street,
        city,
        state,
        zip,
        lng: coords?.[0],
        lat: coords?.[1],
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function nominatimAutocomplete(q: string): Promise<PlaceSuggestion[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("limit", "6");
  // NY metro + Long Island viewbox (west, north, east, south)
  url.searchParams.set("viewbox", "-74.4,41.2,-71.8,40.4");
  url.searchParams.set("bounded", "0");
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "L&S-House-Alts/1.0 (alts.lstailors.com)",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{
      place_id?: number;
      lat?: string;
      lon?: string;
      address?: {
        house_number?: string;
        road?: string;
        residential?: string;
        city?: string;
        town?: string;
        village?: string;
        hamlet?: string;
        suburb?: string;
        state?: string;
        postcode?: string;
      };
    }>;
    const out: PlaceSuggestion[] = [];
    for (const row of json || []) {
      const a = row.address || {};
      const street = [a.house_number, a.road || a.residential].filter(Boolean).join(" ").trim();
      if (!street) continue;
      const city = a.city || a.town || a.village || a.hamlet || a.suburb || "New York";
      const state = normalizeState(a.state);
      const zip = (a.postcode || "").replace(/\D/g, "").slice(0, 5);
      out.push({
        id: `nm-${String(row.place_id ?? street)}`,
        label: formatPlaceLabel({ street, city, state, zip }),
        street,
        city,
        state,
        zip,
        lat: row.lat ? Number(row.lat) : undefined,
        lng: row.lon ? Number(row.lon) : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function dedupe(items: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    const key = (s.label || "").toLowerCase().replace(/\s+/g, " ");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

placesRouter.get("/autocomplete", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const q = (c.req.query("q") || "").trim();
  const zip = (c.req.query("zip") || "").trim();
  if (q.length < 3) return c.json({ data: [] });

  const search = buildSearchQuery(q, zip);

  const google = await googleAutocomplete(search);
  const googleRanked = google && google.length > 0 ? rankSuggestions(q, dedupe(google), zip) : [];
  const googleTop = googleRanked[0];
  const googleLooksRight = googleTop ? scoreSuggestion(q, googleTop, zip) >= 40 : false;
  if (googleLooksRight) {
    return c.json({ data: googleRanked.slice(0, 6), provider: "google" });
  }

  const [photon, nominatim] = await Promise.all([photonAutocomplete(search), nominatimAutocomplete(search)]);
  const merged = rankSuggestions(q, dedupe([...googleRanked, ...nominatim, ...photon]), zip).slice(0, 6);
  return c.json({
    data: merged,
    provider: nominatim.length ? "nominatim+photon" : "photon",
  });
});
