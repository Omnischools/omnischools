import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { wassceCandidates, wasscePapers, waecSpecialConsideration } from "@/db/schema";
import { civilDate } from "./visits";
import { sc12TriggerFires } from "@/lib/wassce/sc12";

/**
 * R226 · SC-12 auto-suggest — the cross-module WRITE (sickbay → WASSCE). A sickbay referral or
 * admission of a live WASSCE candidate whose cohort still has a paper to sit drops a DRAFT SC-12 for
 * the exams officer to review and file. This is a SYSTEM writer: it rides the caller's already
 * MATRON-gated sickbay authz and issues NO `WASSCE_SETUP_ROLES` assertion of its own (the human
 * DRAFT→FILED filing stays `fileScForm`/`WASSCE_SETUP_ROLES`-gated, byte-unchanged).
 *
 * 🔴 SAFETY (R54 / AC-R226-7). It is called BEST-EFFORT, AFTER the clinical tx commits, wrapped in the
 * caller's try/catch, and it opens its OWN `withSchool` — NEVER nested inside the clinical transaction.
 * A throw here therefore can neither roll back nor block the referral/admission; the clinical Result
 * stays `ok`.
 *
 * 🔴 IDEMPOTENT & FILED-SAFE (AC-R226-4/5). `INSERT … ON CONFLICT (school_id, candidate_id, sc_form) DO
 * NOTHING`. A second episode adds no row; a pre-existing FILED (or any) row is left byte-unchanged. It
 * MUST NOT reuse `fileScForm`, whose `onConflictDoUpdate` would downgrade a human FILED row to DRAFT.
 *
 * 🔴 ROW SHAPE (R226.3). status='DRAFT', `filed_at`/`filed_by_user_id`/every ref/every file id/`notes`
 * all NULL — NO clinical field on the SC row. The DRAFT is NOT "filed by" the matron (filed_by NULL);
 * the audit row records who CAUSED the system event (the caller's actor), with no clinical detail in the
 * payload — the `markSickbayMedical` precedent (a derived cross-module write is audited to its caller,
 * the content stays condition-free). The auto-DRAFT flips the candidate at-risk on the HoA board
 * (INCR-18 `OPEN_SC12`) — intended — and stays invisible to the parent portal (the
 * `parent-portal-data.ts:248` `ne(status,'DRAFT')` filter holds).
 */
export async function maybeSuggestSc12(
  schoolId: string,
  studentId: string,
  actor: { id: string | null; role: string },
): Promise<void> {
  // Accra civil date (UTC+0, no DST); `wassce_papers.scheduled_date` is a bare 'YYYY-MM-DD' date column.
  const today = civilDate(new Date());

  await withSchool(schoolId, async (tx) => {
    // A student maps to at most a handful of candidate rows (one per cohort). Resolve them all; the pure
    // gate below decides which — if any — earns a DRAFT.
    const cands = await tx
      .select({
        id: wassceCandidates.id,
        cohortId: wassceCandidates.cohortId,
        status: wassceCandidates.candidateStatus,
      })
      .from(wassceCandidates)
      .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.studentId, studentId)));

    for (const cand of cands) {
      const [paper] = await tx
        .select({ id: wasscePapers.id })
        .from(wasscePapers)
        .where(
          and(
            eq(wasscePapers.schoolId, schoolId),
            eq(wasscePapers.cohortId, cand.cohortId),
            gte(wasscePapers.scheduledDate, today),
          ),
        )
        .limit(1);

      if (!sc12TriggerFires(cand.status, !!paper)) continue;

      const inserted = await tx
        .insert(waecSpecialConsideration)
        .values({
          schoolId,
          candidateId: cand.id,
          scForm: "SC-12",
          status: "DRAFT",
          // R226.3 — a system-suggested DRAFT is NOT a filing: no filer, no workflow stamp, no clinical
          // artifact. Every nullable column stays NULL until a human files it via fileScForm.
          filedAt: null,
          filedByUserId: null,
          medicalCertFileId: null,
          clinicianLetterFileId: null,
          waecAcknowledgedAt: null,
          waecRef: null,
          approvedAt: null,
          makeUpScheduledAt: null,
          makeUpCentre: null,
          completedAt: null,
          notes: null,
        })
        .onConflictDoNothing({
          target: [
            waecSpecialConsideration.schoolId,
            waecSpecialConsideration.candidateId,
            waecSpecialConsideration.scForm,
          ],
        })
        .returning({ id: waecSpecialConsideration.id });

      // Audit ONLY a real insert — a conflict (idempotent no-op) changed nothing, so it records nothing.
      // NO clinical field in the payload (this feed is ADMIN-readable): candidate + form + status only.
      if (inserted.length > 0) {
        await recordAudit(tx, {
          schoolId,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "created",
          entityType: "waec_special_consideration",
          entityId: cand.id,
          after: { scForm: "SC-12", status: "DRAFT", source: "sickbay_auto_suggest" },
          reason: "SC-12 auto-suggested from sickbay (DRAFT)",
        });
      }
    }
  });
}
