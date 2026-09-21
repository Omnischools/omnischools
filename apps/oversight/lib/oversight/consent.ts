import { env } from "@/lib/env";
import type { ReadbackTx } from "@/lib/db/readback";

/**
 * CONSENT ENFORCEMENT for the OTHER_STAFF branch (§6, Lucy C2/C3, apps/web/Todo.md contract).
 *
 * Oversight NEVER writes consent. It reads one row, live, inside the read-back transaction that
 * will fetch the record, and refuses on anything that is not an unambiguous live grant.
 *
 * WHY IT IS READ INSIDE THE FETCH TRANSACTION, AND NEVER CACHED.
 * Consent is revocable in one click from the school's own settings page, and revocation is meant to
 * be immediate. A cache — even a 30-second one — creates a window in which Oversight releases a
 * record under a consent that no longer exists, and that window is exactly the moment a school is
 * most likely to be exercising the right. Reading it in the same transaction as the projection
 * means there is no window at all: either both statements see the grant, or neither does.
 *
 * WHY THERE IS NO FOREIGN KEY. The consent table lives in the OPERATIONAL database; the audit log
 * lives in ANALYTICS (db/schema/audit.ts). Postgres cannot enforce referential integrity across
 * databases, so `audit_access_log.consent_ref` records a uuid, validated at WRITE time by this
 * read. That recorded uuid is an immutable historical claim: a later revocation must NOT rewrite
 * the audit row, because the log records what was relied on at the time.
 *
 * FAIL-CLOSED CASES — all five produce a DENIAL, and every denial is a written audit row:
 *   · no row for (school, NON_GES_STAFF)         → the school never granted
 *   · state <> 'GRANTED'                          → revoked, or a state we do not recognise
 *   · revoked_at IS NOT NULL                      → belt and braces against a stale `state`
 *   · the table is unreachable / does not exist    → we cannot know, so we do not proceed
 *   · OPERATIONAL_READBACK_URL unset               → handled upstream (lib/db/readback.ts)
 */

/** v1 scope. The column exists so a per-person scope can be added later (apps/web contract). */
export const CONSENT_SCOPE_NON_GES_STAFF = "NON_GES_STAFF";

export type OwnershipType = "PUBLIC" | "PRIVATE" | "MISSION";

export type ConsentReadOutcome =
  "GRANTED" | "NO_CONSENT_ROW" | "REVOKED" | "NOT_GRANTED_STATE" | "TABLE_UNREACHABLE";

export interface ConsentRead {
  outcome: ConsentReadOutcome;
  /** `school_staff_oversight_consent.id` — written to `audit_access_log.consent_ref`. */
  consentRef: string | null;
  /** The exact wording the grantor agreed to. The DPA defence; surfaced to the reviewer. */
  consentStatementVersion: string | null;
  grantedAt: string | null;
  /** Populated only on TABLE_UNREACHABLE, for the operator — never shown to the officer. */
  error?: string;
}

export function isConsentGranted(read: ConsentRead): boolean {
  return read.outcome === "GRANTED" && read.consentRef !== null;
}

/**
 * THE FEATURE FLAG — `E3_NON_PUBLIC_STAFF_DRILLDOWN`, default OFF.
 *
 * Read through `env` on every call rather than captured in a module constant, so a flag flip is a
 * restart, not a redeploy-and-pray, and so tests can exercise both states honestly.
 */
export function nonPublicStaffDrilldownEnabled(): boolean {
  return env.E3_NON_PUBLIC_STAFF_DRILLDOWN === true;
}

export type OwnershipPreflight =
  | { allowed: true }
  | { allowed: false; reason: "FLAG_OFF_NON_PUBLIC" | "UNKNOWN_OWNERSHIP" };

/**
 * OWNERSHIP PREFLIGHT — runs BEFORE the read-back transaction is opened, i.e. before any
 * operational connection exists and before any consent row is read.
 *
 * With the flag off, a PRIVATE or MISSION school's OTHER_STAFF drill-down is refused even if that
 * school HAS recorded DPO consent. That is the point: the open question is not whether the school
 * clicked, it is whether an employer's click is a lawful basis for the EMPLOYEE's data under the
 * Data Protection Act 2012 (Act 843) (apps/web/Todo.md "Blocked on"). Until a DPO answers, acting
 * on the click would be relying on a basis nobody has certified. Refusing early also means the
 * operational database is never touched for a request we already know we will refuse.
 *
 * UNKNOWN OWNERSHIP FAILS CLOSED and is NOT treated as PUBLIC. A school whose ownership we cannot
 * read is a school we know nothing about; defaulting it to the permissive branch would make a data
 * gap into an access grant.
 *
 * GES-establishment teachers never reach this function — the statutory branch holds at every
 * ownership type, which is the whole distinction Lucy C3 makes legible with the STATUTORY pill.
 */
export function ownershipPreflight(
  ownership: OwnershipType | null | undefined,
): OwnershipPreflight {
  if (ownership !== "PUBLIC" && ownership !== "PRIVATE" && ownership !== "MISSION") {
    return { allowed: false, reason: "UNKNOWN_OWNERSHIP" };
  }
  if (ownership === "PUBLIC") return { allowed: true };
  return nonPublicStaffDrilldownEnabled()
    ? { allowed: true }
    : { allowed: false, reason: "FLAG_OFF_NON_PUBLIC" };
}

interface ConsentRow {
  id: string;
  state: string;
  revoked_at: string | null;
  granted_at: string | null;
  consent_statement_version: string | null;
}

/**
 * Read the live consent row inside the read-back transaction.
 *
 * The predicate is written out in full — `state = 'GRANTED' AND revoked_at IS NULL` — rather than
 * relying on either condition alone. `state` is the intended signal and `revoked_at` is the
 * timestamp, and a bug on the capture side that sets one without the other must produce a REFUSAL,
 * not a release. Requiring both means the two have to agree before a record opens.
 *
 * The distinction between "no row" and "revoked" is preserved in the outcome because the audit log
 * should be able to tell a school that never granted from one that changed its mind.
 */
export async function readConsentInTx(
  tx: ReadbackTx,
  operationalSchoolId: string,
  scope: string = CONSENT_SCOPE_NON_GES_STAFF,
): Promise<ConsentRead> {
  let rows: ConsentRow[];
  try {
    // ⚠ THE SAVEPOINT IS LOAD-BEARING, NOT DEFENSIVE STYLE.
    //
    // This SELECT is EXPECTED to fail in production today: the consent table does not exist yet
    // (it is being built in apps/web against the contract in apps/web/Todo.md), so the very first
    // non-GES staff drill-down against a real operational database hits `relation
    // "school_staff_oversight_consent" does not exist`. The same is true of a revoked grant or a
    // statement_timeout.
    //
    // In Postgres, a failed statement ABORTS the whole transaction: every later command in it
    // returns "current transaction is aborted", and COMMIT fails. Without the savepoint the catch
    // below would compute the correct refusal, the caller would write its denial — and then the
    // enclosing `sql.begin()` would reject on commit and THROW THAT REFUSAL AWAY, surfacing a raw
    // driver error to the officer instead of Lucy's C2 "individual record not available" state.
    // Rolling back to a savepoint discards only this statement, leaving the outer transaction
    // usable so the gate can finish refusing properly.
    rows = (await tx.savepoint(
      (sp) => sp`
        select
          id::text                        as id,
          state::text                     as state,
          revoked_at::text                as revoked_at,
          granted_at::text                as granted_at,
          consent_statement_version       as consent_statement_version
        from school_staff_oversight_consent
        where school_id = ${operationalSchoolId}::uuid
          and scope::text = ${scope}
        limit 1
      `,
    )) as unknown as ConsentRow[];
  } catch (err) {
    // Table missing, no grant on it, connection lost, statement_timeout. We do not know, so no.
    return {
      outcome: "TABLE_UNREACHABLE",
      consentRef: null,
      consentStatementVersion: null,
      grantedAt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const row = rows[0];
  if (!row) {
    return {
      outcome: "NO_CONSENT_ROW",
      consentRef: null,
      consentStatementVersion: null,
      grantedAt: null,
    };
  }
  if (row.revoked_at !== null) {
    return {
      outcome: "REVOKED",
      consentRef: null,
      consentStatementVersion: row.consent_statement_version,
      grantedAt: row.granted_at,
    };
  }
  if (row.state !== "GRANTED") {
    return {
      outcome: "NOT_GRANTED_STATE",
      consentRef: null,
      consentStatementVersion: row.consent_statement_version,
      grantedAt: row.granted_at,
    };
  }
  return {
    outcome: "GRANTED",
    consentRef: row.id,
    consentStatementVersion: row.consent_statement_version,
    grantedAt: row.granted_at,
  };
}
