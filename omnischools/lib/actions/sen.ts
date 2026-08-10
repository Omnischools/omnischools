"use server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { safeRevalidate } from "@/lib/revalidate";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, assertAnyRole, resolveActor } from "@/lib/auth/server";
import { SEN_REGISTER_ROLES, isStaffRole } from "@/lib/access";
import { senRegister, senModuleAdoption, senSupportGrant, students, roleAssignments, roles } from "@/db/schema";

/**
 * GOV-10 · SEN register write actions (CONFIDENTIAL, admin-gated). Both re-check `SEN_REGISTER_ROLES`
 * server-side BEFORE any DB work — a hand-crafted POST that never touched the gated UI is still refused
 * (R411). Audit rows carry NO confidential value and NO student-id/name (GOV10-18): only the record id,
 * the action, and the consent state.
 */

export type SenActionResult = { ok: true } | { ok: false; error: string };

/**
 * Log a SEN action failure WITHOUT the full error object — a Postgres CHECK/FK violation's `detail` can echo
 * the (confidential) failing row (the diagnosis cluster). For a children's-sensitive module, keep row values
 * out of the server logs: log the SQLSTATE code / message text only, never the error object.
 */
function logSenError(where: string, err: unknown): void {
  const e = err as { code?: string; message?: string };
  console.error(`[sen] ${where} failed:`, e?.code ?? e?.message ?? "unknown error");
}

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
  } catch (err) {
    logSenError("enableSenRegister", err);
    return { ok: false, error: "Could not enable the SEN register. Try again." };
  }
}

const CATEGORY = z.enum(["VISUAL", "HEARING", "PHYSICAL", "INTELLECTUAL", "SPEECH", "OTHER"]);

// GOV-10c (R445) · zero-or-more ADDITIONAL categories a student carries beyond their primary/census bucket.
// Categories are census/operational tags, NOT the detail cluster — so they are permitted on a PENDING row
// (they are set in the base insert values, never via senDetailBag). Each category appears at most once per
// student: the DB `sen_register_secondary_not_primary` CHECK bars primary∈secondary; the array-internal
// no-duplicate rule is enforced here (a Postgres CHECK cannot express array-is-a-set), and both are re-checked
// by `categoriesDistinct` below so a hand-crafted request is refused (GOV10-43), not silently cleaned.
const SECONDARY_CATEGORIES = z.array(CATEGORY).max(5).optional();
const categoriesDistinct = (v: { category: string; secondaryCategories?: string[] }): boolean => {
  const sec = v.secondaryCategories ?? [];
  return !sec.includes(v.category) && new Set(sec).size === sec.length;
};
const CATEGORIES_MSG = { message: "Each support category can be listed only once per student." };

// The confidential DETAIL fields — HONOURED ONLY when consentState === GRANTED (R410); a PENDING row stores
// category only. Shared across create / edit / grant-consent so those paths can never drift (R439).
const DETAIL_FIELDS = {
  severity: z.enum(["MILD", "MODERATE", "SEVERE"]).nullable().optional(),
  supportNotes: z.string().trim().max(500).nullable().optional(),
  accommodations: z.array(z.string().trim().min(1).max(80)).max(20).nullable().optional(),
  diagnosisSource: z.enum(["CLINICAL_DIAGNOSIS", "SCHOOL_OBSERVED"]).nullable().optional(),
  diagnosingClinician: z.string().trim().max(120).nullable().optional(),
  diagnosingInstitution: z.string().trim().max(120).nullable().optional(),
  diagnosisYear: z.number().int().min(1950).max(2100).nullable().optional(),
  consentOnFileAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid consent date.").nullable().optional(),
} as const;
const senDetailShape = z.object(DETAIL_FIELDS);
type SenDetail = z.infer<typeof senDetailShape>;

const RecordShape = z
  .object({
    studentId: z.string().uuid(),
    category: CATEGORY,
    secondaryCategories: SECONDARY_CATEGORIES,
    consentState: z.enum(["GRANTED", "PENDING"]),
    ...DETAIL_FIELDS,
  })
  .refine(categoriesDistinct, CATEGORIES_MSG);

const nullish = <T>(v: T | null | undefined): T | null => (v == null ? null : v);

/**
 * The confidential detail column bag. GRANTED → the entered values; NOT granted → EVERY detail column nulled
 * (mirrors the DB `sen_register_pending_no_detail` CHECK). One definition for create / edit / grant-consent.
 */
function senDetailBag(d: SenDetail, granted: boolean) {
  return {
    severity: granted ? nullish(d.severity) : null,
    supportNotes: granted ? nullish(d.supportNotes) : null,
    accommodations: granted ? nullish(d.accommodations) : null,
    diagnosisSource: granted ? nullish(d.diagnosisSource) : null,
    diagnosingClinician: granted ? nullish(d.diagnosingClinician) : null,
    diagnosingInstitution: granted ? nullish(d.diagnosingInstitution) : null,
    diagnosisYear: granted ? nullish(d.diagnosisYear) : null,
    consentOnFileAt: granted ? nullish(d.consentOnFileAt) : null,
  };
}

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
    secondaryCategories: d.secondaryCategories ?? [],
    consentState: d.consentState,
    ...senDetailBag(d, granted),
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
  } catch (err) {
    // A bad studentId trips the composite FK; a stray detail on a PENDING row trips the DB CHECK.
    logSenError("recordSupportNeed", err);
    return { ok: false, error: "Could not save the record. Check the details and try again." };
  }
}

// ── GOV-10b · teacher accommodation-grant (R438) ──────────────────────────────────────────────────────

const GrantShape = z.object({
  studentId: z.string().uuid(),
  granteeUserId: z.string().uuid(),
  reason: z.string().trim().min(1).max(300),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid expiry date.").nullable().optional(),
});

/**
 * Grant a member of staff per-student access to a child's ACCOMMODATIONS (R411/R438). Writer =
 * `SEN_REGISTER_ROLES` (first-statement gate — a teacher can never self-grant). The grantee must be in-school
 * STAFF (not a student/parent); the student must be an ACTIVE student of this school. Audit carries the
 * grantee id only — NO student-id/name/detail (GOV10-18).
 */
export async function grantSenAccess(input: unknown): Promise<SenActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SEN_REGISTER_ROLES);
  const parsed = GrantShape.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid grant." };
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    const result = await withSchool(school.id, async (tx) => {
      // R106/R438 — the grantee must hold ≥1 STAFF role in THIS school (the canonical predicate, so
      // BOARD_MEMBER — read-only, non-staff per NON_STAFF_ROLES — is refused, not silently granted an inert row).
      const granteeRoles = await tx
        .select({ code: roles.code })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .where(and(eq(roleAssignments.schoolId, school.id), eq(roleAssignments.userId, d.granteeUserId)));
      if (!granteeRoles.some((r) => isStaffRole(r.code))) {
        return { kind: "bad_grantee" as const };
      }
      const stu = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.schoolId, school.id), eq(students.id, d.studentId), eq(students.status, "ACTIVE")))
        .limit(1);
      if (stu.length === 0) return { kind: "bad_student" as const };

      const inserted = await tx
        .insert(senSupportGrant)
        .values({
          schoolId: school.id,
          studentId: d.studentId,
          granteeUserId: d.granteeUserId,
          reason: d.reason,
          grantedByUserId: actor.id ?? undefined,
          expiresAt: d.expiresAt ? new Date(`${d.expiresAt}T23:59:59.999Z`) : null,
        })
        .returning({ id: senSupportGrant.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "sen_access_granted",
        entityType: "sen_support_grant",
        entityId: inserted[0].id,
        after: { granteeUserId: d.granteeUserId },
        reason: "SEN accommodation access granted",
      });
      return { kind: "ok" as const };
    });
    if (result.kind === "bad_grantee") return { ok: false, error: "Choose a member of staff to grant access to." };
    if (result.kind === "bad_student") return { ok: false, error: "That student is not an active student of this school." };
    safeRevalidate("/students/special-needs");
    return { ok: true };
  } catch (err) {
    logSenError("grantSenAccess", err);
    return { ok: false, error: "Could not grant access. Try again." };
  }
}

/** Revoke a grant — APPEND-ONLY (stamps `revoked_at`, never deletes). Idempotent-refuse on an already-revoked
 *  or missing grant. `SEN_REGISTER_ROLES`-gated; scoped to this school's own grants. */
export async function revokeSenAccess(input: unknown): Promise<SenActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SEN_REGISTER_ROLES);
  const parsed = z.object({ grantId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { grantId } = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    const result = await withSchool(school.id, async (tx) => {
      const rows = await tx
        .update(senSupportGrant)
        .set({ revokedAt: new Date(), revokedByUserId: actor.id ?? undefined })
        .where(
          and(
            eq(senSupportGrant.schoolId, school.id),
            eq(senSupportGrant.id, grantId),
            isNull(senSupportGrant.revokedAt),
          ),
        )
        .returning({ id: senSupportGrant.id });
      if (rows.length === 0) return { updated: false as const };
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "sen_access_revoked",
        entityType: "sen_support_grant",
        entityId: grantId,
        reason: "SEN accommodation access revoked",
      });
      return { updated: true as const };
    });
    if (!result.updated) return { ok: false, error: "That grant is already revoked or does not exist." };
    safeRevalidate("/students/special-needs");
    return { ok: true };
  } catch (err) {
    logSenError("revokeSenAccess", err);
    return { ok: false, error: "Could not revoke the grant. Try again." };
  }
}

// ── GOV-10b · record editing & consent lifecycle (R439–R441) ───────────────────────────────────────────

const EditShape = z
  .object({
    recordId: z.string().uuid(),
    category: CATEGORY,
    secondaryCategories: SECONDARY_CATEGORIES,
    ...DETAIL_FIELDS,
  })
  .refine(categoriesDistinct, CATEGORIES_MSG);

/** Edit a GRANTED record's detail (R439). `updatedAt` advances; audit carries ONLY the consent state — no
 *  field value, no before-snapshot (GOV10-18 forbids history). Only a GRANTED row is editable. */
export async function editSenRecord(input: unknown): Promise<SenActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SEN_REGISTER_ROLES);
  const parsed = EditShape.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid edit." };
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    const result = await withSchool(school.id, async (tx) => {
      const rows = await tx
        .update(senRegister)
        .set({
          category: d.category,
          secondaryCategories: d.secondaryCategories ?? [],
          ...senDetailBag(d, true),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(senRegister.schoolId, school.id),
            eq(senRegister.id, d.recordId),
            eq(senRegister.consentState, "GRANTED"),
          ),
        )
        .returning({ id: senRegister.id });
      if (rows.length === 0) return { updated: false as const };
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "sen_record_updated",
        entityType: "sen_register",
        entityId: d.recordId,
        after: { consentState: "GRANTED" },
        reason: "SEN record edited",
      });
      return { updated: true as const };
    });
    if (!result.updated) return { ok: false, error: "No granted record to edit." };
    safeRevalidate("/students/special-needs");
    safeRevalidate("/reports/statutory/generate-annual-census");
    return { ok: true };
  } catch (err) {
    logSenError("editSenRecord", err);
    return { ok: false, error: "Could not save the changes. Try again." };
  }
}

const GrantConsentShape = z.object({
  recordId: z.string().uuid(),
  ...DETAIL_FIELDS,
  // consentOnFileAt is REQUIRED here (a GRANTED record proves consent is filed) — overrides the optional
  // DETAIL_FIELDS version, so it must come AFTER the spread.
  consentOnFileAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid consent date."),
});

/** PENDING → GRANTED when written consent arrives (R440). Requires the consent date; unlocks the detail
 *  cluster (the CHECK passes on GRANTED). The census `total` is UNCHANGED — the child was already counted as
 *  PENDING (consent gates the DETAIL, not the count). */
export async function grantSenConsent(input: unknown): Promise<SenActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SEN_REGISTER_ROLES);
  const parsed = GrantConsentShape.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    const result = await withSchool(school.id, async (tx) => {
      const rows = await tx
        .update(senRegister)
        .set({ consentState: "GRANTED", ...senDetailBag(d, true), updatedAt: new Date() })
        .where(
          and(
            eq(senRegister.schoolId, school.id),
            eq(senRegister.id, d.recordId),
            eq(senRegister.consentState, "PENDING"),
          ),
        )
        .returning({ id: senRegister.id });
      if (rows.length === 0) return { updated: false as const };
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "sen_consent_granted",
        entityType: "sen_register",
        entityId: d.recordId,
        after: { consentState: "GRANTED" },
        reason: "SEN consent granted (pending → granted)",
      });
      return { updated: true as const };
    });
    if (!result.updated) return { ok: false, error: "No pending record to grant consent for." };
    safeRevalidate("/students/special-needs");
    safeRevalidate("/reports/statutory/generate-annual-census");
    return { ok: true };
  } catch (err) {
    logSenError("grantSenConsent", err);
    return { ok: false, error: "Could not record consent. Try again." };
  }
}

/** Consent withdrawal (R441): GRANTED → PENDING, NULL the whole detail cluster (the CHECK passes), and
 *  CASCADE-REVOKE every live teacher grant for that student (the lawful basis to see detail is gone). The
 *  child STAYS census-counted (category retained). Append-only revokes. */
export async function withdrawSenConsent(input: unknown): Promise<SenActionResult> {
  const { school } = await requireSchool();
  await assertAnyRole(SEN_REGISTER_ROLES);
  const parsed = z.object({ recordId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { recordId } = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    const result = await withSchool(school.id, async (tx) => {
      const rows = await tx
        .update(senRegister)
        .set({
          consentState: "PENDING",
          severity: null,
          supportNotes: null,
          accommodations: null,
          diagnosisSource: null,
          diagnosingClinician: null,
          diagnosingInstitution: null,
          diagnosisYear: null,
          consentOnFileAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(senRegister.schoolId, school.id),
            eq(senRegister.id, recordId),
            eq(senRegister.consentState, "GRANTED"),
          ),
        )
        .returning({ studentId: senRegister.studentId });
      if (rows.length === 0) return { updated: false as const };
      // Cascade-revoke every live grant for that student (append-only).
      await tx
        .update(senSupportGrant)
        .set({ revokedAt: new Date(), revokedByUserId: actor.id ?? undefined })
        .where(
          and(
            eq(senSupportGrant.schoolId, school.id),
            eq(senSupportGrant.studentId, rows[0].studentId),
            isNull(senSupportGrant.revokedAt),
          ),
        );
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "sen_consent_withdrawn",
        entityType: "sen_register",
        entityId: recordId,
        after: { consentState: "PENDING" },
        reason: "SEN consent withdrawn (granted → pending); grants revoked",
      });
      return { updated: true as const };
    });
    if (!result.updated) return { ok: false, error: "No granted record to withdraw consent for." };
    safeRevalidate("/students/special-needs");
    safeRevalidate("/reports/statutory/generate-annual-census");
    return { ok: true };
  } catch (err) {
    logSenError("withdrawSenConsent", err);
    return { ok: false, error: "Could not withdraw consent. Try again." };
  }
}
