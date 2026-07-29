// Liquid Glass — L&S House design tokens.
// Single source of truth for palette, type, and glass surfaces. Both
// app.lstailors.com (dashboard) and alts.lstailors.com (intake/day-to-day)
// derive from this. No one-off colours outside these tokens.
//
// HER-71 brighten (2026-07-29): lifted forest luminance ~+5–8% L so FOH
// screens stay readable on iPhone with ambient light. Brass + cream unchanged
// as accents; text-on-brass stays near-black for contrast.

export const forest = {
  deep: "#163524",
  base: "#1C3D2C",
  raised: "#2A4F3C",
  highlight: "#3A6550",
} as const;

export const cream = {
  DEFAULT: "#F1E9D6",
  muted: "#D4CDB8",
  dim: "#A39C8A",
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
