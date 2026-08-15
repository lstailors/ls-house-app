/**
 * Address autocomplete for alts delivery intake.
 * Prefers Google Places when GOOGLE_MAPS_API_KEY is set;
 * otherwise Photon + Nominatim (OpenStreetMap).
 * Street-name tokens are required so house-number-only misses
 * (782 3rd Ave when the user typed Tanglewood) never surface.
 */
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import {
  abbreviateState,
  biasForNear,
  hasHouseAndStreetMatch,
  rankSuggestions,
  type PlaceSuggestion,
} from "../lib/placesSearch";

export const placesRouter = new Hono();

const UA = "L&S-House-Alts/1.0 (https://lstailors.com)";

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

async function googleAutocomplete(q: string, near?: string | null): Promise<PlaceSuggestion[] | null> {
  const key = (process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (!key) return null;
  const { lat, lon } = biasForNear(near);
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", q);
    url.searchParams.set("key", key);
    url.searchParams.set("types", "address");
    url.searchParams.set("components", "country:us");
    url.searchParams.set("location", `${lat},${lon}`);
    url.searchParams.set("radius", "25000");
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
      detailUrl.searchParams.set("fields", "address_component,formatted_address");
      const dres = await fetch(detailUrl.toString(), { signal: AbortSignal.timeout(5000) });
      if (!dres.ok) {
        out.push({
          id: p.place_id,
          label: p.description,
          street: p.structured_formatting?.main_text || p.description.split(",")[0] || "",
          city: "",
          state: "",
          zip: "",
        });
        continue;
      }
      const djson = (await dres.json()) as {
        result?: { address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>; formatted_address?: string };
      };
      const parsed = parseUsComponents(djson.result?.address_components || []);
      out.push({
        id: p.place_id,
        label: djson.result?.formatted_address || p.description,
        street: parsed.street || p.structured_formatting?.main_text || "",
        city: parsed.city,
        state: parsed.state,
        zip: parsed.zip,
      });
    }
    return out;
  } catch {
    return null;
  }
}

async function photonAutocomplete(q: string, near?: string | null): Promise<PlaceSuggestion[]> {
  const { lat, lon } = biasForNear(near);
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("limit", "15");
  url.searchParams.set("lang", "en");
  url.searchParams.append("layer", "house");
  url.searchParams.append("layer", "street");
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      features?: Array<{
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
          town?: string;
          village?: string;
        };
      }>;
    };
    const out: PlaceSuggestion[] = [];
    for (const f of json.features || []) {
      const p = f.properties || {};
      if (p.countrycode && p.countrycode.toUpperCase() !== "US") continue;
      const street = [p.housenumber, p.street || p.name].filter(Boolean).join(" ").trim();
      if (!street) continue;
      const city = p.city || p.town || p.village || p.district || "";
      const state = abbreviateState(p.state || "");
      const zip = (p.postcode || "").replace(/\D/g, "").slice(0, 5);
      const label = [street, city, state, zip].filter(Boolean).join(", ");
      out.push({
        id: String(p.osm_id ?? label),
        label,
        street,
        city,
        state,
        zip,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function nominatimAutocomplete(q: string): Promise<PlaceSuggestion[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", q);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{
      place_id?: number;
      display_name?: string;
      address?: {
        house_number?: string;
        road?: string;
        residential?: string;
        city?: string;
        town?: string;
        village?: string;
        hamlet?: string;
        state?: string;
        postcode?: string;
      };
    }>;
    return json.map((item, i) => {
      const a = item.address ?? {};
      const street = [a.house_number, a.road || a.residential].filter(Boolean).join(" ");
      const city = a.city || a.town || a.village || a.hamlet || "";
      const state = abbreviateState(a.state ?? "");
      const zip = (a.postcode || "").replace(/\D/g, "").slice(0, 5);
      return {
        id: String(item.place_id ?? `nom-${i}`),
        label: item.display_name ?? [street, city, state, zip].filter(Boolean).join(", "),
        street,
        city,
        state,
        zip,
      };
    });
  } catch {
    return [];
  }
}

placesRouter.get("/autocomplete", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const q = (c.req.query("q") || "").trim();
  if (q.length < 3) return c.json({ data: [] });
  const near = c.req.query("near");

  const google = await googleAutocomplete(q, near);
  if (google) return c.json({ data: google, provider: "google" });

  const photon = await photonAutocomplete(q, near);
  let ranked = rankSuggestions(q, photon);
  let provider = "photon";
  if (!hasHouseAndStreetMatch(q, ranked)) {
    const nominatim = await nominatimAutocomplete(q);
    ranked = rankSuggestions(q, [...ranked, ...nominatim]);
    provider = "nominatim";
  }
  return c.json({ data: ranked.slice(0, 6), provider });
});
