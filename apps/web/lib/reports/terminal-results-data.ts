import "server-only";
import { eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { terminalExamResult } from "@/db/schema";

/**
 * GOV-6 · the terminal-exam-results reader (BECE / WASSCE) — server-only, `withSchool`-scoped, so the
 * shared rollup composes it and stays zero-SQL (R360). AGGREGATE-ONLY: it reads the four stored sex-split
 * leaf counts and NOTHING per-candidate (the table carries no candidate rows — R363/R372).
 *
 * `total` / `passed` / `passRate` are ALWAYS DERIVED at read (`deriveTerminalSummary`, R364), NEVER read
 * from a stored column — a stored rate would drift from its own leaves, and `passed` is the ENTERED WAEC
 * outcome (no mark threshold applied — GOV6-03).
 */

export type ExamType = "BECE" | "WASSCE";

/** The four stored leaf counts for one sitting, plus its year. Nothing derived. */
export type TerminalResultRow = {
  year: number;
  femaleCandidates: number;
  maleCandidates: number;
  femalePassed: number;
  malePassed: number;
};

/** Per exam_type, the LATEST year's leaf counts (absent when the school has captured none). */
export type TerminalResults = {
  bece?: TerminalResultRow;
  wassce?: TerminalResultRow;
};

/**
 * The derived, presentation-ready view of one sitting. total/passed/passRate are computed HERE from the
 * leaves (R364) — the single definition the rollup arm, the board tile, the PDF and the capture list all
 * share, so no two surfaces can disagree. `passed` is entered, never thresholded (GOV6-03).
 */
export type TerminalResultSummary = {
  year: number;
  totalCandidates: number;
  passedCount: number;
  passRate: number;
  female: { candidates: number; passed: number };
  male: { candidates: number; passed: number };
};

/** Pure derive of total/passed/passRate from the four leaf counts. The DB CHECK guarantees total ≥ 1;
 *  the `> 0` guard defends against a NaN should a caller ever pass an unchecked row. */
export function deriveTerminalSummary(row: TerminalResultRow): TerminalResultSummary {
  const totalCandidates = row.femaleCandidates + row.maleCandidates;
  const passedCount = row.femalePassed + row.malePassed;
  return {
    year: row.year,
    totalCandidates,
    passedCount,
    passRate: totalCandidates > 0 ? Math.round((passedCount / totalCandidates) * 100) : 0,
    female: { candidates: row.femaleCandidates, passed: row.femalePassed },
    male: { candidates: row.maleCandidates, passed: row.malePassed },
  };
}

/**
 * The LATEST-year sitting per exam_type. Year-scoped and period-INDEPENDENT (R368) — it takes NO period.
 * The max-year pick is done in memory (order-independent) so a shuffled result set still yields the
 * newest sitting per type; the UNIQUE(school, exam_type, year) constraint means one row per (type, year).
 */
export async function getTerminalResults(schoolId: string): Promise<TerminalResults> {
  const rows = await withSchool(schoolId, (tx) =>
    tx
      .select({
        examType: terminalExamResult.examType,
        year: terminalExamResult.year,
        femaleCandidates: terminalExamResult.femaleCandidates,
        maleCandidates: terminalExamResult.maleCandidates,
        femalePassed: terminalExamResult.femalePassed,
        malePassed: terminalExamResult.malePassed,
      })
      .from(terminalExamResult)
      .where(eq(terminalExamResult.schoolId, schoolId)),
  );

  const out: TerminalResults = {};
  for (const r of rows) {
    const key = r.examType === "BECE" ? "bece" : r.examType === "WASSCE" ? "wassce" : null;
    if (!key) continue; // CHECK-guaranteed unreachable; skip rather than trust an unknown domain value
    const cur = out[key];
    if (!cur || r.year > cur.year) {
      out[key] = {
        year: r.year,
        femaleCandidates: r.femaleCandidates,
        maleCandidates: r.maleCandidates,
        femalePassed: r.femalePassed,
        malePassed: r.malePassed,
      };
    }
  }
  return out;
}

/** One captured sitting for the management list — the derived summary + its note + exam type. */
export type TerminalSitting = TerminalResultSummary & { examType: ExamType; note: string | null };

/**
 * ALL captured sittings (both exam types, every year) for the management capture surface's list, newest
 * first. Derives each row's summary from the same `deriveTerminalSummary` the rollup uses.
 */
export async function listTerminalResults(schoolId: string): Promise<TerminalSitting[]> {
  const rows = await withSchool(schoolId, (tx) =>
    tx
      .select({
        examType: terminalExamResult.examType,
        year: terminalExamResult.year,
        femaleCandidates: terminalExamResult.femaleCandidates,
        maleCandidates: terminalExamResult.maleCandidates,
        femalePassed: terminalExamResult.femalePassed,
        malePassed: terminalExamResult.malePassed,
        note: terminalExamResult.note,
      })
      .from(terminalExamResult)
      .where(eq(terminalExamResult.schoolId, schoolId)),
  );

  return rows
    .filter((r): r is typeof r & { examType: ExamType } => r.examType === "BECE" || r.examType === "WASSCE")
    .map((r) => ({ ...deriveTerminalSummary(r), examType: r.examType, note: r.note }))
    .sort((a, b) => b.year - a.year || a.examType.localeCompare(b.examType));
}
