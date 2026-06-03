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
 * Escalated, RLS-bypassing work (migrations, ETL, cross-tenant admin jobs).
 * Use sparingly and never from tenant-facing request handlers.
 */
export async function withoutTenantScope<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role omnischools_admin`);
    return fn(tx);
  });
}
