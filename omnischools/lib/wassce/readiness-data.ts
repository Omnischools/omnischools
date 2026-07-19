import "server-only";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  schools,
  students,
  wassceCandidates,
  wassceProgrammes,
  wassceCandidateSubject,
  wassceSubjects,
  wasscePapers,
  wasscePaperSittings,
  mockExams,
  mockResults,
  waecSpecialConsideration,
  readinessStatements,
} from "@/db/schema";
import {
  projectAggregate,
  bandForAggregate,
  bandRangeLabel,
  type ProjectionResult,
  type ProjectionSubjectInput,
  type ProjectionSnapshot,
  type WassceSubjectType,
} from "@/lib/wassce/projection";
import { effectiveGrade, type WassceGrade } from "@/lib/wassce/mock-grades";
import { SC_FORMS } from "@/lib/wassce/constants";
import type {
  CandidateReadinessData,
  ProjectionRowView,
  ProjectionView,
  ScFormView,
  StatementView,
  SubjectTrajectoryView,
} from "@/lib/wassce/readiness-view";
import type { ReadinessStatementData } from "@/lib/pdf/readiness-statement-document";

/**
 * SERVER-ONLY WASSCE readiness loader (SHS module 4.3 / INCR-17). Imports the db driver, so a client
 * component must NEVER import it (repo memory `reports-data-is-server-only` — only `pnpm build` catches
 * the leak). Every surface figure DERIVES on read via the pure `projectAggregate` lib — no stored live
 * aggregate, no trigger. The client visualizer + write panels take the PRE-FORMATTED view models below.
 *
 * DECISION 11: the projection reads ONLY the predictor-mock grades — never `wassce_paper_sittings`. The
 * exempted-paper read here drives the DISPLAY "(projected)"/holding label ONLY; it never touches the
 * number (that is `projectAggregate`, which has no sittings input).
 */

const PT = (points: number) => `${points} pt${points === 1 ? "" : "s"}`;
const fmtDate = (d: Date | string) =>
  (d instanceof Date ? d : new Date(d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const shortName = (first: string, last: string) => `${(first[0] ?? "").toUpperCase()}. ${last}`;
const initialsOf = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "S";
const scScope = (code: string) => SC_FORMS.find((f) => f.code === code)?.scope ?? "";
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const ackMethodLabel = (m: string | null): string =>
  m === "PHONE_OTP"
    ? "phone-OTP signature"
    : m === "IN_PERSON"
      ? "in-person signature"
      : m === "PDF_UPLOAD"
        ? "uploaded-PDF signature"
        : "signature";

/** One candidate's registered subject + its Mock-1 / Mock-2 grade, ready to project. */
type SubjectRow = {
  subjectId: string;
  name: string;
  type: WassceSubjectType;
  mock1: { grade: WassceGrade; moderatedGrade: WassceGrade | null } | null;
  mock2: { grade: WassceGrade; moderatedGrade: WassceGrade | null } | null;
};

/** Project one mock (predictor or calibration) from the candidate's subject rows. */
function projectMock(rows: SubjectRow[], which: "mock1" | "mock2"): ProjectionResult {
  const input: ProjectionSubjectInput[] = rows.map((r) => ({
    name: r.name,
    type: r.type,
    grade: r[which]?.grade ?? null,
    moderatedGrade: r[which]?.moderatedGrade ?? null,
  }));
  return projectAggregate(input);
}

/**
 * The shared projection core (reused by the surface loader, the generate action, and the roster
 * cleanup): for one candidate, resolve the predictor + calibration mocks, load the per-subject grades,
 * and project both. Call inside `withSchool(...)`.
 */
export async function computeCandidateProjection(
  tx: Tx,
  schoolId: string,
  candidateId: string,
  cohortId: string,
): Promise<{
  predictorMock: { id: string; name: string; markingComplete: boolean } | null;
  rows: SubjectRow[];
  mock2: ProjectionResult;
  mock1: ProjectionResult;
}> {
  const mocks = await tx
    .select({
      id: mockExams.id,
      name: mockExams.name,
      mockNumber: mockExams.mockNumber,
      isPredictor: mockExams.isPredictor,
      markingCompleteAt: mockExams.markingCompleteAt,
    })
    .from(mockExams)
    .where(and(eq(mockExams.schoolId, schoolId), eq(mockExams.cohortId, cohortId)))
    .orderBy(asc(mockExams.mockNumber));

  const predictor = mocks.find((m) => m.isPredictor) ?? null;
  const calibration = mocks.find((m) => !m.isPredictor) ?? null; // "Mock 1"
  const mockIds = mocks.map((m) => m.id);

  // The candidate's registered subjects (composite-FK join keeps everything intra-tenant + naturally
  // filters to registered subjects — the free INCR-18 registration-check mitigation Kofi noted).
  const subjectRows = await tx
    .select({ id: wassceSubjects.id, name: wassceSubjects.name, type: wassceSubjects.subjectType })
    .from(wassceCandidateSubject)
    .innerJoin(
      wassceSubjects,
      and(
        eq(wassceSubjects.schoolId, wassceCandidateSubject.schoolId),
        eq(wassceSubjects.id, wassceCandidateSubject.subjectId),
      ),
    )
    .where(
      and(
        eq(wassceCandidateSubject.schoolId, schoolId),
        eq(wassceCandidateSubject.candidateId, candidateId),
      ),
    )
    .orderBy(asc(wassceSubjects.name));

  const results = mockIds.length
    ? await tx
        .select({
          mockId: mockResults.mockId,
          subjectId: mockResults.subjectId,
          grade: mockResults.grade,
          moderatedGrade: mockResults.moderatedGrade,
        })
        .from(mockResults)
        .where(
          and(
            eq(mockResults.schoolId, schoolId),
            eq(mockResults.candidateId, candidateId),
            inArray(mockResults.mockId, mockIds),
          ),
        )
    : [];

  const rows: SubjectRow[] = subjectRows.map((s) => {
    const grade = (mockId: string | undefined) => {
      if (!mockId) return null;
      const r = results.find((x) => x.mockId === mockId && x.subjectId === s.id);
      return r ? { grade: r.grade as WassceGrade, moderatedGrade: (r.moderatedGrade ?? null) as WassceGrade | null } : null;
    };
    return {
      subjectId: s.id,
      name: s.name,
      type: s.type as WassceSubjectType,
      mock1: grade(calibration?.id),
      mock2: grade(predictor?.id),
    };
  });

  return {
    predictorMock: predictor
      ? { id: predictor.id, name: predictor.name, markingComplete: predictor.markingCompleteAt != null }
      : null,
    rows,
    mock2: projectMock(rows, "mock2"),
    mock1: projectMock(rows, "mock1"),
  };
}

/** Build the immutable snapshot json frozen onto a readiness statement (only when Mock 2 is computable). */
export function buildSnapshot(mock1: ProjectionResult, mock2: ProjectionResult): ProjectionSnapshot | null {
  if (!mock2.computable) return null;
  return {
    mock1Aggregate: mock1.computable ? mock1.aggregate : null,
    mock2Aggregate: mock2.aggregate,
    projectedAggregate: mock2.aggregate, // no trajectory numeric adjust (Decision 12)
    band: mock2.band,
    subjects: mock2.subjects.map((s) => ({
      name: s.name,
      type: s.type,
      grade: s.grade,
      points: s.points,
      counted: s.counted,
    })),
  };
}

/**
 * The roster cleanup (build-plan line 2181): the DERIVED best-3 aggregate per candidate for a cohort's
 * predictor mock — the single source of truth the setup roster's Mock-2-agg column now reads (instead of
 * the seeded static). Candidates without ≥3 graded cores+electives project as not-computable → the
 * caller falls back to the seeded literal (all we have for them). One batched query.
 */
export async function computeCohortAggregates(
  tx: Tx,
  schoolId: string,
  cohortId: string,
): Promise<Map<string, number>> {
  const [predictor] = await tx
    .select({ id: mockExams.id })
    .from(mockExams)
    .where(
      and(
        eq(mockExams.schoolId, schoolId),
        eq(mockExams.cohortId, cohortId),
        eq(mockExams.isPredictor, true),
      ),
    );
  if (!predictor) return new Map();

  const rows = await tx
    .select({
      candidateId: mockResults.candidateId,
      name: wassceSubjects.name,
      type: wassceSubjects.subjectType,
      grade: mockResults.grade,
      moderatedGrade: mockResults.moderatedGrade,
    })
    .from(mockResults)
    .innerJoin(
      wassceCandidateSubject,
      and(
        eq(wassceCandidateSubject.schoolId, mockResults.schoolId),
        eq(wassceCandidateSubject.candidateId, mockResults.candidateId),
        eq(wassceCandidateSubject.subjectId, mockResults.subjectId),
      ),
    )
    .innerJoin(
      wassceSubjects,
      and(
        eq(wassceSubjects.schoolId, mockResults.schoolId),
        eq(wassceSubjects.id, mockResults.subjectId),
      ),
    )
    .where(and(eq(mockResults.schoolId, schoolId), eq(mockResults.mockId, predictor.id)));

  const byCandidate = new Map<string, ProjectionSubjectInput[]>();
  for (const r of rows) {
    const list = byCandidate.get(r.candidateId) ?? [];
    list.push({
      name: r.name,
      type: r.type as WassceSubjectType,
      grade: r.grade as WassceGrade,
      moderatedGrade: (r.moderatedGrade ?? null) as WassceGrade | null,
    });
    byCandidate.set(r.candidateId, list);
  }

  const out = new Map<string, number>();
  for (const [candidateId, input] of byCandidate) {
    const res = projectAggregate(input);
    if (res.computable) out.set(candidateId, res.aggregate);
  }
  return out;
}

/** Load a candidate's whole readiness surface by index number, tenant-scoped. Returns null if unknown. */
export async function loadCandidateReadiness(
  tx: Tx,
  schoolId: string,
  indexNumber: string,
): Promise<CandidateReadinessData | null> {
  const [cand] = await tx
    .select({
      id: wassceCandidates.id,
      cohortId: wassceCandidates.cohortId,
      indexNumber: wassceCandidates.indexNumber,
      firstName: students.firstName,
      lastName: students.lastName,
      programmeName: wassceProgrammes.name,
    })
    .from(wassceCandidates)
    .innerJoin(
      students,
      and(eq(students.schoolId, wassceCandidates.schoolId), eq(students.id, wassceCandidates.studentId)),
    )
    .innerJoin(
      wassceProgrammes,
      and(
        eq(wassceProgrammes.schoolId, wassceCandidates.schoolId),
        eq(wassceProgrammes.id, wassceCandidates.programmeId),
      ),
    )
    .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.indexNumber, indexNumber)));
  if (!cand) return null;

  const { predictorMock, rows, mock1, mock2 } = await computeCandidateProjection(
    tx,
    schoolId,
    cand.id,
    cand.cohortId,
  );

  // Display-only: which counted subjects are HELD from Mock 2 through an exempted live paper (the SC-12
  // "(projected)" label). This reads sittings — a DISPLAY concern, never the projection number.
  const exemptedSittings = await tx
    .select({ subjectId: wasscePapers.subjectId })
    .from(wasscePaperSittings)
    .innerJoin(
      wasscePapers,
      and(
        eq(wasscePapers.schoolId, wasscePaperSittings.schoolId),
        eq(wasscePapers.id, wasscePaperSittings.paperId),
      ),
    )
    .where(
      and(
        eq(wasscePaperSittings.schoolId, schoolId),
        eq(wasscePaperSittings.candidateId, cand.id),
        isNotNull(wasscePaperSittings.exemptedAt),
      ),
    );
  const exemptedSubjectIds = new Set(exemptedSittings.map((r) => r.subjectId));
  const nameById = new Map(rows.map((r) => [r.subjectId, r.name]));
  const exemptedNames = new Set(
    [...exemptedSubjectIds].map((id) => nameById.get(id)).filter((n): n is string => n != null),
  );

  const projection = buildProjectionView(mock1, mock2, exemptedNames);

  // §3 subject trajectory cards — the dropped flag comes from the same best-3 lib as §5.
  const droppedNames = new Set(
    mock2.computable ? mock2.subjects.filter((s) => !s.counted).map((s) => s.name) : [],
  );
  const subjects: SubjectTrajectoryView[] = rows.map((r) => {
    const dropped = droppedNames.has(r.name);
    const typeWord = r.type === "CORE" ? "Core" : r.type === "OPTIONAL" ? "Alternative" : "Elective";
    return {
      name: r.name,
      type: r.type,
      typeLabel: dropped ? `${typeWord} · dropped` : typeWord,
      mock1: r.mock1 ? effectiveGrade(r.mock1) : null,
      mock2: r.mock2 ? effectiveGrade(r.mock2) : null,
      finalGrade: r.mock2 ? effectiveGrade(r.mock2) : null,
      dropped,
    };
  });

  // SC forms for this candidate.
  const scRows = await tx
    .select()
    .from(waecSpecialConsideration)
    .where(
      and(
        eq(waecSpecialConsideration.schoolId, schoolId),
        eq(waecSpecialConsideration.candidateId, cand.id),
      ),
    )
    .orderBy(asc(waecSpecialConsideration.scForm));
  const scForms: ScFormView[] = scRows.map((s) => {
    const open = s.status !== "COMPLETED" && s.status !== "REJECTED";
    return {
      scForm: s.scForm,
      scopeLabel: scScope(s.scForm),
      status: s.status,
      statusLabel: titleCase(s.status),
      waecRef: s.waecRef,
      filedAtLabel: s.filedAt ? fmtDate(s.filedAt) : null,
      makeUpCentre: s.makeUpCentre,
      notes: s.notes,
      open,
    };
  });
  const openMedicalSc = scForms.find((s) => s.scForm === "SC-12" && s.open) ?? null;

  // Current readiness statement (the single non-superseded row).
  const [stmt] = await tx
    .select()
    .from(readinessStatements)
    .where(
      and(
        eq(readinessStatements.schoolId, schoolId),
        eq(readinessStatements.candidateId, cand.id),
        // current = not superseded; the partial index serves this hot read
      ),
    )
    .orderBy(desc(readinessStatements.generatedAt))
    .limit(5);
  const current = stmt && stmt.supersededAt == null ? stmt : undefined;
  const statement: StatementView | null = current
    ? {
        id: current.id,
        generatedAtLabel: fmtDate(current.generatedAt),
        projectedAggregate: current.projectedAggregate,
        projectedBand: current.projectedBand,
        parentAcknowledged: current.parentAcknowledgedAt != null,
        parentAckTitle: current.parentAcknowledgedAt
          ? `Parent acknowledged the ${predictorMock?.name ?? "Mock 2"} readiness statement on ${fmtDate(current.parentAcknowledgedAt)}`
          : null,
        parentAckMeta: current.parentAcknowledgedAt
          ? [
              ackMethodLabel(current.parentAcknowledgedSignatureMethod),
              current.parentAcknowledgedPhone,
              current.parentConcernsText ? `concern noted: ${current.parentConcernsText}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : null,
        pdfHref: `/api/senior/readiness-statement/${current.id}`,
      }
    : null;

  const markingComplete = predictorMock?.markingComplete ?? false;
  const canGenerate = markingComplete && mock2.computable;
  const generateBlockedReason = !predictorMock
    ? "No predictor mock exists for this cohort."
    : !markingComplete
      ? "The predictor mock's marking is not complete yet."
      : !mock2.computable
        ? "The projected aggregate is not computable — the candidate needs at least 3 graded cores and 3 graded electives in the predictor mock."
        : null;

  return {
    candidateId: cand.id,
    shortName: shortName(cand.firstName, cand.lastName),
    fullName: `${cand.firstName} ${cand.lastName}`,
    indexNumber: cand.indexNumber,
    programmeLabel: cand.programmeName,
    projection,
    subjects,
    scForms,
    openMedicalSc,
    statement,
    predictorMockName: predictorMock?.name ?? "Mock 2",
    markingComplete,
    canGenerate,
    generateBlockedReason,
  };
}

/** Shape the §5/§1 projection view (counted/dropped rows + trajectory) from the two projections. */
function buildProjectionView(
  mock1: ProjectionResult,
  mock2: ProjectionResult,
  exemptedNames: Set<string>,
): ProjectionView {
  if (!mock2.computable) return { computable: false, reason: mock2.reason };

  const toRow = (
    s: { name: string; type: WassceSubjectType; grade: WassceGrade; points: number; counted: boolean },
    pool: "core" | "elective",
  ): ProjectionRowView => ({
    name: s.name,
    type: s.type,
    grade: s.grade,
    projected: s.counted && exemptedNames.has(s.name),
    pointsLabel: PT(s.points),
    counted: s.counted,
    statusLabel: s.counted
      ? "Counted"
      : pool === "core"
        ? "Dropped — 4th core"
        : "Dropped — lowest",
  });

  const holding = mock2.subjects.some((s) => s.counted && exemptedNames.has(s.name));
  const mock1Agg = mock1.computable ? mock1.aggregate : null;
  const delta = mock1Agg != null ? mock1Agg - mock2.aggregate : null;
  const deltaLabel =
    delta == null
      ? null
      : delta > 0
        ? `↑ ${delta} place${delta === 1 ? "" : "s"}`
        : delta < 0
          ? `↓ ${-delta} place${delta === -1 ? "" : "s"}`
          : "→ holding";

  return {
    computable: true,
    aggregate: mock2.aggregate,
    band: mock2.band,
    cores: mock2.cores.map((s) => toRow(s, "core")),
    electives: mock2.electives.map((s) => toRow(s, "elective")),
    mock1Aggregate: mock1Agg,
    mock1BandLabel: mock1Agg != null ? bandRangeLabel(mock1Agg) : null,
    mock2Aggregate: mock2.aggregate,
    mock2BandLabel: bandRangeLabel(mock2.aggregate),
    projectedBandLabel: holding
      ? "Med-disruption risk on held papers"
      : bandRangeLabel(mock2.aggregate),
    deltaLabel,
    holding,
  };
}

/**
 * Build the readiness-statement PDF data from the FROZEN snapshot (Ruling 4 — re-render on demand, never
 * recompute). Academic block only — the university block is INCR-17b (omitted, AC16/AC17). Tenant-scoped.
 */
export async function loadReadinessStatementForPdf(
  tx: Tx,
  schoolId: string,
  statementId: string,
): Promise<ReadinessStatementData | null> {
  const [stmt] = await tx
    .select()
    .from(readinessStatements)
    .where(and(eq(readinessStatements.schoolId, schoolId), eq(readinessStatements.id, statementId)));
  if (!stmt) return null;

  const [cand] = await tx
    .select({
      indexNumber: wassceCandidates.indexNumber,
      firstName: students.firstName,
      lastName: students.lastName,
      programmeName: wassceProgrammes.name,
    })
    .from(wassceCandidates)
    .innerJoin(
      students,
      and(eq(students.schoolId, wassceCandidates.schoolId), eq(students.id, wassceCandidates.studentId)),
    )
    .innerJoin(
      wassceProgrammes,
      and(
        eq(wassceProgrammes.schoolId, wassceCandidates.schoolId),
        eq(wassceProgrammes.id, wassceCandidates.programmeId),
      ),
    )
    .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.id, stmt.candidateId)));
  if (!cand) return null;

  const [sc] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId));
  const schoolName = sc?.name ?? "School";
  const snap = stmt.projectionSnapshotJson as ProjectionSnapshot;

  const typeLabel = (t: WassceSubjectType) =>
    t === "CORE" ? "Core" : t === "OPTIONAL" ? "Alternative" : "Elective";

  return {
    school: { name: schoolName, initials: initialsOf(schoolName) },
    candidate: {
      fullName: `${cand.firstName} ${cand.lastName}`,
      indexNumber: cand.indexNumber,
      programmeLabel: cand.programmeName,
    },
    generatedAtLabel: fmtDate(stmt.generatedAt),
    superseded: stmt.supersededAt != null,
    projectedAggregate: stmt.projectedAggregate,
    projectedBand: stmt.projectedBand ?? (stmt.projectedAggregate != null ? bandForAggregate(stmt.projectedAggregate) : "—"),
    mock1Aggregate: snap.mock1Aggregate,
    mock2Aggregate: snap.mock2Aggregate,
    subjects: snap.subjects.map((s) => ({
      name: s.name,
      typeLabel: typeLabel(s.type),
      grade: s.grade,
      pointsLabel: PT(s.points),
      counted: s.counted,
    })),
    parentAck: stmt.parentAcknowledgedAt
      ? {
          acknowledgedAtLabel: fmtDate(stmt.parentAcknowledgedAt),
          methodLabel: ackMethodLabel(stmt.parentAcknowledgedSignatureMethod),
          phone: stmt.parentAcknowledgedPhone,
          concerns: stmt.parentConcernsText,
        }
      : null,
  };
}
