import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  define: {
    "import.meta.env.VITE_COMMIT": JSON.stringify(
      process.env.VITE_COMMIT || process.env.GITHUB_SHA || "checkout-dev",
    ),
  },
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 8020,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      "@checkout": path.resolve(__dirname, "./src"),
      "@ls/api-client": path.resolve(__dirname, "../../packages/api-client/src"),
      "@ls/design": path.resolve(__dirname, "../../packages/design/src"),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.ico", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "L&S Checkout",
        short_name: "Checkout",
        description: "Counter pay + mark out — L&S Tailors",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0D1A10",
        theme_color: "#1F3A2E",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackAllowlist: [/^\/(?!api\/).*/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webp}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  build: { outDir: "dist", sourcemap: true },
});
