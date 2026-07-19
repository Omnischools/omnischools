import { and, asc, eq, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { gradebookScores, subjects, gradeScale } from "@/db/schema";
import { gradeForScore, type GradeBand } from "@/lib/gradebook/grade-scale";
import { listAcademicTerms, resolveSelectedTerm, type AcademicTerm } from "./academic-term";

/**
 * "Subject performance" — per-subject averages across the school for a term (Reports →
 * Academic → Subject performance). Averages the pre-weighted `gradebook_score.total`
 * (the CA/exam weighting is already applied at write time per gradebook_config — do NOT
 * re-weight here) over non-null totals, then maps the mean onto the school's grade_scale.
 */

export type SubjectPerfRow = {
  subjectId: string;
  name: string;
  code: string | null;
  studentsGraded: number;
  average: number | null; // mean of non-null totals, 1 dp; null when nothing graded
  grade: string | null; // grade band the average falls into
  highest: number | null;
  lowest: number | null;
};

export type SubjectPerformance = {
  terms: AcademicTerm[]; // for the TERM / YEAR filter
  term: AcademicTerm | null; // resolved selected term (null → no term configured)
  rows: SubjectPerfRow[];
  hasAnyScores: boolean; // false → render the "needs a full term of graded entries" empty state
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function getSubjectPerformance(
  schoolId: string,
  selectedTermId?: string,
): Promise<SubjectPerformance> {
  const terms = await listAcademicTerms(schoolId);
  const term = resolveSelectedTerm(terms, selectedTermId);
  if (!term) return { terms, term: null, rows: [], hasAnyScores: false };

  return withSchool(schoolId, async (tx) => {
    const bands: GradeBand[] = (
      await tx
        .select({ grade: gradeScale.grade, label: gradeScale.label, minScore: gradeScale.minScore })
        .from(gradeScale)
        .where(eq(gradeScale.schoolId, schoolId))
    ).map((b) => ({ grade: b.grade, label: b.label, minScore: Number(b.minScore) }));

    const subjectRows = await tx
      .select({ id: subjects.id, name: subjects.name, code: subjects.code })
      .from(subjects)
      .where(and(eq(subjects.schoolId, schoolId), eq(subjects.active, true)))
      .orderBy(asc(subjects.name));

    // One grouped pass. gradebook_score is unique per (student, subject, period), so a
    // non-null-total row count == distinct students graded for that subject this term.
    const agg = await tx
      .select({
        subjectId: gradebookScores.subjectId,
        graded: sql<number>`count(*) filter (where ${gradebookScores.total} is not null)::int`,
        avg: sql<string | null>`avg(${gradebookScores.total})`,
        highest: sql<string | null>`max(${gradebookScores.total})`,
        lowest: sql<string | null>`min(${gradebookScores.total})`,
      })
      .from(gradebookScores)
      .where(
        and(eq(gradebookScores.schoolId, schoolId), eq(gradebookScores.periodId, term.periodId)),
      )
      .groupBy(gradebookScores.subjectId);

    const byId = new Map(agg.map((a) => [a.subjectId, a]));
    let hasAnyScores = false;

    const rows: SubjectPerfRow[] = subjectRows.map((s) => {
      const a = byId.get(s.id);
      const graded = a?.graded ?? 0;
      if (graded > 0) hasAnyScores = true;
      const average = a?.avg != null ? round1(Number(a.avg)) : null;
      return {
        subjectId: s.id,
        name: s.name,
        code: s.code,
        studentsGraded: graded,
        average,
        grade: average != null ? gradeForScore(bands, average) : null,
        highest: a?.highest != null ? round1(Number(a.highest)) : null,
        lowest: a?.lowest != null ? round1(Number(a.lowest)) : null,
      };
    });

    return { terms, term, rows, hasAnyScores };
  });
}
