import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { senSupportGrant } from "@/db/schema";

/**
 * GOV-10b · SEN teacher accommodation-grant liveness (R435). These read ONLY the grant table — they project
 * NO `sen_register` confidential detail column, so they are NOT part of the sole-content-path (R437). Live is
 * evaluated in SQL against the DB's own `now()` IN THIS transaction — never a session claim, never middleware
 * (the sickbay `grantIsLive` / VLC `activePastoralFlagStudentIds` idiom).
 */

/** `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())` — per request, in-tx. */
const grantIsLive = sql`${senSupportGrant.revokedAt} is null and (${senSupportGrant.expiresAt} is null or ${senSupportGrant.expiresAt} > now())`;

/**
 * True iff `userId` holds ≥1 LIVE SEN support grant in this school — the page ADMIT gate for the grantee arm
 * (`canAccessSenRegister = role∈SET ‖ hasAnyLiveSenGrant`).
 */
export async function hasAnyLiveSenGrant(tx: Tx, schoolId: string, userId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: senSupportGrant.id })
    .from(senSupportGrant)
    .where(
      and(
        eq(senSupportGrant.schoolId, schoolId),
        eq(senSupportGrant.granteeUserId, userId),
        grantIsLive,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * The set of student ids `userId` holds a LIVE grant for — the grantee reader's ROW FILTER (mirrors
 * `activePastoralFlagStudentIds`). A grantee sees ONLY these students, never the rest of the register.
 */
export async function liveSenGrantStudentIds(
  tx: Tx,
  schoolId: string,
  userId: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ studentId: senSupportGrant.studentId })
    .from(senSupportGrant)
    .where(
      and(
        eq(senSupportGrant.schoolId, schoolId),
        eq(senSupportGrant.granteeUserId, userId),
        grantIsLive,
      ),
    );
  return new Set(rows.map((r) => r.studentId));
}
