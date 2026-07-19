import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  mockExams,
  mockResults,
  wassceCohort,
  wassceCandidates,
  wassceCandidateSubject,
  wassceSubjects,
  students,
  benchmarkDataPoints,
  benchmarkReference,
} from "@/db/schema";
import { getActiveCohort } from "@/lib/wassce/active-cohort";
import { resolveAuthorizedWassceSubjectIds } from "@/lib/wassce/subject-authz";
import {
  WASSCE_GRADES,
  effectiveGrade,
  trajectory,
  gradeDistribution,
  creditRate,
  distinctionRate,
  meanGrade,
  toPct,
  isFocusBand,
  type WassceGrade,
} from "@/lib/wassce/mock-grades";
import type {
  MockColumn,
  MockCell,
  MockCandidateRow,
  BenchRow,
  BenchCell,
} from "@/lib/wassce/mock-view";

export type { MockColumn, MockCell, MockCandidateRow, BenchRow, BenchCell } from "@/lib/wassce/mock-view";

/**
 * SERVER-ONLY subject-teacher surface loader (SHS module 4.3 / INCR-16). Imports the Drizzle schema /
 * db driver, so it must NEVER be imported by a client component (repo memory `reports-data-is-server-
 * only` — only `pnpm build` catches the leak). The client mark-entry grid takes the PRE-FORMATTED
 * `MockCandidateRow[]` + `MockColumn[]` below; every stat DERIVES from real `mock_results` (AC7/8/9) —
 * no seeded literal, no cross-subject best-3 aggregate (AC16).
 *
 * SCOPE (R5 / AC13): a subject teacher sees ONLY the (cohort × their assigned subject) they map to via
 * `senior_subject_teacher`. Oversight roles (WASSCE_SETUP_ROLES) may view any subject in the cohort.
 * Cohort defaults to the ACTIVE (frozen, greatest year) cohort; an explicit `cohortId` (tenant-scoped)
 * switches to another of the school's cohorts (e.g. the in-flight F2-2027 whose Mock 1 is writable).
 */

export type SubjectTeacherData = {
  cohort: { id: string; examYear: number; frozen: boolean };
  cohortOptions: { id: string; examYear: number; frozen: boolean }[]; // school cohorts (view switch)
  subject: { id: string; name: string } | null; // null = no authorised/available subject
  subjectOptions: { id: string; name: string }[]; // for oversight switching
  canWriteSubject: boolean; // acting user may mark this subject (correspondence OR oversight)
  columns: MockColumn[];
  predictorColumnId: string | null;
  rows: MockCandidateRow[];
  stats: {
    candidates: number;
    creditPct: number; // derived
    distinctionPct: number; // derived
    distinctionCount: number;
    meanGrade: WassceGrade | null; // derived
    mock1MeanGrade: WassceGrade | null;
    histogram: { grade: WassceGrade; count: number }[]; // predictor distribution (AC9)
    histogramMax: number;
    aboveCredit: number; // ≥ credit count (predictor)
  };
  benchmark: { credit: BenchCell; distinction: BenchCell } | null;
};

const rawLabel = (raw: string | null, max: string | null): string | null => {
  if (raw == null) return null;
  const r = Number(raw);
  const m = max == null ? 100 : Number(max);
  return `${r % 1 === 0 ? r : r.toFixed(0)} / ${m % 1 === 0 ? m : m.toFixed(0)}`;
};

const shortName = (first: string, last: string) =>
  `${(first[0] ?? "").toUpperCase()}. ${last}`;

const splitNote = (note: string | null) => (note ? note.replace("‖", " ").trim() : null);

/**
 * Load the subject-teacher surface for the acting user. `subjectId` / `cohortId` are optional
 * tenant-scoped selectors; roles decide whether the user may VIEW/WRITE a subject they don't teach.
 * Call inside `withSchool(...)`.
 */
export async function loadSubjectTeacherSurface(
  tx: Tx,
  schoolId: string,
  actingUserId: string | null,
  isOversight: boolean,
  opts?: { subjectId?: string; cohortId?: string },
): Promise<SubjectTeacherData | null> {
  // --- 1) cohort (default active; explicit cohortId must belong to this school) ---
  let cohortRow: typeof wassceCohort.$inferSelect | null = null;
  if (opts?.cohortId) {
    const [c] = await tx
      .select()
      .from(wassceCohort)
      .where(and(eq(wassceCohort.schoolId, schoolId), eq(wassceCohort.id, opts.cohortId)));
    cohortRow = c ?? null;
  }
  if (!cohortRow) cohortRow = await getActiveCohort(tx, schoolId);
  if (!cohortRow) return null;

  const allCohorts = await tx
    .select()
    .from(wassceCohort)
    .where(eq(wassceCohort.schoolId, schoolId))
    .orderBy(asc(wassceCohort.examYear));
  const cohortOptions = allCohorts.map((c) => ({
    id: c.id,
    examYear: c.examYear,
    frozen: c.setupFrozenAt != null,
  }));

  // --- 2) which subject: authorised set (R5) + what actually has mock data in this cohort ---
  const authorized = await resolveAuthorizedWassceSubjectIds(tx, schoolId, actingUserId);

  const mocks = await tx
    .select()
    .from(mockExams)
    .where(and(eq(mockExams.schoolId, schoolId), eq(mockExams.cohortId, cohortRow.id)))
    .orderBy(asc(mockExams.mockNumber));

  const mockIds = mocks.map((m) => m.id);
  // Subjects that have any result in this cohort's mocks (the selectable set).
  const subjectsWithData = mockIds.length
    ? await tx
        .selectDistinct({ subjectId: mockResults.subjectId })
        .from(mockResults)
        .where(and(eq(mockResults.schoolId, schoolId), inArray(mockResults.mockId, mockIds)))
    : [];

  // Subjects this cohort's candidates are registered for — the set oversight can inspect even before any
  // mark exists (the in-flight F2-2027 case, where subjectsWithData is empty but Chemistry is offered).
  const hasOpenMock = mocks.some((m) => m.markingCompleteAt == null);
  const subjectsOffered =
    isOversight && hasOpenMock
      ? await tx
          .selectDistinct({ subjectId: wassceCandidateSubject.subjectId })
          .from(wassceCandidateSubject)
          .innerJoin(
            wassceCandidates,
            and(
              eq(wassceCandidates.schoolId, wassceCandidateSubject.schoolId),
              eq(wassceCandidates.id, wassceCandidateSubject.candidateId),
            ),
          )
          .where(and(eq(wassceCandidateSubject.schoolId, schoolId), eq(wassceCandidates.cohortId, cohortRow.id)))
      : [];

  // What the user may see. A teacher → their authorised subjects; oversight → subjects with data, their
  // authorised set, and (for an in-flight cohort) the subjects the cohort is registered for.
  const visibleSubjectIds = new Set<string>();
  for (const id of authorized) visibleSubjectIds.add(id);
  if (isOversight) {
    for (const s of subjectsWithData) visibleSubjectIds.add(s.subjectId);
    for (const s of subjectsOffered) visibleSubjectIds.add(s.subjectId);
  }

  if (visibleSubjectIds.size === 0) {
    // No correspondence and not oversight → forbidden / empty (the R5 fail-closed path).
    return {
      cohort: { id: cohortRow.id, examYear: cohortRow.examYear, frozen: cohortRow.setupFrozenAt != null },
      cohortOptions,
      subject: null,
      subjectOptions: [],
      canWriteSubject: false,
      columns: [],
      predictorColumnId: null,
      rows: [],
      stats: emptyStats(),
      benchmark: null,
    };
  }

  const subjectRows = await tx
    .select({ id: wassceSubjects.id, name: wassceSubjects.name })
    .from(wassceSubjects)
    .where(
      and(
        eq(wassceSubjects.schoolId, schoolId),
        inArray(wassceSubjects.id, Array.from(visibleSubjectIds)),
      ),
    )
    .orderBy(asc(wassceSubjects.name));

  const subjectOptions = subjectRows;
  const chosen =
    (opts?.subjectId && subjectOptions.find((s) => s.id === opts.subjectId)) ||
    subjectOptions[0] ||
    null;

  const canWriteSubject = chosen ? authorized.has(chosen.id) || isOversight : false;

  if (!chosen) {
    return {
      cohort: { id: cohortRow.id, examYear: cohortRow.examYear, frozen: cohortRow.setupFrozenAt != null },
      cohortOptions,
      subject: null,
      subjectOptions,
      canWriteSubject: false,
      columns: [],
      predictorColumnId: null,
      rows: [],
      stats: emptyStats(),
      benchmark: null,
    };
  }

  // --- 3) mock columns + results for the chosen subject ---
  const columns: MockColumn[] = mocks.map((m) => ({
    id: m.id,
    label: m.name,
    mockNumber: m.mockNumber,
    isPredictor: m.isPredictor,
    locked: m.markingCompleteAt != null,
  }));
  const predictor = mocks.find((m) => m.isPredictor) ?? null;
  const calibration = mocks.find((m) => !m.isPredictor) ?? null; // "Mock 1"

  const results = mockIds.length
    ? await tx
        .select({
          mockId: mockResults.mockId,
          candidateId: mockResults.candidateId,
          grade: mockResults.grade,
          moderatedGrade: mockResults.moderatedGrade,
          rawScore: mockResults.rawScore,
          maxScore: mockResults.maxScore,
          firstName: students.firstName,
          lastName: students.lastName,
          studentCode: students.studentCode,
          indexNumber: wassceCandidates.indexNumber,
          regFlag: wassceCandidates.regFlag,
          note: wassceCandidates.note,
        })
        .from(mockResults)
        .innerJoin(
          wassceCandidates,
          and(
            eq(wassceCandidates.schoolId, mockResults.schoolId),
            eq(wassceCandidates.id, mockResults.candidateId),
          ),
        )
        .innerJoin(
          students,
          and(eq(students.schoolId, wassceCandidates.schoolId), eq(students.id, wassceCandidates.studentId)),
        )
        .where(
          and(
            eq(mockResults.schoolId, schoolId),
            eq(mockResults.subjectId, chosen.id),
            inArray(mockResults.mockId, mockIds),
          ),
        )
    : [];

  // Group by candidate.
  const byCandidate = new Map<
    string,
    {
      name: string;
      studentCode: string;
      indexNumber: string;
      medFlag: boolean;
      note: string | null;
      cells: Record<string, MockCell>;
    }
  >();
  for (const r of results) {
    let c = byCandidate.get(r.candidateId);
    if (!c) {
      c = {
        name: shortName(r.firstName, r.lastName),
        studentCode: r.studentCode,
        indexNumber: r.indexNumber,
        medFlag: r.regFlag === "ON_MEDICAL",
        note: splitNote(r.note),
        cells: {},
      };
      byCandidate.set(r.candidateId, c);
    }
    const grade = r.grade as WassceGrade;
    const moderated = (r.moderatedGrade ?? null) as WassceGrade | null;
    c.cells[r.mockId] = {
      grade,
      moderatedGrade: moderated,
      effective: effectiveGrade({ grade, moderatedGrade: moderated }),
      rawLabel: rawLabel(r.rawScore, r.maxScore),
    };
  }

  // When a mock is OPEN (markable), the grid must also list the cohort's candidates REGISTERED for this
  // subject that have no result yet — otherwise a first mark could never be entered (the in-flight
  // F2-2027 case). When every mock is locked (the F3-2026 history), only the marked set shows (the "28").
  if (mocks.some((m) => m.markingCompleteAt == null)) {
    const registered = await tx
      .select({
        candidateId: wassceCandidates.id,
        firstName: students.firstName,
        lastName: students.lastName,
        studentCode: students.studentCode,
        indexNumber: wassceCandidates.indexNumber,
        regFlag: wassceCandidates.regFlag,
        note: wassceCandidates.note,
      })
      .from(wassceCandidateSubject)
      .innerJoin(
        wassceCandidates,
        and(
          eq(wassceCandidates.schoolId, wassceCandidateSubject.schoolId),
          eq(wassceCandidates.id, wassceCandidateSubject.candidateId),
        ),
      )
      .innerJoin(
        students,
        and(eq(students.schoolId, wassceCandidates.schoolId), eq(students.id, wassceCandidates.studentId)),
      )
      .where(
        and(
          eq(wassceCandidateSubject.schoolId, schoolId),
          eq(wassceCandidateSubject.subjectId, chosen.id),
          eq(wassceCandidates.cohortId, cohortRow.id),
        ),
      );
    for (const r of registered) {
      if (byCandidate.has(r.candidateId)) continue;
      byCandidate.set(r.candidateId, {
        name: shortName(r.firstName, r.lastName),
        studentCode: r.studentCode,
        indexNumber: r.indexNumber,
        medFlag: r.regFlag === "ON_MEDICAL",
        note: splitNote(r.note),
        cells: {},
      });
    }
  }

  const predictorGrade = (candCells: Record<string, MockCell>): WassceGrade | null =>
    predictor && candCells[predictor.id] ? candCells[predictor.id].effective : null;

  const rows: MockCandidateRow[] = Array.from(byCandidate.entries()).map(([id, c]) => {
    const m1 = calibration && c.cells[calibration.id] ? c.cells[calibration.id].effective : null;
    const m2 = predictorGrade(c.cells);
    return {
      id,
      rank: 0,
      name: c.name,
      studentCode: c.studentCode,
      indexNumber: c.indexNumber,
      house: null,
      cells: c.cells,
      trajectory: trajectory(m1, m2),
      predicted: m2,
      teacherNote: c.note,
      isFocus: m2 != null && isFocusBand(m2),
      medFlag: c.medFlag,
    };
  });

  // Rank by predictor grade (best first), then index number for stability.
  rows.sort((a, b) => {
    const ao = a.predicted ? WASSCE_GRADES.indexOf(a.predicted) : 99;
    const bo = b.predicted ? WASSCE_GRADES.indexOf(b.predicted) : 99;
    return ao - bo || a.indexNumber.localeCompare(b.indexNumber);
  });
  rows.forEach((r, i) => (r.rank = i + 1));

  // --- 4) derived stats (predictor distribution) ---
  const predictorGrades = rows.map((r) => r.predicted).filter((g): g is WassceGrade => g != null);
  const mock1Grades = rows
    .map((r) => (calibration && r.cells[calibration.id] ? r.cells[calibration.id].effective : null))
    .filter((g): g is WassceGrade => g != null);
  const dist = gradeDistribution(predictorGrades);
  const histogram = WASSCE_GRADES.map((g) => ({ grade: g, count: dist[g] }));
  const histogramMax = Math.max(1, ...histogram.map((h) => h.count));

  const stats: SubjectTeacherData["stats"] = {
    candidates: rows.length,
    creditPct: toPct(creditRate(predictorGrades)),
    distinctionPct: toPct(distinctionRate(predictorGrades)),
    distinctionCount: predictorGrades.filter((g) => WASSCE_GRADES.indexOf(g) <= 1).length,
    meanGrade: meanGrade(predictorGrades),
    mock1MeanGrade: meanGrade(mock1Grades),
    histogram,
    histogramMax,
    aboveCredit: predictorGrades.filter((g) => WASSCE_GRADES.indexOf(g) <= 5).length,
  };

  // --- 5) benchmark (R4): my cohort DERIVED; school/national/region from the tenant + global tables ---
  const benchmark = await loadBenchmark(tx, schoolId, chosen, stats);

  return {
    cohort: { id: cohortRow.id, examYear: cohortRow.examYear, frozen: cohortRow.setupFrozenAt != null },
    cohortOptions,
    subject: chosen,
    subjectOptions,
    canWriteSubject,
    columns,
    predictorColumnId: predictor?.id ?? null,
    rows,
    stats,
    benchmark,
  };
}

export type MockTimelineRow = {
  id: string;
  cohortId: string;
  cohortLabel: string; // "F3 · 2026"
  cohortFrozen: boolean;
  name: string;
  mockNumber: number;
  isPredictor: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  locked: boolean; // marking_complete_at set → config-edit blocked (AC3)
  status: "COMPLETE" | "SCHEDULED";
};

export type MockConfigData = {
  cohorts: { id: string; examYear: number; frozen: boolean; label: string }[];
  timeline: MockTimelineRow[];
};

/**
 * The setup §2 mock-cycle config surface data (admin). Lists every cohort + every mock across the
 * school (both F3-2026 completed history and F2-2027's scheduled Mock 1), tenant-scoped. The config
 * write (schedule / edit) targets an UNLOCKED mock; a mock with `marking_complete_at` set is locked
 * (AC3). Call inside `withSchool(...)`.
 */
export async function loadMockConfig(tx: Tx, schoolId: string): Promise<MockConfigData> {
  const cohorts = await tx
    .select()
    .from(wassceCohort)
    .where(eq(wassceCohort.schoolId, schoolId))
    .orderBy(asc(wassceCohort.examYear));

  // Form level is anchored on the ACTIVE (frozen, greatest-year) cohort = F3 now; a LATER exam year is
  // an earlier form (F2, F1 …) — the 2027 cohort is this year's F2. Falls back to the max year as F3.
  const frozenYears = cohorts.filter((c) => c.setupFrozenAt != null).map((c) => c.examYear);
  const anchorYear = frozenYears.length
    ? Math.max(...frozenYears)
    : cohorts.length
      ? Math.max(...cohorts.map((c) => c.examYear))
      : new Date().getUTCFullYear();
  const cohortLabel = (examYear: number) => `F${Math.max(1, 3 - (examYear - anchorYear))} · ${examYear}`;

  const mocks = cohorts.length
    ? await tx
        .select()
        .from(mockExams)
        .where(eq(mockExams.schoolId, schoolId))
        .orderBy(asc(mockExams.mockNumber))
    : [];

  const cohortById = new Map(cohorts.map((c) => [c.id, c]));
  const timeline: MockTimelineRow[] = mocks
    .filter((m) => cohortById.has(m.cohortId))
    .map((m) => {
      const c = cohortById.get(m.cohortId)!;
      return {
        id: m.id,
        cohortId: m.cohortId,
        cohortLabel: cohortLabel(c.examYear),
        cohortFrozen: c.setupFrozenAt != null,
        name: m.name,
        mockNumber: m.mockNumber,
        isPredictor: m.isPredictor,
        scheduledStart: m.scheduledStart,
        scheduledEnd: m.scheduledEnd,
        locked: m.markingCompleteAt != null,
        status: (m.markingCompleteAt != null ? "COMPLETE" : "SCHEDULED") as "COMPLETE" | "SCHEDULED",
      };
    })
    .sort((a, b) => a.cohortLabel.localeCompare(b.cohortLabel) || a.mockNumber - b.mockNumber);

  return {
    cohorts: cohorts.map((c) => ({
      id: c.id,
      examYear: c.examYear,
      frozen: c.setupFrozenAt != null,
      label: cohortLabel(c.examYear),
    })),
    timeline,
  };
}

function emptyStats(): SubjectTeacherData["stats"] {
  return {
    candidates: 0,
    creditPct: 0,
    distinctionPct: 0,
    distinctionCount: 0,
    meanGrade: null,
    mock1MeanGrade: null,
    histogram: WASSCE_GRADES.map((g) => ({ grade: g, count: 0 })),
    histogramMax: 1,
    aboveCredit: 0,
  };
}

/**
 * Benchmark strip (R4 / §B.5). "My cohort" is DERIVED from the real predictor grades; School / National
 * / Region come from `benchmark_data_points` (tenant, SCHOOLUP_DIRECT) + `benchmark_reference` (global
 * WAEC national + DIRECTIONAL region). NO pooling, no cross-tenant read — the region row is always
 * rendered with its DIRECTIONAL quality dot + "± pp" caveat, never as a measured figure.
 */
async function loadBenchmark(
  tx: Tx,
  schoolId: string,
  subject: { id: string; name: string },
  stats: SubjectTeacherData["stats"],
): Promise<SubjectTeacherData["benchmark"]> {
  const school = await tx
    .select()
    .from(benchmarkDataPoints)
    .where(and(eq(benchmarkDataPoints.schoolId, schoolId), eq(benchmarkDataPoints.subjectId, subject.id)));

  const reference = await tx
    .select()
    .from(benchmarkReference)
    .where(eq(benchmarkReference.subjectName, subject.name));

  if (school.length === 0 && reference.length === 0) return null;

  const build = (metric: "CREDIT_RATE" | "DISTINCTION_RATE", title: string, myValue: number): BenchCell => {
    const rows: BenchRow[] = [
      {
        label: "My cohort",
        source: "Omnischools · this cohort's predictor-mock marking",
        quality: "STRONG",
        value: myValue,
        caveatPp: null,
      },
    ];
    const s = school.find((r) => r.metric === metric && r.scope === "SCHOOL");
    if (s)
      rows.push({
        label: "School avg",
        source: "Omnischools internal · 5-yr history",
        quality: s.quality,
        value: Number(s.value),
        caveatPp: s.confidenceIntervalPp == null ? null : Number(s.confidenceIntervalPp),
      });
    const nat = reference.find((r) => r.metric === metric && r.scope === "NATIONAL");
    if (nat)
      rows.push({
        label: "National",
        source: "WAEC chief examiner report",
        quality: nat.quality,
        value: Number(nat.value),
        caveatPp: nat.confidenceIntervalPp == null ? null : Number(nat.confidenceIntervalPp),
      });
    const reg = reference.find((r) => r.metric === metric && r.scope === "REGION");
    if (reg)
      rows.push({
        label: `Region · ${reg.region ?? "WR"}`,
        source: "WAEC regional summary · subject-level data sparse",
        quality: reg.quality,
        value: Number(reg.value),
        caveatPp: reg.confidenceIntervalPp == null ? null : Number(reg.confidenceIntervalPp),
      });
    return { title, rows };
  };

  return {
    credit: build("CREDIT_RATE", `Mock 2 credit rate · ${subject.name}`, stats.creditPct),
    distinction: build("DISTINCTION_RATE", "Mock 2 distinction rate (A1 / B2)", stats.distinctionPct),
  };
}
