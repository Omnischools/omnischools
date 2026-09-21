"use server";
import { and, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { requireSchool, resolveActor, assertAnyRole } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { schoolStaffOversightConsent, schoolStaffOversightConsentEvent } from "@/db/schema";
import { CONSENT_STATEMENT_VERSION, highestRankedRole } from "@/lib/oversight-consent";

/**
 * GES staff-record consent — the ONLY writer of school_staff_oversight_consent (Oversight reads it,
 * never writes it). Grant/withdraw both:
 *   • fence independently with `assertAnyRole` (the page redirect does not protect a hand-crafted POST);
 *   • upsert the ONE current-state row per (school, scope) — the CHECK keeps state/revoked_at agreeing;
 *   • append to the immutable event log (the consent history — a Postgres trigger rejects UPDATE/DELETE).
 *
 * The append-only event log IS the audit trail here, so there is deliberately NO `recordAudit` call and
 * NO new audit `entityType` to classify (audit-classification guard) — the history is richer and immutable.
 * The action never branches on ownership: a non-public school records consent identically; enforcement
 * stays flag-off on the Oversight read side until the DPO lawful-basis position exists (surface map §6).
 */
const SCOPE = "NON_GES_STAFF" as const;
// Independent action fence — NOT widened to PROPRIETOR (Kofi's contract names ADMIN/HEADMASTER only).
const CONSENT_ROLES = ["ADMIN", "HEADMASTER"] as const;

export async function grantOversightConsent(): Promise<{ ok: boolean; error?: string }> {
  const { user, school } = await requireSchool();
  await assertAnyRole(CONSENT_ROLES);
  const actor = await resolveActor(school.id); // FK-safe granter id
  const grantedByRole = highestRankedRole(user.roles, CONSENT_ROLES) ?? actor.role;
  try {
    await withSchool(school.id, async (tx) => {
      const [prior] = await tx
        .select({ state: schoolStaffOversightConsent.state })
        .from(schoolStaffOversightConsent)
        .where(
          and(
            eq(schoolStaffOversightConsent.schoolId, school.id),
            eq(schoolStaffOversightConsent.scope, SCOPE),
          ),
        );
      const now = new Date();
      await tx
        .insert(schoolStaffOversightConsent)
        .values({
          schoolId: school.id,
          scope: SCOPE,
          state: "GRANTED",
          grantedByUserId: actor.id ?? null,
          grantedByRole,
          grantedAt: now,
          revokedAt: null,
          consentStatementVersion: CONSENT_STATEMENT_VERSION,
        })
        .onConflictDoUpdate({
          target: [schoolStaffOversightConsent.schoolId, schoolStaffOversightConsent.scope],
          set: {
            state: "GRANTED",
            grantedByUserId: actor.id ?? null,
            grantedByRole,
            grantedAt: now,
            revokedAt: null,
            consentStatementVersion: CONSENT_STATEMENT_VERSION,
          },
        });
      await tx.insert(schoolStaffOversightConsentEvent).values({
        schoolId: school.id,
        scope: SCOPE,
        // REGRANT when the prior current-state row was withdrawn; first grant otherwise.
        eventType: prior?.state === "REVOKED" ? "REGRANT" : "GRANT",
        actorUserId: actor.id ?? null,
        actorRole: grantedByRole,
        consentStatementVersion: CONSENT_STATEMENT_VERSION,
        occurredAt: now,
      });
    });
    safeRevalidate("/settings/oversight-consent");
    safeRevalidate("/settings");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not record consent. Please try again." };
  }
}

export async function revokeOversightConsent(): Promise<{ ok: boolean; error?: string }> {
  const { user, school } = await requireSchool();
  await assertAnyRole(CONSENT_ROLES);
  const actor = await resolveActor(school.id);
  const actorRole = highestRankedRole(user.roles, CONSENT_ROLES) ?? actor.role;
  try {
    await withSchool(school.id, async (tx) => {
      const now = new Date();
      // Only flip a LIVE grant → keeps granted_by_* / granted_at; the CHECK requires revoked_at set.
      // Filtering on state='GRANTED' makes this idempotent: a second withdraw updates 0 rows and
      // appends no duplicate REVOKE.
      const updated = await tx
        .update(schoolStaffOversightConsent)
        .set({ state: "REVOKED", revokedAt: now })
        .where(
          and(
            eq(schoolStaffOversightConsent.schoolId, school.id),
            eq(schoolStaffOversightConsent.scope, SCOPE),
            eq(schoolStaffOversightConsent.state, "GRANTED"),
          ),
        )
        .returning({ id: schoolStaffOversightConsent.id });
      if (updated.length === 0) return; // nothing live to withdraw
      await tx.insert(schoolStaffOversightConsentEvent).values({
        schoolId: school.id,
        scope: SCOPE,
        eventType: "REVOKE",
        actorUserId: actor.id ?? null,
        actorRole,
        consentStatementVersion: null, // a withdrawal agrees to no wording
        occurredAt: now,
      });
    });
    safeRevalidate("/settings/oversight-consent");
    safeRevalidate("/settings");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not withdraw consent. Please try again." };
  }
}
