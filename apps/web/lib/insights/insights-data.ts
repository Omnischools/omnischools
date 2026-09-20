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
import { getAnnualCensusStatus, type CensusFilingStatus } from "@/lib/reports/census/filing-status";
import { boardGhs } from "@/lib/board/tiles";

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
  /**
   * This year's ANNUAL GES census filing state (INS §17-D nudge). `null` when no academic year is
   * configured (the nudge can't name a year, so it's suppressed rather than fabricated).
   */
  censusFiling: { academicYear: string; status: CensusFilingStatus } | null;
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

/** The §17-D census attention row's severity + copy (Kofi's ruling); `dot` is a subset of the panel's. */
export type CensusNudge = { dot: "warn" | "navy-2"; value: string };

/**
 * Days after a school year opens before the "not started" (NONE) census nudge appears. Ghana's annual
 * GES/EMIS return is typically due a few weeks after schools reopen, so a school in the first weeks of a
 * new year is not yet late — we hold the nudge through this grace window rather than nag from day one
 * (OC-CENSUS-NUDGE-WINDOW, owner-chosen: grace, ~6 weeks). We do NOT model a hardcoded GES date; the
 * window is a tunable offset from the year's own opening (the first term's `startsOn`), so it survives
 * calendar changes. A started-but-unsubmitted DRAFT is EXEMPT — "finish what you started" is fair the
 * moment the year is underway.
 */
export const CENSUS_NUDGE_GRACE_DAYS = 42;

/** Add whole days to an ISO "YYYY-MM-DD" date, returning ISO (UTC math; Ghana is GMT so this is the local day). */
const addDaysIso = (iso: string, days: number): string =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * PURE decision for the "GES annual census" attention row (§17-D, Kofi's ruling). Returns the row's
 * severity + copy, or `null` when no nudge is due:
 *   • COMPLETED (filed) or no filing state (no academic year) → null (omit-not-fake; never a "filed" row).
 *   • the resolved academic year hasn't opened yet (its earliest term's `startsOn > today`) → null — a
 *     pre-configured future year is not yet outstanding (AC-5), so we don't nag prematurely.
 *   • NONE still within the early-year grace window (`< opening + CENSUS_NUDGE_GRACE_DAYS`) → null.
 * Otherwise: DRAFT → warn ("finish it", grace-EXEMPT); NONE past the window → navy-2 (gentlest).
 * `today` is "YYYY-MM-DD" (compared lexically against the ISO `startsOn`, matching resolveSelectedTerm).
 */
export function censusNudge(
  filing: { academicYear: string; status: CensusFilingStatus } | null,
  terms: readonly { academicYear: string; startsOn: string }[],
  today: string,
): CensusNudge | null {
  if (!filing || filing.status === "COMPLETED") return null;
  // The year's opening = the earliest term start of that academic year (ISO date strings sort by date).
  const opening = terms
    .filter((t) => t.academicYear === filing.academicYear)
    .map((t) => t.startsOn)
    .sort()[0];
  if (!opening || opening > today) return null; // year hasn't opened → not yet outstanding (AC-5)
  if (filing.status === "DRAFT") {
    // Grace-exempt: a saved draft should be finished regardless of the early-year window.
    return {
      dot: "warn",
      value: `Draft saved for ${filing.academicYear} — review and complete it to file the return.`,
    };
  }
  // NONE: hold through the honest early-year filing window, then surface it gently.
  if (today < addDaysIso(opening, CENSUS_NUDGE_GRACE_DAYS)) return null;
  return {
    dot: "navy-2",
    value: `Not started for ${filing.academicYear} — this year's return is not yet filed.`,
  };
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

  // One cheap indexed lookup on the existing census_return table (depends on the resolved period, so it
  // can't join the Promise.all above). Suppressed when no academic year is configured — the nudge would
  // have no year to name.
  const academicYear = rollup.period?.academicYear ?? null;
  const censusFiling = academicYear
    ? { academicYear, status: await getAnnualCensusStatus(schoolId, academicYear) }
    : null;

  return { rollup, classPerf, subjectPerf, levelPerf, census, attendanceByLevel, censusFiling };
}

/* ───────────────────────────── "Needs attention" derivation ───────────────────────────── */

export type ActionSeverity = "terra" | "warn" | "navy-2";
/** A single attention signal. `href` is consumed ONLY by `/insights` (linked); `/board` renders it
 *  link-free (a board member is confined to `/board*`, so a link to /billing etc. is a dead end). Every
 *  value is a school-wide count/amount or a subject count — NEVER a per-student list (aggregate-only). */
export type ActionItem = { key: string; href: string; dot: ActionSeverity; label: string; value: string };

/**
 * The conditional attention rows — each pushed ONLY when its condition is genuinely true (omit-not-fake:
 * an absent problem is absent, never a green "all good" row). Sorted terra → warn → navy-2. Shared by
 * `/insights` (rendered as action links) and `/board` (rendered link-free); the derivation is identical.
 */
export function buildAttention(d: DirectorsInsights, termLabel: string): ActionItem[] {
  const items: ActionItem[] = [];
  const { rollup, classPerf } = d;

  const fees = rollup.feeCollections;
  if (fees.status === "CAPTURED" && fees.data.outstanding > 0) {
    items.push({
      key: "fees",
      href: "/billing",
      dot: fees.data.collectionRate < 60 ? "terra" : "warn",
      label: "Outstanding fees",
      value: `${boardGhs(fees.data.outstanding)} outstanding · ${fees.data.collectionRate}% collected`,
    });
  }

  // Ungraded classes — Basic tier only; count from getClassPerformance (§17-E), not the rollup arm.
  if (rollup.performance.basic.status !== "NOT_APPLICABLE") {
    const ungraded = classPerf.totalClasses - classPerf.classesGraded;
    if (ungraded > 0) {
      items.push({
        key: "ungraded",
        href: "/gradebook",
        dot: "warn",
        label: "Ungraded classes",
        value: `${ungraded} of ${classPerf.totalClasses} ${
          classPerf.totalClasses === 1 ? "class has" : "classes have"
        } no gradebook scores for ${termLabel}`,
      });
    }
  }

  if (rollup.attendance.status !== "CAPTURED") {
    items.push({
      key: "attendance",
      href: "/attendance",
      dot: "warn",
      label: "Attendance not captured",
      value: rollup.attendance.reason,
    });
  }

  if (rollup.infrastructure.status !== "CAPTURED") {
    items.push({
      key: "facilities",
      href: "/reports/facilities",
      dot: "navy-2",
      label: "Facilities snapshot missing",
      value: rollup.infrastructure.reason,
    });
  }

  const sen = rollup.performance.senior;
  if (sen.status === "CAPTURED" && sen.data.subjectsAtRisk > 0) {
    items.push({
      key: "senior",
      href: "/senior/headmaster-summary",
      dot: "terra",
      label: "Senior readiness at risk",
      value: `${sen.data.subjectsAtRisk} subject${sen.data.subjectsAtRisk === 1 ? "" : "s"} at risk for STPSHS · ${sen.data.subjectsPartial} partial`,
    });
  }

  // GES annual census — DRAFT (warn) or not-started (navy-2), not yet filed (§17-D, Kofi's ruling).
  // NONE holds through an early-year grace window; DRAFT is exempt. Suppressed when no year is configured.
  const nudge = censusNudge(d.censusFiling, rollup.terms, new Date().toISOString().slice(0, 10));
  if (nudge) {
    items.push({
      key: "census",
      href: "/reports/statutory/generate-annual-census",
      dot: nudge.dot,
      label: "GES annual census",
      value: nudge.value,
    });
  }

  const order: Record<ActionSeverity, number> = { terra: 0, warn: 1, "navy-2": 2 };
  return items.sort((a, b) => order[a.dot] - order[b.dot]);
}
