"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool, pgError, isUniqueViolation } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, assertAnyRole } from "@/lib/auth/server";
import { WASSCE_SETUP_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { wassceCandidates, universities, universityProgrammes, universityTargets } from "@/db/schema";
import type { ActionResult } from "@/lib/actions/wassce-readiness";

/**
 * WASSCE university-target write actions (SHS module 4.3 / INCR-17b). Three flows — tag, rank, remove —
 * all gated to WASSCE_SETUP_ROLES (the surface's "Dean of Students" has no `appRoleEnum` equivalent;
 * Lucy Part D / Kofi ratified reuse), all tenant-scoped through `withSchool`, all audit-logged, all
 * re-validating that the candidate belongs to THIS school. The client never supplies a `school_id` —
 * it comes from the session (`requireSchool`) and RLS is the boundary underneath.
 *
 * READ-ONLY GLOBALS: `universities` / `university_programmes` are the seeded published-snapshot
 * reference. There is NO school-facing write path to either — a school tags an existing programme, it
 * never creates or edits one.
 *
 * NOT A STATEMENT WRITER (Kofi R4 / AC13): tagging, ranking or removing a target writes
 * `university_targets` ONLY. It never creates a readiness statement and never supersedes one — the
 * frozen `target_universities_json` moves only when `generateReadinessStatement` runs. The §6 board is
 * derived on read, so a target edit is visible immediately without touching any statement.
 *
 * "Run match · all students" (setup §3) has NO action here on purpose: the match tier is DERIVED, so
 * that control is a READ/refresh of the already-live board, not a stored batch write.
 */

const candidatePath = (indexNumber: string) => `/senior/wassce/candidates/${indexNumber}`;

/**
 * Map a 23505 to the message its constraint earned — both collisions are STRUCTURAL guards (the table's
 * two unique constraints), not app-level pre-checks, so they hold under concurrency. The constraint name
 * is read via `pgError`, which unwraps Drizzle's `DrizzleQueryError` — reading `.code` off the thrown
 * error directly would miss and degrade both to the generic message.
 */
function uniqueMessage(err: unknown): string {
  switch (pgError(err).constraint) {
    case "uniq_university_target_rank":
      return "This candidate already has a programme at that choice. Clear or move the existing one first.";
    case "uniq_university_target_programme":
      return "That programme is already tagged for this candidate.";
    default:
      return "That target conflicts with one this candidate already has.";
  }
}

/** Re-validate a candidate belongs to THIS school; returns its index number for revalidation. */
async function requireCandidate(
  tx: Parameters<Parameters<typeof withSchool>[1]>[0],
  schoolId: string,
  candidateId: string,
): Promise<{ id: string; indexNumber: string } | null> {
  const [c] = await tx
    .select({ id: wassceCandidates.id, indexNumber: wassceCandidates.indexNumber })
    .from(wassceCandidates)
    .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.id, candidateId)));
  return c ?? null;
}

/** Load a target by id WITHIN this school (the tenant re-check for rank/remove), plus its labels. */
async function requireTarget(
  tx: Parameters<Parameters<typeof withSchool>[1]>[0],
  schoolId: string,
  targetId: string,
) {
  const [t] = await tx
    .select({
      id: universityTargets.id,
      candidateId: universityTargets.candidateId,
      targetRank: universityTargets.targetRank,
      programmeName: universityProgrammes.name,
      shortName: universities.shortName,
    })
    .from(universityTargets)
    .innerJoin(
      universityProgrammes,
      eq(universityProgrammes.id, universityTargets.universityProgrammeId),
    )
    .innerJoin(universities, eq(universities.id, universityProgrammes.universityId))
    .where(and(eq(universityTargets.schoolId, schoolId), eq(universityTargets.id, targetId)));
  return t ?? null;
}

const RANKS = ["FIRST_CHOICE", "SECOND_CHOICE", "THIRD_CHOICE"] as const;

// ------------------------------------------------------------------ tag a target (WASSCE_SETUP_ROLES)
const AddTargetSchema = z.object({
  candidateId: z.string().uuid(),
  universityProgrammeId: z.string().uuid(),
  targetRank: z.enum(RANKS).nullish(),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Tag a GLOBAL programme as one of a candidate's university targets. A duplicate programme trips
 * UNIQUE(school_id, candidate_id, university_programme_id); a second FIRST/SECOND/THIRD trips the
 * partial UNIQUE — both degrade to their own message rather than a 500. A NULL rank is always allowed
 * (many unranked supporting choices).
 */
export async function addUniversityTarget(input: unknown): Promise<ActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(WASSCE_SETUP_ROLES);
  const parsed = AddTargetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid target." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const outcome = await withSchool(school.id, async (tx): Promise<ActionResult> => {
      const cand = await requireCandidate(tx, school.id, d.candidateId);
      if (!cand) return { ok: false, error: "That candidate is not in this school." };

      const [programme] = await tx
        .select({ id: universityProgrammes.id, name: universityProgrammes.name })
        .from(universityProgrammes)
        .where(eq(universityProgrammes.id, d.universityProgrammeId));
      if (!programme) return { ok: false, error: "That programme is not in the cut-off reference." };

      const [row] = await tx
        .insert(universityTargets)
        .values({
          schoolId: school.id, // from the SESSION — never a client-supplied school_id
          candidateId: cand.id,
          universityProgrammeId: programme.id,
          targetRank: d.targetRank ?? null,
          taggedByUserId: actor.id ?? undefined,
          notes: d.notes?.trim() || null,
        })
        .returning({ id: universityTargets.id });

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "university_target",
        entityId: row.id,
        after: {
          candidateId: cand.id,
          programme: programme.name,
          targetRank: d.targetRank ?? null,
        },
        reason: "University target tagged",
      });
      return { ok: true, id: cand.indexNumber };
    });
    if (outcome.ok && outcome.id) safeRevalidate(candidatePath(outcome.id));
    return outcome;
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: uniqueMessage(err) };
    return { ok: false, error: "Could not tag that programme. Please try again." };
  }
}

// ------------------------------------------------------------- set / clear a rank (WASSCE_SETUP_ROLES)
const RankSchema = z.object({
  targetId: z.string().uuid(),
  targetRank: z.enum(RANKS).nullish(),
});

/**
 * Set or clear a target's `target_rank`. FIRST_CHOICE is what drives the §6 TARGET overlay, so this is
 * the "make this the primary choice" control. A second FIRST/SECOND/THIRD for the same candidate trips
 * the partial UNIQUE and degrades cleanly; clearing to NULL always succeeds.
 */
export async function setUniversityTargetRank(input: unknown): Promise<ActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(WASSCE_SETUP_ROLES);
  const parsed = RankSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid target rank." };
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const outcome = await withSchool(school.id, async (tx): Promise<ActionResult> => {
      const target = await requireTarget(tx, school.id, d.targetId);
      if (!target) return { ok: false, error: "That target is not in this school." };
      const cand = await requireCandidate(tx, school.id, target.candidateId);
      if (!cand) return { ok: false, error: "That candidate is not in this school." };

      await tx
        .update(universityTargets)
        .set({ targetRank: d.targetRank ?? null })
        .where(
          and(eq(universityTargets.schoolId, school.id), eq(universityTargets.id, target.id)),
        );

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "university_target",
        entityId: target.id,
        before: { targetRank: target.targetRank },
        after: { targetRank: d.targetRank ?? null },
        reason: "University target rank changed",
      });
      return { ok: true, id: cand.indexNumber };
    });
    if (outcome.ok && outcome.id) safeRevalidate(candidatePath(outcome.id));
    return outcome;
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: uniqueMessage(err) };
    return { ok: false, error: "Could not change that target's rank. Please try again." };
  }
}

// --------------------------------------------------------------- remove a target (WASSCE_SETUP_ROLES)
const RemoveSchema = z.object({ targetId: z.string().uuid() });

/**
 * Untag a target. The row is deleted (it carries no history of its own — the audit row IS the history,
 * and any statement already generated keeps its own frozen copy of the target). The GLOBAL programme is
 * untouched: `ON DELETE RESTRICT` runs the other way (a targeted programme can't be deleted).
 */
export async function removeUniversityTarget(input: unknown): Promise<ActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(WASSCE_SETUP_ROLES);
  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid target." };
  const actor = await resolveActor(school.id);

  try {
    const outcome = await withSchool(school.id, async (tx): Promise<ActionResult> => {
      const target = await requireTarget(tx, school.id, parsed.data.targetId);
      if (!target) return { ok: false, error: "That target is not in this school." };
      const cand = await requireCandidate(tx, school.id, target.candidateId);
      if (!cand) return { ok: false, error: "That candidate is not in this school." };

      await tx
        .delete(universityTargets)
        .where(
          and(eq(universityTargets.schoolId, school.id), eq(universityTargets.id, target.id)),
        );

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "deleted",
        entityType: "university_target",
        entityId: target.id,
        before: {
          candidateId: target.candidateId,
          programme: `${target.shortName} · ${target.programmeName}`,
          targetRank: target.targetRank,
        },
        reason: "University target removed",
      });
      return { ok: true, id: cand.indexNumber };
    });
    if (outcome.ok && outcome.id) safeRevalidate(candidatePath(outcome.id));
    return outcome;
  } catch {
    return { ok: false, error: "Could not remove that target. Please try again." };
  }
}
