import "server-only";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { withParentScope, withoutTenantScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import {
  students,
  studentGuardians,
  wassceCandidates,
  readinessStatements,
  waecSpecialConsideration,
} from "@/db/schema";

/**
 * The parent-portal read seam (SHS module 4.3 / INCR-19a). SERVER-ONLY — imports the db driver, so a
 * client component must never import this module (only `pnpm build` catches that leak; see the
 * lib/reports/*-data precedent). 19a needs only enough of the payload to EXERCISE the boundary; the full
 * parent surface (and its Ghanaian-ops / no-jargon copy) is 19b.
 *
 * ENTITLEMENT DERIVES FROM THE LIVE GUARDIAN LINK — `student_guardian.user_id = me` — NEVER phone / name
 * / email (Kofi R1, AC L1/L2). Every child-data read runs inside `withParentScope` (AC D10), which sets
 * `app.current_school` + `app.current_parent_user`; the RESTRICTIVE `parent_deny`/`parent_scope` policies
 * (db/sql/policies.sql) then AND-tighten every tenant table to this parent's own children. A parent loader
 * must NEVER run inside `withoutTenantScope` (that bypasses RLS) — the one `withoutTenantScope` call here
 * is `linkedSchoolIdsTx`, an identity-level metadata read of school_ids only (no PII), mirroring how
 * getCurrentUser resolves roles before a tenant context exists.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Claiming-flow seam (used by lib/actions/invites.ts) — the destination is always the STORED number.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export type ParentInviteTarget = { phone: string; fullName: string; studentId: string };

/**
 * AC C1/C2 — resolve the invite DESTINATION from the stored guardian row, never from caller input.
 * Validates the named `student_guardian` row belongs to `(schoolId, studentId)`; the returned `phone` is
 * the guardian's STORED number, so the claim/OTP destination can never be a caller-supplied number.
 */
export async function resolveParentInviteTargetTx(
  tx: Tx,
  schoolId: string,
  studentId: string,
  guardianId: string,
): Promise<ParentInviteTarget | null> {
  const [g] = await tx
    .select({ phone: studentGuardians.phone, name: studentGuardians.name })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.schoolId, schoolId),
        eq(studentGuardians.id, guardianId),
        eq(studentGuardians.studentId, studentId),
      ),
    )
    .limit(1);
  if (!g) return null;
  return { phone: g.phone, fullName: g.name, studentId };
}

/**
 * AC C4 — on a successful claim, stamp `student_guardian.user_id` on the ONE row named by
 * `(schoolId, studentId, phone)`, never other rows that merely SHARE the phone (a guardian of a DIFFERENT
 * child on the same family SIM stays NULL). Idempotent: re-accept by the same user is a no-op and it never
 * overwrites another user's existing claim. Returns the number of rows stamped. Called from `acceptInvite`
 * inside its bypass transaction (the claimant has no tenant session yet).
 */
export async function stampGuardianUserId(
  tx: Tx,
  args: { schoolId: string; studentId: string; phone: string; userId: string },
): Promise<number> {
  const rows = await tx
    .update(studentGuardians)
    .set({ userId: args.userId })
    .where(
      and(
        eq(studentGuardians.schoolId, args.schoolId),
        eq(studentGuardians.studentId, args.studentId),
        eq(studentGuardians.phone, args.phone),
        or(isNull(studentGuardians.userId), eq(studentGuardians.userId, args.userId)),
      ),
    )
    .returning({ id: studentGuardians.id });
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Parent read loader — the child-data payload, ALWAYS under withParentScope.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A Special Consideration filing, PUBLIC fields only — never `notes`/`filed_by_user_id` (AC D8). */
export type ParentSpecialConsideration = {
  scForm: string;
  status: string;
  filedAt: Date | null;
  waecRef: string | null;
  approvedAt: Date | null;
  makeUpScheduledAt: Date | null;
  makeUpCentre: string | null;
  completedAt: Date | null;
};

/** The CURRENT (non-superseded) readiness statement — the frozen snapshot is the ONLY grade source. */
export type ParentStatement = {
  projectedAggregate: number | null;
  projectedBand: string | null;
  snapshot: unknown; // ponytail: 19b must strip the cohort-tier "band" vocabulary from this snapshot copy.
  generatedAt: Date;
  parentAcknowledgedAt: Date | null;
};

/** The child's candidate — WAEC lifecycle only. NEVER `reg_flag` (AC D9), the moderation trail, or mocks. */
export type ParentCandidate = {
  indexNumber: string;
  centreCode: string;
  candidateStatus: string;
  currentStatement: ParentStatement | null;
  specialConsiderations: ParentSpecialConsideration[];
};

export type ParentChild = {
  id: string;
  firstName: string;
  lastName: string;
  studentCode: string;
  candidate: ParentCandidate | null;
};

/**
 * The parent's entitled children in ONE school, with each child's candidate + current statement + filed
 * SC rows. MUST run on a `tx` already scoped by `withParentScope` (see `loadParentChildren`). Every SELECT
 * is column-scoped to the parent-safe fields: RLS is row-level and cannot mask a column, so the redaction
 * of `reg_flag` (D9) and SC `notes`/`filed_by_user_id` (D8) is enforced HERE by not selecting them. Mock
 * grades (`mock_results`) are never read — the parent sees grades only via the frozen snapshot (D3).
 */
export async function loadParentChildrenTx(
  tx: Tx,
  schoolId: string,
  userId: string,
): Promise<ParentChild[]> {
  void userId; // scope is carried by app.current_parent_user (set by withParentScope), not this arg
  const kids = await tx
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      studentCode: students.studentCode,
    })
    .from(students)
    .where(eq(students.schoolId, schoolId));

  const out: ParentChild[] = [];
  for (const kid of kids) {
    const [cand] = await tx
      .select({
        id: wassceCandidates.id,
        indexNumber: wassceCandidates.indexNumber,
        centreCode: wassceCandidates.centreCode,
        candidateStatus: wassceCandidates.candidateStatus,
      })
      .from(wassceCandidates)
      .where(
        and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.studentId, kid.id)),
      )
      .limit(1);

    let candidate: ParentCandidate | null = null;
    if (cand) {
      // RLS already restricts readiness_statements to the current (superseded_at IS NULL) row.
      const [stmt] = await tx
        .select({
          projectedAggregate: readinessStatements.projectedAggregate,
          projectedBand: readinessStatements.projectedBand,
          snapshot: readinessStatements.projectionSnapshotJson,
          generatedAt: readinessStatements.generatedAt,
          parentAcknowledgedAt: readinessStatements.parentAcknowledgedAt,
        })
        .from(readinessStatements)
        .where(
          and(
            eq(readinessStatements.schoolId, schoolId),
            eq(readinessStatements.candidateId, cand.id),
          ),
        )
        .limit(1);

      // Filed SC rows only — a DRAFT SC-12 must NOT be shown (Lucy: the school hasn't filed yet).
      const scs = await tx
        .select({
          scForm: waecSpecialConsideration.scForm,
          status: waecSpecialConsideration.status,
          filedAt: waecSpecialConsideration.filedAt,
          waecRef: waecSpecialConsideration.waecRef,
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

      candidate = {
        indexNumber: cand.indexNumber,
        centreCode: cand.centreCode,
        candidateStatus: cand.candidateStatus,
        currentStatement: stmt ?? null,
        specialConsiderations: scs,
      };
    }

    out.push({
      id: kid.id,
      firstName: kid.firstName,
      lastName: kid.lastName,
      studentCode: kid.studentCode,
      candidate,
    });
  }
  return out;
}

/** AC D10 — the parent data LOADER, ALWAYS wrapped in withParentScope (never withoutTenantScope). */
export async function loadParentChildren(
  schoolId: string,
  userId: string,
): Promise<ParentChild[]> {
  return withParentScope(schoolId, userId, (tx) => loadParentChildrenTx(tx, schoolId, userId));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Multi-school signal (AC M1/M2) — identity-level metadata, school_ids only.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The DISTINCT schools where this user holds a LIVE guardian link (`student_guardian.user_id = me`).
 * Reads ONLY `school_id` — no child PII, no candidate/statement — so it is an identity-level lookup, not
 * a parent data LOADER (AC D10 forbids the LOADER, not this metadata read, from `withoutTenantScope`).
 */
export async function linkedSchoolIdsTx(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ schoolId: studentGuardians.schoolId })
    .from(studentGuardians)
    .where(eq(studentGuardians.userId, userId));
  return rows.map((r) => r.schoolId);
}

export async function linkedSchoolIds(userId: string): Promise<string[]> {
  return withoutTenantScope((tx) => linkedSchoolIdsTx(tx, userId));
}

export type ParentContext = {
  children: ParentChild[];
  /**
   * AC M1/M2 — true when the parent holds a live guardian link at a school OTHER than the active one.
   * `AppUser.roles`/`schoolId` are already active-school-scoped (PR #167), so the active-school child set
   * is correct; this flag lets the 19b surface SAY "children at more than one school; contact the school"
   * instead of silently rendering one school's child as the whole picture.
   */
  hasChildrenAtOtherSchools: boolean;
};

/** The 19b entry point: the active-school children + the has-other-schools signal. */
export async function resolveParentContext(
  userId: string,
  activeSchoolId: string,
): Promise<ParentContext> {
  const [children, schoolIds] = await Promise.all([
    loadParentChildren(activeSchoolId, userId),
    linkedSchoolIds(userId),
  ]);
  return {
    children,
    hasChildrenAtOtherSchools: schoolIds.some((s) => s !== activeSchoolId),
  };
}
