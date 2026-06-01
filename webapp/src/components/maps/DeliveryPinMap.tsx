// Single-pin map for a delivery detail page.
// Shows GPS drop point if available, otherwise geocodes the address.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icons (Vite breaks the default path resolution)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface Props {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  label?: string | null;
  height?: number;
}

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en" } },
    );
    const data = await res.json() as { lat: string; lon: string }[];
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

export function DeliveryPinMap({ lat, lng, address, label, height = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Resolve coordinates
      let coords: { lat: number; lng: number } | null = null;
      if (lat && lng) {
        coords = { lat, lng };
      } else if (address) {
        coords = await geocode(address);
      }

      if (cancelled) return;
      if (!coords || !containerRef.current) { setFailed(true); setLoading(false); return; }

      setLoading(false);

      // Destroy previous map instance if remounting
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const map = L.map(containerRef.current, {
        center: [coords.lat, coords.lng],
        zoom: 15,
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: false,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map);

      // Brass-coloured custom marker
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#B08D57;border:2px solid #F1E9D6;box-shadow:0 0 0 3px rgba(176,141,87,0.3),0 2px 8px rgba(0,0,0,0.5)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([coords.lat, coords.lng], { icon }).addTo(map);
      if (label) {
        marker.bindPopup(`<span style="font-family:Montserrat,sans-serif;font-size:12px;font-weight:600">${label}</span>`, { closeButton: false });
      }
    }

    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, address]);

  // Cleanup on unmount
  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  if (failed) return null;

  return (
    <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(176,141,87,0.18)", height }}>
      {loading && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(13,26,16,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, fontSize: 11, color: "rgba(176,141,87,0.5)", fontFamily: "Montserrat,sans-serif", letterSpacing: "0.15em" }}>
          LOADING MAP…
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
