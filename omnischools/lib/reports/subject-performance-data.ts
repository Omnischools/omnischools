import { and, asc, eq, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { gradebookScores, subjects, gradeScale, gradebookColumns } from "@/db/schema";
import {
  gradeForScore,
  performanceTone,
  PASS_MARK,
  type GradeBand,
  type PerfTone,
} from "./grade-band";
import { listAcademicTerms, resolveSelectedTerm, previousTerm, type AcademicTerm } from "./academic-term";

/**
 * "Subject performance" — per-subject averages across the school for a term (Reports →
 * Academic → Subject performance). Averages the pre-weighted `gradebook_score.total` (already
 * CA/exam-weighted at write time — do NOT re-weight) over non-null totals, maps the mean onto
 * the school's grade_scale, and compares to the previous term. Pass rate = share ≥ PASS_MARK.
 * When a class is selected, every average is scoped to that class (via gradebook_column).
 */

export type SubjectPerfRow = {
  subjectId: string;
  name: string;
  code: string | null;
  studentsGraded: number;
  average: number | null;
  grade: string | null;
  tone: PerfTone;
  priorAverage: number | null;
  delta: number | null;
  passRate: number | null; // % of graded students at/above the pass mark
  highest: number | null;
  lowest: number | null;
};

export type SubjectLeader = { name: string; average: number; grade: string | null };

export type SubjectPerformance = {
  terms: AcademicTerm[];
  term: AcademicTerm | null;
  priorTerm: AcademicTerm | null;
  classId: string | null;
  rows: SubjectPerfRow[];
  schoolAverage: number | null;
  schoolDelta: number | null;
  subjectsAssessed: number;
  subjectsTaught: number;
  strongest: SubjectLeader | null;
  needsAttention: SubjectLeader | null;
  hasAnyScores: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

type Tx = Parameters<Parameters<typeof withSchool>[1]>[0];
type Agg = {
  subjectId: string;
  graded: number;
  passed: number;
  avg: number | null;
  highest: number | null;
  lowest: number | null;
};

/**
 * Per-subject aggregates for a period. When `classId` is set, restrict to students in that
 * class by intersecting on the (subject, period) gradebook columns defined for the class —
 * i.e. only score rows whose subject·period is taught to that class.
 */
async function subjectAggregates(
  tx: Tx,
  schoolId: string,
  periodId: string,
  classId: string | null,
): Promise<Map<string, Agg>> {
  const classScoped = classId
    ? sql`exists (select 1 from ${gradebookColumns} gc where gc.school_id = ${schoolId}
        and gc.period_id = ${periodId} and gc.subject_id = ${gradebookScores.subjectId}
        and gc.class_id = ${classId})`
    : undefined;

  const rows = await tx
    .select({
      subjectId: gradebookScores.subjectId,
      graded: sql<number>`count(*) filter (where ${gradebookScores.total} is not null)::int`,
      passed: sql<number>`count(*) filter (where ${gradebookScores.total} >= ${PASS_MARK})::int`,
      avg: sql<string | null>`avg(${gradebookScores.total})`,
      highest: sql<string | null>`max(${gradebookScores.total})`,
      lowest: sql<string | null>`min(${gradebookScores.total})`,
    })
    .from(gradebookScores)
    .where(
      and(
        eq(gradebookScores.schoolId, schoolId),
        eq(gradebookScores.periodId, periodId),
        classScoped,
      ),
    )
    .groupBy(gradebookScores.subjectId);

  const map = new Map<string, Agg>();
  for (const r of rows) {
    map.set(r.subjectId, {
      subjectId: r.subjectId,
      graded: r.graded,
      passed: r.passed,
      avg: r.avg != null ? Number(r.avg) : null,
      highest: r.highest != null ? Number(r.highest) : null,
      lowest: r.lowest != null ? Number(r.lowest) : null,
    });
  }
  return map;
}

export async function getSubjectPerformance(
  schoolId: string,
  opts: { periodId?: string; classId?: string } = {},
): Promise<SubjectPerformance> {
  const terms = await listAcademicTerms(schoolId);
  const term = resolveSelectedTerm(terms, opts.periodId);
  const prior = term ? previousTerm(terms, term) : null;
  const classId = opts.classId ?? null;

  const empty: SubjectPerformance = {
    terms,
    term,
    priorTerm: prior,
    classId,
    rows: [],
    schoolAverage: null,
    schoolDelta: null,
    subjectsAssessed: 0,
    subjectsTaught: 0,
    strongest: null,
    needsAttention: null,
    hasAnyScores: false,
  };
  if (!term) return empty;

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

    const [cur, priorAgg] = await Promise.all([
      subjectAggregates(tx, schoolId, term.periodId, classId),
      prior
        ? subjectAggregates(tx, schoolId, prior.periodId, classId)
        : Promise.resolve(new Map<string, Agg>()),
    ]);

    let hasAnyScores = false;
    let subjectsAssessed = 0;
    let schoolGradedSum = 0;
    let schoolGradedCount = 0;
    let priorGradedSum = 0;
    let priorGradedCount = 0;

    const rows: SubjectPerfRow[] = subjectRows.map((s) => {
      const a = cur.get(s.id);
      const p = priorAgg.get(s.id);
      const average = a?.avg != null ? round1(a.avg) : null;
      const priorAverage = p?.avg != null ? round1(p.avg) : null;
      if (a && a.graded > 0) {
        hasAnyScores = true;
        subjectsAssessed += 1;
        schoolGradedSum += a.avg! * a.graded;
        schoolGradedCount += a.graded;
      }
      if (p && p.graded > 0) {
        priorGradedSum += p.avg! * p.graded;
        priorGradedCount += p.graded;
      }
      return {
        subjectId: s.id,
        name: s.name,
        code: s.code,
        studentsGraded: a?.graded ?? 0,
        average,
        grade: average != null ? gradeForScore(bands, average) : null,
        tone: performanceTone(average),
        priorAverage,
        delta: average != null && priorAverage != null ? round1(average - priorAverage) : null,
        passRate: a && a.graded > 0 ? Math.round((a.passed / a.graded) * 100) : null,
        highest: a?.highest != null ? round1(a.highest) : null,
        lowest: a?.lowest != null ? round1(a.lowest) : null,
      };
    });
    rows.sort((x, y) => (y.average ?? -1) - (x.average ?? -1));

    const graded = rows.filter((r) => r.average != null);
    const strongest = graded[0]
      ? { name: graded[0].name, average: graded[0].average!, grade: graded[0].grade }
      : null;
    const needsAttention =
      graded.length > 0
        ? {
            name: graded[graded.length - 1].name,
            average: graded[graded.length - 1].average!,
            grade: graded[graded.length - 1].grade,
          }
        : null;

    const schoolAverage = schoolGradedCount > 0 ? round1(schoolGradedSum / schoolGradedCount) : null;
    const priorSchool = priorGradedCount > 0 ? round1(priorGradedSum / priorGradedCount) : null;

    return {
      terms,
      term,
      priorTerm: prior,
      classId,
      rows,
      schoolAverage,
      schoolDelta:
        schoolAverage != null && priorSchool != null ? round1(schoolAverage - priorSchool) : null,
      subjectsAssessed,
      subjectsTaught: subjectRows.length,
      strongest,
      needsAttention,
      hasAnyScores,
    };
  });
}
