import { and, desc, eq, ne } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { academicPeriod } from "@/db/schema";

/**
 * A real academic term for the Reports TERM / YEAR filters. Unlike the finance
 * reports' date-window `period.ts`, the academic reports key on a specific
 * `academic_period.periodId` (that is what `gradebook_score` joins on), so they
 * select a term rather than a date range.
 */
export type AcademicTerm = {
  periodId: string;
  academicYear: string;
  periodNumber: number;
  label: string; // periodLabel, e.g. "Term 1"
  startsOn: string; // Postgres date, "YYYY-MM-DD"
  endsOn: string;
  closed: boolean;
};

/**
 * Every real (non-SENIOR_F3) term for a school, newest first. Excludes the SENIOR_F3
 * boarding pseudo-period (migration 0048) — it is not a reporting term. Same exclusion
 * as `getReportTerm` so the academic reports resolve the same "current term".
 */
export async function listAcademicTerms(schoolId: string): Promise<AcademicTerm[]> {
  const rows = await withSchool(schoolId, (tx) =>
    tx
      .select({
        periodId: academicPeriod.periodId,
        academicYear: academicPeriod.academicYear,
        periodNumber: academicPeriod.periodNumber,
        label: academicPeriod.periodLabel,
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
        closedAt: academicPeriod.closedAt,
      })
      .from(academicPeriod)
      .where(
        and(eq(academicPeriod.schoolId, schoolId), ne(academicPeriod.productLine, "SENIOR_F3")),
      )
      .orderBy(desc(academicPeriod.academicYear), desc(academicPeriod.periodNumber)),
  );
  return rows.map((r) => ({
    periodId: r.periodId,
    academicYear: r.academicYear,
    periodNumber: r.periodNumber,
    label: r.label,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    closed: r.closedAt != null,
  }));
}

/**
 * Resolve the selected term from a `?term=<periodId>` filter, defaulting to the current
 * term: the window containing today, else the most recent term already started, else the
 * newest term. `terms` must be newest-first (as `listAcademicTerms` returns).
 */
export function resolveSelectedTerm(
  terms: AcademicTerm[],
  selectedPeriodId?: string,
): AcademicTerm | null {
  if (terms.length === 0) return null;
  if (selectedPeriodId) {
    const match = terms.find((t) => t.periodId === selectedPeriodId);
    if (match) return match;
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    terms.find((t) => t.startsOn <= today && t.endsOn >= today) ??
    terms.find((t) => t.startsOn <= today) ?? // desc order → first started = most recent
    terms[0]
  );
}

/**
 * The term immediately before `term` chronologically (for term-on-term comparison), or null
 * when `term` is the earliest. `terms` must be newest-first.
 */
export function previousTerm(terms: AcademicTerm[], term: AcademicTerm): AcademicTerm | null {
  const older = terms.filter(
    (t) =>
      t.academicYear < term.academicYear ||
      (t.academicYear === term.academicYear && t.periodNumber < term.periodNumber),
  );
  return older[0] ?? null; // newest-first → first older entry is the closest previous term
}
