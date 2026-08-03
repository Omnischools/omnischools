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
import { getBooksFinanceLine } from "@/lib/reports/books-finance-data";
import { getPayrollLine } from "@/lib/reports/payroll-line-data";
import { getClassPerformance } from "@/lib/reports/class-performance-data";
import {
  getSeniorReadiness,
  type SeniorReadinessSummary,
} from "@/lib/reports/senior-readiness-data";
import { getSchoolType } from "@/lib/reports/school-type-data";

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

/**
 * GOV-3 · the net-position finance arm (R341–R348) — THE HONESTY INVARIANT.
 *
 * Fees (the billing engine) and `books` are SEPARATE, un-reconciled ledgers with NO dedup — the
 * compensation page even feeds school-paid salaries into the books' salaries line, so there are TWO
 * double-count paths. We therefore present THREE DISTINCT labelled streams and NEVER a single summed
 * "net position"/"profit"/"surplus" scalar. No field here sums across ≥2 of {fees, books, payroll};
 * the ONLY permitted composite is `books.net = income − expense`, WITHIN the one books ledger.
 */
export type NetPositionFinanceArm = {
  fees: RollupArm<FeeCollectionsArm>;
  books: RollupArm<BooksFinanceLine>;
  payroll: RollupArm<PayrollLine>;
};

/** The ONLY cross-line composite in the whole arm: net is a subtraction WITHIN the books ledger. */
export type BooksFinanceLine = { income: number; expense: number; net: number };

export type PayrollLine = {
  schoolPaidMonthlyTotal: number;
  schoolPaidStaffCount: number;
  gesPaidMonthlyMemo: number;
  gesPaidStaffCount: number;
  allowanceMonthlyMemo: number;
  allowanceStaffCount: number;
  cadence: "MONTHLY";
};

/**
 * GOV-4 · the cross-tier academic-performance arm (R352–R357). An UNWRAPPED container — NOT itself a
 * `RollupArm` — so each tier is honest-absence-gated on its OWN, and a COMBINED school can show a
 * captured Basic average beside a not-captured Senior readiness without one masking the other (R352).
 * There is NO blended composite across the two tiers — no field sums or averages Basic and Senior
 * together (R357): they are different measures (a mark-average vs a completion-count) and combining
 * them would fabricate a meaningless number.
 */
export type PerformanceArm = {
  basic: RollupArm<BasicPerformanceSummary>;
  senior: RollupArm<SeniorReadinessSummary>;
};

/**
 * Basic-tier gradebook standing (R353) — AGGREGATE ONLY. The school-wide average of the pre-weighted
 * `gradebook_score.total`, its term-on-term delta, and how many classes are graded. No `rows[]`, no
 * teacher names, no `gradedClasses/totalClasses` FRACTION (a fraction reads as "40% of classes are
 * graded", which is dishonest in a COMBINED school where the Senior classes have no gradebook — R353 /
 * GOV4-09). `overallGrade` is optional and deliberately omitted here: `getClassPerformance` exposes no
 * school-average grade letter, so sourcing one would need a second query (R362-c — omit-not-fake).
 */
export type BasicPerformanceSummary = {
  overallAverage: number | null;
  overallDelta: number | null;
  gradedClasses: number;
  overallGrade?: string | null;
};

export type { SeniorReadinessSummary };

/**
 * GOV-4 · a capability NOT YET BUILT (R358). `RollupArm<never>` — the payload is `never`, so a
 * CAPTURED arm is a COMPILE ERROR: this arm can only ever be NOT_CAPTURED, and can never fabricate a
 * number. GOV-6 (terminal BECE/WASSCE results) and GOV-7 (facilities) replace the body later; until
 * then the board sees a deliberate, forward-looking "coming soon", never a zero.
 */
export type PendingArm = RollupArm<never>;

export type SchoolRollup = {
  schoolId: string;
  period: AcademicTerm | null;
  generatedAt: Date;
  enrolment: RollupArm<EnrolmentArm>;
  attendance: RollupArm<AttendanceArm>;
  feeCollections: RollupArm<FeeCollectionsArm>;
  netPositionFinance: RollupArm<NetPositionFinanceArm>;
  // GOV-4 additions.
  performance: PerformanceArm;
  terminalResults: PendingArm;
  infrastructure: PendingArm;
  /** Every real term (newest-first) so the board's period selector needs no second query. */
  terms: AcademicTerm[];
};

/** How the shipped report pages render a term: "Term 1 · 2025/26" (lib/reports/period.ts). */
const termDisplay = (t: AcademicTerm) => `${t.label} · ${t.academicYear}`;

export async function getSchoolRollup(
  schoolId: string,
  opts?: { periodId?: string },
): Promise<SchoolRollup> {
  const generatedAt = new Date();

  // Resolve ONE term (omitted → current/latest; SENIOR_F3 pseudo-period excluded by the source).
  // schoolType is DB-authoritative (R355) and drives tier-gating — fetched alongside the terms, both
  // independent of the resolved period.
  const [terms, schoolType] = await Promise.all([
    listAcademicTerms(schoolId),
    getSchoolType(schoolId),
  ]);
  const period = resolveSelectedTerm(terms, opts?.periodId);

  // Tier-gate BEFORE period-gate (R355): a BASIC school never computes Senior readiness even to know
  // there's no period — its Senior arm is NOT_APPLICABLE, not NOT_CAPTURED. So only fetch a tier's
  // source when the tier applies AND a period frames it.
  const wantBasic = schoolType !== "SENIOR" && !!period;
  const wantSenior = schoolType !== "BASIC" && !!period;

  // Finance window from the resolved term: [startsOn T00:00Z, endsOn T00:00Z + 1 day) — half-open,
  // so invoices issued on the last day of term are included.
  let financeWindow: { start: Date; end: Date } | null = null;
  if (period) {
    const start = new Date(`${period.startsOn}T00:00:00.000Z`);
    const end = new Date(`${period.endsOn}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    financeWindow = { start, end };
  }

  const [stats, roll, attendance, finance, books, payroll, classPerf, seniorReadiness] =
    await Promise.all([
      getSchoolStats(schoolId),
      getEnrolmentRoll(schoolId, { periodId: opts?.periodId }),
      period ? getAttendanceSummary(schoolId, { periodId: opts?.periodId }) : null,
      financeWindow ? getFinanceReport(schoolId, null, financeWindow) : null,
      // Books is term-windowed; payroll is point-in-time but only needed once a period frames the arm.
      period ? getBooksFinanceLine(schoolId, { startsOn: period.startsOn, endsOn: period.endsOn }) : null,
      period ? getPayrollLine(schoolId) : null,
      // Performance sources — pinned to the RESOLVED period's id (not opts.periodId) so the tile can
      // never read a different term than the rest of the rollup (GOV4-18).
      wantBasic ? getClassPerformance(schoolId, { periodId: period!.periodId, teacherUserId: null }) : null,
      wantSenior ? getSeniorReadiness(schoolId, { periodId: period!.periodId }) : null,
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

  // ── netPositionFinance (R341–R348) ─────────────────────────────────────────────────────────────
  // THREE DISTINCT labelled streams — never one summed "net position"/"profit". Fees and books are
  // separate un-reconciled ledgers (school-paid salaries even double-count into the books' salaries
  // line), so NO field sums across ≥2 of {fees, books, payroll}. The whole arm is NOT_CAPTURED only
  // when there is no period; otherwise CAPTURED, and each inner stream keeps its OWN distinct reason.
  const netPositionFinance: RollupArm<NetPositionFinanceArm> = !period
    ? { status: "NOT_CAPTURED", reason: "No academic period configured." }
    : {
        status: "CAPTURED",
        data: {
          // fees: REUSE the feeCollections arm VALUE verbatim — never re-queried, so the two figures
          // can never disagree. No "fee net" here (net-position is books-only).
          fees: feeCollections,
          // books: term-windowed income/expense. Absence is drawn at row-count == 0, NEVER at
          // net === 0 (income == expense with ≥1 entry is a real, CAPTURED zero).
          books:
            !books || books.rowCount === 0
              ? {
                  status: "NOT_CAPTURED",
                  reason: `No books entries recorded for ${termDisplay(period)}.`,
                }
              : {
                  status: "CAPTURED",
                  data: {
                    income: books.income,
                    expense: books.expense,
                    net: books.income - books.expense, // the ONLY cross-line composite (within books)
                  },
                },
          // payroll: point-in-time monthly run-rate. NOT_APPLICABLE when the school runs no payroll
          // in Omnischools (zero comp rows); CAPTURED with ≥1 row, INCLUDING all-GES (school-paid 0).
          payroll:
            !payroll || payroll.rowCount === 0
              ? {
                  status: "NOT_APPLICABLE",
                  reason: "This school does not run payroll in Omnischools.",
                }
              : {
                  status: "CAPTURED",
                  data: {
                    schoolPaidMonthlyTotal: payroll.schoolPaidMonthlyTotal,
                    schoolPaidStaffCount: payroll.schoolPaidStaffCount,
                    gesPaidMonthlyMemo: payroll.gesPaidMonthlyMemo,
                    gesPaidStaffCount: payroll.gesPaidStaffCount,
                    allowanceMonthlyMemo: payroll.allowanceMonthlyMemo,
                    allowanceStaffCount: payroll.allowanceStaffCount,
                    cadence: "MONTHLY",
                  },
                },
        },
      };

  // ── performance (R352–R357) ────────────────────────────────────────────────────────────────────
  // Tier-gate BEFORE period-gate (R355). schoolType is DB-authoritative (getSchoolType), never
  // opts/URL. NO blended composite across the two tiers (R357) — they are separate honest-absence
  // arms, computed independently, never summed/averaged together.
  const basic: RollupArm<BasicPerformanceSummary> =
    schoolType === "SENIOR"
      ? { status: "NOT_APPLICABLE", reason: "This school does not run a basic (KG–JHS) tier." }
      : !period
        ? { status: "NOT_CAPTURED", reason: "No academic period configured." }
        : // NOT_CAPTURED at zero scores — never overallAverage: 0. A real all-zero average (scores
          // exist, every mark is 0) still has hasAnyScores true → CAPTURED (a true zero, treatment B).
          !classPerf || !classPerf.hasAnyScores || classPerf.schoolAverage == null
          ? {
              status: "NOT_CAPTURED",
              reason: `No gradebook scores recorded for ${termDisplay(period)}.`,
            }
          : {
              status: "CAPTURED",
              data: {
                overallAverage: classPerf.schoolAverage,
                overallDelta: classPerf.schoolDelta,
                gradedClasses: classPerf.classesGraded,
                // overallGrade omitted — getClassPerformance exposes no school-average grade (R362-c).
              },
            };

  const senior: RollupArm<SeniorReadinessSummary> =
    schoolType === "BASIC"
      ? { status: "NOT_APPLICABLE", reason: "Not a senior school." }
      : !period
        ? { status: "NOT_CAPTURED", reason: "No academic period configured." }
        : !seniorReadiness || seniorReadiness.subjectsTotal === 0
          ? {
              status: "NOT_CAPTURED",
              reason: `No senior readiness data recorded for ${termDisplay(period)}.`,
            }
          : { status: "CAPTURED", data: seniorReadiness };

  const performance: PerformanceArm = { basic, senior };

  // ── pending arms (R358) ────────────────────────────────────────────────────────────────────────
  // ALWAYS NOT_CAPTURED with a forward-looking reason. `never` payload makes CAPTURED a compile error;
  // GOV-6 / GOV-7 replace these bodies with real arms later.
  const terminalResults: PendingArm = {
    status: "NOT_CAPTURED",
    reason:
      "Terminal exam results (BECE / WASSCE) are not yet captured in Omnischools — coming in a later release.",
  };
  const infrastructure: PendingArm = {
    status: "NOT_CAPTURED",
    reason: "Facilities details are not yet captured — the termly facilities form is coming soon.",
  };

  return {
    schoolId,
    period,
    generatedAt,
    enrolment,
    attendance: attendanceArm,
    feeCollections,
    netPositionFinance,
    performance,
    terminalResults,
    infrastructure,
    terms,
  };
}
