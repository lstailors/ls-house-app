import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const webapp = path.resolve(__dirname, "../../webapp/src");
const pkgs = path.resolve(__dirname, "../../packages");

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 8010,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  plugins: [react()],
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
