/**
 * WASSCE subject-teacher surface bespoke palettes (SHS module 4.3 / INCR-16 · Lucy map §0.2). These
 * hexes are NOT design tokens and NOT the INCR-15 opacity-stepped grading strip — they are a smoother
 * 9-step grade gradient + a 6-step heat scale unique to this surface. Stored here (not Tailwind) and
 * rendered via inline `style`, so the no-alpha trap (repo memory `no-alpha-token-opacity`) never
 * applies: there is no slash-opacity on a raw-hex token anywhere on this surface. Pure — no DB import.
 */
import type { WassceGrade } from "./mock-grades";

/** Palette A (§0.2A) — grade-chip / distribution-bar solid fills, per grade. Text is always the light bg. */
export const GRADE_COLORS: Record<WassceGrade, string> = {
  A1: "#1E5A35", // bespoke dark forest
  B2: "#2F6B47", // = --green
  B3: "#3D8059", // bespoke
  C4: "#7C9647", // bespoke olive
  C5: "#B59B3D", // bespoke gold-olive
  C6: "#C58A2E", // = --warn
  D7: "#C58A2E", // = --warn
  E8: "#A8771F", // bespoke
  F9: "#B84A39", // = --terra
};

/** Chip text colour — the light bg token hex (readable on every palette-A fill). */
export const GRADE_CHIP_TEXT = "#FAF7F2";

/** Palette B (§0.2B) — heatmap 6-step scale, count-driven. h0 is the light bg (navy-3 text). */
export const HEAT_COLORS: Record<"h0" | "h1" | "h2" | "h3" | "h4" | "h5", { bg: string; text: string }> = {
  h5: { bg: "#1E5A35", text: "#FAF7F2" }, // strong · 14+
  h4: { bg: "#3D8059", text: "#FAF7F2" }, // good · 10–13
  h3: { bg: "#B59B3D", text: "#FAF7F2" }, // mixed · 6–9
  h2: { bg: "#C58A2E", text: "#FAF7F2" }, // focus area · 3–5
  h1: { bg: "#B84A39", text: "#FAF7F2" }, // critical gap · 0–2
  h0: { bg: "#FAF7F2", text: "#8A93A6" }, // zero
};
