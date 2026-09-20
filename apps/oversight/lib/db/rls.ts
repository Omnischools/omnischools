import { sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";

/** The jurisdiction tiers a GES session can hold (OVERSIGHT_ANALYTICS_SPEC §8). */
export type JurisdictionLevel = "SCHOOL" | "DISTRICT" | "REGION" | "NATIONAL";

export interface JurisdictionScope {
  /** The user's node in dim_jurisdiction. Ignored (may be null) when level is NATIONAL. */
  jurisdictionId: string | null;
  level: JurisdictionLevel;
  /** The acting officer's id — sets app.current_officer for the audit_access_log own-rows rule. */
  officerId?: string | null;
}

/**
 * Run a unit of work scoped to a GES user's jurisdiction subtree.
 *
 * Sets the request GUCs the RLS policies read (db/sql/policies.sql):
 *   app.current_jurisdiction — the user's node
 *   app.current_level        — SCHOOL | DISTRICT | REGION | NATIONAL (NATIONAL = no filter)
 *   app.current_officer      — the acting officer (audit own-rows)
 *
 * Every Oversight read MUST go through this helper so the jurisdiction predicate applies. The GUCs
 * are set inside the transaction (local = true) from trusted server code, never from request input,
 * so a district director cannot forge a wider scope.
 */
export async function withJurisdiction<T>(
  scope: JurisdictionScope,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_jurisdiction', ${scope.jurisdictionId ?? ""}, true)`,
    );
    await tx.execute(sql`select set_config('app.current_level', ${scope.level}, true)`);
    await tx.execute(
      sql`select set_config('app.current_officer', ${scope.officerId ?? ""}, true)`,
    );
    return fn(tx);
  });
}
