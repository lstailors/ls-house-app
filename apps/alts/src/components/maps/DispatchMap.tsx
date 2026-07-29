// Dispatch map — all pending deliveries as numbered pins.
// Geocodes addresses that don't yet have GPS. Helps plan the best route.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Delivery } from "@ls/types";

delete (L.Icon.Default.prototype as any)._getIconUrl;

const STATUS_COLOR: Record<string, string> = {
  scheduled:       "#B08D57",
  out_for_delivery: "#FBBF24",
  queued:          "#B08D57",
};

async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { "Accept-Language": "en" } },
    );
    const data = await res.json() as { lat: string; lon: string }[];
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch { return null; }
}

interface PinData {
  delivery: Delivery;
  lat: number;
  lng: number;
  index: number;
}

interface Props {
  deliveries: Delivery[];
  onSelect?: (id: string) => void;
  height?: number;
}

export function DispatchMap({ deliveries, onSelect, height = 420 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty">("loading");

  // Only map active (non-delivered, non-failed) with an address
  const active = deliveries.filter(
    (d) => !["delivered", "failed", "cancelled"].includes(d.status) && d.addressLine,
  );

  useEffect(() => {
    if (!active.length) { setStatus("empty"); return; }
    let cancelled = false;

    async function build() {
      // Geocode all addresses (rate-limit: 1 per 200ms — Nominatim ToS)
      const pins: PinData[] = [];
      for (let i = 0; i < active.length; i++) {
        const d = active[i];
        if (cancelled) return;
        // Prefer stored GPS coords
        const hasGps = (d as any).gpsLatitude && (d as any).gpsLongitude;
        let coords: { lat: number; lng: number } | null = hasGps
          ? { lat: (d as any).gpsLatitude, lng: (d as any).gpsLongitude }
          : await geocode(d.addressLine!);
        if (coords) pins.push({ delivery: d, lat: coords.lat, lng: coords.lng, index: i + 1 });
        if (!hasGps && i < active.length - 1) await new Promise((r) => setTimeout(r, 220));
      }

      if (cancelled || !pins.length || !containerRef.current) { setStatus("empty"); return; }

      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const center: [number, number] = [
        pins.reduce((s, p) => s + p.lat, 0) / pins.length,
        pins.reduce((s, p) => s + p.lng, 0) / pins.length,
      ];

      const map = L.map(containerRef.current, {
        center,
        zoom: 12,
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: true,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 19 }).addTo(map);

      pins.forEach(({ delivery: d, lat, lng, index }) => {
        const color = STATUS_COLOR[d.status] ?? "#B08D57";
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:2px solid #F1E9D6;box-shadow:0 2px 8px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:Montserrat,sans-serif;font-size:11px;font-weight:700;color:#0D1A10;cursor:pointer">${index}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });

        const marker = L.marker([lat, lng], { icon }).addTo(map);

        const popup = `
          <div style="font-family:Montserrat,sans-serif;min-width:160px">
            <div style="font-size:12px;font-weight:700;color:#0D1A10;margin-bottom:3px">${d.customer?.name ?? "—"}</div>
            <div style="font-size:10px;color:#555;margin-bottom:6px">${d.addressLine}</div>
            ${d.deliveryNo ? `<div style="font-size:9px;color:#888;font-family:monospace">${d.deliveryNo}</div>` : ""}
            ${onSelect ? `<button onclick="window.__dispatchSelect('${d.id}')" style="margin-top:8px;width:100%;padding:5px;background:#B08D57;border:none;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer;color:#0D1A10;letter-spacing:.08em">VIEW DETAIL</button>` : ""}
          </div>`;
        marker.bindPopup(popup, { closeButton: false, maxWidth: 220 });
      });

      // Expose select handler for popup button
      if (onSelect) {
        (window as any).__dispatchSelect = onSelect;
      }

      // Fit all pins
      const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });

      setStatus("ready");
    }

    build();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveries.map((d) => d.id).join(",")]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; delete (window as any).__dispatchSelect; }, []);

  return (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(176,141,87,0.18)", height }}>
      {status === "loading" && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(13,26,16,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10, gap: 10 }}>
          <div style={{ fontSize: 11, color: "rgba(176,141,87,0.55)", fontFamily: "Montserrat,sans-serif", letterSpacing: "0.2em" }}>GEOCODING STOPS…</div>
          <div style={{ fontSize: 10, color: "rgba(241,233,214,0.2)", fontFamily: "Montserrat,sans-serif" }}>
            {active.length} {active.length === 1 ? "stop" : "stops"}
          </div>
        </div>
      )}
      {status === "empty" && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(13,26,16,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 12, color: "rgba(176,141,87,0.4)", fontFamily: "Montserrat,sans-serif", letterSpacing: "0.15em" }}>NO STOPS WITH ADDRESSES</div>
        </div>
      )}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
