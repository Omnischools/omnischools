"use server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, type ActiveSchool } from "@/lib/auth/server";
import { getCurrentUser, type AppUser } from "@/lib/auth";
import { hasAnyRole, BOARDING_ROLES, canAccessHouse } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import type { Tx } from "@/lib/db";
import {
  boardingInfractions,
  bondArtefacts,
  deboardinizationRecords,
  students,
  houses,
  bunkAllocation,
  schools,
} from "@/db/schema";
import { insertInfraction } from "@/lib/boarding/discipline-core";
import { runOverdueChain } from "@/lib/boarding/exeat-notify";
import { runUnaccountedSweep } from "@/lib/boarding/resumption-notify";
import {
  DEBOARD_SLOT_LABEL,
  DEBOARD_SLOT_ROLE,
  roleSatisfiesSlot,
  deboardReadyToEffect,
  coSignStatusLabel,
  type CoSignSlot,
} from "@/lib/boarding/discipline";

type ActionResult = { ok: boolean; error?: string; message?: string };
const forbidden: ActionResult = { ok: false, error: "Your role cannot perform this action." };
const DISCIPLINE_PATH = "/senior/boarding/discipline";

/** The default bond standard-form body (serif surface). The student's name is prefilled by the reader. */
const BOND_STANDARD_TEXT =
  "I do hereby acknowledge the infraction recorded against me and undertake, before my Housemaster " +
  "and the Senior Housemaster, that I shall not repeat conduct contrary to the rules of this school. " +
  "I commit to the counselling assigned for the duration of this semester. I accept that any breach " +
  "of this bond may proceed to external suspension and, ultimately, to deboardinization.";

/** Shared guard: signed-in staff holding a BOARDING role (mirrors the exeat/daily/visiting actions). */
async function ctx(): Promise<{ school: ActiveSchool; user: AppUser } | null> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) return null;
  return { school, user };
}

/**
 * Resolve a student and confirm House access (house-scope for a plain HM — AC B4/J2). Returns the
 * student's House id, or an error when the caller cannot reach that House.
 */
async function studentHouseAccess(
  tx: Tx,
  schoolId: string,
  studentId: string,
  roles: readonly string[],
  userId: string | null,
): Promise<{ ok: true; houseId: string | null } | { ok: false; error: string }> {
  const [stu] = await tx
    .select({ houseId: students.houseId })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .limit(1);
  if (!stu) return { ok: false, error: "Student not found." };
  if (stu.houseId) {
    const [house] = await tx
      .select({ hmUserId: houses.hmUserId })
      .from(houses)
      .where(and(eq(houses.schoolId, schoolId), eq(houses.id, stu.houseId)))
      .limit(1);
    if (!canAccessHouse(roles, userId, house?.hmUserId)) {
      return { ok: false, error: "You can only act on the House you are assigned to." };
    }
  } else if (!hasAnyRole(roles, ["ADMIN", "HEADMASTER", "DEAN_OF_BOARDING"])) {
    // A student off any House (e.g. already deboardinized) is cross-house — plain HM cannot reach it.
    return { ok: false, error: "You can only act on the House you are assigned to." };
  }
  return { ok: true, houseId: stu.houseId };
}

// ---------------------------------------------------------------------------
// Log an infraction (MANUAL) — rung from the frozen ladder; pastoral bypass at the shared insert site
// ---------------------------------------------------------------------------

const LogInput = z.object({
  studentId: z.string().uuid(),
  severity: z.enum(["NOTE", "WARNING", "BOND", "SUSPENSION", "DEBOARDINIZATION"]),
  narrativeText: z.string().trim().min(3).max(2000),
});

/**
 * Log a manual infraction at a ladder rung (AC A/G/I). A pastorally-flagged student writes ZERO
 * infraction and is routed to the Dean (the bypass lives at the shared insert site). A BOND rung also
 * spins up the bond artefact shell (the signing room). Parent-notify SMS fires at Warning+ (console).
 */
export async function logInfraction(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = LogInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid infraction." };
  const d = parsed.data;
  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const access = await studentHouseAccess(tx, school.id, d.studentId, user.roles, user.id);
    if (!access.ok) return { ok: false, error: access.error };

    const res = await insertInfraction(tx, {
      schoolId: school.id,
      studentId: d.studentId,
      severity: d.severity,
      narrativeText: d.narrativeText,
      sourceKind: "MANUAL",
      sourceRefId: null,
      loggedByUserId: actor.id,
      actorRole: actor.role,
    });
    if (res.status === "bypassed") {
      return { ok: true, message: "Student has an active pastoral case — routed to the Dean, not laddered (no infraction written)." };
    }
    if (res.status !== "inserted") return { ok: false, error: "Could not log the infraction." };

    // A BOND rung opens the standard-form artefact (three signature slots). Upsert on the bond UK.
    if (d.severity === "BOND") {
      await tx
        .insert(bondArtefacts)
        .values({ schoolId: school.id, infractionId: res.id, bondText: BOND_STANDARD_TEXT })
        .onConflictDoNothing({ target: [bondArtefacts.schoolId, bondArtefacts.infractionId] });
    }
    return { ok: true, message: `Logged a ${d.severity.toLowerCase()} · append-only.` };
  });

  if (out.ok) safeRevalidate(DISCIPLINE_PATH);
  return out;
}

// ---------------------------------------------------------------------------
// Bond signing room — three independently-flipping slots (student + HM witness + Senior HM witness)
// ---------------------------------------------------------------------------

const BondSignInput = z.object({
  bondId: z.string().uuid(),
  slot: z.enum(["student", "hm", "seniorHm"]),
});

/**
 * Flip one bond signature slot (AC B5). The student slot is recorded by any boarding staff; the two
 * witness slots require the mapped role (HM = HOUSEMASTER house-scoped, Senior HM = DEAN_OF_BOARDING).
 * Each slot flips independently (the nullable timestamps are the source of truth).
 */
export async function signBond(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = BondSignInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid signature." };
  const { bondId, slot } = parsed.data;
  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const [bond] = await tx
      .select({ infractionId: bondArtefacts.infractionId })
      .from(bondArtefacts)
      .where(and(eq(bondArtefacts.schoolId, school.id), eq(bondArtefacts.id, bondId)))
      .limit(1);
    if (!bond) return { ok: false, error: "Bond not found." };
    const [inf] = await tx
      .select({ studentId: boardingInfractions.studentId })
      .from(boardingInfractions)
      .where(and(eq(boardingInfractions.schoolId, school.id), eq(boardingInfractions.id, bond.infractionId)))
      .limit(1);
    if (!inf) return { ok: false, error: "Infraction not found." };
    const access = await studentHouseAccess(tx, school.id, inf.studentId, user.roles, user.id);
    if (!access.ok) return { ok: false, error: access.error };

    // Witness slots are role-gated; the student slot is recorded by any boarding staff.
    if (slot === "hm" && !(user.roles.includes("HOUSEMASTER") || user.roles.includes("ADMIN"))) {
      return { ok: false, error: "The HM witness slot must be signed by the Housemaster." };
    }
    if (slot === "seniorHm" && !(user.roles.includes("DEAN_OF_BOARDING") || user.roles.includes("ADMIN"))) {
      return { ok: false, error: "The Senior HM witness slot must be signed by the Dean of Boarding." };
    }

    const now = new Date();
    const set =
      slot === "student"
        ? { studentSignatureAt: now }
        : slot === "hm"
          ? { hmWitnessAt: now, hmWitnessUserId: actor.id ?? undefined }
          : { seniorHmWitnessAt: now, seniorHmWitnessUserId: actor.id ?? undefined };
    await tx.update(bondArtefacts).set(set).where(and(eq(bondArtefacts.schoolId, school.id), eq(bondArtefacts.id, bondId)));

    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOND_SIGNED",
      entityType: "bond_artefacts",
      entityId: bondId,
      after: { slot },
    });
    return { ok: true, message: `${slot === "student" ? "Student" : slot === "hm" ? "HM witness" : "Senior HM witness"} signed.` };
  });

  if (out.ok) safeRevalidate(DISCIPLINE_PATH);
  return out;
}

// ---------------------------------------------------------------------------
// Deboardinization — open (draft) → sign three slots → commit (residency flip + bunk release)
// ---------------------------------------------------------------------------

const OpenDeboardInput = z.object({
  studentId: z.string().uuid(),
  narrativeText: z.string().trim().min(3).max(2000),
  penaltyDays: z.number().int().min(0).max(365).optional(),
  penaltyPerDayAmount: z.number().min(0).max(100000).optional(),
});

/**
 * Open a deboardinization DRAFT (AC B). Logs the DEBOARDINIZATION-rung infraction and creates the
 * record with NO co-signs and NO effective_at (residency unchanged). Penalty snapshots are stored for
 * DISPLAY only. A flagged student is routed to the Dean (no infraction, no record).
 */
export async function openDeboardinization(input: unknown): Promise<ActionResult & { recordId?: string }> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = OpenDeboardInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult & { recordId?: string }> => {
    const access = await studentHouseAccess(tx, school.id, d.studentId, user.roles, user.id);
    if (!access.ok) return { ok: false, error: access.error };

    const res = await insertInfraction(tx, {
      schoolId: school.id,
      studentId: d.studentId,
      severity: "DEBOARDINIZATION",
      narrativeText: d.narrativeText,
      sourceKind: "MANUAL",
      sourceRefId: null,
      loggedByUserId: actor.id,
      actorRole: actor.role,
    });
    if (res.status === "bypassed") {
      return { ok: true, message: "Student has an active pastoral case — routed to the Dean, not laddered." };
    }
    if (res.status !== "inserted") return { ok: false, error: "Could not open the deboardinization." };

    const [rec] = await tx
      .insert(deboardinizationRecords)
      .values({
        schoolId: school.id,
        studentId: d.studentId,
        infractionId: res.id,
        penaltyDays: d.penaltyDays ?? null,
        penaltyPerDayAmount: d.penaltyPerDayAmount != null ? d.penaltyPerDayAmount.toFixed(2) : null,
        // 🟥 fee_penalty_invoice_id LEFT NULL — the invoice-write STUB (no billing coupling).
      })
      .returning({ id: deboardinizationRecords.id });

    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "DEBOARDINIZATION_OPENED",
      entityType: "deboardinization_records",
      entityId: rec.id,
      after: { studentId: d.studentId, infractionId: res.id, penaltyDays: d.penaltyDays ?? null },
    });
    return { ok: true, message: "Deboardinization draft opened — needs three co-signs.", recordId: rec.id };
  });

  if (out.ok) safeRevalidate(DISCIPLINE_PATH);
  return out;
}

const SignDeboardInput = z.object({
  recordId: z.string().uuid(),
  slot: z.enum(["hm", "seniorHm", "headmaster"]),
});

/**
 * Sign one of the three deboardinization slots (AC B1/B3/B4). The signer's role must satisfy the slot
 * (HM = HOUSEMASTER house-scoped, Senior HM = DEAN_OF_BOARDING, Headmaster = HEADMASTER; ADMIN super).
 * Signing alone never flips residency — that is the separate commit gate.
 */
export async function signDeboard(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = SignDeboardInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid signature." };
  const { recordId, slot } = parsed.data;
  const { school, user } = c;
  const actor = await resolveActor(school.id);

  if (!roleSatisfiesSlot(user.roles, slot as CoSignSlot)) {
    return { ok: false, error: `The ${DEBOARD_SLOT_LABEL[slot as CoSignSlot]} co-sign requires the ${DEBOARD_SLOT_ROLE[slot as CoSignSlot]} role.` };
  }

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const [rec] = await tx
      .select({ studentId: deboardinizationRecords.studentId, effectiveAt: deboardinizationRecords.effectiveAt })
      .from(deboardinizationRecords)
      .where(and(eq(deboardinizationRecords.schoolId, school.id), eq(deboardinizationRecords.id, recordId)))
      .limit(1);
    if (!rec) return { ok: false, error: "Deboardinization record not found." };
    if (rec.effectiveAt) return { ok: false, error: "This deboardinization is already in effect." };
    // The HM slot is house-scoped to the student's House (a plain HM can only co-sign their own House).
    if (slot === "hm") {
      const access = await studentHouseAccess(tx, school.id, rec.studentId, user.roles, user.id);
      if (!access.ok) return { ok: false, error: access.error };
    }

    const now = new Date();
    const set =
      slot === "hm"
        ? { hmSignAt: now, hmSignUserId: actor.id ?? undefined }
        : slot === "seniorHm"
          ? { seniorHmSignAt: now, seniorHmSignUserId: actor.id ?? undefined }
          : { headmasterSignAt: now, headmasterSignUserId: actor.id ?? undefined };
    await tx
      .update(deboardinizationRecords)
      .set(set)
      .where(and(eq(deboardinizationRecords.schoolId, school.id), eq(deboardinizationRecords.id, recordId)));

    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "DEBOARDINIZATION_COSIGNED",
      entityType: "deboardinization_records",
      entityId: recordId,
      after: { slot },
    });
    return { ok: true, message: `${DEBOARD_SLOT_LABEL[slot as CoSignSlot]} co-signed.` };
  });

  if (out.ok) safeRevalidate(DISCIPLINE_PATH);
  return out;
}

const CommitInput = z.object({ recordId: z.string().uuid() });

/**
 * Commit (effect) a deboardinization (AC B1/B2/C). Requires all THREE co-signs present — a 2-of-3
 * draft is rejected (no effective_at, no residency flip). On commit: effective_at is set, residency
 * flips BOARDER→DEBOARDINIZED, current_bunk_id is nulled and the open bunk_allocation row is closed
 * (INCR-7 J2) — all atomic + audited. NO DB trigger (this lib is the only writer).
 */
export async function commitDeboardinization(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = CommitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { recordId } = parsed.data;
  const { school } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const [rec] = await tx
      .select({
        studentId: deboardinizationRecords.studentId,
        effectiveAt: deboardinizationRecords.effectiveAt,
        hmSignAt: deboardinizationRecords.hmSignAt,
        seniorHmSignAt: deboardinizationRecords.seniorHmSignAt,
        headmasterSignAt: deboardinizationRecords.headmasterSignAt,
      })
      .from(deboardinizationRecords)
      .where(and(eq(deboardinizationRecords.schoolId, school.id), eq(deboardinizationRecords.id, recordId)))
      .limit(1);
    if (!rec) return { ok: false, error: "Deboardinization record not found." };
    if (rec.effectiveAt) return { ok: false, error: "This deboardinization is already in effect." };
    if (!deboardReadyToEffect({ hmAt: rec.hmSignAt, seniorHmAt: rec.seniorHmSignAt, headmasterAt: rec.headmasterSignAt })) {
      return { ok: false, error: coSignStatusLabel({ hmAt: rec.hmSignAt, seniorHmAt: rec.seniorHmSignAt, headmasterAt: rec.headmasterSignAt }) + " — cannot effect yet." };
    }

    const [stu] = await tx
      .select({ residency: students.residency, currentBunkId: students.currentBunkId })
      .from(students)
      .where(and(eq(students.schoolId, school.id), eq(students.id, rec.studentId)))
      .limit(1);
    if (!stu) return { ok: false, error: "Student not found." };

    const now = new Date();
    // 1) effective_at (the same-table CHECK guarantees the three signs are present).
    await tx
      .update(deboardinizationRecords)
      .set({ effectiveAt: now })
      .where(and(eq(deboardinizationRecords.schoolId, school.id), eq(deboardinizationRecords.id, recordId)));
    // 2) close the open bunk_allocation row (INCR-7 J2).
    await tx
      .update(bunkAllocation)
      .set({ toAt: now })
      .where(
        and(
          eq(bunkAllocation.schoolId, school.id),
          eq(bunkAllocation.studentId, rec.studentId),
          isNull(bunkAllocation.toAt),
        ),
      );
    // 3) flip residency + release the bunk.
    await tx
      .update(students)
      .set({ residency: "DEBOARDINIZED", currentBunkId: null })
      .where(and(eq(students.schoolId, school.id), eq(students.id, rec.studentId)));

    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "DEBOARDINIZED",
      entityType: "student",
      entityId: rec.studentId,
      before: { residency: stu.residency, bunkId: stu.currentBunkId },
      after: { residency: "DEBOARDINIZED", bunkId: null, recordId },
      reason: "Deboardinization effected (3 co-signs) — bunk released.",
    });
    return { ok: true, message: "Deboardinization in effect — residency flipped, bunk released." };
  });

  if (out.ok) safeRevalidate(DISCIPLINE_PATH);
  return out;
}

// ---------------------------------------------------------------------------
// Board review + reinstatement (Board = a first-class record; reinstate = HEADMASTER/ADMIN-gated)
// ---------------------------------------------------------------------------

const BoardReviewInput = z.object({
  recordId: z.string().uuid(),
  motionText: z.string().trim().min(3).max(2000),
});

/** File a Board-review motion (AC D1) — records board_review_at + the motion text. */
export async function fileBoardReview(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = BoardReviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid motion." };
  const { recordId, motionText } = parsed.data;
  const { school } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const [rec] = await tx
      .select({ effectiveAt: deboardinizationRecords.effectiveAt })
      .from(deboardinizationRecords)
      .where(and(eq(deboardinizationRecords.schoolId, school.id), eq(deboardinizationRecords.id, recordId)))
      .limit(1);
    if (!rec) return { ok: false, error: "Deboardinization record not found." };
    await tx
      .update(deboardinizationRecords)
      .set({ boardReviewAt: new Date(), boardDecisionText: motionText })
      .where(and(eq(deboardinizationRecords.schoolId, school.id), eq(deboardinizationRecords.id, recordId)));
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOARD_REVIEW_FILED",
      entityType: "deboardinization_records",
      entityId: recordId,
      after: { motion: motionText.slice(0, 200) },
    });
    return { ok: true, message: "Board-review motion filed." };
  });

  if (out.ok) safeRevalidate(DISCIPLINE_PATH);
  return out;
}

const ReinstateInput = z.object({
  recordId: z.string().uuid(),
  boardDecisionText: z.string().trim().min(3, "A Board decision is required to reinstate.").max(2000),
});

/**
 * Reinstate a deboardinized student (AC D2/D3/D4/D5) — Board-reviewed, HEADMASTER/ADMIN-gated (NOT
 * plain HM, NOT Dean). Requires a non-empty board_decision_text. Flips residency DEBOARDINIZED→BOARDER
 * and stamps reinstated_at/by. Does NOT restore the old bunk (current_bunk_id stays NULL — D5).
 */
export async function reinstate(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const { school, user } = c;
  if (!hasAnyRole(user.roles, ["HEADMASTER", "ADMIN"])) {
    return { ok: false, error: "Only the Headmaster (or Admin) may reinstate — the Board's decision." };
  }
  const parsed = ReinstateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "A Board decision is required." };
  const { recordId, boardDecisionText } = parsed.data;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const [rec] = await tx
      .select({
        studentId: deboardinizationRecords.studentId,
        effectiveAt: deboardinizationRecords.effectiveAt,
        reinstatedAt: deboardinizationRecords.reinstatedAt,
        boardReviewAt: deboardinizationRecords.boardReviewAt,
      })
      .from(deboardinizationRecords)
      .where(and(eq(deboardinizationRecords.schoolId, school.id), eq(deboardinizationRecords.id, recordId)))
      .limit(1);
    if (!rec) return { ok: false, error: "Deboardinization record not found." };
    if (!rec.effectiveAt) return { ok: false, error: "This deboardinization is not in effect." };
    if (rec.reinstatedAt) return { ok: false, error: "This student is already reinstated." };

    const now = new Date();
    await tx
      .update(deboardinizationRecords)
      .set({
        boardDecisionText,
        boardReviewAt: rec.boardReviewAt ?? now,
        reinstatedAt: now,
        reinstatedByUserId: actor.id ?? undefined,
      })
      .where(and(eq(deboardinizationRecords.schoolId, school.id), eq(deboardinizationRecords.id, recordId)));
    // Flip residency back to BOARDER — the bunk is NOT restored (D5).
    await tx
      .update(students)
      .set({ residency: "BOARDER" })
      .where(and(eq(students.schoolId, school.id), eq(students.id, rec.studentId)));

    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "REINSTATED",
      entityType: "student",
      entityId: rec.studentId,
      before: { residency: "DEBOARDINIZED" },
      after: { residency: "BOARDER", bunkRestored: false, recordId },
      reason: boardDecisionText.slice(0, 200),
    });
    return { ok: true, message: "Reinstated to boarding — bunk not restored (re-allocate on the roster)." };
  });

  if (out.ok) safeRevalidate(DISCIPLINE_PATH);
  return out;
}

// ---------------------------------------------------------------------------
// Auto-log sweep (preview) — runs the exeat-overdue + resumption-absent derivations (both write NOTEs
// idempotently). A second run logs nothing new (AC E).
// ---------------------------------------------------------------------------

export async function runAutoLogSweep(dateIso?: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const { school, user } = c;
  const actor = await resolveActor(school.id);
  const [sch] = await withSchool(school.id, (tx) =>
    tx.select({ name: schools.name }).from(schools).where(eq(schools.id, school.id)).limit(1),
  );
  const schoolName = sch?.name ?? "School";
  const overdue = await runOverdueChain(school.id, user.roles, user.id, actor.id, actor.role);
  const absent = await runUnaccountedSweep(school.id, user.roles, user.id, schoolName, dateIso);
  safeRevalidate(DISCIPLINE_PATH);
  return {
    ok: true,
    message: `Sweep complete — ${overdue.stage3Stubs} overdue NOTE(s), ${absent.checked} unaccounted checked. Idempotent (re-run logs nothing new).`,
  };
}
