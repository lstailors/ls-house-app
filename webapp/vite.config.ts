import { defineConfig, type Connect, type ViteDevServer, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react-swc";
import { vibecodePlugin } from "@vibecodeapp/webapp/plugin";
import fs from "fs";
import path from "path";

/**
 * Dev/preview parity with vercel.json rewrites.
 * Vite's SPA fallback would otherwise serve the house shell for /logistics.
 * <base href="/logistics/"> in the page makes fetch("data.json") hit /logistics/data.json
 * whether the browser URL has a trailing slash or not.
 */
function logisticsHeatMapStatic() {
  const file = path.resolve(__dirname, "public/logistics/index.html");
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const pathOnly = (req.url || "").split("?")[0];
    if (pathOnly !== "/logistics" && pathOnly !== "/logistics/") {
      next();
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    fs.createReadStream(file).pipe(res);
  };
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(serve);
  };
  return {
    name: "logistics-heatmap-static",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 8000,
    allowedHosts: true,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    logisticsHeatMapStatic(),
    react(),
    mode === "development" && vibecodePlugin(),
  ].filter(Boolean),
  build: {
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
    alias: [
      // Order matters: more specific subpath aliases must precede the bare
      // package alias, otherwise "@ls/design" swallows "@ls/design/ui/button".
      { find: /^@ls\/types$/, replacement: path.resolve(__dirname, "../packages/types/src/index.ts") },
      { find: /^@ls\/api-client$/, replacement: path.resolve(__dirname, "../packages/api-client/src/index.ts") },
      { find: /^@ls\/auth$/, replacement: path.resolve(__dirname, "../packages/auth/src/index.ts") },
      { find: /^@ls\/auth\/(.*)$/, replacement: path.resolve(__dirname, "../packages/auth/src") + "/$1" },
      { find: /^@ls\/design\/index\.css$/, replacement: path.resolve(__dirname, "../packages/design/src/index.css") },
      { find: /^@ls\/design\/src\/index\.css$/, replacement: path.resolve(__dirname, "../packages/design/src/index.css") },
      { find: /^@ls\/design\/tailwind\.preset$/, replacement: path.resolve(__dirname, "../packages/design/tailwind.preset.ts") },
      { find: /^@ls\/design\/format$/, replacement: path.resolve(__dirname, "../packages/design/src/format.ts") },
      { find: /^@ls\/design\/utils$/, replacement: path.resolve(__dirname, "../packages/design/src/utils.ts") },
      { find: /^@ls\/design\/tokens$/, replacement: path.resolve(__dirname, "../packages/design/src/tokens.ts") },
      { find: /^@ls\/design\/ui\/(.*)$/, replacement: path.resolve(__dirname, "../packages/design/src/ui") + "/$1" },
      { find: /^@ls\/design\/hooks\/(.*)$/, replacement: path.resolve(__dirname, "../packages/design/src/hooks") + "/$1" },
      { find: /^@ls\/design\/glass\/(.*)$/, replacement: path.resolve(__dirname, "../packages/design/src/glass") + "/$1" },
      { find: /^@ls\/design$/, replacement: path.resolve(__dirname, "../packages/design/src/index.ts") },
      { find: /^@alts\/(.*)$/, replacement: path.resolve(__dirname, "../apps/alts/src") + "/$1" },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
    dedupe: ["react", "react-dom", "@tanstack/react-query", "clsx", "tailwind-merge"],
  },
}));
