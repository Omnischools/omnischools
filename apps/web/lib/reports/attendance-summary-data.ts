import { and, asc, eq, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { attendanceRecords, attendanceSettings, students, classes, users } from "@/db/schema";
import {
  computeAttendanceFlags,
  FLAG_THRESHOLDS,
  type FlagSeverity,
} from "@/lib/attendance-flags";
import { attendanceTone, type PerfTone } from "./grade-band";
import { listAcademicTerms, resolveSelectedTerm, previousTerm, type AcademicTerm } from "./academic-term";

/**
 * "Attendance summary" — term attendance rates by class + students needing attention
 * (Reports → Operational → Attendance summary). Rate = (PRESENT + LATE) / marked, with all
 * five statuses (P/L/E/M/A) in the denominator; needs-attention reuses `computeAttendanceFlags`
 * with the school's `attendance_settings` thresholds. Attendance is date-windowed on the term.
 */

export type StatusCounts = {
  present: number;
  late: number;
  excused: number;
  medical: number;
  absent: number;
};

export type ClassAttendanceRow = {
  classId: string;
  name: string;
  teacherName: string | null;
  rate: number | null; // (P+L)/marked, %
  tone: PerfTone;
  priorRate: number | null;
  delta: number | null;
  marked: number;
  counts: StatusCounts;
};

export type NeedsAttentionRow = {
  studentId: string;
  name: string;
  studentCode: string;
  className: string;
  rate: number | null;
  daysAbsent: number;
  severity: FlagSeverity;
  reasons: string[];
};

export type AttendanceThresholds = {
  pctWatch: number;
  pctCritical: number;
  absWatch: number;
  absCritical: number;
};

export type AttendanceSummary = {
  terms: AcademicTerm[];
  term: AcademicTerm | null;
  priorTerm: AcademicTerm | null;
  scoped: boolean;
  schoolRate: number | null;
  schoolDelta: number | null;
  totalMarked: number;
  statusTotals: StatusCounts;
  byClass: ClassAttendanceRow[];
  needsAttention: NeedsAttentionRow[];
  criticalCount: number;
  watchCount: number;
  perfectCount: number;
  thresholds: AttendanceThresholds;
  hasAnyMarks: boolean;
};

const emptyCounts = (): StatusCounts => ({
  present: 0,
  late: 0,
  excused: 0,
  medical: 0,
  absent: 0,
});
const rateOf = (c: StatusCounts): number | null => {
  const marked = c.present + c.late + c.excused + c.medical + c.absent;
  return marked > 0 ? Math.round(((c.present + c.late) / marked) * 100) : null;
};
const markedOf = (c: StatusCounts) => c.present + c.late + c.excused + c.medical + c.absent;

type Rec = {
  studentId: string;
  classId: string;
  date: string;
  status: string;
  firstName: string;
  lastName: string;
  studentCode: string;
  studentStatus: string;
  className: string;
};

function tallyStatus(counts: StatusCounts, status: string) {
  if (status === "PRESENT") counts.present += 1;
  else if (status === "LATE") counts.late += 1;
  else if (status === "EXCUSED") counts.excused += 1;
  else if (status === "MEDICAL") counts.medical += 1;
  else if (status === "ABSENT") counts.absent += 1;
}

export async function getAttendanceSummary(
  schoolId: string,
  opts: { periodId?: string; teacherUserId?: string | null } = {},
): Promise<AttendanceSummary> {
  const terms = await listAcademicTerms(schoolId);
  const term = resolveSelectedTerm(terms, opts.periodId);
  const prior = term ? previousTerm(terms, term) : null;
  const scoped = !!opts.teacherUserId;

  const base: AttendanceSummary = {
    terms,
    term,
    priorTerm: prior,
    scoped,
    schoolRate: null,
    schoolDelta: null,
    totalMarked: 0,
    statusTotals: emptyCounts(),
    byClass: [],
    needsAttention: [],
    criticalCount: 0,
    watchCount: 0,
    perfectCount: 0,
    thresholds: {
      pctWatch: FLAG_THRESHOLDS.pctWatch,
      pctCritical: FLAG_THRESHOLDS.pctCritical,
      absWatch: FLAG_THRESHOLDS.absWatch,
      absCritical: FLAG_THRESHOLDS.absCritical,
    },
    hasAnyMarks: false,
  };
  if (!term) return base;

  return withSchool(schoolId, async (tx) => {
    const [settings] = await tx
      .select({
        pctWatch: attendanceSettings.pctWatch,
        pctCritical: attendanceSettings.pctCritical,
        absWatch: attendanceSettings.absWatchDays,
        absCritical: attendanceSettings.absCriticalDays,
      })
      .from(attendanceSettings)
      .where(eq(attendanceSettings.schoolId, schoolId));
    const thresholds: AttendanceThresholds = settings ?? base.thresholds;
    const flagThresholds = { ...FLAG_THRESHOLDS, ...thresholds };

    const teacherFilter = opts.teacherUserId
      ? eq(classes.classTeacherUserId, opts.teacherUserId)
      : undefined;

    // All classes in scope (so an empty class still shows a row / rate —).
    const classRows = await tx
      .select({ classId: classes.id, name: classes.name, teacherName: users.fullName })
      .from(classes)
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
      .where(and(eq(classes.schoolId, schoolId), eq(classes.active, true), teacherFilter))
      .orderBy(asc(classes.name));

    // Current-term records, joined for the needs-attention list + per-class tally.
    const dateWindow = and(
      sql`${attendanceRecords.date} >= ${term.startsOn}::date`,
      sql`${attendanceRecords.date} <= ${term.endsOn}::date`,
    );
    const recs: Rec[] = await tx
      .select({
        studentId: attendanceRecords.studentId,
        classId: attendanceRecords.classId,
        date: attendanceRecords.date,
        status: attendanceRecords.status,
        firstName: students.firstName,
        lastName: students.lastName,
        studentCode: students.studentCode,
        studentStatus: students.status,
        className: classes.name,
      })
      .from(attendanceRecords)
      .innerJoin(
        students,
        and(
          eq(attendanceRecords.studentId, students.id),
          eq(attendanceRecords.schoolId, students.schoolId),
        ),
      )
      .innerJoin(
        classes,
        and(
          eq(attendanceRecords.classId, classes.id),
          eq(attendanceRecords.schoolId, classes.schoolId),
        ),
      )
      .where(
        and(
          eq(attendanceRecords.schoolId, schoolId),
          eq(classes.active, true),
          teacherFilter,
          dateWindow,
        ),
      );

    // Prior-term attended/marked, per class (delta) and summed for the school-wide prior rate.
    const priorRates = new Map<string, number | null>();
    let priorSchoolAttended = 0;
    let priorSchoolMarked = 0;
    if (prior) {
      const priorRows = await tx
        .select({
          classId: attendanceRecords.classId,
          attended: sql<number>`count(*) filter (where ${attendanceRecords.status} in ('PRESENT','LATE'))::int`,
          marked: sql<number>`count(*)::int`,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.schoolId, schoolId),
            sql`${attendanceRecords.date} >= ${prior.startsOn}::date`,
            sql`${attendanceRecords.date} <= ${prior.endsOn}::date`,
          ),
        )
        .groupBy(attendanceRecords.classId);
      for (const r of priorRows) {
        priorRates.set(r.classId, r.marked > 0 ? Math.round((r.attended / r.marked) * 100) : null);
        priorSchoolAttended += r.attended;
        priorSchoolMarked += r.marked;
      }
    }

    // Per-class + school-wide tallies from the loaded records.
    const perClass = new Map<string, StatusCounts>();
    const statusTotals = emptyCounts();
    for (const r of recs) {
      tallyStatus(statusTotals, r.status);
      const c = perClass.get(r.classId) ?? emptyCounts();
      tallyStatus(c, r.status);
      perClass.set(r.classId, c);
    }

    const byClass: ClassAttendanceRow[] = classRows.map((c) => {
      const counts = perClass.get(c.classId) ?? emptyCounts();
      const rate = rateOf(counts);
      const priorRate = priorRates.get(c.classId) ?? null;
      return {
        classId: c.classId,
        name: c.name,
        teacherName: c.teacherName ?? null,
        rate,
        tone: attendanceTone(rate),
        priorRate,
        delta: rate != null && priorRate != null ? rate - priorRate : null,
        marked: markedOf(counts),
        counts,
      };
    });

    // Needs-attention — reuse the shared flag engine; scope to ACTIVE students.
    const flagsByStudent = computeAttendanceFlags(
      recs.map((r) => ({ studentId: r.studentId, date: r.date, status: r.status })),
      flagThresholds,
    );
    const studentMeta = new Map<string, Rec>();
    for (const r of recs) if (!studentMeta.has(r.studentId)) studentMeta.set(r.studentId, r);

    const needsAttention: NeedsAttentionRow[] = [];
    let perfectCount = 0;
    for (const [studentId, f] of Array.from(flagsByStudent)) {
      const meta = studentMeta.get(studentId);
      if (!meta || meta.studentStatus !== "ACTIVE") continue;
      const daysAbsent = recs.filter(
        (r) => r.studentId === studentId && r.status === "ABSENT",
      ).length;
      if (f.worst) {
        needsAttention.push({
          studentId,
          name: `${meta.firstName} ${meta.lastName}`,
          studentCode: meta.studentCode,
          className: meta.className,
          rate: f.termPct,
          daysAbsent,
          severity: f.worst,
          reasons: f.flags.map((fl) => fl.label),
        });
      } else if (f.total > 0 && daysAbsent === 0) {
        perfectCount += 1;
      }
    }
    const sevRank = (s: FlagSeverity) => (s === "CRITICAL" ? 0 : 1);
    needsAttention.sort(
      (a, b) => sevRank(a.severity) - sevRank(b.severity) || (a.rate ?? 0) - (b.rate ?? 0),
    );

    const schoolRate = rateOf(statusTotals);
    const priorSchool =
      priorSchoolMarked > 0 ? Math.round((priorSchoolAttended / priorSchoolMarked) * 100) : null;

    return {
      terms,
      term,
      priorTerm: prior,
      scoped,
      schoolRate,
      schoolDelta: schoolRate != null && priorSchool != null ? schoolRate - priorSchool : null,
      totalMarked: markedOf(statusTotals),
      statusTotals,
      byClass,
      needsAttention,
      criticalCount: needsAttention.filter((n) => n.severity === "CRITICAL").length,
      watchCount: needsAttention.filter((n) => n.severity === "WATCHING").length,
      perfectCount,
      thresholds,
      hasAnyMarks: markedOf(statusTotals) > 0,
    };
  });
}
