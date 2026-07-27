import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { vibecodePlugin } from "@vibecodeapp/webapp/plugin";
import path from "path";

// https://vitejs.dev/config/
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
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
    dedupe: ["react", "react-dom", "@tanstack/react-query", "clsx", "tailwind-merge"],
  },
}));
