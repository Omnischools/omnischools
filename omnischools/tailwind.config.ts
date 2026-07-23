import type { Config } from "tailwindcss";

/**
 * Tailwind bound to Omnischools design tokens (styles/tokens.css).
 * Brand scales (navy/gold/green/terra/warn) are available directly for porting
 * HTML surfaces faithfully; semantic colours (background/primary/...) drive shadcn/ui.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./features/**/*.{js,ts,jsx,tsx,mdx}",
    // `lib/` too: several display maps live there and hand back Tailwind class STRINGS
    // (`MATCH_TIER_CLASS`, `cutOffDifficultyClass`, the roster avatar tints, the grading bands).
    // Without this glob an ARBITRARY value declared only in lib — `bg-[#E5EAF2]`, `text-[#1E5A35]`,
    // `bg-[rgba(45,63,92,0.12)]` — is never emitted, so the element renders with NO background at all.
    // It fails SILENTLY: typecheck and `next build` both pass. Caught in the live preview, not the build.
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // brand palette (direct)
        navy: {
          DEFAULT: "var(--navy)",
          2: "var(--navy-2)",
          3: "var(--navy-3)",
          deep: "var(--navy-deep)",
        },
        gold: {
          DEFAULT: "var(--gold)",
          soft: "var(--gold-soft)",
          bg: "var(--gold-bg)",
        },
        green: { DEFAULT: "var(--green)", bg: "var(--green-bg)" },
        terra: { DEFAULT: "var(--terra)", bg: "var(--terra-bg)", deep: "var(--terra-deep)" },
        warn: { DEFAULT: "var(--warn)", bg: "var(--warn-bg)" },

        // chronic-register condition pills (INCR-23a) — the two families with no brand token.
        "condition-epilepsy": {
          DEFAULT: "var(--condition-epilepsy)",
          bg: "var(--condition-epilepsy-bg)",
        },
        "condition-diabetes": {
          DEFAULT: "var(--condition-diabetes)",
          bg: "var(--condition-diabetes-bg)",
        },

        // brand surfaces (used directly: bg-bg, text-bg, bg-surface)
        bg: "var(--bg)",
        surface: "var(--surface)",

        // semantic roles (shadcn/ui)
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        success: { DEFAULT: "var(--success)", foreground: "var(--success-foreground)" },
        warning: { DEFAULT: "var(--warning)", foreground: "var(--warning-foreground)" },
        border: {
          DEFAULT: "var(--border)",
          1: "var(--border-1)",
          2: "var(--border-2)",
        },
        input: "var(--input)",
        ring: "var(--ring)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "Consolas", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        pill: "100px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
      },
      maxWidth: {
        page: "1480px",
        prose: "740px",
        content: "680px",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
