/**
 * WASSCE mock-grade pure helpers (SHS module 4.3 / INCR-16). NO DB import — safe on client or
 * server, and the unit-testable core of every DERIVED figure the subject-teacher surface renders
 * (Kofi AC7/AC8/AC9): the trajectory ↑/→/↓, the credit/distinction rates, the per-grade histogram,
 * the cohort mean, and the effective (moderated-or-teacher) predicted grade. NOTHING here computes a
 * cross-subject best-3 AGGREGATE (AC16 — that is INCR-17); these are all per-subject, grade-level.
 *
 * The grade order IS the `wassce_grade` enum order (A1 best → F9 fail, db/schema/_enums.ts) so an
 * ordinal comparison is enum-monotonic: lower ordinal = better grade.
 */

/** The WAEC 9-grade band, best → worst. Order matches the `wassce_grade` pgEnum exactly. */
export const WASSCE_GRADES = ["A1", "B2", "B3", "C4", "C5", "C6", "D7", "E8", "F9"] as const;
export type WassceGrade = (typeof WASSCE_GRADES)[number];

/** True when `x` is one of the 9 WAEC grades (mark-entry validation — AC6). */
export function isWassceGrade(x: unknown): x is WassceGrade {
  return typeof x === "string" && (WASSCE_GRADES as readonly string[]).includes(x);
}

/** 0 (A1, best) … 8 (F9, worst). Lower = better. */
export function gradeOrdinal(g: WassceGrade): number {
  return WASSCE_GRADES.indexOf(g);
}

/** A1–C6 (ordinal ≤ 5) is a WAEC credit pass; D7–F9 is not. */
export function isCredit(g: WassceGrade): boolean {
  return gradeOrdinal(g) <= 5;
}

/** A1 / B2 (ordinal ≤ 1) is a distinction on this surface (§B.1.3 / §B.5.2 — 12/28 = 43%). */
export function isDistinction(g: WassceGrade): boolean {
  return gradeOrdinal(g) <= 1;
}

/** A1–C6 is the credit band; C5–C6 (ordinal 4–5) is the borderline "FOCUS" zone (§B.2 rows 07–09). */
export function isFocusBand(g: WassceGrade): boolean {
  const o = gradeOrdinal(g);
  return o >= 4 && o <= 5;
}

/**
 * The effective (predicted) grade — COALESCE(moderated_grade, grade), DERIVED ON READ (R2/AC7/AC10).
 * There is NO stored predicted_grade column; the per-subject predicted grade is the effective grade
 * of the `is_predictor` mock. The teacher's original `grade` stays visible alongside (never replaced).
 */
export function effectiveGrade(r: {
  grade: WassceGrade;
  moderatedGrade?: WassceGrade | null;
}): WassceGrade {
  return r.moderatedGrade ?? r.grade;
}

export type Trajectory = {
  dir: "up" | "flat" | "down";
  /** Grade-steps improved (positive = better in Mock 2 than Mock 1). */
  steps: number;
  /** Surface label — "↑ 1 grade" / "→ holding" / "→ stuck" / "↓ 1 grade" / "—". */
  label: string;
};

/**
 * The Mock 1 → Mock 2 trajectory (AC8), DERIVED from the two real grades — never stored. A flat move
 * is "holding" when the held grade is B3 or better, "stuck" when it is borderline (C4+), matching the
 * surface (E. Mensah A1 → holding, A. Bonsu C5 → stuck). A missing Mock 1 renders an em-dash.
 */
export function trajectory(
  mock1: WassceGrade | null | undefined,
  mock2: WassceGrade | null | undefined,
): Trajectory {
  if (!mock2 || !mock1) return { dir: "flat", steps: 0, label: "—" };
  const steps = gradeOrdinal(mock1) - gradeOrdinal(mock2); // >0 improved (lower ordinal is better)
  if (steps > 0) return { dir: "up", steps, label: `↑ ${steps} grade` };
  if (steps < 0) return { dir: "down", steps, label: `↓ ${-steps} grade` };
  return { dir: "flat", steps: 0, label: gradeOrdinal(mock2) <= 2 ? "→ holding" : "→ stuck" };
}

/** Per-grade counts across a set of grades (the §B.1.4 histogram — AC9). */
export function gradeDistribution(grades: readonly WassceGrade[]): Record<WassceGrade, number> {
  const out = Object.fromEntries(WASSCE_GRADES.map((g) => [g, 0])) as Record<WassceGrade, number>;
  for (const g of grades) out[g] += 1;
  return out;
}

/** Share of grades at credit (≤ C6), as a 0–1 fraction (AC9). */
export function creditRate(grades: readonly WassceGrade[]): number {
  if (grades.length === 0) return 0;
  return grades.filter(isCredit).length / grades.length;
}

/** Share of grades at distinction (A1/B2), as a 0–1 fraction (AC9). */
export function distinctionRate(grades: readonly WassceGrade[]): number {
  if (grades.length === 0) return 0;
  return grades.filter(isDistinction).length / grades.length;
}

/** Round a 0–1 fraction to a whole-percent integer (display helper — 0.4285 → 43). */
export function toPct(fraction: number): number {
  return Math.round(fraction * 100);
}

/** The cohort mean grade (§B.1.3 cell 4) — mean ordinal rounded to the nearest band. */
export function meanGrade(grades: readonly WassceGrade[]): WassceGrade | null {
  if (grades.length === 0) return null;
  const avg = grades.reduce((s, g) => s + gradeOrdinal(g), 0) / grades.length;
  return WASSCE_GRADES[Math.min(WASSCE_GRADES.length - 1, Math.max(0, Math.round(avg)))];
}

/** Benchmark confidence tier → the §B.5.2 provenance dot (STRONG green · MODERATE gold · DIRECTIONAL warn). */
export function benchmarkDot(quality: "STRONG" | "MODERATE" | "DIRECTIONAL"): {
  key: "strong" | "mod" | "weak";
  dotClass: string;
} {
  if (quality === "STRONG") return { key: "strong", dotClass: "bg-green" };
  if (quality === "MODERATE") return { key: "mod", dotClass: "bg-gold" };
  return { key: "weak", dotClass: "bg-warn" };
}
