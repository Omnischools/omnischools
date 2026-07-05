/**
 * Grade-scale helpers shared by the on-screen report card and the report-card PDF.
 * A grade applies for score >= minScore up to the next-higher grade's threshold; the
 * top grade runs to 100 and the lowest usually starts at 0.
 */
export type GradeBand = { grade: string; label: string | null; minScore: number };

export type GradeLegendRow = {
  grade: string;
  label: string | null;
  min: number;
  max: number;
};

/** The grade whose threshold a score falls into (highest minScore ≤ score). */
export function gradeForScore(bands: GradeBand[], score: number): string | null {
  if (bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => b.minScore - a.minScore);
  for (const b of sorted) if (score >= b.minScore) return b.grade;
  return sorted[sorted.length - 1].grade;
}

/** Score ranges per grade, highest first: e.g. A 80–100, B2 70–79, … (top grade → 100). */
export function gradeLegend(bands: GradeBand[]): GradeLegendRow[] {
  const sorted = [...bands].sort((a, b) => b.minScore - a.minScore);
  return sorted.map((b, i) => {
    const min = Math.round(b.minScore);
    const max = i === 0 ? 100 : Math.max(min, Math.round(sorted[i - 1].minScore) - 1);
    return { grade: b.grade, label: b.label, min, max };
  });
}

/** Parent-facing "average score" — simple mean of the non-null subject totals. */
export function averageOfTotals(totals: (number | null)[]): number | null {
  const vals = totals.filter((t): t is number => t != null);
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}
