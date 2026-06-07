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
