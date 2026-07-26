import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { vibecodePlugin } from "@vibecodeapp/webapp/plugin";
import path from "path";

// https://vitejs.dev/config/
// This one Vite project builds two apps:
//   (default)          → app.lstailors.com   — the admin dashboard
//   VITE_APP_TARGET=alts → alts.lstailors.com — the alterations POS
// They share every component; only the route tree, shell and branding differ.
const isAlts = process.env.VITE_APP_TARGET === "alts";

// Swap the shell-level HTML so an installed POS home-screen icon isn't
// indistinguishable from the admin app.
const altsHtml = (): Plugin => ({
  name: "alts-html",
  transformIndexHtml: (html) =>
    isAlts
      ? html
          .replace(/<title>[^<]*<\/title>/, "<title>L&S Alterations — POS</title>")
          .replace(
            /(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/,
            "$1L&S Alterations$2",
          )
          .replace('href="/manifest.json"', 'href="/manifest-alts.json"')
      : html,
});

export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 8000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    altsHtml(),
    mode === "development" && vibecodePlugin(),
  ].filter(Boolean),
  build: {
    // Written into the alts/ Vercel project's Root Directory, so its
    // outputDirectory can stay a plain "dist" with no parent traversal.
    outDir: isAlts ? "../alts/dist" : "dist",
    // Vite refuses to empty an outDir outside its root unless told to, which
    // would otherwise leave stale hashed chunks from previous deploys.
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-router': ['react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-motion': ['framer-motion'],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Resolved at build time rather than branched inside main.tsx: a runtime
      // ternary would leave Rollup walking both route trees, so each bundle
      // would still contain the other app's pages.
      "@root-app": path.resolve(
        __dirname,
        isAlts ? "./src/alts/AltsApp.tsx" : "./src/App.tsx",
      ),
    },
  },
}));
