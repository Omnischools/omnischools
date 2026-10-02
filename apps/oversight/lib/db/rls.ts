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
 * lib/oversight/officer.ts). So no literal, no partial and no "just this once" shape reaches these
 * three `set_config` calls FROM TYPESCRIPT — which is a statement about this codebase, not about the
 * database. See THE TRUST RESIDUAL below `withJurisdiction()`: the GUCs themselves are fully
 * trusted, so the property being bought here is "application code cannot hand-write a ceiling", not
 * "a ceiling cannot be forged".
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
 * Every Oversight read MUST go through this helper so the jurisdiction predicate applies. The scope
 * it takes can only have come from a resolved session (see above), so the ceiling is never a value
 * the request, or the author, chose.
 *
 * `set_config` is called in exactly THREE places in this app, and the division is deliberate:
 *   · HERE — the three jurisdiction GUCs, from a resolved session. The chokepoint.
 *   · lib/db/readback.ts — `app.current_school`, the OPERATIONAL tenant GUC, one school per
 *     transaction, on a different database with a different credential.
 *   · lib/provisioning/officers.ts (`withNationalRead`) — `app.current_level = 'NATIONAL'` so the
 *     PROVISIONER connection can read `dim_jurisdiction` for the node picker and the officer list.
 *     That one is a READ CONVENIENCE and no guard depends on it: every provisioning guard derives
 *     the tier through a SECURITY DEFINER function that ignores GUCs entirely, so deleting that line
 *     would empty a dropdown rather than permit anything.
 * tests/auth-boundaries.test.ts pins all three by name, and separately pins that the two SCOPE GUCs
 * (`app.current_jurisdiction`, `app.current_officer`) are written only here.
 *
 * ══ THE TRUST RESIDUAL — stated plainly, because every other residual in this file set is ══
 *
 * THE `app.current_*` GUCs ARE FULLY TRUSTED BY THE DATABASE. Every policy in db/sql/policies.sql
 * reads them through `ov_current_jurisdiction()` / `ov_is_national()` / `ov_current_officer()` and
 * believes what it finds. There is no signature on them, no binding to the connection's identity,
 * and no way for Postgres to tell a value this function set from one typed into a `psql` prompt on
 * the same connection. So the unforgeability established above is a TYPESCRIPT property — a brand,
 * a single chokepoint, and the app role having no write grant on the officer directory — and NOT a
 * database property.
 *
 * WHAT THAT COSTS IF THE APP CREDENTIAL LEAKS (a leaked `ANALYTICS_DATABASE_URL`, an SQL-injection
 * foothold, a compromised server process). Whoever holds it can `select set_config('app.current_
 * level','NATIONAL',false)` and then read EVERY aggregate in the analytics database, and can INSERT
 * `audit_access_log` rows in any officer's name for any school (the `audit_insert` predicate keys on
 * the same GUCs, so it is satisfied by the same forgery). That is a real and total loss of the
 * jurisdiction boundary at the aggregate tier, and of the audit log's integrity as a record of who
 * looked at what.
 *
 * WHAT IT DOES NOT COST: the named records. Individual data lives in OPERATIONAL Postgres behind a
 * SECOND credential (`OPERATIONAL_READBACK_URL` — a different database, a different role, SELECT on
 * six tables, read-only, statement-timeout'd), and the analytics database holds no individuals by
 * design (§9). Forging a GUC therefore buys an unfiltered aggregate read, not a roster. It also
 * cannot mint an officer: the app role has no INSERT/UPDATE on `ref_oversight_officer` at all, so
 * `app.current_officer` can be set to a uid but a uid cannot be made into an officer.
 *
 * THE RULE FOR FUTURE AUTHORS, which is the only part of this that is actionable:
 * NEVER RUN RAW SQL ON THE APP CONNECTION OUTSIDE `withJurisdiction()`. Not a quick `db.execute`
 * for a count, not a "just this one unscoped read", not a migration helper. The brand makes the
 * ceiling unforgeable through the typed path; a bare `db.execute()` simply walks around it with no
 * GUCs set — which, for most policies, means zero rows (fail closed, good) but for anything keyed on
 * `ov_is_national()` or a NULL-tolerant predicate can mean more than the officer should see. The one
 * sanctioned exception is `lib/auth/officer-directory.ts`, the bootstrap read that PRODUCES the
 * jurisdiction and therefore cannot have one — quarantined in a file whose entire content is that
 * single query, for exactly this reason.
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
