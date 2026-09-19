import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

const pkgs = path.resolve(__dirname, "../../packages");

/** Put only those packages in a shared chunk — never their deps (clsx, prop-types, …).
 *  Do not isolate recharts here: Rollup would hoist shared helpers into that file
 *  and login would still download 400KB of charts. Lazy dashboard routes own recharts. */
function vendorChunk(id: string): string | undefined {
  const fromNm = id.split("node_modules").pop();
  if (!fromNm || fromNm === id) return;
  const p = fromNm.replace(/\\/g, "/");
  if (p.includes("/leaflet/") || p.includes("/react-leaflet/")) return "vendor-maps";
  if (p.includes("/jsqr/") || p.includes("/html5-qrcode/") || p.includes("/@zxing/")) {
    return "vendor-scan";
  }
  if (p.includes("/@tanstack/react-query")) return "vendor-query";
  if (p.includes("/react-router")) return "vendor-router";
}
