import { pathToFileURL } from "node:url";
import postgres from "postgres";

/**
 * #1 — OPERATIONAL-SCHOOL-UUID POPULATE (writes analytics `operational_school_id`).
 *
 * Fills `ref_emis_school_register.operational_school_id` (db/schema/ref.ts) so the §6 gate can
 * resolve an EMIS school straight to its operational tenant uuid under the officer's own RLS
 * (lib/oversight/school-ref.ts, AC-1.1) instead of round-tripping a request-supplied id.
 *
 * The match is EXACT and one-directional: analytics `ref_emis_school_register.emis_school_id`
 * ↔ operational `ref_school.ges_code` (they are the same GES/EMIS identifier). Never fuzzy.
 *
 *   AC-1.2  only `on_schoolup = true` register rows are populated.
 *   AC-1.3  `on_schoolup = false` rows are never touched, so they stay NULL.
 *   AC-1.4  the UPDATE is keyed on the exact emis_school_id whose ges_code produced the id, so
 *           school A's id can never land on school B's row; a ges_code with no register row is
 *           skipped (we drive from the register), a register row with no operational match stays NULL.
 *
 * ── CONNECTIONS ─────────────────────────────────────────────────────────────────────────────────
 * Reads OPERATIONAL read-only (no operational writes), writes ANALYTICS as the owner.
 *
 * ⚠ The operational read must ENUMERATE `ref_school` across tenants. The §6 `oversight_readback`
 * role CANNOT do this: its `ref_school` tenant_isolation policy keys on `id = app.current_school`,
 * so with no GUC set it returns ZERO rows (verified: 0 vs 8 for a broad reader). The populate
 * therefore needs a PRIVILEGED / cross-tenant operational reader — the same broad operational read
 * the nightly ETL uses to refresh dim_jurisdiction (OVERSIGHT_ANALYTICS_SPEC §7 step 2), read-only
 * on privilege. `readOperationalGesCodes()` fails LOUD if it reads zero schools while the register
 * expects matches, so an RLS-blocked mis-wiring can never silently populate nothing.
 */

export interface PopulateResult {
  updated: number;
  skippedNoMatch: number;
  skippedNotOnSchoolup: number;
}

/**
 * Read every `(ges_code → operational id)` pair. Throws when it reads nothing but the register has
 * `on_schoolup` rows to match — the signature of the narrow read-back role (RLS) or a wrong URL.
 */
async function readOperationalGesCodes(
  operationalSql: postgres.Sql,
  expectMatches: boolean,
): Promise<Map<string, string>> {
  const ops = await operationalSql<{ id: string; ges_code: string }[]>`
    select id::text as id, ges_code from ref_school
  `;
  if (ops.length === 0 && expectMatches) {
    throw new Error(
      "operational ref_school returned ZERO rows while the register has on_schoolup schools to " +
        "match. The §6 oversight_readback role is RLS-scoped to one school (id = app.current_school) " +
        "and cannot enumerate ref_school — point the operational read at a PRIVILEGED cross-tenant " +
        "reader (read-only), not the read-back role.",
    );
  }
  return new Map(ops.map((r) => [r.ges_code, r.id]));
}

export async function populateOperationalSchoolIds(opts: {
  operationalSql: postgres.Sql;
  analyticsSql: postgres.Sql;
}): Promise<PopulateResult> {
  const { operationalSql, analyticsSql } = opts;

  const register = await analyticsSql<{ emis_school_id: string; on_schoolup: boolean }[]>`
    select emis_school_id, on_schoolup from ref_emis_school_register
  `;
  const expectMatches = register.some((r) => r.on_schoolup);
  const byGesCode = await readOperationalGesCodes(operationalSql, expectMatches);

  let updated = 0;
  let skippedNoMatch = 0;
  let skippedNotOnSchoolup = 0;
  for (const row of register) {
    if (!row.on_schoolup) {
      skippedNotOnSchoolup++; // AC-1.3 — untouched, stays NULL
      continue;
    }
    const operationalId = byGesCode.get(row.emis_school_id);
    if (!operationalId) {
      skippedNoMatch++; // AC-1.4 — register row with no operational match, stays NULL
      continue;
    }
    // AC-1.4 — keyed on the EXACT emis_school_id whose ges_code produced operationalId, so no
    // cross-write is possible; `and on_schoolup = true` is a belt-and-braces guard on AC-1.2.
    await analyticsSql`
      update ref_emis_school_register
         set operational_school_id = ${operationalId}::uuid
       where emis_school_id = ${row.emis_school_id} and on_schoolup = true
    `;
    updated++;
  }
  return { updated, skippedNoMatch, skippedNotOnSchoolup };
}

async function main(): Promise<void> {
  // Operational: a PRIVILEGED cross-tenant READ-ONLY reader (see the CONNECTIONS note). Default to
  // OPERATIONAL_READBACK_URL for local convenience, but on prod set OPERATIONAL_DATABASE_URL to a
  // broad reader — the read-back role's RLS returns zero rows and the loud guard will fire.
  const operationalUrl =
    process.env.OPERATIONAL_DATABASE_URL ?? process.env.OPERATIONAL_READBACK_URL;
  if (!operationalUrl) {
    console.error(
      "set OPERATIONAL_DATABASE_URL (a privileged cross-tenant read-only operational reader).",
    );
    process.exit(2);
  }
  // Analytics: the owner/writer (Direct connection, per docs/PROVISIONING.md §2).
  const analyticsUrl =
    process.env.ANALYTICS_DATABASE_URL ??
    "postgresql://omnischools:omnischools@localhost:55432/omnischools_analytics_dev";

  const operationalSql = postgres(operationalUrl, { max: 1, prepare: false });
  const analyticsSql = postgres(analyticsUrl, { max: 1, prepare: false });
  try {
    const r = await populateOperationalSchoolIds({ operationalSql, analyticsSql });
    console.log(
      `✓ operational_school_id: ${r.updated} populated, ${r.skippedNoMatch} unmatched, ` +
        `${r.skippedNotOnSchoolup} not-on-Schoolup (left NULL).`,
    );
  } finally {
    await operationalSql.end({ timeout: 5 });
    await analyticsSql.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
