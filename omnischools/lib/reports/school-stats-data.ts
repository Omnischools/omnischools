import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { academicPeriod, classes, roleAssignments, roles, students, users } from "@/db/schema";

/**
 * "School at a glance" aggregates for Reports → School stats → At a glance.
 *
 * Every figure is derived truthfully from real rows. Headcount, gender and class
 * composition are point-in-time counts of ACTIVE students. The enrolment-flow
 * exits (withdrew / transferred / graduated) are LIFETIME totals — there is no
 * status-change timestamp in the schema yet, so they cannot be term-scoped. Only
 * `joinedThisTerm` (via `enrolledOn`) is genuinely term-windowed; the page must
 * label the exits honestly as current totals, not term deltas.
 */

const round = (n: number) => Math.round(n);

/** Parse a Postgres `date` ("YYYY-MM-DD") as a UTC-midnight Date. */
function parseDate(d: string | Date): Date {
  if (d instanceof Date) return d;
  return new Date(`${d}T00:00:00.000Z`);
}

/** Format a Date as a Postgres `date` literal for an inclusive bound. */
function toDateLiteral(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type CapacityFlag = "Under" | "Ok" | "Full" | "Over";

export type ClassComposition = {
  classId: string;
  name: string;
  level: string | null;
  teacherName: string | null;
  enrolled: number;
  targetCapacity: number | null;
  utilisationPct: number | null;
  femaleCount: number;
  maleCount: number;
  flag: CapacityFlag | null;
};

export type SchoolStatsTerm = {
  academicYear: string;
  periodLabel: string;
  periodNumber: number;
  startsOn: Date;
  endsOn: Date;
};

export type SchoolStats = {
  snapshotAt: Date;
  hasTerm: boolean;
  term: SchoolStatsTerm | null;
  // Headcount KPIs
  totalStudents: number;
  joinedThisTerm: number;
  teachingStaff: number;
  studentTeacherRatio: number | null;
  activeClasses: number;
  avgClassSize: number;
  classSizeMin: number;
  classSizeMax: number;
  levelSummary: string;
  // Composition
  byClass: ClassComposition[];
  // Gender (school-wide, ACTIVE)
  gender: {
    female: number;
    male: number;
    total: number;
    femalePct: number;
    malePct: number;
  };
  // Enrolment flow (see honesty note above)
  enrolmentFlow: {
    newAdmissions: number;
    withdrew: number;
    transferred: number;
    graduated: number;
    netChange: number;
  };
};

/** Derive the capacity flag — only meaningful when a target is set. */
function deriveFlag(utilisationPct: number | null): CapacityFlag | null {
  if (utilisationPct == null) return null;
  if (utilisationPct < 90) return "Under";
  if (utilisationPct > 110) return "Over";
  return utilisationPct < 100 ? "Ok" : "Full";
}

/** Build a short "JHS 1, 2, 3" style summary from distinct class levels. */
function summariseLevels(levels: (string | null)[]): string {
  const seen = Array.from(new Set(levels.filter((l): l is string => !!l)));
  if (seen.length === 0) return "—";
  return seen.join(" · ");
}

export async function getSchoolStats(schoolId: string): Promise<SchoolStats> {
  const snapshotAt = new Date();

  return withSchool(schoolId, async (tx) => {
    // ---- Term context ------------------------------------------------------
    const periodRows = await tx
      .select({
        academicYear: academicPeriod.academicYear,
        periodNumber: academicPeriod.periodNumber,
        periodLabel: academicPeriod.periodLabel,
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
      })
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, schoolId))
      .orderBy(asc(academicPeriod.academicYear), asc(academicPeriod.periodNumber));

    const terms: SchoolStatsTerm[] = periodRows.map((r) => ({
      academicYear: r.academicYear,
      periodNumber: r.periodNumber,
      periodLabel: r.periodLabel,
      startsOn: parseDate(r.startsOn),
      endsOn: parseDate(r.endsOn),
    }));

    // current term = window containing today; else latest startsOn <= today; else last
    let currentIdx = terms.findIndex(
      (t) => +t.startsOn <= +snapshotAt && +snapshotAt <= +t.endsOn,
    );
    if (currentIdx === -1) {
      for (let i = terms.length - 1; i >= 0; i--) {
        if (+terms[i].startsOn <= +snapshotAt) {
          currentIdx = i;
          break;
        }
      }
    }
    if (currentIdx === -1 && terms.length > 0) currentIdx = terms.length - 1;

    const term = currentIdx >= 0 ? terms[currentIdx] : null;
    const hasTerm = !!term;

    // ---- Status counts (lifetime; ACTIVE is the live headcount) ------------
    const statusRows = await tx
      .select({
        status: students.status,
        count: sql<number>`count(*)::int`,
      })
      .from(students)
      .where(eq(students.schoolId, schoolId))
      .groupBy(students.status);

    const statusCount = (s: string) =>
      statusRows.find((r) => r.status === s)?.count ?? 0;
    const totalStudents = statusCount("ACTIVE");
    const withdrew = statusCount("WITHDRAWN");
    const transferred = statusCount("TRANSFERRED");
    const graduated = statusCount("GRADUATED");

    // ---- Joined this term (term-scoped via enrolledOn) ---------------------
    let joinedThisTerm = 0;
    if (term) {
      const fromLit = toDateLiteral(term.startsOn);
      const toLit = toDateLiteral(snapshotAt);
      const joinedRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(students)
        .where(
          and(
            eq(students.schoolId, schoolId),
            eq(students.status, "ACTIVE"),
            sql`${students.enrolledOn} >= ${fromLit}::date`,
            sql`${students.enrolledOn} <= ${toLit}::date`,
          ),
        );
      joinedThisTerm = joinedRows[0]?.count ?? 0;
    }

    // ---- Teaching staff (distinct users w/ active teacher role assignment) -
    const staffRows = await tx
      .select({ count: sql<number>`count(distinct ${roleAssignments.userId})::int` })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.schoolId, schoolId),
          isNull(roleAssignments.endDate),
          sql`(${roles.code} ilike '%TEACHER%' or ${roles.label} ilike '%teacher%')`,
        ),
      );
    const teachingStaff = staffRows[0]?.count ?? 0;
    const studentTeacherRatio =
      teachingStaff > 0 ? round(totalStudents / teachingStaff) : null;

    // ---- Active classes + per-class composition ----------------------------
    const classRows = await tx
      .select({
        classId: classes.id,
        name: classes.name,
        level: classes.level,
        targetCapacity: classes.targetCapacity,
        teacherName: users.fullName,
      })
      .from(classes)
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
      .where(and(eq(classes.schoolId, schoolId), eq(classes.active, true)))
      .orderBy(asc(classes.name));

    const activeClasses = classRows.length;

    // Per-class ACTIVE student counts split by sex (single grouped query).
    const perClassRows = await tx
      .select({
        classId: students.classId,
        sex: students.sex,
        count: sql<number>`count(*)::int`,
      })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")))
      .groupBy(students.classId, students.sex);

    const enrolledByClass = new Map<string, { female: number; male: number }>();
    for (const r of perClassRows) {
      if (!r.classId) continue;
      const e = enrolledByClass.get(r.classId) ?? { female: 0, male: 0 };
      if (r.sex === "FEMALE") e.female += r.count;
      else if (r.sex === "MALE") e.male += r.count;
      enrolledByClass.set(r.classId, e);
    }

    const byClass: ClassComposition[] = classRows.map((c) => {
      const e = enrolledByClass.get(c.classId) ?? { female: 0, male: 0 };
      const enrolled = e.female + e.male;
      const target = c.targetCapacity ?? null;
      const utilisationPct =
        target && target > 0 ? round((enrolled / target) * 100) : null;
      return {
        classId: c.classId,
        name: c.name,
        level: c.level,
        teacherName: c.teacherName ?? null,
        enrolled,
        targetCapacity: target,
        utilisationPct,
        femaleCount: e.female,
        maleCount: e.male,
        flag: deriveFlag(utilisationPct),
      };
    });

    // Avg / min / max over classes that actually hold ≥1 active student.
    const sizes = byClass.filter((c) => c.enrolled > 0).map((c) => c.enrolled);
    const populatedCount = sizes.length;
    const avgClassSize =
      populatedCount > 0 ? round(totalStudents / populatedCount) : 0;
    const classSizeMin = populatedCount > 0 ? Math.min(...sizes) : 0;
    const classSizeMax = populatedCount > 0 ? Math.max(...sizes) : 0;
    const levelSummary = summariseLevels(classRows.map((c) => c.level));

    // ---- Gender (school-wide, ACTIVE) --------------------------------------
    const genderRows = await tx
      .select({
        sex: students.sex,
        count: sql<number>`count(*)::int`,
      })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")))
      .groupBy(students.sex);

    const female = genderRows.find((r) => r.sex === "FEMALE")?.count ?? 0;
    const male = genderRows.find((r) => r.sex === "MALE")?.count ?? 0;
    const genderTotal = female + male;
    const femalePct = genderTotal > 0 ? round((female / genderTotal) * 100) : 0;
    const malePct = genderTotal > 0 ? round((male / genderTotal) * 100) : 0;

    // ---- Enrolment flow ----------------------------------------------------
    const newAdmissions = joinedThisTerm;
    const netChange = newAdmissions - (withdrew + transferred);

    return {
      snapshotAt,
      hasTerm,
      term,
      totalStudents,
      joinedThisTerm,
      teachingStaff,
      studentTeacherRatio,
      activeClasses,
      avgClassSize,
      classSizeMin,
      classSizeMax,
      levelSummary,
      byClass,
      gender: {
        female,
        male,
        total: genderTotal,
        femalePct,
        malePct,
      },
      enrolmentFlow: {
        newAdmissions,
        withdrew,
        transferred,
        graduated,
        netChange,
      },
    } satisfies SchoolStats;
  });
}
