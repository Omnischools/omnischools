import "server-only";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { sickbayAdmission, sickbayReferral } from "@/db/schema";

/**
 * 🔴 INCR-29 · the PARENT-facing sickbay reader (SHS module 4.4 × parent portal 4.3 · Kofi R229/R230).
 * The single most privacy-sensitive reader in the product.
 *
 * MEDIUM-3 — Wells's `parent_scope` (0064) opens the ROW on `sickbay_admission` + `sickbay_referral`
 * (RLS scopes by child), INCLUDING every Class-4 column on it — the ER-handoff snapshot and the
 * reproductive-PII note. RLS is ROW-level and CANNOT mask a column, so THIS PROJECTION is the ONLY
 * guard keeping clinical data off the wire. A clinical column in a SELECT here — or a single join to
 * the visit / any clinical table — leaks health PII to a parent. The reader therefore touches EXACTLY
 * these two tables, joins NOTHING, and projects EXACTLY the owner-confirmed frozen key-set below.
 *
 * FROZEN KEY-SET (owner-confirmed 2026-07-26, R229). `parentSickbayStatusTx()` returns EXACTLY these
 * four keys — a clinical field spread onto it changes the key-set and reds parent-sickbay-data.test.ts
 * (PS7), not production. NO studentId / ids / free-text ever in the returned shape (studentId is an
 * INPUT filter only, resolved server-side from the session, never returned).
 *   • onSiteCareOpen — an OPEN admission exists (discharged_at IS NULL). R230.
 *   • admittedOnDate — admitted_at, DATE-ONLY no clock (owner FLAG A). null when no open admission.
 *   • referredOut    — an OPEN referral exists (departed_at set · returned_at NULL · voided_at NULL). FLAG C.
 *   • referredOnDate — departed_at, DATE-ONLY. null when no open referral.
 *
 * 🚫 NEVER in a SELECT, NEVER joined (R229 deny-list / R230/R235): the visit's working impression /
 * presenting complaint / surveillance category (the reader does NOT read the visit table at all) /
 * vitals / drug·MAR / the chronic register / clinician / the hospital name / the ward / the physical
 * bed / isolation flag / the expected-return + expected-discharge stamps (FLAG B, OUT) / transport mode
 * / who reported the intake / the frozen ER-handoff snapshot (referral reason · handoff labs · last
 * meal · the Class-4 reproductive note · travel note) / NHIS / cost / the comms thread + notifications.
 * The leak surface is the join list, and there is NONE. NO write, NO notify/SMS.
 */
export interface ParentSickbayStatus {
  onSiteCareOpen: boolean;
  admittedOnDate: string | null; // 'YYYY-MM-DD' — date only, never a clock
  referredOut: boolean;
  referredOnDate: string | null; // 'YYYY-MM-DD' — date only, never a clock
}

// Date-only projection, done IN SQL so a raw timestamp never leaves the DB (FLAG A). `AT TIME ZONE
// 'UTC'` pins the civil date deterministically (Ghana is UTC+0, so this is the same day the medical
// record shows — the medical-hold module's convention) regardless of the connection's TimeZone.
const dateOnly = (col: unknown) =>
  sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD')`;

/**
 * The two open-care facts for ONE child, projected to the frozen key-set. `studentId` is an INPUT
 * filter (resolved server-side from the session, never a URL param) and is NEVER returned. MUST run on
 * a tx already scoped by `withParentScope`; the `parent_scope` RLS predicate independently guarantees
 * the id can only be one of THIS parent's own children — a forged id yields zero rows (fail-closed).
 */
export async function parentSickbayStatusTx(
  tx: Tx,
  schoolId: string,
  studentId: string,
): Promise<ParentSickbayStatus> {
  // OPEN admission — the on-site fact (R230). At most one row (uniq_sickbay_open_admission_student).
  const [adm] = await tx
    .select({ admittedOnDate: dateOnly(sickbayAdmission.admittedAt) })
    .from(sickbayAdmission)
    .where(
      and(
        eq(sickbayAdmission.schoolId, schoolId),
        eq(sickbayAdmission.studentId, studentId),
        isNull(sickbayAdmission.dischargedAt),
      ),
    )
    .limit(1);

  // OPEN referral — the referred-out fact (R230): departed, not yet returned, not voided.
  const [ref] = await tx
    .select({ referredOnDate: dateOnly(sickbayReferral.departedAt) })
    .from(sickbayReferral)
    .where(
      and(
        eq(sickbayReferral.schoolId, schoolId),
        eq(sickbayReferral.studentId, studentId),
        isNotNull(sickbayReferral.departedAt),
        isNull(sickbayReferral.returnedAt),
        isNull(sickbayReferral.voidedAt),
      ),
    )
    .limit(1);

  return {
    onSiteCareOpen: !!adm,
    admittedOnDate: adm?.admittedOnDate ?? null,
    referredOut: !!ref,
    referredOnDate: ref?.referredOnDate ?? null,
  };
}

/** Entry point — ONE child's open-care status under `withParentScope` (never `withSchool`). */
export async function loadParentSickbayStatus(
  schoolId: string,
  userId: string,
  studentId: string,
): Promise<ParentSickbayStatus> {
  return withParentScope(schoolId, userId, (tx) => parentSickbayStatusTx(tx, schoolId, studentId));
}
