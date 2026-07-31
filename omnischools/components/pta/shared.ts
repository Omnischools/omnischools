/**
 * Shared PTA client-surface constants (SHS module 4.7 / INCR-50). Plain values only (NO hooks, NO
 * "use client") so both server and client components may import them. The surface copy for each tier's
 * config-grid + dues block lives here, keyed by the four fixed tier types.
 *
 * No-alpha token trap ([[no-alpha-token-opacity]]): every tint is a SOLID brand token or a literal
 * rgba() — never a slash-opacity on a raw-hex token (`bg-navy/80` silently breaks). The navy gen-preview
 * card uses `bg-white/5` / `border-white/10` (white is a real colour) + `text-gold-soft`. Verify in the
 * live preview, not the build.
 */
import type { PtaTierType } from "@/lib/pta/defaults";

/** The standard editor field styling (mirrors the PLC/VLC `fieldClass`). */
export const fieldClass =
  "rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface disabled:opacity-60";

/** Tier accent → SOLID brand tokens (icon chip / left border / label). Emergency = terra (new for PTA). */
export const PTA_ACCENT: Record<
  "navy" | "gold" | "green" | "terra",
  { icon: string; borderL: string; lab: string }
> = {
  navy: { icon: "bg-navy text-bg", borderL: "border-l-navy", lab: "text-navy" },
  gold: { icon: "bg-gold text-navy", borderL: "border-l-gold", lab: "text-gold" },
  green: { icon: "bg-green text-bg", borderL: "border-l-green", lab: "text-green" },
  terra: { icon: "bg-terra text-bg", borderL: "border-l-terra", lab: "text-terra" },
};

export interface SettingDef {
  key: string;
  label: string;
  hint?: string;
  options: string[]; // opaque option labels round-tripped into tier_settings (NOT EAV — R410)
}

export interface TierUi {
  tierNo: number;
  name: string; // "Form PTA"
  scope: string; // "per class"
  desc: string;
  accent: "navy" | "gold" | "green" | "terra";
  iconInitials: string; // "FP"
  activeLabel: string; // "Active" / "Available"
  /** Standing officers + quorum + frequency shown? (Emergency = false — convene-only, R414). */
  hasStandingConfig: boolean;
  /** A dues block shown? (Emergency = false — no standing dues, R414). */
  hasDues: boolean;
  frequencyOptions: string[];
  officerHint?: string;
  settings: SettingDef[];
}

export const TIER_UI: Record<PtaTierType, TierUi> = {
  FORM: {
    tierNo: 1,
    name: "Form PTA",
    scope: "per class",
    desc: "One PTA per class, auto-generated from your current class list. Form Master is the default secretary. Meets once per term typically.",
    accent: "navy",
    iconInitials: "FP",
    activeLabel: "Active",
    hasStandingConfig: true,
    hasDues: true,
    frequencyOptions: [
      "Once per term (3× per academic year)",
      "Twice per term",
      "Monthly",
      "Ad-hoc — Form Master decides",
    ],
    officerHint: "Form Master serves ex-officio as Secretary",
    settings: [
      {
        key: "membershipBasis",
        label: "Membership basis",
        hint: "Affects expected-attendees count on registers",
        options: ["One parent/guardian per student (default)", "Both parents (where available)"],
      },
    ],
  },
  HOUSE: {
    tierNo: 2,
    name: "House PTA",
    scope: "per House",
    desc: "One PTA per House, auto-generated. Housemaster is the default Secretary. Focus: boarding, welfare, pastoral matters, House finances.",
    accent: "gold",
    iconInitials: "HP",
    activeLabel: "Active",
    hasStandingConfig: true,
    hasDues: true,
    frequencyOptions: [
      "Once per term",
      "Twice per academic year (visiting day + speech day)",
      "As called by Housemaster",
    ],
    settings: [
      {
        key: "membershipScope",
        label: "Membership scope",
        hint: "Default: all House-affiliated, day or boarding",
        options: [
          "Parents of students assigned to this House (boarding & day)",
          "Parents of boarders only",
        ],
      },
    ],
  },
  GENERAL: {
    tierNo: 3,
    name: "General PTA",
    scope: "school-wide",
    desc: 'One per school — "the PTA" in casual reference. Elected executive, school-wide policy, the body the Headmaster reports to. Always active in any school that runs a PTA at all.',
    accent: "green",
    iconInitials: "GP",
    activeLabel: "Active",
    hasStandingConfig: true,
    hasDues: true,
    frequencyOptions: [
      "Once per term + AGM annually (default)",
      "Twice per term",
      "AGM only · all else by Emergency tier",
    ],
    officerHint: "7 roles standard for General PTA executive",
    settings: [
      {
        key: "headmasterRole",
        label: "Headmaster role",
        hint: "Headmaster typically attends but doesn't vote on PTA resolutions",
        options: ["Ex-officio (non-voting member)", "Voting member", "Observer only"],
      },
      {
        key: "officerTerm",
        label: "Officer term length",
        options: ["2 academic years (default)", "1 academic year", "3 academic years"],
      },
    ],
  },
  EMERGENCY: {
    tierNo: 4,
    name: "Emergency PTA",
    scope: "on-demand",
    desc: "Not pre-scheduled. Convened when something can't wait — a serious incident, an urgent policy decision, an unbudgeted expenditure. Convened by Headmaster or General PTA Chair only. Standing dues don't apply; ad-hoc levies allowed.",
    accent: "terra",
    iconInitials: "EP",
    activeLabel: "Available",
    hasStandingConfig: false,
    hasDues: false,
    frequencyOptions: [],
    settings: [
      {
        key: "whoConvene",
        label: "Who can convene",
        hint: "Audit-logged when triggered · attaches reason",
        options: [
          "Headmaster OR General PTA Chair (default)",
          "Headmaster only",
          "General PTA Chair only",
        ],
      },
      {
        key: "minNotice",
        label: "Minimum notice required",
        options: ["48 hours (default)", "24 hours", "72 hours", "No minimum (true emergency)"],
      },
      {
        key: "attendanceScope",
        label: "Attendance scope",
        options: [
          "All General PTA members (default)",
          "Executive only",
          "Specified subset (e.g. one tier · one Form · one House)",
        ],
      },
      {
        key: "adhocLevy",
        label: "Ad-hoc levy allowed",
        hint: "If yes, levy goes through the dues fee category with audit trail",
        options: ["Yes · with resolution passed", "No · standing dues only"],
      },
    ],
  },
};

export const DUES_BASIS_OPTIONS = [
  { value: "PER_STUDENT", label: "Per student" },
  { value: "PER_FAMILY", label: "Per family (one fee covers all siblings)" },
] as const;

export const DUES_CADENCE_OPTIONS = [
  { value: "PER_TERM", label: "Per term" },
  { value: "PER_YEAR", label: "Per academic year" },
  { value: "ONE_OFF", label: "One-off (admission only)" },
] as const;

export function duesBasisLabel(v: string | null): string {
  return DUES_BASIS_OPTIONS.find((o) => o.value === v)?.label ?? "—";
}
export function duesCadenceLabel(v: string | null): string {
  return DUES_CADENCE_OPTIONS.find((o) => o.value === v)?.label ?? "—";
}

/** "GHS 50.00" — display only (the stored value is numeric(12,2)). */
export function ghs(amount: number | null): string {
  return amount == null ? "—" : `GHS ${amount.toFixed(2)}`;
}
