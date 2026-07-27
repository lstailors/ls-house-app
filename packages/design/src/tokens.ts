// Liquid Glass — L&S House design tokens.
// Single source of truth for palette, type, and glass surfaces. Both
// app.lstailors.com (dashboard) and alts.lstailors.com (intake/day-to-day)
// derive from this. No one-off colours outside these tokens.

export const forest = {
  deep: "#0D1A10",
  base: "#0F2218",
  raised: "#1F3A2E",
  highlight: "#2A4D3D",
} as const;

export const cream = {
  DEFAULT: "#F1E9D6",
  muted: "#C9C0AB",
  dim: "#8A8474",
} as const;

// Brushed brass — the SOLE accent.
export const brass = {
  dark: "#8C6F42",
  DEFAULT: "#B08D57",
  light: "#D4B27A",
  glow: "#E5C892",
} as const;

export const signal = {
  emerald: "#4FBF8E",
  amber: "#E8A85C",
  rose: "#D97B6C",
} as const;

export const fontFamily = {
  display: ['"Cormorant Garamond"', "Garamond", "Georgia", "serif"],
  sans: ["Montserrat", "system-ui", "sans-serif"],
  mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
} as const;

// Minimum comfortable tap target for front-of-house iPad use.
export const TAP_TARGET_MIN_PX = 88;
