import "server-only";
import { getSchoolRollup, type AttendanceClassRow, type SchoolRollup } from "@/lib/rollup/school-rollup";
import {
  getClassPerformance,
  getLevelPerformance,
  compareLevelLabel,
  UNSPECIFIED_LEVEL,
  type ClassPerformance,
  type LevelPerformance,
} from "@/lib/reports/class-performance-data";
import {
  getSubjectPerformance,
  type SubjectPerformance,
} from "@/lib/reports/subject-performance-data";
import { getCensusEnrolment, type CensusEnrolment } from "@/lib/reports/census-enrolment-data";

/**
 * INS · the Directors' Insights composition seam. Server-only, ZERO SQL beyond the readers it awaits
 * (the one net-new query is `getLevelPerformance`); it re-serves the AGGREGATE projections that already
 * ship behind `/board` and `/reports` plus the by-level attendance fold, and returns an
 * AGGREGATE-ONLY bundle. This is the structural enforcement point for the owner-stated hard invariant
 * (INS-23): the `DirectorsInsights` type contains NO student-identifying field (name / id / code /
 * DOB) — every member is class / year-group (level) / subject / age-band keyed.
 *
 * TRAP (INS-22, the one hard reuse trap): this seam MUST NEVER call `getAttendanceSummary` — it returns
 * `needsAttention[]` carrying `studentId` / student `name` / `studentCode` (PII). Attendance here comes
 * from `rollup.attendance` (already PII-stripped by the rollup) and is folded by level below.
 */

/** One folded year-group attendance row — the lossless integer sum of its member classes (INS-14). */
export type InsightsAttendanceLevelRow = {
  level: string;
  rate: number | null; // (ΣP+ΣL)/Σmarked, recomputed — NOT an average of class rates
  marked: number;
  counts: { present: number; late: number; excused: number; medical: number; absent: number };
};

export type DirectorsInsights = {
  rollup: SchoolRollup;
  classPerf: ClassPerformance;
  subjectPerf: SubjectPerformance;
  levelPerf: LevelPerformance;
  census: CensusEnrolment;
  /** Attendance folded by year-group; empty when the attendance arm is not CAPTURED. */
  attendanceByLevel: InsightsAttendanceLevelRow[];
};

/**
 * PURE lossless fold of the PII-stripped `AttendanceClassRow[]` to year-group grain (INS-14). Sums the
 * five P/L/E/M/A counts + `marked` per level and RECOMPUTES `rate = round((ΣP+ΣL)/Σmarked·100)` — the
 * board's own rate definition over the summed counts, never a mean of class rates. A class whose id is
 * not in `levelByClassId` folds under `"Unspecified"` (honest). No DB → unit-tested directly.
 */
export function foldAttendanceByLevel(
  byClass: readonly AttendanceClassRow[],
  levelByClassId: ReadonlyMap<string, string>,
): InsightsAttendanceLevelRow[] {
  const acc = new Map<
    string,
    { marked: number; counts: InsightsAttendanceLevelRow["counts"] }
  >();
  for (const c of byClass) {
    const level = levelByClassId.get(c.classId) ?? UNSPECIFIED_LEVEL;
    const a =
      acc.get(level) ??
      { marked: 0, counts: { present: 0, late: 0, excused: 0, medical: 0, absent: 0 } };
    a.marked += c.marked;
    a.counts.present += c.counts.present;
    a.counts.late += c.counts.late;
    a.counts.excused += c.counts.excused;
    a.counts.medical += c.counts.medical;
    a.counts.absent += c.counts.absent;
    acc.set(level, a);
  }
  return [...acc.entries()]
    .map(([level, a]) => ({
      level,
      marked: a.marked,
      counts: a.counts,
      rate:
        a.marked > 0 ? Math.round(((a.counts.present + a.counts.late) / a.marked) * 100) : null,
    }))
    .sort((x, y) => compareLevelLabel(x.level, y.level));
}

export async function getDirectorsInsights(
  schoolId: string,
  opts: { periodId?: string } = {},
): Promise<DirectorsInsights> {
  const [rollup, classPerf, subjectPerf, levelPerf, census] = await Promise.all([
    getSchoolRollup(schoolId, { periodId: opts.periodId }),
    getClassPerformance(schoolId, { periodId: opts.periodId }),
    getSubjectPerformance(schoolId, { periodId: opts.periodId }),
    getLevelPerformance(schoolId, { periodId: opts.periodId }),
    // Enrolment / gender / age are a point-in-time census snapshot (ACTIVE-only, un-windowed) — they
    // do NOT move with the term selector; the surface labels them as-of `census.censusDate`.
    getCensusEnrolment(schoolId),
  ]);

  // classId → year-group level, from the census by-class rows (which carry `level`).
  const levelByClassId = new Map<string, string>();
  for (const c of census.byClass) levelByClassId.set(c.classId, c.level ?? UNSPECIFIED_LEVEL);

  const attendanceByLevel =
    rollup.attendance.status === "CAPTURED"
      ? foldAttendanceByLevel(rollup.attendance.data.byClass, levelByClassId)
      : [];

  return { rollup, classPerf, subjectPerf, levelPerf, census, attendanceByLevel };
}
