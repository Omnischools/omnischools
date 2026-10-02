import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import {
  ProvisioningError,
  provisionOfficer,
  type ProvisionResult,
} from "@/lib/provisioning/officers";

/**
 * OFFICER DIRECTORY LOADER (increment G · Kofi R7 · docs/PROVISIONING.md §4b).
 *
 * Seeds / bulk-loads `ref_oversight_officer` from a GES posting list, writing the matching
 * `audit_officer_provisioning` row for every officer IN THE SAME TRANSACTION as the directory write.
 * Mirrors `scripts/load-establishment.ts`: a pure parse/validate pass, then a DB pass, both
 * exported so the suite can test them without a CLI.
 *
 * ── PRIVILEGE (and the difference from load-establishment) ───────────────────────────────────────
 * The establishment loader runs as the analytics OWNER over `ANALYTICS_DATABASE_URL`. This one does
 * NOT, and must not: it connects over `PROVISIONER_DATABASE_URL` — the dedicated non-owner
 * `ov_provisioner` role with exactly the grants paste 0005 installs. The point of that role is that
 * granting oversight authority is a narrow, separately-held capability; a loader that reached for
 * the owner credential "because it is a script" would hand every future operator of this script the
 * ability to do anything at all to the analytics database, and would skip the role-targeted write
 * policies that are half of the posture. There is deliberately no fallback to
 * `ANALYTICS_DATABASE_URL`.
 *
 * ── WHAT IT REFUSES ─────────────────────────────────────────────────────────────────────────────
 *  · a SCHOOL-tier node (Kofi R1) — refused by name here, and again by the database trigger;
 *  · a REGION/NATIONAL row with no approver, or an approver who is the actor (the two-person rule);
 *  · a row with no reason — there is no safe default justification for granting oversight;
 *  · a tier or role SUPPLIED IN THE FILE. There is no such field. The tier is derived from the node
 *    on every row, every run (Kofi R2/AC10): a file that could name a tier is a file that could
 *    widen someone's reach with a typo, and a reviewer reading the posting list would not see it.
 *
 * ── FILE FORMAT ─────────────────────────────────────────────────────────────────────────────────
 * JSON. A file-level `as_of_date` + `actor_id` (the provisioning administrator), and a `rows` array:
 *
 *   { "as_of_date": "2026-10-01",
 *     "actor_id": "90000000-0000-4000-8000-000000000001",
 *     "rows": [
 *       { "officer_id": "60000000-…-0001",          // THE SUPABASE AUTH UID. Not a new id.
 *         "jurisdiction_id": "10000000-…-0003",
 *         "full_name": "Akua Mensah",
 *         "work_email": "akua.mensah@ges.gov.gh",
 *         "reason": "GES posting letter WAW/2026/011 — district director",
 *         "approver_id": "90000000-…-0002"          // REQUIRED for REGION / NATIONAL nodes
 *       } ] }
 *
 * `officer_id` IS the Supabase auth uid (Kofi AC14). The loader cannot mint one: a directory row
 * whose id matches no auth user is an officer who can never sign in and whose audit rows are
 * attributable to nobody, so the uid must exist in Supabase Auth BEFORE this runs.
 */

export interface OfficerFileRow {
  officer_id?: unknown;
  jurisdiction_id?: unknown;
  full_name?: unknown;
  work_email?: unknown;
  reason?: unknown;
  approver_id?: unknown;
  as_of_date?: unknown;
  source?: unknown;
  /** Present-but-rejected: a file must not be able to name a tier or a role. */
  level?: unknown;
  tier?: unknown;
  officer_role?: unknown;
}

export interface OfficerFile {
  as_of_date?: unknown;
  actor_id?: unknown;
  rows?: unknown;
}

export interface ParsedOfficer {
  officerId: string;
  jurisdictionId: string;
  fullName: string | null;
  workEmail: string | null;
  reason: string;
  actorId: string;
  approverId: string | null;
  asOfDate: string;
  source: string;
}

export class OfficerFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficerFileError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Parse + validate. PURE — no DB, no tier derivation (that needs the spine). Rejects loudly. */
export function parseOfficerFile(text: string): ParsedOfficer[] {
  let parsed: OfficerFile;
  try {
    parsed = JSON.parse(text) as OfficerFile;
  } catch (err) {
    throw new OfficerFileError(
      `File is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rows)) {
    throw new OfficerFileError('File must be a JSON object with a "rows" array.');
  }
  const rows = parsed.rows as OfficerFileRow[];
  if (rows.length === 0) throw new OfficerFileError("File carries no rows.");

  const fileActor = nonEmptyString(parsed.actor_id);
  if (!fileActor || !UUID.test(fileActor)) {
    throw new OfficerFileError(
      'File must carry an "actor_id" uuid — the Omnischools administrator this provisioning is attributed to. Every row of the provisioning log names an actor; a load with no actor would be authority granted by nobody.',
    );
  }
  const fileAsOf = nonEmptyString(parsed.as_of_date);

  const seen = new Set<string>();
  return rows.map((row, i) => {
    // A file that names a tier/role is rejected WHOLE, not silently ignored: ignoring it would let
    // an operator believe they had set a tier that the loader then derived differently, and the
    // disagreement would be invisible until an officer saw more than expected.
    for (const forbidden of ["level", "tier", "officer_role"] as const) {
      if (row[forbidden] !== undefined) {
        throw new OfficerFileError(
          `Row ${i}: "${forbidden}" is not a field of this file. The tier and the role are DERIVED from the jurisdiction node on every load (Kofi R2/AC10) — remove it and let the node decide.`,
        );
      }
    }

    const officerId = nonEmptyString(row.officer_id);
    if (!officerId || !UUID.test(officerId)) {
      throw new OfficerFileError(
        `Row ${i}: "officer_id" must be the officer's Supabase auth uid (a uuid). It is not generated here — the auth user must exist first, or the row would be an officer who can never sign in.`,
      );
    }
    if (seen.has(officerId.toLowerCase())) {
      throw new OfficerFileError(
        `Row ${i}: officer ${officerId} appears twice in this file. Two rows for one uid in one load means the second silently wins; split them into separate, individually-reasoned loads.`,
      );
    }
    seen.add(officerId.toLowerCase());

    const jurisdictionId = nonEmptyString(row.jurisdiction_id);
    if (!jurisdictionId || !UUID.test(jurisdictionId)) {
      throw new OfficerFileError(
        `Row ${i} (${officerId}): "jurisdiction_id" must be a dim_jurisdiction uuid — the node that IS this officer's ceiling.`,
      );
    }

    const reason = nonEmptyString(row.reason);
    if (!reason) {
      throw new OfficerFileError(
        `Row ${i} (${officerId}): "reason" is required — the posting letter or directive this grant rests on. There is no safe default justification.`,
      );
    }

    const approverId = nonEmptyString(row.approver_id);
    if (approverId && !UUID.test(approverId)) {
      throw new OfficerFileError(
        `Row ${i} (${officerId}): "approver_id" must be a uuid.`,
      );
    }
    if (approverId && approverId.toLowerCase() === fileActor.toLowerCase()) {
      throw new OfficerFileError(
        `Row ${i} (${officerId}): the approver is the same person as the actor. A one-person two-person rule is the failure the rule exists to close.`,
      );
    }

    const asOfDate = nonEmptyString(row.as_of_date) ?? fileAsOf;
    if (!asOfDate) {
      throw new OfficerFileError(
        `Row ${i} (${officerId}): no as_of_date — set a file-level "as_of_date" or a per-row one.`,
      );
    }

    return {
      officerId,
      jurisdictionId,
      fullName: nonEmptyString(row.full_name),
      workEmail: nonEmptyString(row.work_email),
      reason,
      actorId: fileActor,
      approverId,
      asOfDate,
      source: nonEmptyString(row.source) ?? "GES_HR_DIRECTORY",
    };
  });
}

/**
 * Load the parsed rows. ONE TRANSACTION PER OFFICER (directory row + audit row together), not one
 * for the whole file.
 *
 * Deliberate: a 40-row posting list in which row 12 names a SCHOOL node should provision rows 1–11
 * and stop with a message naming row 12, rather than rolling back eleven correct, individually
 * reasoned grants. The unit of atomicity that matters is "a grant and its audit row", which
 * `provisionOfficer()` holds; the file is a batch of independent grants, not one.
 */
export async function loadOfficers(
  sql: postgres.Sql,
  officers: ParsedOfficer[],
): Promise<ProvisionResult[]> {
  const results: ProvisionResult[] = [];
  for (const [i, officer] of officers.entries()) {
    try {
      results.push(
        await provisionOfficer(sql, {
          officerId: officer.officerId,
          jurisdictionId: officer.jurisdictionId,
          actorId: officer.actorId,
          approverId: officer.approverId,
          fullName: officer.fullName,
          workEmail: officer.workEmail,
          reason: officer.reason,
          source: officer.source,
          asOfDate: officer.asOfDate,
        }),
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new OfficerFileError(
        `Row ${i} (${officer.officerId}): ${detail} — ${results.length} officer(s) were provisioned before this row; they are committed and logged. Fix this row and re-run with the remainder.`,
      );
    }
  }
  return results;
}

export async function loadOfficerFile(
  sql: postgres.Sql,
  text: string,
): Promise<ProvisionResult[]> {
  return loadOfficers(sql, parseOfficerFile(text));
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("usage: tsx scripts/load-officers.ts <officers-file.json>");
    process.exit(2);
  }
  // The PROVISIONER connection, never the app role and never the owner — see the privilege note.
  const url = process.env.PROVISIONER_DATABASE_URL?.trim();
  if (!url) {
    console.error(
      "✗ PROVISIONER_DATABASE_URL is not set. This loader writes the officer directory and must connect as the dedicated non-owner provisioner role (docs/PROVISIONING.md §4b). It will NOT fall back to ANALYTICS_DATABASE_URL.",
    );
    process.exit(2);
  }

  const text = readFileSync(filePath, "utf8");
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const results = await loadOfficerFile(sql, text);
    for (const r of results) {
      console.log(`  ${r.action.padEnd(12)} ${r.officerId}  ${r.tier}  ${r.officerRole}`);
    }
    console.log(
      `✓ ${results.length} officer(s) provisioned, each with its provisioning-audit row in the same transaction.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ ${message}`);
    if (err instanceof ProvisioningError || err instanceof OfficerFileError)
      process.exit(1);
    process.exit(1);
  });
}
