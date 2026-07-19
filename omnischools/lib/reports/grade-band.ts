import { gradeForScore, type GradeBand } from "@/lib/gradebook/grade-scale";

/**
 * Shared performance helpers for the academic reports. Grade bands come from the
 * school's own `grade_scale` (never hard-code "1-9" — Basic is A-F, WASSCE A1-F9);
 * `gradeForScore` maps a mean onto that scale.
 */
export { gradeForScore };
export type { GradeBand };

/** Colour tone for a score/rate. 70 = strong, 50 = GES credit line. */
export type PerfTone = "green" | "gold" | "terra" | "none";

export function performanceTone(avg: number | null): PerfTone {
  if (avg == null) return "none";
  if (avg >= 70) return "green";
  if (avg >= 50) return "gold";
  return "terra";
}

/** Attendance-rate tone — a distinct scale from scores (90 target / 75 watch). */
export function attendanceTone(rate: number | null): PerfTone {
  if (rate == null) return "none";
  if (rate >= 90) return "green";
  if (rate >= 75) return "gold";
  return "terra";
}

/** Pass / credit mark (GES default). Subject pass-rate uses this threshold. */
export const PASS_MARK = 50;
