import type { Config } from "tailwindcss";

// Mirrors @ls/design tokens (Liquid Glass: forest, cream, brass).
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: { deep: "#163524", base: "#1C3D2C", raised: "#2A4F3C", highlight: "#3A6550" },
        cream: { DEFAULT: "#F1E9D6", muted: "#D4CDB8", dim: "#A39C8A" },
        brass: { dark: "#8C6F42", DEFAULT: "#B08D57", light: "#D4B27A", glow: "#E5C892" },
        signal: { emerald: "#4FBF8E", amber: "#E8A85C", rose: "#D97B6C" },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', "Garamond", "Georgia", "serif"],
        sans: ["Montserrat", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glass: "0 1px 0 rgba(241,233,214,0.06) inset, 0 12px 32px -12px rgba(0,0,0,0.45)",
        "glass-lg": "0 1px 0 rgba(241,233,214,0.08) inset, 0 24px 48px -16px rgba(0,0,0,0.55)",
      },
    },
  },
  plugins: [],
} satisfies Config;
