import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import {
  students,
  studentGuardians,
  wassceCandidates,
  wasscePaperSittings,
  wasscePapers,
  waecSpecialConsideration,
  readinessStatements,
  notificationLog,
} from "@/db/schema";
import { linkedSchoolIds } from "./parent-data";
import { sanitizeSnapshot, type AckMethod, type SanitizedSnapshot } from "@/lib/wassce/parent-copy";
import type { MatchBand, MatchMargin, FrozenTargetUniversity } from "@/lib/wassce/university-match";
import type { WassceProgrammeKey } from "@/lib/wassce/constants";

/**
 * The INCR-19b parent-portal read loader (SHS module 4.3). SERVER-ONLY — imports the db driver, so a
 * client component must never import it (only `pnpm build` catches that leak; the reports-data precedent).
 * The whole §1-§5 payload the read-only surface needs, fetched ENTIRELY under `withParentScope` and ONLY
 * from the 9 parent-readable tables, with EXPLICIT parent-safe column lists — RLS is row-level and cannot
 * mask a column, so the redaction of `reg_flag` (D9) and SC `notes`/`filed_by_user_id` (D8) is enforced
 * HERE by never selecting them. Nothing widens the 19a boundary; this reads within it.
 *
 * WHAT IS DELIBERATELY NOT READ (omit-not-fake, Kofi R5): Sickbay (ward/bed/clinician/treatment/NHIS —
 * module 4.4, unbuilt), staff phone numbers / per-child staff names (role_assignment — not parent-
 * readable), the cohort `band` (stripped by `sanitizeSnapshot`, R6), and `mock_results` grades (a parent
 * sees grades ONLY via the frozen snapshot). §4 reads `notification_log` scoped to the child + the
 * parent's OWN stored phone; that table is parent-DENIED by the 19a boundary, so it returns [] today and
 * §4 omits — the query stays so §4 lights up the day a comms increment grants it a parent_scope policy.
 */

export type ParentPortalPaper = {
  paperId: string;
  name: string;
  scheduledDate: string | null; // 'YYYY-MM-DD'
  scheduledTime: string | null;
  durationMinutes: number | null;
  paperType: string;
  satAt: Date | null;
  exemptedAt: Date | null;
};

/** An SC filing, PUBLIC fields only — NEVER `notes` / `filed_by_user_id` (D8). */
export type ParentPortalSc = {
  scForm: string;
  status: string;
  filedAt: Date | null;
  waecRef: string | null;
  waecAcknowledgedAt: Date | null;
  approvedAt: Date | null;
  makeUpScheduledAt: Date | null;
  makeUpCentre: string | null;
  completedAt: Date | null;
};

export type ParentPortalStatement = {
  id: string;
  projectedAggregate: number | null; // NO band / projectedBand (R6)
  generatedAt: Date;
  parentAcknowledgedAt: Date | null;
  parentAckMethod: AckMethod;
  parentAckPhone: string | null;
  parentConcernsText: string | null;
  targets: FrozenTargetUniversity[];
  snapshot: SanitizedSnapshot; // band-stripped
};

export type ParentPortalSms = { createdAt: Date; message: string; status: string };

export type ParentPortalCandidate = {
  indexNumber: string;
  centreCode: string;
  candidateStatus: string;
  papers: ParentPortalPaper[];
  specialConsiderations: ParentPortalSc[];
  statement: ParentPortalStatement | null;
  smsThread: ParentPortalSms[];
};

export type ParentPortalChild = {
  studentId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  formLabel: string | null;
  programme: WassceProgrammeKey | null;
  dateOfBirth: string | null;
  candidate: ParentPortalCandidate | null;
};

export type ParentPortalData = {
  guardianName: string | null;
  guardianRelationship: string | null;
  guardianPhone: string | null;
  children: ParentPortalChild[];
  hasChildrenAtOtherSchools: boolean;
};

/** Parse the frozen `target_universities_json` (jsonb → unknown) into the fields the surface renders. */
function parseTargets(json: unknown): FrozenTargetUniversity[] {
  if (!Array.isArray(json)) return [];
  const out: FrozenTargetUniversity[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const m = (t.margin && typeof t.margin === "object" ? t.margin : {}) as Record<string, unknown>;
    const margin: MatchMargin = {
      direction:
        m.direction === "inside" || m.direction === "outside" || m.direction === "on"
          ? m.direction
          : "on",
      points: typeof m.points === "number" ? m.points : 0,
    };
    out.push({
      universityName: str(t.universityName),
      shortName: str(t.shortName),
      universityType: str(t.universityType),
      programmeName: str(t.programmeName),
      qualification: str(t.qualification),
      location: str(t.location),
      cutOff: num(t.cutOff),
      cutOffReferenceYear: num(t.cutOffReferenceYear),
      targetRank: typeof t.targetRank === "string" ? t.targetRank : null,
      isPrimary: t.isPrimary === true,
      projectedAggregate: num(t.projectedAggregate),
      matchBand: (["SAFETY", "COMFORTABLE", "MATCH", "STRETCH"].includes(String(t.matchBand))
        ? t.matchBand
        : "MATCH") as MatchBand,
      displayTier: (t.displayTier as FrozenTargetUniversity["displayTier"]) ?? "MATCH",
      margin,
      prerequisites: (t.prerequisites as FrozenTargetUniversity["prerequisites"]) ?? {
        met: false,
        status: "PENDING",
        unmet: [],
        pending: [],
      },
    });
  }
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

const isAckMethod = (v: string | null): AckMethod =>
  v === "PHONE_OTP" || v === "IN_PERSON" || v === "PDF_UPLOAD" ? v : null;

/** Load the full portal payload for ONE child — MUST run on a `tx` already scoped by withParentScope. */
export async function loadParentPortalTx(
  tx: Tx,
  schoolId: string,
  userId: string,
): Promise<ParentPortalData> {
  // The parent's OWN guardian row (student_guardian is scoped to user_id = this parent by parent_scope,
  // so this never reads a co-guardian's row). name/relationship/phone for the header + the §4 filter.
  const [me] = await tx
    .select({
      name: studentGuardians.name,
      relationship: studentGuardians.relationship,
      phone: studentGuardians.phone,
    })
    .from(studentGuardians)
    .where(and(eq(studentGuardians.schoolId, schoolId), eq(studentGuardians.userId, userId)))
    .limit(1);

  const kids = await tx
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      formLabel: students.currentClassLabel,
      programme: students.programme,
      dateOfBirth: students.dateOfBirth,
    })
    .from(students)
    .where(eq(students.schoolId, schoolId));

  const children: ParentPortalChild[] = [];
  for (const kid of kids) {
    const [cand] = await tx
      .select({
        id: wassceCandidates.id,
        indexNumber: wassceCandidates.indexNumber,
        centreCode: wassceCandidates.centreCode,
        candidateStatus: wassceCandidates.candidateStatus,
      })
      .from(wassceCandidates)
      .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.studentId, kid.id)))
      .limit(1);

    let candidate: ParentPortalCandidate | null = null;
    if (cand) {
      // §2 — DRIVE FROM THE CHILD'S SITTINGS (candidate-scoped), then join papers (Lucy leak #1: never
      // drive from the cohort-wide wassce_papers). parent_scope on wassce_papers also row-limits to the
      // papers this child sits, so this can only ever return the child's own timetable.
      const paperRows = await tx
        .select({
          paperId: wasscePapers.id,
          name: wasscePapers.name,
          scheduledDate: wasscePapers.scheduledDate,
          scheduledTime: wasscePapers.scheduledTime,
          durationMinutes: wasscePapers.durationMinutes,
          paperType: wasscePapers.paperType,
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

      const papers = paperRows
        .map((p) => ({ ...p, durationMinutes: p.durationMinutes ?? null }))
        .sort(byScheduled);

      // §3 — SC public fields only; DRAFT hidden (Lucy: the school hasn't filed).
      const specialConsiderations = await tx
        .select({
          scForm: waecSpecialConsideration.scForm,
          status: waecSpecialConsideration.status,
          filedAt: waecSpecialConsideration.filedAt,
          waecRef: waecSpecialConsideration.waecRef,
          waecAcknowledgedAt: waecSpecialConsideration.waecAcknowledgedAt,
          approvedAt: waecSpecialConsideration.approvedAt,
          makeUpScheduledAt: waecSpecialConsideration.makeUpScheduledAt,
          makeUpCentre: waecSpecialConsideration.makeUpCentre,
          completedAt: waecSpecialConsideration.completedAt,
        })
        .from(waecSpecialConsideration)
        .where(
          and(
            eq(waecSpecialConsideration.schoolId, schoolId),
            eq(waecSpecialConsideration.candidateId, cand.id),
            ne(waecSpecialConsideration.status, "DRAFT"),
          ),
        );

      // §5 — the CURRENT (non-superseded) statement; RLS already excludes superseded rows. NO
      // projectedBand column selected (R6); the snapshot is band-stripped by sanitizeSnapshot.
      const [stmt] = await tx
        .select({
          id: readinessStatements.id,
          projectedAggregate: readinessStatements.projectedAggregate,
          snapshot: readinessStatements.projectionSnapshotJson,
          targets: readinessStatements.targetUniversitiesJson,
          generatedAt: readinessStatements.generatedAt,
          parentAcknowledgedAt: readinessStatements.parentAcknowledgedAt,
          parentAckMethod: readinessStatements.parentAcknowledgedSignatureMethod,
          parentAckPhone: readinessStatements.parentAcknowledgedPhone,
          parentConcernsText: readinessStatements.parentConcernsText,
        })
        .from(readinessStatements)
        .where(
          and(
            eq(readinessStatements.schoolId, schoolId),
            eq(readinessStatements.candidateId, cand.id),
          ),
        )
        .limit(1);

      const statement: ParentPortalStatement | null = stmt
        ? {
            id: stmt.id,
            projectedAggregate: stmt.projectedAggregate ?? null,
            generatedAt: stmt.generatedAt,
            parentAcknowledgedAt: stmt.parentAcknowledgedAt ?? null,
            parentAckMethod: isAckMethod(stmt.parentAckMethod),
            parentAckPhone: stmt.parentAckPhone ?? null,
            parentConcernsText: stmt.parentConcernsText ?? null,
            targets: parseTargets(stmt.targets),
            snapshot: sanitizeSnapshot(stmt.snapshot),
          }
        : null;

      // §4 — real SMS rows for THIS child to the parent's OWN stored phone. notification_log is parent-
      // DENIED by the 19a boundary → [] today (§4 omits); the query is boundary-honest and future-proof.
      const smsThread: ParentPortalSms[] = me?.phone
        ? await tx
            .select({
              createdAt: notificationLog.createdAt,
              message: notificationLog.message,
              status: notificationLog.status,
            })
            .from(notificationLog)
            .where(
              and(
                eq(notificationLog.schoolId, schoolId),
                eq(notificationLog.studentId, kid.id),
                eq(notificationLog.phone, me.phone),
              ),
            )
            .orderBy(asc(notificationLog.createdAt))
        : [];

      candidate = {
        indexNumber: cand.indexNumber,
        centreCode: cand.centreCode,
        candidateStatus: cand.candidateStatus,
        papers,
        specialConsiderations,
        statement,
        smsThread,
      };
    }

    children.push({
      studentId: kid.id,
      firstName: kid.firstName,
      lastName: kid.lastName,
      fullName: `${kid.firstName} ${kid.lastName}`.trim(),
      formLabel: kid.formLabel ?? null,
      programme: (kid.programme as WassceProgrammeKey | null) ?? null,
      dateOfBirth: kid.dateOfBirth ?? null,
      candidate,
    });
  }

  return {
    guardianName: me?.name ?? null,
    guardianRelationship: me?.relationship ?? null,
    guardianPhone: me?.phone ?? null,
    children,
    hasChildrenAtOtherSchools: false, // filled by loadParentPortal (identity metadata, outside the scope)
  };
}

/** ordered by exam date then start clock, undated papers last. */
function byScheduled(a: ParentPortalPaper, b: ParentPortalPaper): number {
  if (a.scheduledDate !== b.scheduledDate) {
    if (!a.scheduledDate) return 1;
    if (!b.scheduledDate) return -1;
    return a.scheduledDate < b.scheduledDate ? -1 : 1;
  }
  return (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? "");
}

/** The 19b entry point — the active-school payload (under withParentScope) + the multi-school signal. */
export async function loadParentPortal(
  schoolId: string,
  userId: string,
): Promise<ParentPortalData> {
  const [data, schoolIds] = await Promise.all([
    withParentScope(schoolId, userId, (tx) => loadParentPortalTx(tx, schoolId, userId)),
    linkedSchoolIds(userId),
  ]);
  return { ...data, hasChildrenAtOtherSchools: schoolIds.some((s) => s !== schoolId) };
}
