"use server";
/**
 * Sickbay setup mutations (SHS module 4.4 / INCR-21 · surface §1/§2).
 *
 * Every mutation is gated server-side to SICKBAY_CONFIG_WRITE_ROLES (ADMIN / HEADMASTER). The
 * MATRON READS the surface and every write here refuses her — including a hand-crafted POST that
 * never touched the UI (AC E2/E3). Every mutation writes one audit_log row with a before→after
 * snapshot (AC E4).
 *
 * Three rules that live here and NOT in the database (portability — business logic in lib/, never a
 * trigger):
 *   • a mode change is a RENDER GATE and deletes nothing (R6 · AC A6) — B→C→B returns identical
 *     beds and slots;
 *   • a bed-capacity save is a TARGET RECONCILE (R11 · AC B5) — the plan is computed pure, and an
 *     unreachable target rejects the WHOLE save before a single row is touched;
 *   • both matron pointers must hold MATRON in THIS school (R20 · AC D2/D3).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CONFIG_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { sickbayBed, sickbayScheduleSlot, sickbaySettings } from "@/db/schema";
import { getSickbayConfig, getScheduleSlots, holdsMatronRole } from "@/lib/sickbay/config";
import { openAdmissionBeds } from "@/lib/sickbay/visit-reads";
import {
  CANONICAL_SICKBAY_SLOTS,
  planBedReconcile,
  validateRoundOrdering,
} from "@/lib/sickbay/defaults";
import { referralOnlyGuard } from "@/lib/sickbay/visits";

type Result = { ok: boolean; error?: string };
const SETUP_PATH = "/senior/sickbay/setup";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Shared write gate. A MATRON reaching any of these actions directly — form POST, fetch, replayed
 * server-action id — is refused here, before any query runs (AC E3).
 */
async function authorizeWrite(): Promise<
  | { ok: true; schoolId: string; actor: { id: string | null; role: string } }
  | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SICKBAY_CONFIG_WRITE_ROLES)) {
    // Accurate for BOTH refused cases: the MATRON, who reads this surface, and a role with no read
    // access at all (a HOUSEMASTER hand-crafting the POST) — "you can read but not change it" would
    // be a false statement to the second.
    return {
      ok: false,
      error: "Only an Administrator or the Headmaster can change the sickbay configuration.",
    };
  }
  const actor = await resolveActor(school.id);
  return { ok: true, schoolId: school.id, actor };
}

/** Upsert the singleton settings row (the boarding_settings idiom — school_id is the conflict target). */
async function upsertSettings(
  tx: Parameters<Parameters<typeof withSchool>[1]>[0],
  schoolId: string,
  values: Partial<typeof sickbaySettings.$inferInsert>,
) {
  await tx
    .insert(sickbaySettings)
    .values({ schoolId, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: sickbaySettings.schoolId,
      set: { ...values, updatedAt: new Date() },
    });
}

// ---- 1) Mode — a render gate that NEVER deletes a row (R3/R6 · AC A6) ----

const ModeSchema = z.object({ mode: z.enum(["FULL", "FIRST_AID", "REFERRAL_ONLY"]) });

/**
 * Declare the school's sickbay mode. Switching B→C hides the capacity section but retains every
 * bed and slot row unread; switching back returns them identical (AC A6). Nothing is deleted,
 * hidden, migrated or renumbered here — that is the whole point of one schema and three modes.
 *
 * Choosing FULL/FIRST_AID on a school with NO slots seeds the canonical 7 (repo memory
 * `onboarding-inputs-cascade`: an input creates its artefact rather than making the admin re-enter
 * it). It NEVER re-seeds a school that already has slots, so a B→C→B round trip is lossless.
 */
export async function setSickbayMode(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = ModeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick one of the three sickbay modes." };
  const { mode } = parsed.data;

  const before = await getSickbayConfig(auth.schoolId);
  const existingSlots = await getScheduleSlots(auth.schoolId);

  // R56 — the R6 forward guard INCR-21 recorded but could not test until an admission table existed.
  // A switch to REFERRAL_ONLY asserts the school has no on-site beds; reject it while a patient is
  // still in one, in the R11 error grammar (name the count, name the beds, save nothing). Open
  // VISITS do not block — Mode C keeps the visit record and they need no bed.
  if (mode === "REFERRAL_ONLY" && before.mode !== "REFERRAL_ONLY") {
    const occupied = await openAdmissionBeds(auth.schoolId);
    const guard = referralOnlyGuard(occupied.map((o) => o.bedNumber));
    if (guard) return { ok: false, error: guard };
  }

  try {
    await withSchool(auth.schoolId, async (tx) => {
      await upsertSettings(tx, auth.schoolId, { mode, configuredAt: new Date() });
      // First A/B selection on a school that has never had a schedule → seed the canonical day.
      if (mode !== "REFERRAL_ONLY" && existingSlots.length === 0) {
        await tx
          .insert(sickbayScheduleSlot)
          .values(CANONICAL_SICKBAY_SLOTS.map((s) => ({ schoolId: auth.schoolId, ...s })));
      }
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "sickbay_settings",
        entityId: auth.schoolId,
        before: { mode: before.mode, configured: before.configured },
        after: { mode, seededSlots: mode !== "REFERRAL_ONLY" && existingSlots.length === 0 },
        reason: `Sickbay mode set to ${mode}`,
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the sickbay mode." };
  }
}

// ---- 2) Bed capacity — a TARGET RECONCILE, never a delete (R10/R11 · AC B4/B5) ----

const CapacitySchema = z.object({
  general: z.coerce.number().int().min(0).max(200),
  isolation: z.coerce.number().int().min(0).max(200),
});

/**
 * Save the two bed counts as a target. Raising inserts rows numbered max+1 upward (a retired bed's
 * number is NEVER reused — a visit record saying "bed 3" must still mean that bed); lowering
 * deactivates the highest-numbered UNOCCUPIED beds. The two pools never merge (R9).
 *
 * The plan is computed by a pure function BEFORE any write, so an unreachable target returns a
 * named error with no partial application (AC B5). `occupiedBedIds` is empty at INCR-21 — no
 * admission table exists yet; INCR-22 passes the open admissions' bed ids and the guard lights up.
 */
export async function saveBedCapacity(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = CapacitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bed counts must be whole numbers from 0 to 200." };

  const config = await getSickbayConfig(auth.schoolId);
  // R59 — `occupiedBedIds` stops being `[]`. The open admissions' bed ids are passed so the R11
  // reject branch (unit-test-only since 0056) finally fires against real occupancy: a capacity
  // decrease that would deactivate a bed with a patient in it rejects the WHOLE save, named error.
  const occupied = await openAdmissionBeds(auth.schoolId);
  const plan = planBedReconcile(config.beds, parsed.data, occupied.map((o) => o.bedId));
  if ("error" in plan) return { ok: false, error: plan.error };
  if (plan.insert.length === 0 && plan.deactivate.length === 0) return { ok: true };

  try {
    await withSchool(auth.schoolId, async (tx) => {
      if (plan.insert.length > 0) {
        await tx
          .insert(sickbayBed)
          .values(plan.insert.map((b) => ({ schoolId: auth.schoolId, ...b })));
      }
      for (const id of plan.deactivate) {
        await tx
          .update(sickbayBed)
          .set({ active: false })
          .where(and(eq(sickbayBed.schoolId, auth.schoolId), eq(sickbayBed.id, id)));
      }
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "sickbay_bed",
        entityId: auth.schoolId,
        before: { general: config.bedCounts.general, isolation: config.bedCounts.isolation },
        after: { ...parsed.data, added: plan.insert.length, retired: plan.deactivate.length },
        reason: `Bed capacity set to ${parsed.data.general} general · ${parsed.data.isolation} isolation`,
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch (err) {
    // uniq_sickbay_bed_number — two capacity saves raced and both planned the same next number.
    // The plan is recomputed from fresh rows on reload, so a retry is the right advice.
    if (isUniqueViolation(err)) {
      return { ok: false, error: "Someone else changed the bed capacity just now. Reload and try again." };
    }
    return { ok: false, error: "Could not save the bed capacity." };
  }
}

// ---- 3) Clinical staff — two pointers + the doctor's text (R20/R21 · AC D2/D3/D4) ----

// The two matron pointers are `.nullable()`, NOT `.nullish()` — absence is REJECTED at the trust
// boundary rather than silently clearing a live pointer (Dex D1). Only the doctor fields carry the
// absent-means-unchanged semantic below, because only they are hidden by a capability gate. Keeping
// all four `.nullish()` made the schema misdocument intent: a caller sending just a doctor field
// would have wiped both matrons, and the first partial editor added in INCR-22+ would have hit it.
const StaffSchema = z.object({
  matronUserId: z.string().uuid().nullable(),
  assistantMatronUserId: z.string().uuid().nullable(),
  visitingDoctorName: z.string().trim().max(96).nullish(),
  visitingDoctorAffiliation: z.string().trim().max(96).nullish(),
});

/**
 * Set the clinical-staff register. Both matron pointers must hold MATRON IN THIS SCHOOL — checked
 * at the app layer (R20), never a cross-table trigger. The visiting doctor is text only: no
 * ref_user is created, no role_assignment written, no invite sent (R21 · AC D4). An account for a
 * three-hour-a-week external clinician would create a tenant identity, a password, an audit actor
 * and a leaving problem, for a name on a card.
 */
export async function saveClinicalStaff(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = StaffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the clinical staff details." };
  const d = parsed.data;
  const matronUserId = d.matronUserId || null;
  const assistantMatronUserId = d.assistantMatronUserId || null;

  if (matronUserId && assistantMatronUserId && matronUserId === assistantMatronUserId) {
    return { ok: false, error: "The Senior and Assistant Matron must be two different people." };
  }
  for (const [label, id] of [
    ["Senior Matron", matronUserId],
    ["Assistant Matron", assistantMatronUserId],
  ] as const) {
    if (id && !(await holdsMatronRole(auth.schoolId, id))) {
      return { ok: false, error: `The ${label} must be a staff member holding the Matron role in this school.` };
    }
  }

  const before = await getSickbayConfig(auth.schoolId);
  // ABSENT ≠ CLEARED. A REFERRAL_ONLY school has no visiting-doctor capability, so its editor never
  // renders those two fields and never sends them — writing null there would delete a doctor the
  // school still has on a switch back (R6 · AC A6). An empty string IS a clear and still writes null.
  const patch = {
    matronUserId,
    assistantMatronUserId,
    ...(d.visitingDoctorName !== undefined && {
      visitingDoctorName: d.visitingDoctorName || null,
    }),
    ...(d.visitingDoctorAffiliation !== undefined && {
      visitingDoctorAffiliation: d.visitingDoctorAffiliation || null,
    }),
  };
  // The DB write stays a PATCH, but the audit trail must stay a SNAPSHOT (Dex D2 · AC E4). `before`
  // always lists all four fields; if `after` listed only the ones sent, a reader could not tell
  // "doctor unchanged" from "doctor cleared" — and the natural reading of a missing key is the
  // wrong one. Fold the untouched fields back in for the audit only.
  // Only the doctor fields can be absent from `patch`; the two matron pointers are always present
  // (StaffSchema requires them), so they come through the spread.
  const effectiveAfter = {
    visitingDoctorName: before.visitingDoctorName,
    visitingDoctorAffiliation: before.visitingDoctorAffiliation,
    ...patch,
  };
  try {
    await withSchool(auth.schoolId, async (tx) => {
      await upsertSettings(tx, auth.schoolId, patch);
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "sickbay_settings",
        entityId: auth.schoolId,
        before: {
          matronUserId: before.matronUserId,
          assistantMatronUserId: before.assistantMatronUserId,
          visitingDoctorName: before.visitingDoctorName,
          visitingDoctorAffiliation: before.visitingDoctorAffiliation,
        },
        after: effectiveAfter,
        reason: "Sickbay clinical staff updated",
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the clinical staff." };
  }
}

// ---- 4) Schedule slots — edit / toggle / reset (R16 · AC C4/C5/C8) ----

const SlotSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(48),
  description: z.string().trim().max(160).nullish(),
  startsAt: z.string().regex(HHMM, "Times must be HH:MM."),
  endsAt: z.string().regex(HHMM, "Times must be HH:MM."),
  staffing: z.string().trim().max(48).nullish(),
  daysOfWeek: z.array(z.coerce.number().int().min(1).max(7)).max(7),
  runsOnHolidays: z.boolean(),
});

/**
 * Edit one slot. Deliberately NO `end > start` check: the on-call window is 22:00 → 06:00 and wraps
 * midnight (AC C8) — such a rule would reject the one slot the module most needs. Only a zero-length
 * window is refused.
 *
 * The anchor's TIME is editable (05:45 is still anchored) but it must start no later than every
 * other medication round (R16 · AC C5), and it can never be re-kinded or un-anchored — neither
 * field is in this schema, so a hand-crafted POST cannot carry them.
 */
export async function updateScheduleSlot(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = SlotSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the slot details." };
  }
  const d = parsed.data;
  if (d.startsAt === d.endsAt) {
    return { ok: false, error: "A slot must have a length — start and end cannot be the same time." };
  }
  if (d.daysOfWeek.length === 0) {
    return { ok: false, error: "Pick at least one day this slot runs." };
  }

  const slots = await getScheduleSlots(auth.schoolId);
  const before = slots.find((s) => s.id === d.id);
  if (!before) return { ok: false, error: "That schedule slot no longer exists." };
  // R16 is a property of the SET: validate the set AS IT WOULD BE after this edit, not the one row.
  // Moving a NON-anchor round to 05:00 while the anchor sits at 06:30 breaks it just as surely as
  // moving the anchor. Only the fields the invariant reads need to be projected forward.
  const orderingError = validateRoundOrdering(
    slots.map((s) => (s.id === d.id ? { ...s, label: d.label, startsAt: d.startsAt } : s)),
  );
  if (orderingError) return { ok: false, error: orderingError };

  try {
    await withSchool(auth.schoolId, async (tx) => {
      await tx
        .update(sickbayScheduleSlot)
        .set({
          label: d.label,
          description: d.description || null,
          startsAt: d.startsAt,
          endsAt: d.endsAt,
          staffing: d.staffing || null,
          daysOfWeek: Array.from(new Set(d.daysOfWeek)).sort((a, b) => a - b),
          runsOnHolidays: d.runsOnHolidays,
          updatedAt: new Date(),
        })
        .where(
          and(eq(sickbayScheduleSlot.schoolId, auth.schoolId), eq(sickbayScheduleSlot.id, d.id)),
        );
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "sickbay_schedule_slot",
        entityId: d.id,
        before,
        after: d,
        reason: `Schedule slot updated · ${d.label}`,
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the schedule slot." };
  }
}

const ToggleSchema = z.object({ id: z.string().uuid(), active: z.boolean() });

/** Turn a slot off (a Mode-B school with no noon round needs an off switch). The ANCHOR cannot be
 *  deactivated — nor deleted, re-kinded or un-anchored (R16 · AC C4). Deactivation is never a delete. */
export async function toggleScheduleSlot(input: unknown): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid slot." };
  const { id, active } = parsed.data;

  const slots = await getScheduleSlots(auth.schoolId);
  const before = slots.find((s) => s.id === id);
  if (!before) return { ok: false, error: "That schedule slot no longer exists." };
  if (before.isAnchor && !active) {
    return {
      ok: false,
      error: "The anchor round cannot be switched off — everything else flexes around it.",
    };
  }
  // Switching a round back ON can break R16 too: park a 06:45 round off, move the anchor to 07:00,
  // switch the round back on. The ordering rule ignores inactive rounds, so this path has to
  // re-validate the whole set with the toggle applied.
  const orderingError = validateRoundOrdering(
    slots.map((s) => (s.id === id ? { ...s, active } : s)),
  );
  if (orderingError) return { ok: false, error: orderingError };

  try {
    await withSchool(auth.schoolId, async (tx) => {
      await tx
        .update(sickbayScheduleSlot)
        .set({ active, updatedAt: new Date() })
        .where(and(eq(sickbayScheduleSlot.schoolId, auth.schoolId), eq(sickbayScheduleSlot.id, id)));
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "sickbay_schedule_slot",
        entityId: id,
        before: { active: before.active },
        after: { active },
        reason: `Schedule slot ${active ? "activated" : "deactivated"} · ${before.label}`,
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not change the slot." };
  }
}

/**
 * `Reset to defaults` — DESTRUCTIVE, so the client confirms first. Replaces the school's slots with
 * the canonical 7 of R13. The delete is scoped to this school's sickbay_schedule_slot rows only
 * (marker-scoped by school; nothing else writes this table).
 */
export async function resetScheduleSlots(): Promise<Result> {
  const auth = await authorizeWrite();
  if (!auth.ok) return auth;
  const before = await getScheduleSlots(auth.schoolId);
  try {
    await withSchool(auth.schoolId, async (tx) => {
      await tx
        .delete(sickbayScheduleSlot)
        .where(eq(sickbayScheduleSlot.schoolId, auth.schoolId));
      await tx
        .insert(sickbayScheduleSlot)
        .values(CANONICAL_SICKBAY_SLOTS.map((s) => ({ schoolId: auth.schoolId, ...s })));
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: auth.actor.id ?? undefined,
        actorRole: auth.actor.role,
        actionType: "updated",
        entityType: "sickbay_schedule_slot",
        entityId: auth.schoolId,
        before: { slots: before.length },
        after: { slots: CANONICAL_SICKBAY_SLOTS.length },
        reason: "Schedule reset to the canonical 7 slots",
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reset the schedule." };
  }
}
