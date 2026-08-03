import "server-only";
import {
  listAcademicTerms,
  resolveSelectedTerm,
  type AcademicTerm,
} from "@/lib/reports/academic-term";
import { getSchoolStats } from "@/lib/reports/school-stats-data";
import { getEnrolmentRoll } from "@/lib/reports/enrolment-roll-data";
import { getAttendanceSummary } from "@/lib/reports/attendance-summary-data";
import { getFinanceReport } from "@/lib/reports/finance-data";

/**
 * GOV-1 · the shared `school-rollup` aggregate seam — the spine both the board/director overview
 * and the GES census build against (governance-census-build-plan.md).
 *
 * Pure read/aggregate. It owns ZERO SQL: it composes four shipped `withSchool`-scoped report data
 * functions and re-exposes their figures FAITHFULLY — it never recomputes a number (the one
 * exception, `lifetimeExits`, is a re-sum of `getSchoolStats`'s own three exit fields; see below).
 *
 * Honesty convention (omit-not-fake): each arm is CAPTURED with data, or NOT_CAPTURED with a reason
 * string — never a fabricated zero. A true zero (fees billed, GHS 0 collected) IS captured. GOV-1
 * never emits NOT_APPLICABLE (reserved for later tier-gated arms).
 */

export type RollupArm<T> =
  | { status: "CAPTURED"; data: T }
  | { status: "NOT_CAPTURED"; reason: string }
  | { status: "NOT_APPLICABLE"; reason: string };

export type RollupGender = {
  female: number;
  male: number;
  total: number;
  femalePct: number;
  malePct: number;
};

export type EnrolmentClassRow = {
  classId: string;
  name: string;
  enrolled: number;
  femaleCount: number;
  maleCount: number;
};

export type EnrolmentArm = {
  // Point-in-time (getSchoolStats) — populate even when period == null.
  roll: number;
  gender: RollupGender;
  activeClasses: number;
  avgClassSize: number;
  teachingStaff: number;
  studentTeacherRatio: number | null;
  levelSummary: string;
  byClass: EnrolmentClassRow[];
  // Term-windowed (getEnrolmentRoll, NOT stats) — null when period == null, never 0.
  admissionsThisTerm: number | null;
  intakeFemale: number | null;
  intakeMale: number | null;
  netChange: number | null;
  // Lifetime totals (labelled lifetime — cumulative, period-independent).
  withdrew: number;
  transferred: number;
  graduated: number;
  lifetimeExits: number;
};

export type AttendanceStatusTotals = {
  present: number;
  late: number;
  excused: number;
  medical: number;
  absent: number;
};

export type AttendanceClassRow = {
  classId: string;
  name: string;
  rate: number | null;
  marked: number;
  counts: AttendanceStatusTotals;
};

export type AttendanceArm = {
  schoolRate: number | null;
  schoolDelta: number | null;
  totalMarked: number;
  statusTotals: AttendanceStatusTotals;
  byClass: AttendanceClassRow[];
};

export type FeeCollectionsArm = {
  billed: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
};

export type SchoolRollup = {
  schoolId: string;
  period: AcademicTerm | null;
  generatedAt: Date;
  enrolment: RollupArm<EnrolmentArm>;
  attendance: RollupArm<AttendanceArm>;
  feeCollections: RollupArm<FeeCollectionsArm>;
};

/** How the shipped report pages render a term: "Term 1 · 2025/26" (lib/reports/period.ts). */
const termDisplay = (t: AcademicTerm) => `${t.label} · ${t.academicYear}`;

export async function getSchoolRollup(
  schoolId: string,
  opts?: { periodId?: string },
): Promise<SchoolRollup> {
  const generatedAt = new Date();

  // Resolve ONE term (omitted → current/latest; SENIOR_F3 pseudo-period excluded by the source).
  const terms = await listAcademicTerms(schoolId);
  const period = resolveSelectedTerm(terms, opts?.periodId);

  // Finance window from the resolved term: [startsOn T00:00Z, endsOn T00:00Z + 1 day) — half-open,
  // so invoices issued on the last day of term are included.
  let financeWindow: { start: Date; end: Date } | null = null;
  if (period) {
    const start = new Date(`${period.startsOn}T00:00:00.000Z`);
    const end = new Date(`${period.endsOn}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    financeWindow = { start, end };
  }

  const [stats, roll, attendance, finance] = await Promise.all([
    getSchoolStats(schoolId),
    getEnrolmentRoll(schoolId, { periodId: opts?.periodId }),
    period ? getAttendanceSummary(schoolId, { periodId: opts?.periodId }) : null,
    financeWindow ? getFinanceReport(schoolId, null, financeWindow) : null,
  ]);

  // ── enrolment ─────────────────────────────────────────────────────────────────────────────────
  const enrolment: RollupArm<EnrolmentArm> =
    stats.totalStudents > 0
      ? {
          status: "CAPTURED",
          data: {
            roll: stats.totalStudents,
            gender: stats.gender,
            activeClasses: stats.activeClasses,
            avgClassSize: stats.avgClassSize,
            teachingStaff: stats.teachingStaff,
            studentTeacherRatio: stats.studentTeacherRatio,
            levelSummary: stats.levelSummary,
            byClass: stats.byClass.map((c) => ({
              classId: c.classId,
              name: c.name,
              enrolled: c.enrolled,
              femaleCount: c.femaleCount,
              maleCount: c.maleCount,
            })),
            // Term-windowed → null (not 0) when there is no period to measure.
            admissionsThisTerm: period ? roll.admissionsThisTerm : null,
            intakeFemale: period ? roll.intakeFemale : null,
            intakeMale: period ? roll.intakeMale : null,
            // netChange MUST be the enrolment-roll's term-scoped value, never stats' mixed-scope one.
            netChange: period ? roll.netChange : null,
            // Lifetime exits: cumulative, so read from stats (populated even when period == null).
            withdrew: stats.enrolmentFlow.withdrew,
            transferred: stats.enrolmentFlow.transferred,
            graduated: stats.enrolmentFlow.graduated,
            lifetimeExits:
              stats.enrolmentFlow.withdrew +
              stats.enrolmentFlow.transferred +
              stats.enrolmentFlow.graduated,
          },
        }
      : { status: "NOT_CAPTURED", reason: "No students currently enrolled." };

  // ── attendance ────────────────────────────────────────────────────────────────────────────────
  const attendanceArm: RollupArm<AttendanceArm> =
    !period || !attendance
      ? { status: "NOT_CAPTURED", reason: "No academic period configured." }
      : attendance.totalMarked === 0
        ? {
            status: "NOT_CAPTURED",
            reason: `No attendance marked for ${termDisplay(period)}.`,
          }
        : {
            status: "CAPTURED",
            data: {
              // Aggregate-only re-exposure — no needsAttention/criticalCount/thresholds (PII/ops).
              schoolRate: attendance.schoolRate,
              schoolDelta: attendance.schoolDelta,
              totalMarked: attendance.totalMarked,
              statusTotals: attendance.statusTotals,
              byClass: attendance.byClass.map((c) => ({
                classId: c.classId,
                name: c.name,
                rate: c.rate,
                marked: c.marked,
                counts: c.counts,
              })),
            },
          };

  // ── feeCollections ────────────────────────────────────────────────────────────────────────────
  const feeCollections: RollupArm<FeeCollectionsArm> =
    !period || !finance
      ? { status: "NOT_CAPTURED", reason: "No academic period configured." }
      : Number(finance.totals?.invoiceCount ?? 0) === 0
        ? {
            status: "NOT_CAPTURED",
            reason: `No fees billed for ${termDisplay(period)}.`,
          }
        : {
            // A true zero (fees billed, nothing yet collected) is CAPTURED, not hidden.
            status: "CAPTURED",
            data: {
              billed: finance.billed,
              collected: finance.collected,
              outstanding: finance.outstanding,
              collectionRate: finance.rate,
            },
          };

  return { schoolId, period, generatedAt, enrolment, attendance: attendanceArm, feeCollections };
}
