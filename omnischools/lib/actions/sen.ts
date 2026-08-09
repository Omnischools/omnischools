"use server";
import { z } from "zod";
import { safeRevalidate } from "@/lib/revalidate";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, assertAnyRole, resolveActor } from "@/lib/auth/server";
import { SEN_REGISTER_ROLES } from "@/lib/access";
import { senRegister, senModuleAdoption } from "@/db/schema";

/**
 * GOV-10 · SEN register write actions (CONFIDENTIAL, admin-gated). Both re-check `SEN_REGISTER_ROLES`
 * server-side BEFORE any DB work — a hand-crafted POST that never touched the gated UI is still refused
 * (R411). Audit rows carry NO confidential value and NO student-id/name (GOV10-18): only the record id,
 * the action, and the consent state.
 */

export type SenActionResult = { ok: true } | { ok: false; error: string };

/**
 * Explicit opt-in (R413) — writes the `sen_module_adoption` marker so the annual census §5 becomes AUTO
 * (adopted → FULL, even at a captured zero). Idempotent (a re-enable is a no-op).
 */
export async function enableSenRegister(): Promise<SenActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SEN_REGISTER_ROLES);
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .insert(senModuleAdoption)
        .values({ schoolId: school.id, enabledBy: actor.id ?? undefined })
        .onConflictDoNothing({ target: senModuleAdoption.schoolId });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "sen_module_enabled",
        entityType: "sen_module_adoption",
        entityId: school.id,
        reason: "SEN register enabled",
      });
    });
    safeRevalidate("/students/special-needs");
    safeRevalidate("/reports/statutory/generate-annual-census");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not enable the SEN register. Try again." };
  }
}

const RecordShape = z.object({
  studentId: z.string().uuid(),
  category: z.enum(["VISUAL", "HEARING", "PHYSICAL", "INTELLECTUAL", "SPEECH", "OTHER"]),
  consentState: z.enum(["GRANTED", "PENDING"]),
  // Detail — HONOURED ONLY when consentState === GRANTED (R410); a PENDING row stores category only.
  severity: z.enum(["MILD", "MODERATE", "SEVERE"]).nullable().optional(),
  supportNotes: z.string().trim().max(500).nullable().optional(),
  accommodations: z.array(z.string().trim().min(1).max(80)).max(20).nullable().optional(),
  diagnosisSource: z.enum(["CLINICAL_DIAGNOSIS", "SCHOOL_OBSERVED"]).nullable().optional(),
  diagnosingClinician: z.string().trim().max(120).nullable().optional(),
  diagnosingInstitution: z.string().trim().max(120).nullable().optional(),
  diagnosisYear: z.number().int().min(1950).max(2100).nullable().optional(),
  consentOnFileAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid consent date.").nullable().optional(),
});

const nullish = <T>(v: T | null | undefined): T | null => (v == null ? null : v);

/**
 * Record a support need (R409/R410). Consent is the enforcement point:
 *  - PENDING  → student_id + category ONLY; every detail column is nulled (matches the DB
 *    `sen_register_pending_no_detail` CHECK); the child is still counted in the de-identified census.
 *  - GRANTED  → the full record, and `consentOnFileAt` is REQUIRED (a granted record proves consent is filed).
 * One row per student (R415) — a second record for the same student is refused.
 */
export async function recordSupportNeed(input: unknown): Promise<SenActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SEN_REGISTER_ROLES);
  const parsed = RecordShape.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid record." };
  }
  const d = parsed.data;
  const granted = d.consentState === "GRANTED";
  if (granted && !d.consentOnFileAt) {
    return { ok: false, error: "A record with consent on file needs the date consent was filed." };
  }

  // The insert bag — PENDING withholds ALL detail (defense-in-depth mirroring the DB CHECK).
  const vals = {
    schoolId: school.id,
    studentId: d.studentId,
    category: d.category,
    consentState: d.consentState,
    severity: granted ? nullish(d.severity) : null,
    supportNotes: granted ? nullish(d.supportNotes) : null,
    accommodations: granted ? nullish(d.accommodations) : null,
    diagnosisSource: granted ? nullish(d.diagnosisSource) : null,
    diagnosingClinician: granted ? nullish(d.diagnosingClinician) : null,
    diagnosingInstitution: granted ? nullish(d.diagnosingInstitution) : null,
    diagnosisYear: granted ? nullish(d.diagnosisYear) : null,
    consentOnFileAt: granted ? nullish(d.consentOnFileAt) : null,
  };

  const actor = await resolveActor(school.id);
  try {
    const result = await withSchool(school.id, async (tx) => {
      const inserted = await tx
        .insert(senRegister)
        .values({ ...vals, createdBy: actor.id ?? undefined })
        .onConflictDoNothing({ target: [senRegister.schoolId, senRegister.studentId] })
        .returning({ id: senRegister.id });
      if (inserted.length === 0) return { duplicate: true as const };
      // Recording implies adoption (R413) — ensure the marker so the census §5 flips to AUTO.
      await tx
        .insert(senModuleAdoption)
        .values({ schoolId: school.id, enabledBy: actor.id ?? undefined })
        .onConflictDoNothing({ target: senModuleAdoption.schoolId });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "sen_record_created",
        entityType: "sen_register",
        entityId: inserted[0].id,
        // NO confidential value, NO student-id/name (GOV10-18) — only the consent posture.
        after: { consentState: d.consentState },
        reason: "SEN support need recorded",
      });
      return { duplicate: false as const };
    });
    if (result.duplicate) {
      return { ok: false, error: "This student already has a SEN record." };
    }
    safeRevalidate("/students/special-needs");
    safeRevalidate("/reports/statutory/generate-annual-census");
    return { ok: true };
  } catch {
    // A bad studentId trips the composite FK; a stray detail on a PENDING row trips the DB CHECK.
    return { ok: false, error: "Could not save the record. Check the details and try again." };
  }
}
