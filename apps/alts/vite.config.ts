import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

const webapp = path.resolve(__dirname, "../../webapp/src");
const pkgs = path.resolve(__dirname, "../../packages");

/**  POS shell + phone-tier routes — precache so floor / iPhone survive wifi drops */
const POS_ROUTES = [
  "/",
  "/login",
  "/lookup",
  "/scanner",
  "/shop-floor",
  "/pickup",
  "/parked",
  "/orders/alterations",
  "/intake/kind",
  "/intake/alterations",
  "/dispatch",
  "/quote",
  "/transfers",
  "/e-ticket",
  "/pay",
  "/customers",
  "/deliveries",
];

const NAV_EXTRA = [
  /^\/e-ticket\/[^/]+\/?$/,
  /^\/t\/[^/]+\/?$/,
  /^\/orders\/alterations\/[^/]+\/photos\/?$/,
  /^\/g\/[^/]+\/[^/]+\/?$/,
  /^\/garments\/[^/]+\/?$/,
  /^\/garments\/[^/]+\/[^/]+\/?$/,
  /^\/scanner\/?$/,
  /^\/pay\/[^/]+\/?$/,
  /^\/customers\/[^/]+\/?$/,
  /^\/deliveries\/[^/]+\/?$/,
];

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 8010,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
        "ls-icon.svg",
        "ls-logo-seal.png",
      ],
      manifest: {
        name: "L&S Alterations",
        short_name: "Alts",
        description: "L&S House alterations FOH — intake, shop floor, pickup",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // any — phones stay portrait-capable; tablet lock is CSS media only
        orientation: "any",
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
        navigateFallbackAllowlist: [
          ...POS_ROUTES.map(
            (r) => new RegExp(`^${r === "/" ? "/" : r.replace(/\//g, "\\/")}(\\/?|\\?.*)?$`),
          ),
          ...NAV_EXTRA,
        ],
        // Shell + hashed assets always; POS navigations via navigateFallback
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webp}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "alts-pos-navigations",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: ({ request }) =>
              request.destination === "style" ||
              request.destination === "script" ||
              request.destination === "worker" ||
              request.destination === "font",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "alts-shell-static",
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-router": ["react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
        },
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@alts\/(.*)$/, replacement: path.resolve(__dirname, "src") + "/$1" },
      { find: /^@ls\/types$/, replacement: path.join(pkgs, "types/src/index.ts") },
      { find: /^@ls\/api-client$/, replacement: path.join(pkgs, "api-client/src/index.ts") },
      { find: /^@ls\/auth$/, replacement: path.join(pkgs, "auth/src/index.ts") },
      { find: /^@ls\/auth\/(.*)$/, replacement: path.join(pkgs, "auth/src") + "/$1" },
      { find: /^@ls\/design\/index\.css$/, replacement: path.join(pkgs, "design/src/index.css") },
      { find: /^@ls\/design\/src\/index\.css$/, replacement: path.join(pkgs, "design/src/index.css") },
      { find: /^@ls\/design\/tailwind\.preset$/, replacement: path.join(pkgs, "design/tailwind.preset.ts") },
      { find: /^@ls\/design\/format$/, replacement: path.join(pkgs, "design/src/format.ts") },
      { find: /^@ls\/design\/utils$/, replacement: path.join(pkgs, "design/src/utils.ts") },
      { find: /^@ls\/design\/tokens$/, replacement: path.join(pkgs, "design/src/tokens.ts") },
      { find: /^@ls\/design\/ui\/(.*)$/, replacement: path.join(pkgs, "design/src/ui") + "/$1" },
      { find: /^@ls\/design\/hooks\/(.*)$/, replacement: path.join(pkgs, "design/src/hooks") + "/$1" },
      { find: /^@ls\/design\/glass\/(.*)$/, replacement: path.join(pkgs, "design/src/glass") + "/$1" },
      { find: /^@ls\/design$/, replacement: path.join(pkgs, "design/src/index.ts") },
      // Shared FOH implementation lives in webapp until fully extracted
      { find: "@", replacement: webapp },
    ],
    dedupe: ["react", "react-dom", "@tanstack/react-query", "clsx", "tailwind-merge"],
  },
});
