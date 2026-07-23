"use server";
/**
 * Sickbay CHRONIC REGISTER write path (SHS module 4.4 / INCR-23a) — the matron's entry + medication
 * writes. Mirrors lib/actions/sickbay-visit.ts EXACTLY: `authorizeChronicWrite()` is the FIRST
 * statement of every mutation, then a Zod parse, then a `withStaffScope` transaction (the third RLS
 * boundary wraps WRITES too, R112) with `recordAudit` inside the same tx, and every id is re-resolved
 * server-side (a client id is never trusted).
 *
 * 🔴 Authz (R39/R111). Chronic WRITE = SICKBAY_CLINICAL_WRITE_ROLES = [MATRON] — NOT ADMIN (the
 * proprietor/IT is not a clinician) and NOT HEADMASTER (he READS the register but must never author a
 * care plan — R39's split, repeated). A hand-crafted call from either is refused HERE, before any
 * query runs; the DB `WITH CHECK` (`chronic_clinical_role(...) = 'MATRON'`) is the defence-in-depth
 * behind it, not a substitute — on dev the app connects as a superuser so the app-layer gate is the
 * only boundary a preview exercises.
 *
 * The three constraints (R96 MENTAL_HEALTH ⇒ referral-managed · R99 is_prn XOR slot · R102
 * on_site_treatable=false ⇒ zero meds) are surfaced as FRIENDLY errors, never a raw pg failure:
 * R96/R99 are DB CHECKs mapped by `chronicWriteError`; R102 is cross-row, so it is a NAMED refusal in
 * the writer (never a silent drop). R103 versioning is a COUNTER on the row + the audit before/after
 * snapshot — no version table, no superseded rows.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withStaffScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { sickbayChronicEntry, sickbayChronicMed, sickbayScheduleSlot, students } from "@/db/schema";
import { chronicWriteError, R102_REFUSAL, PRN_XOR_SLOT } from "@/lib/sickbay/chronic-write-errors";

type Result = { ok: boolean; error?: string; id?: string };

const REGISTER_PATH = "/senior/sickbay/chronic-register";
const planPath = (studentId: string) => `${REGISTER_PATH}/${studentId}`;

const CONDITIONS = [
  "SICKLE_CELL",
  "ASTHMA",
  "EPILEPSY",
  "ALLERGY",
  "MENTAL_HEALTH",
  "DIABETES",
  "OTHER",
] as const;
const STATUSES = ["STABLE", "MONITOR", "ACTIVE_CRISIS"] as const;

/**
 * The shared chronic-write gate. A HEADMASTER or ADMIN reaching any of these directly — form POST,
 * fetch, replayed server-action id — is refused here, even though a HEADMASTER can READ the register.
 * Same shape as `authorizeClinicalWrite` in sickbay-visit.ts; the role set is the [MATRON]-only seam.
 */
async function authorizeChronicWrite(): Promise<
  | { ok: true; schoolId: string; actor: { id: string | null; role: string } }
  | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SICKBAY_CLINICAL_WRITE_ROLES)) {
    return { ok: false, error: "Only the Matron can author a chronic care plan." };
  }
  const actor = await resolveActor(school.id);
  return { ok: true, schoolId: school.id, actor };
}

const audit = (
  tx: Tx,
  schoolId: string,
  actor: { id: string | null; role: string },
  entry: {
    actionType: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    reason: string;
  },
) =>
  recordAudit(tx, {
    schoolId,
    actorUserId: actor.id ?? undefined,
    actorRole: actor.role,
    ...entry,
  });

// The editable text tier of a care plan — the snapshot the audit before/after carries (R103: the
// previous full text is recoverable from the audit log, so there is no version table).
const PLAN_BODY = {
  condition: z.enum(CONDITIONS),
  // Required — the pill's words. The enum drives only the colour; a plan with no words is a blank pill.
  conditionLabel: z.string().trim().min(1).max(120),
  status: z.enum(STATUSES).default("STABLE"),
  onSiteTreatable: z.boolean().default(true),
  referralManaged: z.boolean().default(false),
  conditionDetail: z.string().trim().max(8000).nullish(),
  baselineStatus: z.string().trim().max(8000).nullish(),
  careGoals: z.string().trim().max(8000).nullish(),
  emergencyProtocol: z.string().trim().max(8000).nullish(),
  dischargeCriteria: z.string().trim().max(4000).nullish(),
  triggers: z.string().trim().max(8000).nullish(),
  redFlags: z.string().trim().max(4000).nullish(),
  firstAction: z.string().trim().max(4000).nullish(),
  externalClinicalHome: z.string().trim().max(400).nullish(),
  externalPastoralHome: z.string().trim().max(400).nullish(),
  externalCareCadence: z.string().trim().max(400).nullish(),
};

const PlanBodySchema = z.object(PLAN_BODY);
type PlanBody = z.infer<typeof PlanBodySchema>;

/**
 * R96 — a MENTAL_HEALTH condition is referral-managed and NOT treated on site, by product policy. The
 * writer DERIVES the two booleans so the matron can never author the inconsistent combination; the DB
 * CHECK `chronic_mental_health_referral_managed` is the backstop for a hand-crafted call.
 */
function normaliseFlags(d: PlanBody): { onSiteTreatable: boolean; referralManaged: boolean } {
  if (d.condition === "MENTAL_HEALTH") return { onSiteTreatable: false, referralManaged: true };
  return { onSiteTreatable: d.onSiteTreatable, referralManaged: d.referralManaged };
}

/** The plan's editable columns, shaped for both the INSERT/UPDATE values and the audit snapshot. */
function planValues(d: PlanBody, flags: { onSiteTreatable: boolean; referralManaged: boolean }) {
  return {
    condition: d.condition,
    conditionLabel: d.conditionLabel,
    status: d.status,
    onSiteTreatable: flags.onSiteTreatable,
    referralManaged: flags.referralManaged,
    conditionDetail: d.conditionDetail || null,
    baselineStatus: d.baselineStatus || null,
    careGoals: d.careGoals || null,
    emergencyProtocol: d.emergencyProtocol || null,
    dischargeCriteria: d.dischargeCriteria || null,
    triggers: d.triggers || null,
    redFlags: d.redFlags || null,
    firstAction: d.firstAction || null,
    externalClinicalHome: d.externalClinicalHome || null,
    externalPastoralHome: d.externalPastoralHome || null,
    externalCareCadence: d.externalCareCadence || null,
  };
}

// ============================================================================
// Create a care plan (one row per student × condition, R91)
// ============================================================================

const CreateEntrySchema = PlanBodySchema.extend({ studentId: z.string().uuid() });

/**
 * Open a care plan. The student is re-resolved to an ACTIVE student OF THIS SCHOOL (RLS + the explicit
 * predicate + the composite FK are three layers). The partial unique
 * `uniq_sickbay_chronic_entry_condition` — not an app check — refuses a second LIVE plan for the same
 * condition under the concurrent double-create race (R58), surfaced as a friendly collision. A freshly
 * authored plan is reviewed by its author now (v1), so the version meta reads honestly on first render.
 */
export async function createChronicEntry(input: unknown): Promise<Result> {
  const auth = await authorizeChronicWrite();
  if (!auth.ok) return auth;
  const parsed = CreateEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the condition and a label to open the plan." };
  const d = parsed.data;
  const userId = auth.actor.id;
  if (!userId) return { ok: false, error: "Your session could not be resolved. Sign in again." };
  const flags = normaliseFlags(d);

  try {
    const id = await withStaffScope(auth.schoolId, userId, async (tx) => {
      const [student] = await tx
        .select({ id: students.id, status: students.status })
        .from(students)
        .where(and(eq(students.schoolId, auth.schoolId), eq(students.id, d.studentId)))
        .limit(1);
      if (!student) throw new NamedError("That student is not in this school.");
      if (student.status !== "ACTIVE") throw new NamedError("That student is not active.");

      const now = new Date();
      const values = planValues(d, flags);
      const [row] = await tx
        .insert(sickbayChronicEntry)
        .values({
          schoolId: auth.schoolId,
          studentId: student.id,
          ...values,
          version: 1,
          reviewedAt: now,
          reviewedByUserId: userId,
        })
        .returning({ id: sickbayChronicEntry.id });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_chronic_entry",
        entityId: row.id,
        after: { studentId: student.id, version: 1, ...values },
        reason: "Chronic care plan opened",
      });
      return row.id;
    });
    safeRevalidate(REGISTER_PATH);
    safeRevalidate(planPath(d.studentId));
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: chronicWriteError(err, "Could not open the care plan.") };
  }
}

// ============================================================================
// Edit a care plan — R103: bump the version COUNTER, re-stamp the review, snapshot before/after
// ============================================================================

const EditEntrySchema = PlanBodySchema.extend({ entryId: z.string().uuid() });

/**
 * Save an edit. R103 — NOT a new row and NOT a superseded row: the `version` counter increments in
 * place, `reviewed_at` / `reviewed_by_user_id` re-stamp to the acting matron, and the PREVIOUS FULL
 * TEXT is recoverable from the audit before-snapshot (the audit log is the history — owner D5.1). The
 * `after` is a full effective snapshot, never a patch (Dex's INCR-21 D2 lesson).
 *
 * Re-classifying to MENTAL_HEALTH flips the entry's generated `hm_restricted` bit and cascades it onto
 * any live grant (R129, in the DB). R102 is enforced symmetrically here: flipping a plan that still
 * carries scheduled medication to referral-managed would strand those doses, so it is refused.
 */
export async function editChronicEntry(input: unknown): Promise<Result> {
  const auth = await authorizeChronicWrite();
  if (!auth.ok) return auth;
  const parsed = EditEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the condition and a label to save the plan." };
  const d = parsed.data;
  const userId = auth.actor.id;
  if (!userId) return { ok: false, error: "Your session could not be resolved. Sign in again." };
  const flags = normaliseFlags(d);

  try {
    const studentId = await withStaffScope(auth.schoolId, userId, async (tx) => {
      const [prev] = await tx
        .select()
        .from(sickbayChronicEntry)
        .where(
          and(
            eq(sickbayChronicEntry.schoolId, auth.schoolId),
            eq(sickbayChronicEntry.id, d.entryId),
            eq(sickbayChronicEntry.active, true),
          ),
        )
        .limit(1);
      if (!prev) throw new NamedError("That care plan no longer exists.");

      // R102 (symmetric with addChronicMed) — a referral-managed plan carries no on-site medication.
      if (!flags.onSiteTreatable) {
        const existing = await tx
          .select({ id: sickbayChronicMed.id })
          .from(sickbayChronicMed)
          .where(
            and(
              eq(sickbayChronicMed.schoolId, auth.schoolId),
              eq(sickbayChronicMed.entryId, prev.id),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          throw new NamedError(
            "This plan still has scheduled medication. Remove the medication before making it " +
              "referral-managed (no on-site treatment).",
          );
        }
      }

      const now = new Date();
      const version = prev.version + 1;
      const values = planValues(d, flags);
      await tx
        .update(sickbayChronicEntry)
        .set({ ...values, version, reviewedAt: now, reviewedByUserId: userId, updatedAt: now })
        .where(and(eq(sickbayChronicEntry.schoolId, auth.schoolId), eq(sickbayChronicEntry.id, prev.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_chronic_entry",
        entityId: prev.id,
        before: {
          version: prev.version,
          condition: prev.condition,
          conditionLabel: prev.conditionLabel,
          status: prev.status,
          onSiteTreatable: prev.onSiteTreatable,
          referralManaged: prev.referralManaged,
          conditionDetail: prev.conditionDetail,
          baselineStatus: prev.baselineStatus,
          careGoals: prev.careGoals,
          emergencyProtocol: prev.emergencyProtocol,
          dischargeCriteria: prev.dischargeCriteria,
          triggers: prev.triggers,
          redFlags: prev.redFlags,
          firstAction: prev.firstAction,
          externalClinicalHome: prev.externalClinicalHome,
          externalPastoralHome: prev.externalPastoralHome,
          externalCareCadence: prev.externalCareCadence,
        },
        after: { version, ...values },
        reason: "Chronic care plan revised",
      });
      return prev.studentId;
    });
    safeRevalidate(REGISTER_PATH);
    safeRevalidate(planPath(studentId));
    return { ok: true, id: studentId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: chronicWriteError(err, "Could not save the care plan.") };
  }
}

// ============================================================================
// Add / remove a medication (entry × drug × slot | PRN, R99)
// ============================================================================

const AddMedSchema = z.object({
  entryId: z.string().uuid(),
  drugName: z.string().trim().min(1).max(120),
  doseLabel: z.string().trim().min(1).max(120),
  isPrn: z.boolean(),
  slotId: z.string().uuid().nullish(),
  note: z.string().trim().max(2000).nullish(),
});

/**
 * Add one prescription row. R99's XOR (is_prn ⇔ no slot) is refused HERE with the shared friendly
 * message, and the DB CHECK `chronic_med_prn_xor_slot` is the backstop. R102 — a referral-managed plan
 * carries no on-site medication, so the insert is REFUSED with a named error, never silently dropped.
 * The slot is re-resolved to an ACTIVE MEDICATION_ROUND of this school (a client slot id is never
 * trusted), and the per-(entry × drug × slot) unique refuses a duplicate cell.
 */
export async function addChronicMed(input: unknown): Promise<Result> {
  const auth = await authorizeChronicWrite();
  if (!auth.ok) return auth;
  const parsed = AddMedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the drug and its dose to add it." };
  const d = parsed.data;
  // R99 — is_prn XOR slot, refused first so the message is identical to the DB-CHECK backstop.
  if (d.isPrn === !!d.slotId) return { ok: false, error: PRN_XOR_SLOT };
  const userId = auth.actor.id;
  if (!userId) return { ok: false, error: "Your session could not be resolved. Sign in again." };

  try {
    const out = await withStaffScope(auth.schoolId, userId, async (tx) => {
      const [entry] = await tx
        .select({
          id: sickbayChronicEntry.id,
          studentId: sickbayChronicEntry.studentId,
          onSiteTreatable: sickbayChronicEntry.onSiteTreatable,
        })
        .from(sickbayChronicEntry)
        .where(
          and(
            eq(sickbayChronicEntry.schoolId, auth.schoolId),
            eq(sickbayChronicEntry.id, d.entryId),
            eq(sickbayChronicEntry.active, true),
          ),
        )
        .limit(1);
      if (!entry) throw new NamedError("That care plan no longer exists.");
      // 🔴 R102 — refuse the insert, do NOT silently drop it.
      if (!entry.onSiteTreatable) throw new NamedError(R102_REFUSAL);

      let slotId: string | null = null;
      if (d.slotId) {
        const [slot] = await tx
          .select({ id: sickbayScheduleSlot.id })
          .from(sickbayScheduleSlot)
          .where(
            and(
              eq(sickbayScheduleSlot.schoolId, auth.schoolId),
              eq(sickbayScheduleSlot.id, d.slotId),
              eq(sickbayScheduleSlot.kind, "MEDICATION_ROUND"),
              eq(sickbayScheduleSlot.active, true),
            ),
          )
          .limit(1);
        if (!slot) throw new NamedError("That medication round is not on the schedule.");
        slotId = slot.id;
      }

      const [row] = await tx
        .insert(sickbayChronicMed)
        .values({
          schoolId: auth.schoolId,
          entryId: entry.id,
          drugName: d.drugName,
          doseLabel: d.doseLabel,
          isPrn: d.isPrn,
          slotId,
          note: d.note || null,
        })
        .returning({ id: sickbayChronicMed.id });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_chronic_med",
        entityId: row.id,
        after: { entryId: entry.id, drugName: d.drugName, doseLabel: d.doseLabel, isPrn: d.isPrn, slotId },
        reason: "Chronic medication added",
      });
      return { medId: row.id, studentId: entry.studentId };
    });
    safeRevalidate(REGISTER_PATH);
    safeRevalidate(planPath(out.studentId));
    return { ok: true, id: out.medId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: chronicWriteError(err, "Could not add the medication.") };
  }
}

const RemoveMedSchema = z.object({ medId: z.string().uuid() });

/**
 * Remove one prescription row. The med is re-resolved by (school, id) and joined to its entry for the
 * student to revalidate; a hard DELETE is the model (a med schema has no void column — a stopped drug
 * leaves the plan) and the audit before-snapshot preserves what was removed. R110's append-only is a
 * GRANT rule, not a med rule.
 */
export async function removeChronicMed(input: unknown): Promise<Result> {
  const auth = await authorizeChronicWrite();
  if (!auth.ok) return auth;
  const parsed = RemoveMedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid medication." };
  const d = parsed.data;
  const userId = auth.actor.id;
  if (!userId) return { ok: false, error: "Your session could not be resolved. Sign in again." };

  try {
    const studentId = await withStaffScope(auth.schoolId, userId, async (tx) => {
      const [med] = await tx
        .select({
          id: sickbayChronicMed.id,
          drugName: sickbayChronicMed.drugName,
          doseLabel: sickbayChronicMed.doseLabel,
          isPrn: sickbayChronicMed.isPrn,
          slotId: sickbayChronicMed.slotId,
          note: sickbayChronicMed.note,
          studentId: sickbayChronicEntry.studentId,
        })
        .from(sickbayChronicMed)
        .innerJoin(
          sickbayChronicEntry,
          and(
            eq(sickbayChronicEntry.schoolId, auth.schoolId),
            eq(sickbayChronicEntry.id, sickbayChronicMed.entryId),
          ),
        )
        .where(and(eq(sickbayChronicMed.schoolId, auth.schoolId), eq(sickbayChronicMed.id, d.medId)))
        .limit(1);
      if (!med) throw new NamedError("That medication is no longer on the plan.");
      await tx
        .delete(sickbayChronicMed)
        .where(and(eq(sickbayChronicMed.schoolId, auth.schoolId), eq(sickbayChronicMed.id, med.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "deleted",
        entityType: "sickbay_chronic_med",
        entityId: med.id,
        before: {
          drugName: med.drugName,
          doseLabel: med.doseLabel,
          isPrn: med.isPrn,
          slotId: med.slotId,
          note: med.note,
        },
        reason: "Chronic medication removed",
      });
      return med.studentId;
    });
    safeRevalidate(REGISTER_PATH);
    safeRevalidate(planPath(studentId));
    return { ok: true, id: studentId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: chronicWriteError(err, "Could not remove the medication.") };
  }
}

/** Thrown inside a tx to surface a NAMED business error and roll the whole thing back. */
class NamedError extends Error {}
