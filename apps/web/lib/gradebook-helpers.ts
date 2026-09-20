/** Round to 2 dp. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Simple Basic-tier letter grade from a 0–100 total. */
export function gradeFor(total: number): string {
  if (total >= 80) return "A";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  if (total >= 50) return "D";
  if (total >= 40) return "E";
  return "F";
}

/** Weighted total (out of 100) from class + exam scores and weights (percent). */
export function weightedTotal(
  classScore: number | null,
  examScore: number | null,
  classWeight: number,
  examWeight: number,
): number | null {
  if (classScore == null || examScore == null) return null;
  return round2((classScore * classWeight) / 100 + (examScore * examWeight) / 100);
}

export function numOrNull(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
