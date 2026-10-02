import { sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import type { OfficerSession } from "@/lib/oversight/officer";

/** The jurisdiction tiers a GES session can hold (OVERSIGHT_ANALYTICS_SPEC §8). */
export type JurisdictionLevel = "SCHOOL" | "DISTRICT" | "REGION" | "NATIONAL";

/**
 * ⚠ NOT EXPORTED, AND THAT IS THE POINT (increment G).
 *
 * This interface used to be `export interface JurisdictionScope`, which meant every caller of
 * `withJurisdiction()` assembled its own scope object — typically by copying three fields off the
 * officer. It worked, and it had one fatal property: `withJurisdiction({ jurisdictionId: null,
 * level: "NATIONAL" }, …)` typechecked. That literal is a complete, unauthenticated national
 * jurisdiction ceiling, two lines long, available to any page in the app; the GUCs it writes are
 * what every policy in db/sql/policies.sql trusts. The comment below used to say "never from request
 * input, so a district director cannot forge a wider scope" — true of the request, but nothing in
 * the type system said it of the CODE.
 *
 * Now the only way to obtain a `JurisdictionScope` is `scopeFor(session)`, and the only way to
 * obtain a session is for one to have been resolved from the database (see the resolution brand in
 * lib/oversight/officer.ts). So the scope is unforgeable by construction: there is no literal, no
 * partial, and no "just this once" shape that reaches these three `set_config` calls.
 */
interface RawJurisdictionScope {
  /** The user's node in dim_jurisdiction. Ignored (may be null) when level is NATIONAL. */
  jurisdictionId: string | null;
  level: JurisdictionLevel;
  /** The acting officer's id — sets app.current_officer for the audit_access_log own-rows rule. */
  officerId: string | null;
}

declare const SESSION_DERIVED: unique symbol;

/**
 * A jurisdiction scope that provably came from an `OfficerSession`. Opaque on purpose: callers pass
 * it around and hand it to `withJurisdiction()`, and read `officerId` where they need the acting
 * officer, but cannot build one.
 */
export type JurisdictionScope = RawJurisdictionScope & {
  readonly [SESSION_DERIVED]: true;
};

/**
 * THE ONLY CONSTRUCTOR. Takes the whole session rather than three loose fields, so the node and the
 * tier cannot be paired with a different officer's id by a mistake at the call site.
 *
 * NATIONAL: the officer's node id is passed THROUGH rather than nulled. `ov_is_national()`
 * short-circuits `ov_in_subtree()` before the node is consulted, so the value is never used as a
 * filter for a national officer — but passing it keeps one rule ("app.current_jurisdiction is the
 * officer's own node, always") instead of two, and keeps the GUC agreeing with the directory row
 * (`ref_oversight_officer.jurisdiction_id` is NOT NULL even at NATIONAL — Wells's note). The dev
 * shim is the one session with a genuinely null node, and null is written as the empty string,
 * exactly as before.
 */
export function scopeFor(session: OfficerSession): JurisdictionScope {
  return {
    jurisdictionId: session.jurisdictionId,
    level: session.level,
    officerId: session.officerId,
  } as JurisdictionScope;
}

/**
 * Run a unit of work scoped to a GES user's jurisdiction subtree.
 *
 * Sets the request GUCs the RLS policies read (db/sql/policies.sql):
 *   app.current_jurisdiction — the user's node
 *   app.current_level        — SCHOOL | DISTRICT | REGION | NATIONAL (NATIONAL = no filter)
 *   app.current_officer      — the acting officer (audit own-rows)
 *
 * Every Oversight read MUST go through this helper so the jurisdiction predicate applies. This
 * function and lib/db/readback.ts are the ONLY two places in the app that call `set_config`, and
 * the scope it takes can only have come from a resolved session (see above) — so the ceiling is
 * never a value the request, or the author, chose.
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
