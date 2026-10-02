import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  sealOfficerSession,
  type OfficerSession,
  type ResolvedOfficerFields,
} from "@/lib/oversight/officer";
import type { JurisdictionLevel } from "@/lib/db/rls";

/**
 * THE BOOTSTRAP READ, AND NOTHING ELSE (increment G · docs/PROVISIONING.md §4b).
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────────────────────
 * Every other analytics read in this app goes through `withJurisdiction()` (lib/db/rls.ts), which
 * sets the GUCs the RLS policies key on. This one CANNOT: it is the read that PRODUCES the
 * jurisdiction. It is therefore the single unscoped query in the codebase, and it is quarantined in
 * a file whose whole content is that one query so the exception is visible rather than buried three
 * calls deep in an auth helper. If a second unscoped read ever appears, it will not appear here.
 *
 * ── WHAT KEEPS AN UNSCOPED READ SAFE ─────────────────────────────────────────────────────────────
 * Not this file. The safety is in the database (db/sql/policies.sql, "OFFICER AUTH" block):
 *   · `ref_oversight_officer` is RLS-enabled with NO policy the app role can match, so there is no
 *     `select * from ref_oversight_officer` to write — a leaked connection string cannot enumerate
 *     the GES officer roster.
 *   · `ov_resolve_officer(uid)` is SECURITY DEFINER, keyed on the uid the caller names, `limit 1`.
 *     It cannot return a row the caller did not name, cannot return two, and returns NO PII.
 *   · It filters `is_active` and refuses a SCHOOL node, so deactivation and Kofi R1 take effect in
 *     the DATABASE rather than in an app-side check someone could forget.
 * This module's only job is to pass the uid it was given and trust nothing it gets back beyond the
 * four columns the function is declared to return.
 *
 * ── THE UID IS THE ONLY THING TAKEN FROM THE TOKEN ───────────────────────────────────────────────
 * `resolveOfficerByUid` takes a uid and returns a session whose jurisdiction, tier and role all come
 * from the DATABASE. The caller (lib/auth/index.ts) gets that uid from
 * `supabase.auth.getUser()` — a verified round trip — and passes NOTHING else from the JWT. A token
 * carrying `level: "NATIONAL"` or `jurisdiction_id: <national>` as a custom claim therefore widens
 * nothing: no code path reads a scope out of a claim. tests/officer-resolver-rls.test.ts proves it
 * against a forged claim set.
 */

/** The four columns `ov_resolve_officer(uid)` returns — and the only ones that decide scope. */
interface ResolverRow {
  officer_id: string;
  jurisdiction_id: string;
  level: string;
  officer_role: string;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Record<string, unknown>[];
}

/**
 * Kofi R1 restated on the APP side. The resolver already refuses a SCHOOL node, and so does the
 * directory's write trigger — this is the third refusal, in the one place that would otherwise turn
 * a SCHOOL row (planted by a privileged hand, or loaded with the trigger disabled) into a session.
 * Three refusals for one rule is deliberate: each is in a different layer, and the cheap one is
 * here.
 */
const OFFICER_LEVELS = ["DISTRICT", "REGION", "NATIONAL"] as const;

function officerLevel(raw: unknown): JurisdictionLevel | null {
  return (OFFICER_LEVELS as readonly string[]).includes(String(raw))
    ? (String(raw) as JurisdictionLevel)
    : null;
}

/**
 * Resolve a verified auth uid to a branded `OfficerSession`, or null.
 *
 * NULL FOR EVERY FAILURE, DELIBERATELY INDISTINGUISHABLE: no directory row, a deactivated officer,
 * a SCHOOL-tier row, a vanished node, a malformed uid, a database error. The caller's only correct
 * response to any of them is to refuse, and a function that distinguished them would be an
 * account-state oracle — the property policies.sql's resolver design goes out of its way not to be.
 *
 * It returns NO display name: `ov_resolve_officer()` yields none (Wells's note), and the chrome's
 * name comes from the officer's own JWT. So there is no path by which this module could put a
 * directory-sourced name on an audit row.
 */
export async function resolveOfficerByUid(uid: string): Promise<OfficerSession | null> {
  const trimmed = uid?.trim();
  if (!trimmed) return null;
  // A non-uuid would make the `uuid` cast raise rather than return zero rows. Refuse it here so a
  // malformed token is a quiet "no session" instead of a 500 that leaks the shape of the query.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null;
  }

  let rows: Record<string, unknown>[];
  try {
    // NOT inside withJurisdiction: no GUCs are set, and none are needed — the uid is an ARGUMENT.
    // That is the whole reason policies.sql chose a SECURITY DEFINER function over a bootstrap GUC
    // (see its "BOOTSTRAP-RESOLUTION PROBLEM" note): `withJurisdiction` stays the only writer of
    // request GUCs in the app.
    const result = await db.execute(
      sql`select officer_id::text, jurisdiction_id::text, level::text, officer_role::text
            from ov_resolve_officer(${trimmed}::uuid)`,
    );
    rows = rowsOf(result);
  } catch {
    // A missing function (paste 0005 not applied), a revoked EXECUTE grant, a dead connection — all
    // of them mean we cannot establish who this is. Fail closed. The operator-facing signal for a
    // missed paste is "no officer can sign in", which PROVISIONING §2a calls out explicitly.
    return null;
  }

  const row = rows[0] as unknown as ResolverRow | undefined;
  if (!row) return null;

  const level = officerLevel(row.level);
  if (!level) return null;
  if (!row.jurisdiction_id) return null;

  const fields: ResolvedOfficerFields = {
    officerId: row.officer_id,
    // The DIRECTORY's role value, verbatim — not a label and not a guess. It lands on
    // `audit_access_log.officer_role`, so it must be the post the directory actually records.
    officerRole: row.officer_role,
    jurisdictionId: row.jurisdiction_id,
    level,
  };
  return sealOfficerSession(fields);
}
