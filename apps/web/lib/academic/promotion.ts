import { GES_BASIC_CLASSES } from "@/lib/onboarding";
import { compareLevelLabel, UNSPECIFIED_LEVEL } from "@/lib/reports/level-order";

/**
 * Year-end promotion ladder — pure helpers shared by the promotion action and UI.
 * Progression follows the GES basic ladder (KG 1 → KG 2 → Primary 1–6 → JHS 1–3);
 * the terminal level graduates.
 */

export const GRADUATE = "GRADUATE" as const;

/**
 * The next rung for a class level: the next level label, GRADUATE for the terminal level
 * (JHS 3), or null when the level isn't on the standard ladder (custom naming → handled
 * manually).
 */
export function nextLevel(
  level: string | null | undefined,
): string | typeof GRADUATE | null {
  if (!level) return null;
  const i = GES_BASIC_CLASSES.indexOf(level.trim());
  if (i < 0) return null;
  return i === GES_BASIC_CLASSES.length - 1 ? GRADUATE : GES_BASIC_CLASSES[i + 1];
}

/** Next academic-year label: "2025/26" → "2026/27". Falls back to the input if unparsable. */
export function nextAcademicYear(label: string): string {
  const m = label.match(/^(\d{4})\s*\/\s*\d{2,4}$/);
  if (!m) return label;
  const start = Number(m[1]) + 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Shift an ISO date (YYYY-MM-DD) forward one year; Feb 29 → Feb 28. */
export function shiftYearIso(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  if (d.getUTCMonth() !== month) d.setUTCDate(0); // overflowed (Feb 29) → last day of Feb
  return d.toISOString().slice(0, 10);
}

/**
 * Ladder-correct order for two promotion-preview rows (#320): canonical tier order on the level
 * (#305's compareLevelLabel — KG<Primary<JHS<SHS, numeric within tier — because the ladder can't be
 * expressed in SQL), then class name so streams within a year-group stay grouped. Null levels
 * (UNMATCHED / level-less classes) bucket last via UNSPECIFIED_LEVEL. Callers `.sort()` a
 * lastName-ordered array, so a stable sort keeps students in lastName order within a class.
 */
export function comparePromotionRows(
  a: { fromLevel: string | null; fromClass: string },
  b: { fromLevel: string | null; fromClass: string },
): number {
  return (
    compareLevelLabel(a.fromLevel ?? UNSPECIFIED_LEVEL, b.fromLevel ?? UNSPECIFIED_LEVEL) ||
    a.fromClass.localeCompare(b.fromClass)
  );
}

/** The section suffix of a class name relative to its level, e.g. ("JHS 1 A","JHS 1") → "A". */
export function sectionSuffix(className: string, level: string | null): string {
  if (!level) return "";
  const n = className.trim();
  const l = level.trim();
  if (n.toLowerCase().startsWith(l.toLowerCase())) {
    return n.slice(l.length).trim();
  }
  return "";
}
