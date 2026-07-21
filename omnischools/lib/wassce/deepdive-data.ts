import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  students,
  wassceCandidates,
  wassceCandidateSubject,
  wassceSubjects,
  wasscePapers,
  wasscePaperSittings,
  subjects,
  seniorScoreLedger,
  seniorSubjectTeacher,
  academicPeriod,
  attendanceRecords,
  invoices,
  users,
} from "@/db/schema";
import {
  buildLedgerGridView,
  buildScheduleView,
  type CandidateDeepDiveView,
  type LedgerGridView,
  type LedgerPeriodInput,
  type LedgerRowInput,
  type ScheduleRowInput,
} from "./deepdive-view";

/**
 * SERVER-ONLY deep-dive loader for the WASSCE candidate readiness page (SHS module 4.3 / INCR-20 — the
 * Module 4.3 CAPSTONE). Imports the db driver, so a client panel must NEVER import it (repo memory
 * `reports-data-is-server-only`; only `pnpm build` catches the leak). Reads ONLY already-shipped tables —
 * no migration, no schema change. Every query is tenant-scoped inside the caller's `withSchool(...)` (RLS).
 *
 * CONTEXTUAL-ONLY (Decision 12): the ledger read imports NO `compile.ts` / `resolveWeights` /
 * `projectAggregate` — it selects stored category scores, the stored `weighted_total`, and the FROZEN
 * `*_weight_used` snapshot, recomputing nothing (AC2/AC3/AC4).
 *
 * SUBJECT-JOIN SEAM (Kofi + Lucy, Dex FORWARD-1 / INCR-16 R5): the ledger keys on gradebook `subject`,
 * the candidate keys on `wassce_subjects`. We resolve correspondence by NAME within the tenant only —
 * BOTH sides filtered by the active school_id — so a candidate in school A can never resolve a subject or
 * ledger row from school B. No new FK.
 */

const numOrNull = (v: string | number | null): number | null =>
  v == null ? null : typeof v === "number" ? v : Number(v);

const fmtGhs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sep 2025 – Dec 2025" from two `date` strings (UTC, no tz drift). */
const rangeLabel = (start: string, end: string) => {
  const s = new Date(start);
  const e = new Date(end);
  return `${MON[s.getUTCMonth()]} ${s.getUTCFullYear()} – ${MON[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
};
/** Short column header, e.g. "Sem 1 · 2025/26" (period_label collapsed to "Sem N"). */
const columnLabel = (periodLabel: string, academicYear: string) =>
  `${periodLabel.replace(/^Semester\s+/i, "Sem ").replace(/^Term\s+/i, "Term ")} · ${academicYear}`;

/**
 * Load the four NEW deep-dive panels for a candidate (index-keyed, tenant-scoped). Returns null if the
 * candidate is unknown in this school (the page already renders the not-found card in that case).
 */
export async function loadCandidateDeepDive(
  tx: Tx,
  schoolId: string,
  indexNumber: string,
  now: Date,
): Promise<CandidateDeepDiveView | null> {
  const [cand] = await tx
    .select({
      id: wassceCandidates.id,
      studentId: wassceCandidates.studentId,
      classId: students.classId,
      stpshsRef: students.stpshsRef,
    })
    .from(wassceCandidates)
    .innerJoin(
      students,
      and(eq(students.schoolId, wassceCandidates.schoolId), eq(students.id, wassceCandidates.studentId)),
    )
    .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.indexNumber, indexNumber)));
  if (!cand) return null;

  // ── the SENIOR semester axis (F1S1…F3S2), ordered academic_year, period_number ──
  const periodRows = await tx
    .select({
      periodId: academicPeriod.periodId,
      periodLabel: academicPeriod.periodLabel,
      academicYear: academicPeriod.academicYear,
      startsOn: academicPeriod.startsOn,
      endsOn: academicPeriod.endsOn,
    })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.productLine, "SENIOR")))
    .orderBy(asc(academicPeriod.academicYear), asc(academicPeriod.periodNumber));
  const periods: LedgerPeriodInput[] = periodRows.map((p) => ({
    periodId: p.periodId,
    label: columnLabel(p.periodLabel, p.academicYear),
    periodSub: rangeLabel(p.startsOn, p.endsOn),
  }));
  const periodIds = periodRows.map((p) => p.periodId);
  const term = periodRows[periodRows.length - 1] ?? null; // latest SENIOR period = the context window

  // ── the candidate's registered subjects (composite-FK join = intra-tenant, registered-only) ──
  const regSubjects = await tx
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
        eq(wassceCandidateSubject.candidateId, cand.id),
      ),
    )
    .orderBy(asc(wassceSubjects.name));

  // ── name-match wassce_subjects → gradebook subjects, strictly within the tenant (R5 seam) ──
  const names = Array.from(new Set(regSubjects.map((s) => s.name)));
  const gradebookRows = names.length
    ? await tx
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(and(eq(subjects.schoolId, schoolId), inArray(subjects.name, names)))
    : [];
  const gradebookIdByName = new Map(gradebookRows.map((g) => [g.name, g.id]));
  const gradebookIds = gradebookRows.map((g) => g.id);

  // ── the ledger read: stored scores + stored weighted_total + FROZEN weight snapshot (no recompute) ──
  const ledgerRows =
    gradebookIds.length && periodIds.length
      ? await tx
          .select({
            subjectId: seniorScoreLedger.subjectId,
            periodId: seniorScoreLedger.periodId,
            asgnScore: seniorScoreLedger.asgnScore,
            midSemScore: seniorScoreLedger.midSemScore,
            endSemScore: seniorScoreLedger.endSemScore,
            projectScore: seniorScoreLedger.projectScore,
            portfolioScore: seniorScoreLedger.portfolioScore,
            weightedTotal: seniorScoreLedger.weightedTotal,
            asgnWeightUsed: seniorScoreLedger.asgnWeightUsed,
            midSemWeightUsed: seniorScoreLedger.midSemWeightUsed,
            endSemWeightUsed: seniorScoreLedger.endSemWeightUsed,
            projectWeightUsed: seniorScoreLedger.projectWeightUsed,
            portfolioWeightUsed: seniorScoreLedger.portfolioWeightUsed,
          })
          .from(seniorScoreLedger)
          .where(
            and(
              eq(seniorScoreLedger.schoolId, schoolId),
              eq(seniorScoreLedger.studentId, cand.studentId),
              inArray(seniorScoreLedger.subjectId, gradebookIds),
              inArray(seniorScoreLedger.periodId, periodIds),
            ),
          )
      : [];
  const ledgerBySubject = new Map<string, LedgerRowInput[]>();
  for (const r of ledgerRows) {
    const list = ledgerBySubject.get(r.subjectId) ?? [];
    list.push({
      periodId: r.periodId,
      asgnScore: numOrNull(r.asgnScore),
      midSemScore: numOrNull(r.midSemScore),
      endSemScore: numOrNull(r.endSemScore),
      projectScore: numOrNull(r.projectScore),
      portfolioScore: numOrNull(r.portfolioScore),
      weightedTotal: numOrNull(r.weightedTotal),
      asgnWeightUsed: r.asgnWeightUsed,
      midSemWeightUsed: r.midSemWeightUsed,
      endSemWeightUsed: r.endSemWeightUsed,
      projectWeightUsed: r.projectWeightUsed,
      portfolioWeightUsed: r.portfolioWeightUsed,
    });
    ledgerBySubject.set(r.subjectId, list);
  }

  // ── teacher header per gradebook subject (senior_subject_teacher for the candidate's class × subject) ──
  // Derived ONLY through the student's own class; no class → no teacher name (never fabricated, Kofi OMIT).
  const teacherByGradebookId = new Map<string, string>();
  if (cand.classId && gradebookIds.length) {
    const teachers = await tx
      .select({ subjectId: seniorSubjectTeacher.subjectId, name: users.fullName })
      .from(seniorSubjectTeacher)
      .innerJoin(users, eq(users.id, seniorSubjectTeacher.teacherUserId))
      .where(
        and(
          eq(seniorSubjectTeacher.schoolId, schoolId),
          eq(seniorSubjectTeacher.classId, cand.classId),
          inArray(seniorSubjectTeacher.subjectId, gradebookIds),
        ),
      );
    for (const t of teachers) if (t.name) teacherByGradebookId.set(t.subjectId, t.name);
  }

  const ledgerGrids: LedgerGridView[] = regSubjects.map((s) => {
    const gradebookId = gradebookIdByName.get(s.name) ?? null;
    return buildLedgerGridView({
      subjectId: s.id,
      subjectName: s.name,
      resolved: gradebookId != null,
      teacherLabel: gradebookId ? (teacherByGradebookId.get(gradebookId) ?? null) : null,
      periods,
      rows: gradebookId ? (ledgerBySubject.get(gradebookId) ?? []) : [],
    });
  });
  // Default subject = first CORE by name, else the first registered subject (view-state seed).
  const defaultSubjectId =
    regSubjects.find((s) => s.type === "CORE")?.id ?? regSubjects[0]?.id ?? null;

  // ── §2 schedule: the candidate's papers via their sittings (Sat/Missed/Upcoming from stored fields) ──
  const paperRows = await tx
    .select({
      paperId: wasscePapers.id,
      name: wasscePapers.name,
      paperType: wasscePapers.paperType,
      scheduledDate: wasscePapers.scheduledDate,
      scheduledTime: wasscePapers.scheduledTime,
      durationMinutes: wasscePapers.durationMinutes,
      satAt: wasscePaperSittings.satAt,
      exemptedAt: wasscePaperSittings.exemptedAt,
    })
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
      ),
    );
  const scheduleInput: ScheduleRowInput[] = paperRows.map((p) => ({
    paperId: p.paperId,
    name: p.name,
    paperType: p.paperType,
    scheduledDate: p.scheduledDate ? new Date(p.scheduledDate) : null,
    scheduledTime: p.scheduledTime,
    durationMinutes: p.durationMinutes,
    satAt: p.satAt,
    exemptedAt: p.exemptedAt,
  }));
  const schedule = buildScheduleView(scheduleInput, now);

  // ── §7 attendance cell: rate + absence over the term, honouring the FIVE statuses (Medical ≠ Absent) ──
  let attendance = { value: "—", meta: "No attendance marked this term." };
  if (term) {
    const [att] = await tx
      .select({
        present: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'PRESENT')::int`,
        late: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'LATE')::int`,
        absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'ABSENT')::int`,
        marked: sql<number>`count(*)::int`,
      })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.schoolId, schoolId),
          eq(attendanceRecords.studentId, cand.studentId),
          sql`${attendanceRecords.date} >= ${term.startsOn}::date`,
          sql`${attendanceRecords.date} <= ${term.endsOn}::date`,
        ),
      );
    if (att && att.marked > 0) {
      const pct = Math.round(((att.present + att.late) / att.marked) * 1000) / 10;
      attendance = {
        value: `${pct}%`,
        meta: `${att.absent} absence${att.absent === 1 ? "" : "s"} this term.`,
      };
    }
  }

  // ── §7 fees cell: outstanding = the maintained invoice balance (billed − paid), non-voided only ──
  const [fee] = await tx
    .select({ outstanding: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.schoolId, schoolId),
        eq(invoices.studentId, cand.studentId),
        isNull(invoices.voidedAt),
      ),
    );
  const outstanding = Number(fee?.outstanding ?? 0);
  const fees = {
    value: outstanding <= 0 ? "Paid in full" : `${fmtGhs(outstanding)} outstanding`,
    // "Free SHS" is a display label — never a gate (AC12).
    meta: `Free SHS · ${fmtGhs(Math.max(0, outstanding))} outstanding.`,
  };

  return {
    ledgerGrids,
    defaultSubjectId,
    schedule,
    termLabel: term?.periodLabel ?? null,
    attendance,
    fees,
    stpshs: {
      ref: cand.stpshsRef ?? "pending", // INCR-3 Q1 convention: NULL → literal "pending"
      pending: cand.stpshsRef == null,
      sheetHref: "/senior/score-ledger",
    },
  };
}
