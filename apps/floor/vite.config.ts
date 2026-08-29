import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: { host: "0.0.0.0", port: Number(process.env.PORT) || 8020, proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true } } },
  plugins: [react(), VitePWA({
    registerType: "autoUpdate",
    includeAssets: ["icon-192.png", "icon-512.png", "apple-touch-icon.png"],
    manifest: {
      name: "L&S Shop Floor", short_name: "Floor", description: "Move and complete L&S alteration garments",
      start_url: "/", scope: "/", display: "standalone", orientation: "portrait",
      background_color: "#0D1A10", theme_color: "#0D1A10",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
      ]
    },
    workbox: { navigateFallback: "/index.html", navigateFallbackAllowlist: [/^\/(?!api\/).*/], globPatterns: ["**/*.{js,css,html,png,svg,woff2}"], runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith("/api/"), handler: "NetworkOnly" }] }
  })],
  build: { outDir: "dist" }
});
