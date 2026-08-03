import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { gradebookScores, students, classes, gradeScale, users } from "@/db/schema";
import {
  gradeForScore,
  performanceTone,
  passRateOf,
  PASS_MARK,
  type GradeBand,
  type PerfTone,
} from "./grade-band";
import {
  listAcademicTerms,
  resolveSelectedTerm,
  previousTerm,
  type AcademicTerm,
} from "./academic-term";

/**
 * "Class performance" — average of the pre-weighted `gradebook_score.total` per class for a
 * term, set against the previous term (Reports → Academic → Class performance). The total is
 * already CA/exam-weighted at write time (gradebook_config), so this only averages it; it does
 * not re-weight. Averages are AVG(total) over the class's score rows (all subjects pooled).
 */

export type ClassPerfRow = {
  classId: string;
  name: string;
  teacherName: string | null;
  average: number | null; // 1 dp; null when nothing graded
  grade: string | null;
  tone: PerfTone;
  priorAverage: number | null;
  delta: number | null; // average - priorAverage; null when either side is missing
  studentsGraded: number;
};

export type ClassLeader = { name: string; average: number; grade: string | null };

export type ClassPerformance = {
  terms: AcademicTerm[];
  term: AcademicTerm | null;
  priorTerm: AcademicTerm | null;
  scoped: boolean; // true → teacher-scoped to their own classes
  rows: ClassPerfRow[];
  schoolAverage: number | null;
  schoolDelta: number | null;
  /** School-wide % of graded scores at/above PASS_MARK (per-score basis; null when none graded). */
  schoolPassRate: number | null;
  classesGraded: number;
  totalClasses: number;
  highest: ClassLeader | null;
  needsSupport: ClassLeader | null;
  hasAnyScores: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

type Tx = Parameters<Parameters<typeof withSchool>[1]>[0];

/** AVG(total) + distinct students graded, per class, for one period. */
async function classAverages(
  tx: Tx,
  schoolId: string,
  periodId: string,
): Promise<Map<string, { avg: number | null; students: number }>> {
  const rows = await tx
    .select({
      classId: students.classId,
      avg: sql<string | null>`avg(${gradebookScores.total})`,
      students: sql<number>`count(distinct ${gradebookScores.studentId}) filter (where ${gradebookScores.total} is not null)::int`,
    })
    .from(gradebookScores)
    .innerJoin(
      students,
      and(
        eq(gradebookScores.studentId, students.id),
        eq(gradebookScores.schoolId, students.schoolId),
      ),
    )
    .where(and(eq(gradebookScores.schoolId, schoolId), eq(gradebookScores.periodId, periodId)))
    .groupBy(students.classId);

  const map = new Map<string, { avg: number | null; students: number }>();
  for (const r of rows) {
    if (!r.classId) continue;
    map.set(r.classId, { avg: r.avg != null ? Number(r.avg) : null, students: r.students });
  }
  return map;
}

/** School-wide AVG(total) + per-score pass/graded counts over the in-scope classes for one period. */
async function scopedSchoolAggregate(
  tx: Tx,
  schoolId: string,
  periodId: string,
  classIds: string[],
): Promise<{ avg: number | null; passed: number; graded: number }> {
  if (classIds.length === 0) return { avg: null, passed: 0, graded: 0 };
  const [row] = await tx
    .select({
      avg: sql<string | null>`avg(${gradebookScores.total})`,
      // Per-score pass basis — MIRRORS subject-performance-data.ts (count(*) filter ≥ PASS_MARK over
      // non-null totals), aggregated school-wide with NO group-by. Same pass, no extra round-trip.
      passed: sql<number>`count(*) filter (where ${gradebookScores.total} >= ${PASS_MARK})::int`,
      graded: sql<number>`count(*) filter (where ${gradebookScores.total} is not null)::int`,
    })
    .from(gradebookScores)
    .innerJoin(
      students,
      and(
        eq(gradebookScores.studentId, students.id),
        eq(gradebookScores.schoolId, students.schoolId),
      ),
    )
    .where(
      and(
        eq(gradebookScores.schoolId, schoolId),
        eq(gradebookScores.periodId, periodId),
        inArray(students.classId, classIds),
      ),
    );
  return {
    avg: row?.avg != null ? Number(row.avg) : null,
    passed: row?.passed ?? 0,
    graded: row?.graded ?? 0,
  };
}

export async function getClassPerformance(
  schoolId: string,
  opts: { periodId?: string; teacherUserId?: string | null } = {},
): Promise<ClassPerformance> {
  const terms = await listAcademicTerms(schoolId);
  const term = resolveSelectedTerm(terms, opts.periodId);
  const prior = term ? previousTerm(terms, term) : null;
  const scoped = !!opts.teacherUserId;

  const empty: ClassPerformance = {
    terms,
    term,
    priorTerm: prior,
    scoped,
    rows: [],
    schoolAverage: null,
    schoolDelta: null,
    schoolPassRate: null,
    classesGraded: 0,
    totalClasses: 0,
    highest: null,
    needsSupport: null,
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

    const classFilters = [eq(classes.schoolId, schoolId), eq(classes.active, true)];
    if (opts.teacherUserId) classFilters.push(eq(classes.classTeacherUserId, opts.teacherUserId));
    const classRows = await tx
      .select({ classId: classes.id, name: classes.name, teacherName: users.fullName })
      .from(classes)
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
      .where(and(...classFilters))
      .orderBy(asc(classes.name));

    const classIds = classRows.map((c) => c.classId);
    const [curAvgs, priorAvgs, schoolAgg, priorSchoolAgg] = await Promise.all([
      classAverages(tx, schoolId, term.periodId),
      prior
        ? classAverages(tx, schoolId, prior.periodId)
        : Promise.resolve(new Map<string, { avg: number | null; students: number }>()),
      scopedSchoolAggregate(tx, schoolId, term.periodId, classIds),
      prior
        ? scopedSchoolAggregate(tx, schoolId, prior.periodId, classIds)
        : Promise.resolve({ avg: null, passed: 0, graded: 0 }),
    ]);

    let hasAnyScores = false;
    let classesGraded = 0;
    const rows: ClassPerfRow[] = classRows.map((c) => {
      const cur = curAvgs.get(c.classId);
      const pr = priorAvgs.get(c.classId);
      const average = cur?.avg != null ? round1(cur.avg) : null;
      const priorAverage = pr?.avg != null ? round1(pr.avg) : null;
      if (cur && cur.students > 0) {
        hasAnyScores = true;
        classesGraded += 1;
      }
      return {
        classId: c.classId,
        name: c.name,
        teacherName: c.teacherName ?? null,
        average,
        grade: average != null ? gradeForScore(bands, average) : null,
        tone: performanceTone(average),
        priorAverage,
        delta: average != null && priorAverage != null ? round1(average - priorAverage) : null,
        studentsGraded: cur?.students ?? 0,
      };
    });
    rows.sort((a, b) => (b.average ?? -1) - (a.average ?? -1));

    const graded = rows.filter((r) => r.average != null);
    const highest = graded[0]
      ? { name: graded[0].name, average: graded[0].average!, grade: graded[0].grade }
      : null;
    const needsSupport =
      graded.length > 0
        ? {
            name: graded[graded.length - 1].name,
            average: graded[graded.length - 1].average!,
            grade: graded[graded.length - 1].grade,
          }
        : null;

    const schoolAverage = schoolAgg.avg != null ? round1(schoolAgg.avg) : null;
    const priorSchool = priorSchoolAgg.avg != null ? round1(priorSchoolAgg.avg) : null;
    // Per-score pass rate, same definition as the per-subject one in subject-performance-data.ts.
    const schoolPassRate = passRateOf(schoolAgg.passed, schoolAgg.graded);

    return {
      terms,
      term,
      priorTerm: prior,
      scoped,
      rows,
      schoolAverage,
      schoolDelta:
        schoolAverage != null && priorSchool != null ? round1(schoolAverage - priorSchool) : null,
      schoolPassRate,
      classesGraded,
      totalClasses: classRows.length,
      highest,
      needsSupport,
      hasAnyScores,
    };
  });
}
