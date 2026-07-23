import { sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";

/**
 * Run a unit of work scoped to a single tenant.
 * Sets `app.current_school` for the transaction so every RLS policy
 * (USING school_id = current_setting('app.current_school')::uuid) applies.
 * All tenant-scoped reads/writes MUST go through this helper.
 */
export async function withSchool<T>(
  schoolId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_school', ${schoolId}, true)`);
    return fn(tx);
  });
}

/**
 * Run a unit of work scoped to a single PARENT viewing ONE of their own children (INCR-19a, the
 * parent-portal read boundary — Module 4.3 / Decision 13).
 *
 * Sets TWO GUCs for the transaction, bypass OFF:
 *   • `app.current_school`      — the tenant, exactly as `withSchool` (tenant_isolation still applies);
 *   • `app.current_parent_user` — the authenticated ref_user id, the SECOND boundary this seam adds.
 *
 * WHY A SECOND GUC + A SECOND POLICY FAMILY. `tenant_isolation` is PERMISSIVE and Postgres OR's
 * permissive policies, so it alone lets a parent read EVERY row in the school (Lucy: "a plain
 * tenant_isolation policy lets a PARENT read every candidate"). The parent scope therefore lives in
 * `AS RESTRICTIVE` policies (`parent_deny` / `parent_scope`, see db/sql/policies.sql), which Postgres
 * AND's with the permissive set — they can only TIGHTEN, never widen. Every restrictive policy is
 * guarded `pu IS NULL OR <rule>` where `pu = NULLIF(current_setting('app.current_parent_user',
 * true), '')`; because NEITHER `withSchool` NOR `withoutTenantScope` ever sets that GUC, `pu IS NULL`
 * on every staff / escalated session → the restrictive clause is TRUE → a total no-op → their
 * behaviour is byte-unchanged. Only THIS helper sets the GUC, so only a parent session is scoped.
 *
 * Deny-by-default: a parent session sees ZERO rows on every tenant table except the small
 * parent-readable set (their child + that child's WASSCE artefacts + their own comms). The GUC is set
 * only here, in trusted server code, never from request input, so it cannot be forged.
 *
 * Read-only by contract: there is NO parent write path (Kofi R4). Do NOT issue writes inside this
 * helper.
 */
export async function withParentScope<T>(
  schoolId: string,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_school', ${schoolId}, true)`);
    await tx.execute(sql`select set_config('app.current_parent_user', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Run a unit of work scoped to ONE STAFF USER inside one tenant (INCR-23a, the chronic-register
 * boundary — Module 4.4 / owner decision D2). This is the THIRD RLS boundary in the product.
 *
 * Sets TWO GUCs for the transaction, bypass OFF:
 *   • `app.current_school`      — the tenant, exactly as `withSchool` (tenant_isolation still applies);
 *   • `app.current_staff_user`  — the authenticated ref_user id of the member of staff.
 *
 * 🔴 THE POLARITY IS THE INVERSE OF `withParentScope`, DELIBERATELY (Kofi R112). Every `parent_scope`
 * policy is guarded `pu IS NULL OR <rule>` — PERMIT by default — which is safe there because those
 * tables' default audience IS all staff, so an unset GUC has to be a no-op. The `staff_grant_scope`
 * family is guarded `su IS NOT NULL AND <rule>` — DENY by default — because the four
 * `sickbay_chronic_*` tables have NO default audience: only a MATRON, a HEADMASTER (minus
 * MENTAL_HEALTH, R116) or a named grantee may read a care plan. The register's route is deliberately
 * wider than `SICKBAY_ROLES` (R117), so `su IS NULL ⇒ permit` would mean one forgotten seam hands a
 * HOUSEMASTER the whole register; under deny-by-default the same bug yields an empty page.
 * ⚠ PR #176 is the demonstrated version of that hazard, not a hypothetical one: a claimed parent read
 * children's blood groups, allergies, conditions and medications precisely because a permit-by-default
 * clause met an unset GUC on a staff-shaped page.
 *
 * READS **AND WRITES** (unlike `withParentScope`, which is read-only by contract): a matron's care-plan
 * and grant writes run inside this seam too. The write half of each policy is a WITH CHECK requiring a
 * DEFAULT CLINICAL ROLE rather than "an entry you may read" — a WITH CHECK is evaluated on a row that
 * does not exist yet, so an entry-reachability rule would make it impossible to create the first care
 * plan, and the actor-shaped rule additionally stops a FULL_PLAN grantee from EDITING the plan he was
 * shown or self-issuing a wider grant.
 *
 * The GUC is set only here, in trusted server code, never from request input, so it cannot be forged.
 * Expiry and revocation are evaluated in SQL against the DB's own `now()` inside this transaction
 * (R114) — never a session claim, never middleware, never a cached `hasGrant`.
 */
export async function withStaffScope<T>(
  schoolId: string,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_school', ${schoolId}, true)`);
    await tx.execute(sql`select set_config('app.current_staff_user', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Postgres error classification lives in the PURE `./pg-error` module (no driver import, so it is
 * unit-tested in `lib/db/pg-error.test.ts`). Re-exported here because every caller already imports the
 * db seam from `@/lib/db/rls` — see that module for WHY reading `.code`/`.message` off the thrown
 * error silently misses.
 */
export { pgError, isUniqueViolation } from "./pg-error";

/**
 * Escalated, RLS-bypassing work (onboarding, identity lookups, ETL, admin jobs).
 *
 * Sets the `app.bypass_rls` GUC for the transaction; the tenant-isolation policies
 * (db/sql/policies.sql) pass unconditionally while it is 'on'. This replaces a
 * BYPASSRLS role — which Supabase's non-superuser `postgres` cannot create — and is
 * portable across the local Docker DB and Supabase. The flag is set only here, in
 * trusted server code, never from request input, so it cannot be forged.
 *
 * Use sparingly and never to serve tenant-facing reads without an explicit reason.
 */
export async function withoutTenantScope<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}
