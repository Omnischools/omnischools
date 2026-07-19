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
 * Unwrap a thrown query error to the underlying PostgresError fields.
 *
 * Drizzle wraps every driver failure in a `DrizzleQueryError` and hangs the real `PostgresError` off
 * `.cause`, so an `(err as {code?}).code === "23505"` check against the THROWN error silently misses and
 * a constraint violation degrades to the generic "please try again" instead of its own message. Always
 * inspect through this helper. The cause chain is walked (depth-capped) so it survives another wrap.
 */
export function pgError(err: unknown): { code?: string; constraint: string | undefined } {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur != null && typeof cur === "object"; i++) {
    const e = cur as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof e.code === "string") {
      return {
        code: e.code,
        constraint: typeof e.constraint_name === "string" ? e.constraint_name : undefined,
      };
    }
    cur = e.cause;
  }
  return { code: undefined, constraint: undefined };
}

/** True when the error is a Postgres unique violation (SQLSTATE 23505), however deeply it was wrapped. */
export function isUniqueViolation(err: unknown): boolean {
  return pgError(err).code === "23505";
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
