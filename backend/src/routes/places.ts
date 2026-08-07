/**
 * Address autocomplete for alts delivery intake.
 * Prefers Google Places (New) when GOOGLE_MAPS_API_KEY is set;
 * falls back to Photon (OSM) so FOH always has suggestions.
 */
import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";

export const placesRouter = new Hono();

type Suggestion = {
  id: string;
  label: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
};

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

async function googleAutocomplete(q: string): Promise<Suggestion[] | null> {
  const key = (process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (!key) return null;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", q);
    url.searchParams.set("key", key);
    url.searchParams.set("types", "address");
    url.searchParams.set("components", "country:us");
    url.searchParams.set("location", `${NYC.lat},${NYC.lng}`);
    url.searchParams.set("radius", "25000");
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      predictions?: Array<{ place_id: string; description: string; structured_formatting?: { main_text?: string } }>;
    };
    if (json.status !== "OK" && json.status !== "ZERO_RESULTS") return null;
    const preds = json.predictions || [];
    // Resolve top 5 place details for structured address (zip critical for zone quote)
    const out: Suggestion[] = [];
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
          street: p.structured_formatting?.main_text || p.description.split(",")[0],
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
        street: parsed.street || p.structured_formatting?.main_text,
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

async function photonAutocomplete(q: string): Promise<Suggestion[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("lat", String(NYC.lat));
  url.searchParams.set("lon", String(NYC.lng));
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "en");
  // Bias US
  url.searchParams.set("osm_tag", "place:house");
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "L&S-House-Alts/1.0" },
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
        };
      }>;
    };
    const out: Suggestion[] = [];
    for (const f of json.features || []) {
      const p = f.properties || {};
      if (p.countrycode && p.countrycode.toUpperCase() !== "US") continue;
      const street = [p.housenumber, p.street || p.name].filter(Boolean).join(" ").trim();
      if (!street) continue;
      const city = p.city || p.district || "New York";
      const state = p.state === "New York" ? "NY" : p.state || "NY";
      const zip = (p.postcode || "").replace(/\D/g, "").slice(0, 5);
      const label = [street, city, state, zip].filter(Boolean).join(", ");
      out.push({
        id: String(p.osm_id ?? label),
        label,
        street,
        city,
        state: state.length > 2 ? state.slice(0, 2).toUpperCase() : state,
        zip,
      });
    }
    // Dedupe by label
    const seen = new Set<string>();
    return out.filter((s) => {
      if (seen.has(s.label)) return false;
      seen.add(s.label);
      return true;
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

  const google = await googleAutocomplete(q);
  if (google) return c.json({ data: google, provider: "google" });

  const photon = await photonAutocomplete(q);
  return c.json({ data: photon, provider: "photon" });
});
