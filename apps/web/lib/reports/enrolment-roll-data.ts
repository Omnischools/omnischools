import { and, asc, eq, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { students, classes, users } from "@/db/schema";
import { listAcademicTerms, resolveSelectedTerm, previousTerm, type AcademicTerm } from "./academic-term";

/**
 * "Enrolment & roll" — admissions this term and the current roll, with lifetime exits
 * (Reports → Operational → Enrolment & roll). Admissions are term-windowed via
 * `students.enrolledOn` (as school-stats does); exits (withdrew/transferred/graduated) have no
 * status-change timestamp in the schema, so they are LIFETIME totals, labelled honestly — never
 * term deltas. Net change is admissions-only (the only genuinely term-scoped leg). Admin surface.
 */

export type EnrolmentClassRow = {
  classId: string;
  name: string;
  teacherName: string | null;
  admitted: number;
  female: number;
  male: number;
  currentSize: number;
  priorAdmitted: number | null;
  delta: number | null;
};

export type EnrolmentRoll = {
  terms: AcademicTerm[];
  term: AcademicTerm | null;
  priorTerm: AcademicTerm | null;
  currentRoll: number; // ACTIVE headcount
  admissionsThisTerm: number;
  priorAdmissions: number | null;
  intakeFemale: number;
  intakeMale: number;
  withdrew: number;
  transferred: number;
  graduated: number;
  lifetimeExits: number;
  netChange: number; // = admissionsThisTerm (honest, term-scoped)
  byClass: EnrolmentClassRow[];
  hasAnyStudents: boolean;
};

/** Count of students admitted (enrolledOn) within a term window. */
async function admissionsIn(
  tx: Parameters<Parameters<typeof withSchool>[1]>[0],
  schoolId: string,
  term: AcademicTerm,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(students)
    .where(
      and(
        eq(students.schoolId, schoolId),
        sql`${students.enrolledOn} >= ${term.startsOn}::date`,
        sql`${students.enrolledOn} <= ${term.endsOn}::date`,
      ),
    );
  return row?.count ?? 0;
}

export async function getEnrolmentRoll(
  schoolId: string,
  opts: { periodId?: string } = {},
): Promise<EnrolmentRoll> {
  const terms = await listAcademicTerms(schoolId);
  const term = resolveSelectedTerm(terms, opts.periodId);
  const prior = term ? previousTerm(terms, term) : null;

  const base: EnrolmentRoll = {
    terms,
    term,
    priorTerm: prior,
    currentRoll: 0,
    admissionsThisTerm: 0,
    priorAdmissions: null,
    intakeFemale: 0,
    intakeMale: 0,
    withdrew: 0,
    transferred: 0,
    graduated: 0,
    lifetimeExits: 0,
    netChange: 0,
    byClass: [],
    hasAnyStudents: false,
  };
  if (!term) return base;

  return withSchool(schoolId, async (tx) => {
    // Lifetime status counts (as school-stats-data).
    const statusRows = await tx
      .select({ status: students.status, count: sql<number>`count(*)::int` })
      .from(students)
      .where(eq(students.schoolId, schoolId))
      .groupBy(students.status);
    const statusCount = (s: string) => statusRows.find((r) => r.status === s)?.count ?? 0;
    const currentRoll = statusCount("ACTIVE");
    const withdrew = statusCount("WITHDRAWN");
    const transferred = statusCount("TRANSFERRED");
    const graduated = statusCount("GRADUATED");
    const totalStudents = statusRows.reduce((a, r) => a + r.count, 0);

    // Intake this term by sex (+ prior term total for the delta).
    const intakeRows = await tx
      .select({ sex: students.sex, count: sql<number>`count(*)::int` })
      .from(students)
      .where(
        and(
          eq(students.schoolId, schoolId),
          sql`${students.enrolledOn} >= ${term.startsOn}::date`,
          sql`${students.enrolledOn} <= ${term.endsOn}::date`,
        ),
      )
      .groupBy(students.sex);
    const intakeFemale = intakeRows.find((r) => r.sex === "FEMALE")?.count ?? 0;
    const intakeMale = intakeRows.find((r) => r.sex === "MALE")?.count ?? 0;
    const admissionsThisTerm = intakeFemale + intakeMale;
    const priorAdmissions = prior ? await admissionsIn(tx, schoolId, prior) : null;

    // Per-class: admissions this term (by sex) + current ACTIVE size.
    const classRows = await tx
      .select({ classId: classes.id, name: classes.name, teacherName: users.fullName })
      .from(classes)
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
      .where(and(eq(classes.schoolId, schoolId), eq(classes.active, true)))
      .orderBy(asc(classes.name));

    const admittedByClass = await tx
      .select({
        classId: students.classId,
        female: sql<number>`count(*) filter (where ${students.sex} = 'FEMALE')::int`,
        male: sql<number>`count(*) filter (where ${students.sex} = 'MALE')::int`,
      })
      .from(students)
      .where(
        and(
          eq(students.schoolId, schoolId),
          sql`${students.enrolledOn} >= ${term.startsOn}::date`,
          sql`${students.enrolledOn} <= ${term.endsOn}::date`,
        ),
      )
      .groupBy(students.classId);
    const admittedMap = new Map(admittedByClass.map((r) => [r.classId, r]));

    const activeByClass = await tx
      .select({ classId: students.classId, count: sql<number>`count(*)::int` })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")))
      .groupBy(students.classId);
    const activeMap = new Map(activeByClass.map((r) => [r.classId, r.count]));

    const priorAdmittedByClass = new Map<string, number>();
    if (prior) {
      const rows = await tx
        .select({ classId: students.classId, count: sql<number>`count(*)::int` })
        .from(students)
        .where(
          and(
            eq(students.schoolId, schoolId),
            sql`${students.enrolledOn} >= ${prior.startsOn}::date`,
            sql`${students.enrolledOn} <= ${prior.endsOn}::date`,
          ),
        )
        .groupBy(students.classId);
      for (const r of rows) if (r.classId) priorAdmittedByClass.set(r.classId, r.count);
    }

    const byClass: EnrolmentClassRow[] = classRows.map((c) => {
      const a = admittedMap.get(c.classId);
      const admitted = (a?.female ?? 0) + (a?.male ?? 0);
      const priorAdmitted = prior ? (priorAdmittedByClass.get(c.classId) ?? 0) : null;
      return {
        classId: c.classId,
        name: c.name,
        teacherName: c.teacherName ?? null,
        admitted,
        female: a?.female ?? 0,
        male: a?.male ?? 0,
        currentSize: activeMap.get(c.classId) ?? 0,
        priorAdmitted,
        delta: priorAdmitted != null ? admitted - priorAdmitted : null,
      };
    });
    byClass.sort((x, y) => y.admitted - x.admitted);

    return {
      terms,
      term,
      priorTerm: prior,
      currentRoll,
      admissionsThisTerm,
      priorAdmissions,
      intakeFemale,
      intakeMale,
      withdrew,
      transferred,
      graduated,
      lifetimeExits: withdrew + transferred + graduated,
      netChange: admissionsThisTerm,
      byClass,
      hasAnyStudents: totalStudents > 0,
    };
  });
}
