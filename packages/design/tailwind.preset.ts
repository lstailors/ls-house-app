import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

// Liquid Glass — shared Tailwind preset.
// Extend this in each app's tailwind.config.ts rather than redefining tokens.
//   import lsPreset from "@ls/design/tailwind.preset";
//   export default { presets: [lsPreset], content: [...] }

export default {
  content: [],
  theme: {
    extend: {
      colors: {
        // ─── L&S House Liquid Glass palette ───────────────────────────
        forest: {
          deep: "#163524",
          base: "#1C3D2C",
          raised: "#2A4F3C",
          highlight: "#3A6550",
        },
        cream: {
          DEFAULT: "#F1E9D6",
          muted: "#D4CDB8",
          dim: "#A39C8A",
        },
        brass: {
          dark: "#8C6F42",
          DEFAULT: "#B08D57",
          light: "#D4B27A",
          glow: "#E5C892",
        },
        signal: {
          emerald: "#4FBF8E",
          amber: "#E8A85C",
          rose: "#D97B6C",
        },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', "Garamond", "Georgia", "serif"],
        sans: ["Montserrat", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      letterSpacing: {
        widest: "0.2em",
        widerer: "0.32em",
      },
      backgroundImage: {
        "glass-card":
          "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
        "glass-card-hover":
          "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
        "brass-line":
          "linear-gradient(90deg, transparent 0%, #B08D57 50%, transparent 100%)",
        "brass-radial":
          "radial-gradient(ellipse at top, rgba(176,141,87,0.18) 0%, transparent 65%)",
        "forest-radial":
          "radial-gradient(ellipse at center, #2A4F3C 0%, #163524 70%)",
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(212,178,122,0.08)",
        "glass-lg":
          "0 24px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(212,178,122,0.12)",
        "brass-glow":
          "0 0 0 1px rgba(176,141,87,0.4), 0 0 24px rgba(176,141,87,0.18)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "brass-shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        "brass-shimmer": "brass-shimmer 8s linear infinite",
        "glow-pulse": "glow-pulse 4s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
