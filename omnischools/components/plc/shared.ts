/**
 * Shared PLC client-surface constants (SHS module 4.6 / INCR-47). Plain values only (NO hooks, NO
 * "use client") so both server and client components may import them.
 *
 * No-alpha token trap ([[no-alpha-token-opacity]]): every tint here is a SOLID brand token or a
 * literal rgba() — never a slash-opacity on a raw-hex token (`bg-navy/80` silently breaks). The navy
 * contract card uses `bg-white/5` / `border-white/10` (white is a real colour) + `text-gold-soft`.
 */

/** The standard editor field styling (mirrors the VLC rhythm-editor `fieldClass`). */
export const fieldClass =
  "rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface disabled:opacity-60";

/** ISO weekday options (Monday = 1 … Sunday = 7). */
export const DAY_OPTIONS = [
  { v: 1, l: "Monday" },
  { v: 2, l: "Tuesday" },
  { v: 3, l: "Wednesday" },
  { v: 4, l: "Thursday" },
  { v: 5, l: "Friday" },
  { v: 6, l: "Saturday" },
  { v: 7, l: "Sunday" },
] as const;

export const PLC_TYPE_OPTIONS = [
  { v: "subject", l: "Subject-based" },
  { v: "cross-cutting", l: "Cross-cutting" },
  { v: "new-teacher", l: "New-teacher support" },
] as const;

/** Type accent → solid brand tokens (border-left / icon chip / type label). */
export const ACCENT: Record<"navy" | "gold" | "green", { borderL: string; icon: string; lab: string }> =
  {
    navy: { borderL: "border-l-navy", icon: "bg-navy text-bg", lab: "text-navy" },
    gold: { borderL: "border-l-gold", icon: "bg-gold text-navy", lab: "text-gold" },
    green: { borderL: "border-l-green", icon: "bg-green text-bg", lab: "text-green" },
  };

/** NTC licence-renewal annual CPD total (surface lede "20 CPD points per teacher per year"). Editorial
 * policy constant, identical for every school — NOT a stored column (the school stores only its own
 * 8-point PLC contribution target). */
export const NTC_ANNUAL_TOTAL = 20;
