import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  houses,
  students,
  users,
  mockExams,
  mockResults,
  readinessStatements,
  universities,
  universityProgrammes,
  universityTargets,
  waecSpecialConsideration,
  wassceCandidates,
  wassceProgrammes,
  wasscePapers,
  wasscePaperSittings,
  wassceSubjects,
} from "@/db/schema";
import { getActiveCohort } from "@/lib/wassce/active-cohort";
import { computeCohortProjections, type CohortPredictorRow } from "@/lib/wassce/readiness-data";
import {
  assessCandidateRisk,
  cohortSummary,
  cohortTier,
  compareRisk,
  aggregateHistogram,
  subjectHeatTag,
  TIER_COLORS,
  type CohortSummary,
  type HistogramBin,
  type RiskReason,
  type SubjectHeatTag,
} from "@/lib/wassce/cohort";
import {
  creditRate,
  effectiveGrade,
  gradeDistribution,
  isCredit,
  toPct,
  WASSCE_GRADES,
  type WassceGrade,
} from "@/lib/wassce/mock-grades";
import {
  checkPrerequisites,
  parsePrerequisiteRules,
  TARGET_TIER_BANDS,
  type PrerequisiteCheck,
} from "@/lib/wassce/university-match";
import { PROGRAMME_ORDER, PROGRAMME_TRACKS, type WassceProgrammeKey } from "@/lib/wassce/constants";
import type { ProjectionResult } from "@/lib/wassce/projection";

/**
 * SERVER-ONLY cohort-readiness loader (SHS module 4.3 / INCR-18). Imports the db driver — a client
 * component must NEVER import it (repo memory `reports-data-is-server-only`; only `pnpm build` catches
 * the leak). Every figure DERIVES on read from `mock_results` through the pure libs; nothing is stored
 * (`wassce_candidates.projected_aggregate` stays NULL) and there is no trigger.
 *
 * HONESTY CORRECTIONS BAKED IN (Kofi R4 — derive or omit, never fake):
 *   • no attendance table exists → "Expected in centre today" = today's sittings MINUS the exempted,
 *     never a "239 of 240 in centre" claim;
 *   • "credit-pass rate" is ALL-CREDIT CANDIDATES (numerator + denominator both rendered);
 *   • "no tertiary path" is "no target tagged" (the system knows tagging, not paths);
 *   • median/mean/tiers cover COMPUTABLE projections only, and the excluded count is stated;
 *   • NO regional/national benchmark is loaded — `benchmark_reference.subject_name` is NOT NULL, so no
 *     school-wide comparison row is even representable. It is omitted, not placeholdered.
 *
 * `readiness_statements` is read for the STALE BADGE ONLY (R1.6). Cohort figures never read the frozen
 * artifact — that would make the dashboard stale the instant a grade is moderated.
 */

const fmtDate = (d: Date | string) =>
  (d instanceof Date ? d : new Date(d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const fmtStamp = (d: Date) =>
  `${fmtDate(d)} · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
const shortName = (first: string, last: string) => `${(first[0] ?? "").toUpperCase()}. ${last}`;
const pct1 = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

/** Local (not UTC) YYYY-MM-DD — `wassce_papers.scheduled_date` is a bare date column. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------------------------ view models */

export type CohortTileSet = {
  /** §1.1 — sittings scheduled TODAY minus the exempted. NOT an attendance figure. */
  expectedInCentre: number | null;
  exemptedToday: number;
  scheduledToday: number;
  nextPaperLabel: string | null; // rendered instead when no paper is scheduled today
  /** §1.2 — over computable projections only. */
  median: number | null;
  mean: number | null;
  medianTierLabel: string | null;
  /** §1.3 — candidates whose EVERY graded predictor result is a credit. */
  allCreditNumerator: number;
  allCreditDenominator: number;
  /** §1.4 / §1.5 */
  atRisk: number;
  noTargetTagged: number;
  /** §1.6 — the ADDED marking-progress tile (R4e). */
  gradedResults: number;
  expectedResults: number;
  markingComplete: boolean;
};

export type BannerView = {
  title: string; // "WASSCE 2026 · Day 2"
  papers: { name: string; window: string }[];
  exemptedNote: string | null;
};

export type ProgrammeBarView = {
  key: WassceProgrammeKey;
  label: string;
  total: number;
  computable: number;
  tiers: { key: string; name: string; count: number; pct: number; color: string }[];
};

export type HeatmapRowView = {
  subjectId: string;
  label: string;
  type: "CORE" | "ELECTIVE" | "OPTIONAL";
  /** Per-programme copies merged into this row; >1 means the deep link opens only one of them. */
  copies: number;
  registered: number;
  graded: number;
  counts: { grade: WassceGrade; count: number }[];
  belowCredit: number;
  belowCreditPct: number;
  f9: number;
  tag: SubjectHeatTag;
};

export type ConcernCardView = {
  subjectId: string;
  heading: string;
  body: string;
  tag: Exclude<SubjectHeatTag, null>;
};

export type AtRiskRowView = {
  candidateId: string;
  name: string;
  initials: string;
  indexNumber: string;
  programmeKey: WassceProgrammeKey | null;
  programmeLabel: string;
  aggregate: number | null;
  aggregateTierKey: string | null;
  lowestTargetLabel: string | null;
  lowestTargetSub: string | null;
  gap: number | null;
  gapLabel: string;
  gapTone: "over" | "tight" | "ok" | "none";
  reasons: RiskReason[];
  sortKey: number;
};

export type HouseCardView = {
  key: string;
  name: string;
  colour: string | null;
  hmLabel: string | null;
  summary: CohortSummary;
  openSc12: number;
  isNoHouseBucket: boolean;
};

export type TrailRowView = {
  candidateName: string;
  indexNumber: string;
  subjectId: string;
  subjectName: string;
  grade: WassceGrade;
  moderatedGrade: WassceGrade;
  moderatorLabel: string;
  moderatedAtLabel: string;
  reason: string | null;
};

export type StaleStatementView = {
  name: string;
  indexNumber: string;
  frozenAggregate: number | null;
  liveLabel: string;
};

export type CohortReadinessData = {
  examYear: number;
  predictorName: string | null;
  markingComplete: boolean;
  summary: CohortSummary;
  tiles: CohortTileSet;
  banner: BannerView | null;
  histogram: HistogramBin[];
  histogramMax: number;
  programmes: ProgrammeBarView[];
  heatmap: HeatmapRowView[];
  concerns: ConcernCardView[];
  resultCreditPct: number;
  atRisk: AtRiskRowView[];
  houses: HouseCardView[];
  trail: TrailRowView[];
  stale: StaleStatementView[];
};

/* ------------------------------------------------------------------------------------- the loader */

/** Load the whole HoA cohort surface, tenant-scoped. Call inside `withSchool(...)`. */
export async function loadCohortReadiness(
  tx: Tx,
  schoolId: string,
): Promise<CohortReadinessData | null> {
  const cohort = await getActiveCohort(tx, schoolId);
  if (!cohort) return null;

  // ---- the roster (candidate ⋈ student ⋈ programme, House left-joined: day candidates have none)
  const candidates = await tx
    .select({
      id: wassceCandidates.id,
      indexNumber: wassceCandidates.indexNumber,
      firstName: students.firstName,
      lastName: students.lastName,
      houseId: students.houseId,
      programmeKey: wassceProgrammes.programme,
    })
    .from(wassceCandidates)
    .innerJoin(
      students,
      and(
        eq(students.schoolId, wassceCandidates.schoolId),
        eq(students.id, wassceCandidates.studentId),
      ),
    )
    .innerJoin(
      wassceProgrammes,
      and(
        eq(wassceProgrammes.schoolId, wassceCandidates.schoolId),
        eq(wassceProgrammes.id, wassceCandidates.programmeId),
      ),
    )
    .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.cohortId, cohort.id)));

  const candidateIds = candidates.map((c) => c.id);

  // ---- the predictor mock + ONE batched registration ⋈ result pass (drives every derived figure)
  const [predictor] = await tx
    .select({ id: mockExams.id, name: mockExams.name, markingCompleteAt: mockExams.markingCompleteAt })
    .from(mockExams)
    .where(
      and(
        eq(mockExams.schoolId, schoolId),
        eq(mockExams.cohortId, cohort.id),
        eq(mockExams.isPredictor, true),
      ),
    );
  const { rows, projections } = await computeCohortProjections(tx, schoolId, cohort.id);

  const byCandidateRows = new Map<string, CohortPredictorRow[]>();
  for (const r of rows) {
    const list = byCandidateRows.get(r.candidateId) ?? [];
    list.push(r);
    byCandidateRows.set(r.candidateId, list);
  }

  // ---- tagged university targets (GLOBAL programme reference joined; prerequisite check per target)
  const targetRows = candidateIds.length
    ? await tx
        .select({
          candidateId: universityTargets.candidateId,
          cutOff: universityProgrammes.currentCutOff,
          programmeName: universityProgrammes.name,
          qualification: universityProgrammes.qualification,
          prerequisiteSubjectsJson: universityProgrammes.prerequisiteSubjectsJson,
          shortName: universities.shortName,
        })
        .from(universityTargets)
        .innerJoin(
          universityProgrammes,
          eq(universityProgrammes.id, universityTargets.universityProgrammeId),
        )
        .innerJoin(universities, eq(universities.id, universityProgrammes.universityId))
        .where(
          and(
            eq(universityTargets.schoolId, schoolId),
            inArray(universityTargets.candidateId, candidateIds),
          ),
        )
    : [];

  // ---- SC filings (the OPEN_SC12 clause + the per-house count)
  const scRows = candidateIds.length
    ? await tx
        .select({
          candidateId: waecSpecialConsideration.candidateId,
          scForm: waecSpecialConsideration.scForm,
          status: waecSpecialConsideration.status,
        })
        .from(waecSpecialConsideration)
        .where(
          and(
            eq(waecSpecialConsideration.schoolId, schoolId),
            inArray(waecSpecialConsideration.candidateId, candidateIds),
          ),
        )
    : [];
  const scByCandidate = new Map<string, { scForm: string; status: string }[]>();
  for (const s of scRows) {
    const list = scByCandidate.get(s.candidateId) ?? [];
    list.push({ scForm: s.scForm, status: s.status });
    scByCandidate.set(s.candidateId, list);
  }

  /* ---------------------------------------------------------------- §3 · the at-risk assessment */

  const targetsByCandidate = new Map<string, typeof targetRows>();
  for (const t of targetRows) {
    const list = targetsByCandidate.get(t.candidateId) ?? [];
    list.push(t);
    targetsByCandidate.set(t.candidateId, list);
  }

  const notComputable: ProjectionResult = { computable: false, reason: "INSUFFICIENT_CORES" };
  const assessments = new Map<string, ReturnType<typeof assessCandidateRisk>>();
  const atRisk: AtRiskRowView[] = [];

  for (const c of candidates) {
    const projection = projections.get(c.id) ?? notComputable;
    const subjectRows = byCandidateRows.get(c.id) ?? [];
    const registered = subjectRows.map((r) => r.name);
    const grades: Record<string, WassceGrade> = {};
    for (const r of subjectRows) {
      if (r.grade) grades[r.name] = effectiveGrade({ grade: r.grade, moderatedGrade: r.moderatedGrade });
    }

    const tagged = targetsByCandidate.get(c.id) ?? [];
    const checked = tagged.map((t) => ({
      ...t,
      prerequisites: checkPrerequisites(
        parsePrerequisiteRules(t.prerequisiteSubjectsJson),
        grades,
        registered,
      ),
    }));

    const name = shortName(c.firstName, c.lastName);
    const risk = assessCandidateRisk({
      name,
      projection,
      targets: checked.map((t) => ({ cutOff: t.cutOff, prerequisites: t.prerequisites })),
      scForms: scByCandidate.get(c.id) ?? [],
    });
    assessments.set(c.id, risk);
    if (!risk.atRisk) continue;

    // The displayed target IS the one the rule judged: MAX(cut_off), the least-ambitious school.
    const lowest = checked.reduce<(typeof checked)[number] | null>(
      (best, t) => (!best || t.cutOff > best.cutOff ? t : best),
      null,
    );
    const aggregate = projection.computable ? projection.aggregate : null;

    atRisk.push({
      candidateId: c.id,
      name,
      initials: `${(c.firstName[0] ?? "").toUpperCase()}${(c.lastName[0] ?? "").toUpperCase()}`,
      indexNumber: c.indexNumber,
      programmeKey: c.programmeKey as WassceProgrammeKey,
      programmeLabel: PROGRAMME_TRACKS[c.programmeKey as WassceProgrammeKey]?.shortLabel ?? "—",
      aggregate,
      aggregateTierKey: aggregate == null ? null : cohortTier(aggregate).key,
      lowestTargetLabel: lowest ? `${lowest.qualification} ${lowest.programmeName} · ${lowest.shortName}` : null,
      lowestTargetSub: lowest ? `cut-off ${lowest.cutOff}` : null,
      gap: risk.gap,
      gapLabel:
        risk.gap == null
          ? "—"
          : risk.gap > 0
            ? `+${risk.gap} over`
            : risk.gap < 0
              ? `−${-risk.gap} within`
              : "0 on",
      gapTone:
        risk.gap == null ? "none" : risk.gap >= 3 ? "over" : risk.gap > 0 ? "tight" : "ok",
      reasons: risk.reasons,
      sortKey: risk.sortKey,
    });
  }
  atRisk.sort(compareRisk);

  /* ------------------------------------------------------------------------ §1 · roll-up + tiles */

  const entries = candidates.map((c) => {
    const p = projections.get(c.id);
    return {
      aggregate: p && p.computable ? p.aggregate : null,
      atRisk: assessments.get(c.id)?.atRisk ?? false,
    };
  });
  const summary = cohortSummary(entries);

  const histogram = aggregateHistogram(
    entries.map((e) => e.aggregate).filter((a): a is number => a != null),
  );
  const histogramMax = Math.max(1, ...histogram.map((b) => b.count));

  // All-credit candidates: EVERY graded predictor result is a credit ÷ candidates with ≥1 graded result.
  let allCreditNumerator = 0;
  let allCreditDenominator = 0;
  for (const c of candidates) {
    const graded = (byCandidateRows.get(c.id) ?? [])
      .filter((r): r is CohortPredictorRow & { grade: WassceGrade } => r.grade != null)
      .map((r) => effectiveGrade({ grade: r.grade, moderatedGrade: r.moderatedGrade }));
    if (graded.length === 0) continue;
    allCreditDenominator += 1;
    if (graded.every(isCredit)) allCreditNumerator += 1;
  }

  // ---- today's papers: the ONLY honest "expected in centre" figure (scheduled sittings − exempted)
  const papers = await tx
    .select({
      id: wasscePapers.id,
      name: wasscePapers.name,
      scheduledDate: wasscePapers.scheduledDate,
      scheduledTime: wasscePapers.scheduledTime,
      durationMinutes: wasscePapers.durationMinutes,
    })
    .from(wasscePapers)
    .where(and(eq(wasscePapers.schoolId, schoolId), eq(wasscePapers.cohortId, cohort.id)))
    .orderBy(asc(wasscePapers.scheduledDate), asc(wasscePapers.scheduledTime));

  const today = isoDay(new Date());
  const dated = papers.filter((p) => p.scheduledDate != null);
  const papersToday = dated.filter((p) => p.scheduledDate === today);
  const nextPaper = dated.find((p) => (p.scheduledDate as string) > today) ?? null;

  let scheduledToday = 0;
  let exemptedToday = 0;
  if (papersToday.length) {
    const sittings = await tx
      .select({ exemptedAt: wasscePaperSittings.exemptedAt })
      .from(wasscePaperSittings)
      .where(
        and(
          eq(wasscePaperSittings.schoolId, schoolId),
          inArray(
            wasscePaperSittings.paperId,
            papersToday.map((p) => p.id),
          ),
        ),
      );
    scheduledToday = sittings.length;
    exemptedToday = sittings.filter((s) => s.exemptedAt != null).length;
  }

  const firstDay = dated[0]?.scheduledDate ?? null;
  const dayIndex =
    firstDay && papersToday.length
      ? Math.round(
          (Date.parse(`${today}T00:00:00`) - Date.parse(`${firstDay}T00:00:00`)) / 86_400_000,
        ) + 1
      : null;

  const endClock = (start: string | null, mins: number | null) => {
    if (!start) return null;
    const [h, m] = start.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m) || mins == null) return start;
    const total = h * 60 + m + mins;
    return `${start}–${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  // The banner states the DAY and the SCHEDULED CLOCK — both derivable. It never claims who is in the
  // centre, that a paper is "underway", or that there are "no other anomalies" (R4a).
  const banner: BannerView | null =
    papersToday.length && dayIndex != null
      ? {
          title: `WASSCE ${cohort.examYear} · Day ${dayIndex}`,
          papers: papersToday.map((p) => ({
            name: p.name,
            window: endClock(p.scheduledTime, p.durationMinutes) ?? "time not scheduled",
          })),
          exemptedNote:
            exemptedToday > 0
              ? `${exemptedToday} candidate${exemptedToday === 1 ? "" : "s"} exempted from today's papers`
              : null,
        }
      : null;

  const gradedResults = rows.filter((r) => r.grade != null).length;

  const tiles: CohortTileSet = {
    expectedInCentre: papersToday.length ? scheduledToday - exemptedToday : null,
    exemptedToday,
    scheduledToday,
    nextPaperLabel:
      papersToday.length || !nextPaper
        ? null
        : `${nextPaper.name} · ${fmtDate(nextPaper.scheduledDate as string)}`,
    median: summary.median,
    mean: summary.mean,
    medianTierLabel: summary.medianTier ? `${summary.medianTier.name} · ${summary.medianTier.range}` : null,
    allCreditNumerator,
    allCreditDenominator,
    atRisk: summary.atRisk,
    noTargetTagged: candidates.filter((c) => (targetsByCandidate.get(c.id) ?? []).length === 0).length,
    gradedResults,
    expectedResults: rows.length,
    markingComplete: predictor?.markingCompleteAt != null,
  };

  /* --------------------------------------------------------------------- §1 · programme breakdown */

  const programmes: ProgrammeBarView[] = PROGRAMME_ORDER.map((key) => {
    const slice = candidates.filter((c) => c.programmeKey === key);
    const s = cohortSummary(
      slice.map((c) => {
        const p = projections.get(c.id);
        return {
          aggregate: p && p.computable ? p.aggregate : null,
          atRisk: assessments.get(c.id)?.atRisk ?? false,
        };
      }),
    );
    return {
      key,
      label: PROGRAMME_TRACKS[key].shortLabel,
      total: s.total,
      computable: s.computable,
      tiers: TARGET_TIER_BANDS.map((band) => ({
        key: band.key,
        name: band.name,
        count: s.tierCounts[band.key] ?? 0,
        pct: pct1(s.tierCounts[band.key] ?? 0, s.computable),
        color: TIER_COLORS[band.key],
      })),
    };
  }).filter((p) => p.total > 0);

  /* ------------------------------------------------------------------------------- §2 · heatmap */

  // `wassce_subjects` is UNIQUE per (school, PROGRAMME, name), so one subject exists as several rows —
  // every CORE four times, and Biology twice (ELECTIVE under Science, OPTIONAL under Home Ec). The HoA
  // reads ONE row per subject covering the whole cohort ("English Language · 240"), so the copies are
  // merged by NAME; a subject that is CORE anywhere sorts with the cores. The deep link targets whichever
  // copy carries the most registrations.
  const bySubject = new Map<string, CohortPredictorRow[]>();
  for (const r of rows) {
    const list = bySubject.get(r.name) ?? [];
    list.push(r);
    bySubject.set(r.name, list);
  }

  const heatmap: HeatmapRowView[] = [...bySubject.values()]
    .map((subjectRows) => {
      const byId = new Map<string, number>();
      for (const r of subjectRows) byId.set(r.subjectId, (byId.get(r.subjectId) ?? 0) + 1);
      const subjectId = [...byId.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      const grades = subjectRows
        .filter((r): r is CohortPredictorRow & { grade: WassceGrade } => r.grade != null)
        .map((r) => effectiveGrade({ grade: r.grade, moderatedGrade: r.moderatedGrade }));
      const dist = gradeDistribution(grades);
      const belowCredit = grades.filter((g) => !isCredit(g)).length;
      return {
        subjectId,
        label: subjectRows[0].name,
        // Explicit precedence CORE > ELECTIVE > OPTIONAL. Falling back to `subjectRows[0].type` made the
        // badge NON-DETERMINISTIC for a subject that is ELECTIVE under one programme and OPTIONAL under
        // another (Biology): the driving query has no ORDER BY, so the badge flickered between loads.
        // No figure depends on this — `projectAggregate` pools ELECTIVE and OPTIONAL identically.
        type: subjectRows.some((r) => r.type === "CORE")
          ? ("CORE" as const)
          : subjectRows.some((r) => r.type === "ELECTIVE")
            ? ("ELECTIVE" as const)
            : ("OPTIONAL" as const),
        // How many per-programme copies this row merges. >1 means the deep link can only open ONE of
        // them, so the view must say so rather than let a "240 registered" row land on a 60-row page.
        copies: byId.size,
        registered: subjectRows.length,
        graded: grades.length,
        counts: WASSCE_GRADES.map((g) => ({ grade: g, count: dist[g] })),
        belowCredit,
        belowCreditPct: pct1(belowCredit, grades.length),
        f9: dist.F9,
        tag: subjectHeatTag(belowCredit, grades.length),
      };
    })
    // CORE first, then ELECTIVE/OPTIONAL; alphabetical within each group.
    .sort((a, b) => {
      const rank = (t: string) => (t === "CORE" ? 0 : 1);
      return rank(a.type) - rank(b.type) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
    });

  // The concern/watch cards are COMPUTED, never ported: the surface's Elective-Math card states "(33%)"
  // where the true share is 40.7%, and calls it the largest below-credit CONCENTRATION when Core Maths
  // has more by count (44 vs 35) — true only as a SHARE. Both figures come off the rows here.
  const tagged = heatmap
    .filter((r) => r.tag != null)
    .sort((a, b) => b.belowCreditPct - a.belowCreditPct || b.belowCredit - a.belowCredit);
  const topShare = tagged[0]?.subjectId ?? null;
  const concerns: ConcernCardView[] = [
    ...tagged.filter((r) => r.tag === "CONCERN").slice(0, 2),
    ...tagged.filter((r) => r.tag === "WATCH").slice(0, 1),
  ].map((r, i) => ({
    subjectId: r.subjectId,
    tag: r.tag as Exclude<SubjectHeatTag, null>,
    heading:
      r.tag === "CONCERN" ? `Concern subject ${i + 1} · ${r.label}.` : `Watch subject · ${r.label}.`,
    body: [
      `${r.belowCredit} of ${r.graded} graded (${r.belowCreditPct}%) below credit · ${r.f9} F9${r.f9 === 1 ? "" : "s"}.`,
      r.subjectId === topShare ? "Largest below-credit share of any single subject." : null,
    ]
      .filter(Boolean)
      .join(" "),
  }));

  const allGrades = rows
    .filter((r): r is CohortPredictorRow & { grade: WassceGrade } => r.grade != null)
    .map((r) => effectiveGrade({ grade: r.grade, moderatedGrade: r.moderatedGrade }));

  /* ---------------------------------------------------------------------------- §4 · house × tier */

  const houseRows = await tx
    .select({
      id: houses.id,
      name: houses.name,
      colour: houses.colour,
      hmName: users.fullName,
    })
    .from(houses)
    .leftJoin(users, eq(users.id, houses.hmUserId))
    .where(eq(houses.schoolId, schoolId))
    .orderBy(asc(houses.name));

  const openSc12For = (ids: string[]) =>
    ids.filter((id) =>
      (scByCandidate.get(id) ?? []).some(
        (s) => s.scForm === "SC-12" && s.status !== "COMPLETED" && s.status !== "REJECTED",
      ),
    ).length;

  const houseCard = (
    key: string,
    name: string,
    colour: string | null,
    hmLabel: string | null,
    slice: typeof candidates,
    isNoHouseBucket: boolean,
  ): HouseCardView => ({
    key,
    name,
    colour,
    hmLabel,
    summary: cohortSummary(
      slice.map((c) => {
        const p = projections.get(c.id);
        return {
          aggregate: p && p.computable ? p.aggregate : null,
          atRisk: assessments.get(c.id)?.atRisk ?? false,
        };
      }),
    ),
    openSc12: openSc12For(slice.map((c) => c.id)),
    isNoHouseBucket,
  });

  const houseCards: HouseCardView[] = houseRows
    .map((h) =>
      houseCard(
        h.id,
        h.name,
        h.colour,
        h.hmName ? `HM ${h.hmName}` : null,
        candidates.filter((c) => c.houseId === h.id),
        false,
      ),
    )
    .filter((h) => h.summary.total > 0);

  // A candidate with NO House is BUCKETED, never dropped — the demo school is 720 boarders + 480 day,
  // and silently omitting the day candidates would understate every tier and at-risk count (R7/AC18).
  const dayCandidates = candidates.filter((c) => c.houseId == null);
  if (dayCandidates.length) {
    houseCards.push(
      houseCard("no-house", "No house · day candidates", null, null, dayCandidates, true),
    );
  }

  /* ------------------------------------------------------- moderation trail + stale-statement badge */

  const trailRows = predictor
    ? await tx
        .select({
          firstName: students.firstName,
          lastName: students.lastName,
          indexNumber: wassceCandidates.indexNumber,
          subjectId: wassceSubjects.id,
          subjectName: wassceSubjects.name,
          grade: mockResults.grade,
          moderatedGrade: mockResults.moderatedGrade,
          moderatedAt: mockResults.moderatedAt,
          moderationReason: mockResults.moderationReason,
          moderatorName: users.fullName,
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
          and(
            eq(students.schoolId, wassceCandidates.schoolId),
            eq(students.id, wassceCandidates.studentId),
          ),
        )
        .innerJoin(
          wassceSubjects,
          and(
            eq(wassceSubjects.schoolId, mockResults.schoolId),
            eq(wassceSubjects.id, mockResults.subjectId),
          ),
        )
        .leftJoin(users, eq(users.id, mockResults.moderatorUserId))
        .where(
          and(
            eq(mockResults.schoolId, schoolId),
            eq(mockResults.mockId, predictor.id),
            isNotNull(mockResults.moderatedGrade),
          ),
        )
    : [];

  const trail: TrailRowView[] = trailRows
    .sort((a, b) => (b.moderatedAt?.getTime() ?? 0) - (a.moderatedAt?.getTime() ?? 0))
    .map((t) => ({
      candidateName: shortName(t.firstName, t.lastName),
      indexNumber: t.indexNumber,
      subjectId: t.subjectId,
      subjectName: t.subjectName,
      grade: t.grade as WassceGrade,
      moderatedGrade: t.moderatedGrade as WassceGrade,
      moderatorLabel: t.moderatorName ?? "—",
      moderatedAtLabel: t.moderatedAt ? fmtStamp(t.moderatedAt) : "—",
      reason: t.moderationReason,
    }));

  // R1.6 — the stale badge is DERIVED on read: a CURRENT statement whose frozen aggregate no longer
  // matches the live projection. Nothing is stored, nothing auto-regenerates, nothing auto-supersedes.
  const statements = candidateIds.length
    ? await tx
        .select({
          candidateId: readinessStatements.candidateId,
          projectedAggregate: readinessStatements.projectedAggregate,
        })
        .from(readinessStatements)
        .where(
          and(
            eq(readinessStatements.schoolId, schoolId),
            isNull(readinessStatements.supersededAt),
            inArray(readinessStatements.candidateId, candidateIds),
          ),
        )
    : [];
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const stale: StaleStatementView[] = [];
  for (const s of statements) {
    const c = candidateById.get(s.candidateId);
    if (!c) continue;
    const live = projections.get(s.candidateId);
    const liveAggregate = live && live.computable ? live.aggregate : null;
    if (liveAggregate === s.projectedAggregate) continue;
    stale.push({
      name: shortName(c.firstName, c.lastName),
      indexNumber: c.indexNumber,
      frozenAggregate: s.projectedAggregate,
      liveLabel: liveAggregate == null ? "projection pending" : String(liveAggregate),
    });
  }

  return {
    examYear: cohort.examYear,
    predictorName: predictor?.name ?? null,
    markingComplete: predictor?.markingCompleteAt != null,
    summary,
    tiles,
    banner,
    histogram,
    histogramMax,
    programmes,
    heatmap,
    concerns,
    resultCreditPct: toPct(creditRate(allGrades)),
    atRisk,
    houses: houseCards,
    trail,
    stale,
  };
}
