"use server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, assertAnyRole } from "@/lib/auth/server";
import { WASSCE_SETUP_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { sendSms } from "@/lib/sms";
import { wassceCandidates, waecSpecialConsideration, readinessStatements } from "@/db/schema";
import {
  computeCandidateProjection,
  buildSnapshot,
  buildTargetSnapshot,
  loadCandidateTargets,
} from "@/lib/wassce/readiness-data";

/**
 * WASSCE readiness write actions (SHS module 4.3 / INCR-17). Three flows, all gated to
 * WASSCE_SETUP_ROLES (HoA/Headmaster/Admin — no new exams-officer role), all tenant-scoped (withSchool),
 * all audit-logged, all re-validate the candidate ∈ school:
 *   • fileScForm            — file / refile / advance a WAEC special-consideration form (SC-3/7/12).
 *   • generateReadinessStatement — run the projection lib ONCE, FREEZE the snapshot; supersede-then-insert.
 *   • recordParentAck       — school-captured parent acknowledgement + a console-degrading confirm SMS.
 * NO trigger writes: the projection is the pure lib, the snapshot is written once by generate, immutable.
 */

const candidatePath = (indexNumber: string) => `/senior/wassce/candidates/${indexNumber}`;

/** Resolve + re-validate a candidate belongs to THIS school; return its index number for revalidation. */
async function requireCandidate(
  tx: Parameters<Parameters<typeof withSchool>[1]>[0],
  schoolId: string,
  candidateId: string,
): Promise<{ id: string; cohortId: string; indexNumber: string } | null> {
  const [c] = await tx
    .select({
      id: wassceCandidates.id,
      cohortId: wassceCandidates.cohortId,
      indexNumber: wassceCandidates.indexNumber,
    })
    .from(wassceCandidates)
    .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.id, candidateId)));
  return c ?? null;
}

// ---------------------------------------------------------------- SC-form filing (WASSCE_SETUP_ROLES)
const ScFormSchema = z.object({
  candidateId: z.string().uuid(),
  scForm: z.enum(["SC-3", "SC-7", "SC-12"]),
  status: z.enum(["DRAFT", "FILED", "ACKNOWLEDGED", "APPROVED", "SCHEDULED", "COMPLETED", "REJECTED"]),
  waecRef: z.string().trim().max(60).optional(),
  makeUpCentre: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

/**
 * File / refile / advance a WAEC special-consideration form. UNIQUE(school_id, candidate_id, sc_form) —
 * a refile UPDATEs the one row (never a second). Stamps the workflow timestamp for the target status,
 * preserving any already-set stamp (idempotent, auditable).
 */
export async function fileScForm(input: unknown): Promise<ActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(WASSCE_SETUP_ROLES);
  const parsed = ScFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid SC form." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  const now = new Date();

  try {
    const outcome = await withSchool(school.id, async (tx): Promise<ActionResult> => {
      const cand = await requireCandidate(tx, school.id, d.candidateId);
      if (!cand) return { ok: false, error: "That candidate is not in this school." };

      const [existing] = await tx
        .select()
        .from(waecSpecialConsideration)
        .where(
          and(
            eq(waecSpecialConsideration.schoolId, school.id),
            eq(waecSpecialConsideration.candidateId, d.candidateId),
            eq(waecSpecialConsideration.scForm, d.scForm),
          ),
        );

      const filed = d.status !== "DRAFT";
      const values = {
        schoolId: school.id,
        candidateId: d.candidateId,
        scForm: d.scForm,
        status: d.status,
        filedAt: filed ? (existing?.filedAt ?? now) : existing?.filedAt ?? null,
        filedByUserId: filed ? (existing?.filedByUserId ?? actor.id ?? undefined) : existing?.filedByUserId ?? undefined,
        waecRef: d.waecRef?.trim() || existing?.waecRef || null,
        waecAcknowledgedAt: d.status === "ACKNOWLEDGED" ? (existing?.waecAcknowledgedAt ?? now) : existing?.waecAcknowledgedAt ?? null,
        approvedAt: d.status === "APPROVED" ? (existing?.approvedAt ?? now) : existing?.approvedAt ?? null,
        makeUpScheduledAt: d.status === "SCHEDULED" ? (existing?.makeUpScheduledAt ?? now) : existing?.makeUpScheduledAt ?? null,
        makeUpCentre: d.makeUpCentre?.trim() || existing?.makeUpCentre || null,
        completedAt: d.status === "COMPLETED" ? (existing?.completedAt ?? now) : existing?.completedAt ?? null,
        notes: d.notes?.trim() || existing?.notes || null,
      };

      await tx
        .insert(waecSpecialConsideration)
        .values(values)
        .onConflictDoUpdate({
          target: [
            waecSpecialConsideration.schoolId,
            waecSpecialConsideration.candidateId,
            waecSpecialConsideration.scForm,
          ],
          set: {
            status: values.status,
            filedAt: values.filedAt,
            filedByUserId: values.filedByUserId,
            waecRef: values.waecRef,
            waecAcknowledgedAt: values.waecAcknowledgedAt,
            approvedAt: values.approvedAt,
            makeUpScheduledAt: values.makeUpScheduledAt,
            makeUpCentre: values.makeUpCentre,
            completedAt: values.completedAt,
            notes: values.notes,
          },
        });

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: existing ? "updated" : "created",
        entityType: "waec_special_consideration",
        entityId: d.candidateId,
        before: existing ? { status: existing.status } : undefined,
        after: { scForm: d.scForm, status: d.status, waecRef: values.waecRef },
        reason: existing ? "SC form advanced" : "SC form filed",
      });
      return { ok: true, id: cand.indexNumber };
    });
    if (outcome.ok && outcome.id) safeRevalidate(candidatePath(outcome.id));
    return outcome;
  } catch {
    return { ok: false, error: "Could not file the SC form. Please try again." };
  }
}

// -------------------------------------------------- readiness statement generate (WASSCE_SETUP_ROLES)
const GenerateSchema = z.object({ candidateId: z.string().uuid() });

/**
 * Generate a readiness statement: run the projection lib ONCE, freeze the aggregate/band/snapshot, and
 * supersede the prior current row THEN insert the new one (the single-current invariant is enforced by
 * write order in this transaction — the current index is intentionally non-unique). Gated on the
 * predictor mock's marking_complete AND a computable projection. NEVER writes the live
 * wassce_candidates.projected_aggregate (stays NULL — the frozen snapshot is the only stored copy).
 */
export async function generateReadinessStatement(input: unknown): Promise<ActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(WASSCE_SETUP_ROLES);
  const parsed = GenerateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid candidate." };
  const actor = await resolveActor(school.id);

  try {
    const outcome = await withSchool(school.id, async (tx): Promise<ActionResult> => {
      const cand = await requireCandidate(tx, school.id, parsed.data.candidateId);
      if (!cand) return { ok: false, error: "That candidate is not in this school." };

      const { predictorMock, rows, mock1, mock2 } = await computeCandidateProjection(
        tx,
        school.id,
        cand.id,
        cand.cohortId,
      );
      if (!predictorMock) return { ok: false, error: "No predictor mock exists for this cohort." };
      if (!predictorMock.markingComplete) {
        return { ok: false, error: "Marking is not complete for the predictor mock — cannot generate yet." };
      }
      if (!mock2.computable) {
        return {
          ok: false,
          error: "Projection is not computable — the candidate needs at least 3 graded cores and 3 graded electives in the predictor mock.",
        };
      }
      const snapshot = buildSnapshot(mock1, mock2);
      if (!snapshot) return { ok: false, error: "Projection is not computable." };

      // INCR-17b/AC14: ALSO freeze the candidate's CURRENT live targets + their computed match. This is
      // the ONLY writer of `target_universities_json` — target CRUD never touches it (AC13), and a later
      // cut-off/target edit moves the live §6 board but never this frozen copy (AC15). None → `[]`.
      const targets = await loadCandidateTargets(tx, school.id, cand.id, rows);
      const targetSnapshot = buildTargetSnapshot(targets, mock2.aggregate);

      // Single-current invariant — SUPERSEDE first, THEN insert. Since INCR-17b/AC21 the partial index
      // `readiness_statements_current_idx` is UNIQUE, so the DB is the structural backstop and a
      // concurrent second generation loses on a unique-violation (degraded by the catch below); this
      // write ORDER is still required so the normal path never trips it. A re-moderation never mutates
      // an existing statement, it supersedes it.
      await tx
        .update(readinessStatements)
        .set({ supersededAt: new Date() })
        .where(
          and(
            eq(readinessStatements.schoolId, school.id),
            eq(readinessStatements.candidateId, cand.id),
            isNull(readinessStatements.supersededAt),
          ),
        );

      const [row] = await tx
        .insert(readinessStatements)
        .values({
          schoolId: school.id,
          candidateId: cand.id,
          mock2Id: predictorMock.id,
          projectedAggregate: mock2.aggregate,
          projectedBand: mock2.band,
          projectionSnapshotJson: snapshot,
          targetUniversitiesJson: targetSnapshot, // frozen live targets + match; `[]` when none (AC14)
          generatedAt: new Date(),
          generatedByUserId: actor.id ?? undefined,
        })
        .returning({ id: readinessStatements.id });

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "readiness_statement",
        entityId: row.id,
        after: {
          candidateId: cand.id,
          aggregate: mock2.aggregate,
          band: mock2.band,
          mock2Id: predictorMock.id,
          targetsFrozen: targetSnapshot.length,
        },
        reason: "Readiness statement generated (projection + university targets frozen)",
      });
      return { ok: true, id: cand.indexNumber };
    });
    if (outcome.ok && outcome.id) safeRevalidate(candidatePath(outcome.id));
    return outcome;
  } catch {
    return { ok: false, error: "Could not generate the readiness statement. Please try again." };
  }
}

// -------------------------------------------------------- parent acknowledgement (WASSCE_SETUP_ROLES)
const ParentAckSchema = z.object({
  candidateId: z.string().uuid(),
  method: z.enum(["PHONE_OTP", "IN_PERSON", "PDF_UPLOAD"]),
  phone: z.string().trim().max(20).optional(),
  concerns: z.string().trim().max(1000).optional(),
});

/**
 * Record a SCHOOL-CAPTURED parent acknowledgement on the candidate's CURRENT statement (the parent-facing
 * signing UI is INCR-19). Sends a confirmation SMS via sendSms() — which DEGRADES to a console log when
 * no Hubtel creds are present (owner-gated; never provisioned here). SMS failure never fails the ack.
 */
export async function recordParentAck(input: unknown): Promise<ActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(WASSCE_SETUP_ROLES);
  const parsed = ParentAckSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid acknowledgement." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  let smsTarget: string | null = null;
  let candidateIndex: string | null = null;
  try {
    const outcome = await withSchool(school.id, async (tx): Promise<ActionResult> => {
      const cand = await requireCandidate(tx, school.id, d.candidateId);
      if (!cand) return { ok: false, error: "That candidate is not in this school." };

      const [current] = await tx
        .select({ id: readinessStatements.id })
        .from(readinessStatements)
        .where(
          and(
            eq(readinessStatements.schoolId, school.id),
            eq(readinessStatements.candidateId, cand.id),
            isNull(readinessStatements.supersededAt),
          ),
        );
      if (!current) {
        return { ok: false, error: "There is no current readiness statement to acknowledge — generate one first." };
      }

      await tx
        .update(readinessStatements)
        .set({
          parentAcknowledgedAt: new Date(),
          parentAcknowledgedSignatureMethod: d.method,
          parentAcknowledgedPhone: d.phone?.trim() || null,
          parentConcernsText: d.concerns?.trim() || null,
        })
        .where(
          and(eq(readinessStatements.schoolId, school.id), eq(readinessStatements.id, current.id)),
        );

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "readiness_statement",
        entityId: current.id,
        after: { parentAck: true, method: d.method },
        reason: "Parent acknowledgement recorded",
      });
      smsTarget = d.phone?.trim() || null;
      candidateIndex = cand.indexNumber;
      return { ok: true, id: cand.indexNumber };
    });

    // Confirmation SMS — console-degrades without Hubtel creds; a send failure never fails the ack.
    if (outcome.ok && smsTarget) {
      try {
        await sendSms(
          smsTarget,
          `Your acknowledgement of the WASSCE readiness statement for candidate ${candidateIndex} has been recorded by the school. Thank you.`,
        );
      } catch {
        /* SMS is best-effort — the ack is already committed */
      }
    }
    if (outcome.ok && outcome.id) safeRevalidate(candidatePath(outcome.id));
    return outcome;
  } catch {
    return { ok: false, error: "Could not record the acknowledgement. Please try again." };
  }
}
