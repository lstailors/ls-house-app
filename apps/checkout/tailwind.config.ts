import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: { DEFAULT: "#1F3A2E", deep: "#0D1A10", mid: "#0F2218", high: "#2A4D3D" },
        cream: { DEFAULT: "#F1E9D6", muted: "#C9C0AB", dim: "#8A8474" },
        brass: { DEFAULT: "#B08D57", light: "#D4B27A", dark: "#8C6F42" },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', "Georgia", "serif"],
        ui: ["Montserrat", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
