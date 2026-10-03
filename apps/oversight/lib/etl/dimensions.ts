import type postgres from "postgres";
import type { RegisterRow } from "./register";

/**
 * DIMENSION REFRESH (scope §2 "the real first task", task H3).
 *
 * Builds the `dim_jurisdiction` spine — NATIONAL → REGION → DISTRICT → SCHOOL — and the global
 * `dim_period` rows, from the parsed EMIS extract. Idempotent: running it twice changes nothing.
 *
 * ═══ THE ONE INVARIANT THIS MODULE EXISTS TO GUARANTEE ═══════════════════════════════════════════
 * EVERY SCHOOL NODE HAS AN UNBROKEN PARENT CHAIN TO THE SINGLE NATIONAL NODE.
 * Every roll-up in the product is a recursive walk up `parent_id`, and the jurisdiction RLS predicate
 * (`ov_in_subtree`) is the same walk. A school whose district is missing, or whose region's parent is
 * null, is invisible to a national officer AND to the district total — and it is invisible QUIETLY:
 * the national figure is still internally consistent, just smaller than the country. There is no DB
 * constraint that can catch it (`parent_id` is nullable because NATIONAL has no parent), so the chain
 * is asserted after the refresh (`assertSpineIntact`) and in the test suite.
 *
 * SINGLE NATIONAL NODE. The refresh ADOPTS an existing NATIONAL row rather than inserting its own.
 * Two NATIONAL nodes would split the country in half with no error anywhere: each subtree sums
 * correctly, and "Ghana" reports whichever half its own node happens to parent.
 *
 * ═══ PERIOD MAPPING — THE Q3 GAP, AND THE INTERIM RULE THIS SLICE USES ═══════════════════════════
 * Operational `academic_period` is PER SCHOOL (every school has its own uuid for "2025/26 Term 1");
 * analytics `dim_period` is GLOBAL. Scope §2 flags the mapping as missing and needing a Kofi ruling
 * (Q3: straddling terms, SENIOR_F3, which period is the ANNUAL cut). None of those cases arise for
 * `fact_infrastructure`, which is TERM-only and has no exam cohort, so the slice uses the obvious
 * narrow rule and states it:
 *     (academic_year, term) → the dim_period row with that (academic_year, term, period_type='TERM')
 * The operational row supplies `academic_year` and `term`; nothing is inferred from dates. A school
 * whose period cannot be mapped is EXCLUDED from the run with a named failure — never defaulted to
 * "the current term", which would silently file one school's Term 1 census under another's Term 2.
 */

export interface JurisdictionIndex {
  nationalId: string;
  /** region name → jurisdiction_id */
  regions: Map<string, string>;
  /** `${region}\u0000${district}` → jurisdiction_id */
  districts: Map<string, string>;
  /** emis_school_id → jurisdiction_id */
  schools: Map<string, string>;
}

export const DEFAULT_NATIONAL_NAME = "Ghana";

function districtKey(regionName: string, districtName: string): string {
  return `${regionName}\u0000${districtName}`;
}

/** Find the single NATIONAL node, or create it. Adopts an existing one — see the header. */
async function ensureNational(sql: postgres.Sql, name: string): Promise<string> {
  const existing = await sql<{ jurisdiction_id: string }[]>`
    select jurisdiction_id::text as jurisdiction_id
      from dim_jurisdiction where level = 'NATIONAL'
     order by name limit 1`;
  if (existing.length > 0) return existing[0]!.jurisdiction_id;
  const inserted = await sql<{ jurisdiction_id: string }[]>`
    insert into dim_jurisdiction (level, parent_id, name)
    values ('NATIONAL', null, ${name})
    returning jurisdiction_id::text as jurisdiction_id`;
  return inserted[0]!.jurisdiction_id;
}

/**
 * Upsert the children of one parent, by (level, parent_id, name). There is no UNIQUE on that triple
 * in the schema, so this is select-then-insert-the-missing rather than `on conflict` — and it is done
 * as two set-based statements per level rather than a query per node, because the spine is ~90 rows
 * per run and a round trip each would dominate the run time for no clarity.
 */
async function ensureChildren(
  sql: postgres.Sql,
  level: "REGION" | "DISTRICT",
  parentId: string,
  names: string[],
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  if (names.length === 0) return index;
  const existing = await sql<{ jurisdiction_id: string; name: string }[]>`
    select jurisdiction_id::text as jurisdiction_id, name
      from dim_jurisdiction
     where level = ${level}::jurisdiction_level
       and parent_id = ${parentId}::uuid
       and name = any(${names})`;
  for (const row of existing) index.set(row.name, row.jurisdiction_id);

  const missing = names.filter((n) => !index.has(n));
  if (missing.length > 0) {
    const inserted = await sql<{ jurisdiction_id: string; name: string }[]>`
      insert into dim_jurisdiction ${sql(
        missing.map((name) => ({ level, parent_id: parentId, name })),
      )}
      returning jurisdiction_id::text as jurisdiction_id, name`;
    for (const row of inserted) index.set(row.name, row.jurisdiction_id);
  }
  return index;
}

/**
 * Refresh NATIONAL → REGION → DISTRICT → SCHOOL from the extract.
 *
 * `is_reporting` is set from `on_schoolup`: it is the SCHOOL-node mirror of the register flag, and it
 * is UPDATED on every run, not only on insert — a school that leaves Omnischools must stop being
 * reporting, or the inclusion set keeps including it and the delete-then-insert keeps wiping its last
 * good figures.
 *
 * SCHOOL nodes are keyed on `ges_code = emis_school_id`, the convention the rest of the app already
 * uses (`db/sql/policies.sql`, the §6 fixtures). The school node also carries `school_type` and
 * `ownership_type` — a slowly-changing DIMENSION attribute, which is precisely why
 * `fact_infrastructure` must not duplicate them (fact.ts's note).
 */
export async function refreshJurisdictions(
  sql: postgres.Sql,
  rows: RegisterRow[],
  nationalName: string = DEFAULT_NATIONAL_NAME,
): Promise<JurisdictionIndex> {
  const nationalId = await ensureNational(sql, nationalName);

  const regionNames = [...new Set(rows.map((r) => r.regionName))].sort();
  const regions = await ensureChildren(sql, "REGION", nationalId, regionNames);

  const districts = new Map<string, string>();
  for (const regionName of regionNames) {
    const regionId = regions.get(regionName)!;
    const names = [
      ...new Set(
        rows.filter((r) => r.regionName === regionName).map((r) => r.districtName),
      ),
    ].sort();
    const built = await ensureChildren(sql, "DISTRICT", regionId, names);
    for (const [name, id] of built) districts.set(districtKey(regionName, name), id);
  }

  // ---- SCHOOL nodes: one set-based select, one insert, one update. Idempotent by ges_code. ----
  const schools = new Map<string, string>();
  const emisIds = rows.map((r) => r.emisSchoolId);
  const CHUNK = 500;
  for (let i = 0; i < emisIds.length; i += CHUNK) {
    const existing = await sql<{ jurisdiction_id: string; ges_code: string }[]>`
      select jurisdiction_id::text as jurisdiction_id, ges_code
        from dim_jurisdiction
       where level = 'SCHOOL' and ges_code = any(${emisIds.slice(i, i + CHUNK)})`;
    for (const row of existing) schools.set(row.ges_code, row.jurisdiction_id);
  }

  const toInsert = rows.filter((r) => !schools.has(r.emisSchoolId));
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK).map((r) => ({
      level: "SCHOOL" as const,
      parent_id: districts.get(districtKey(r.regionName, r.districtName))!,
      name: r.name,
      ges_code: r.emisSchoolId,
      school_type: r.schoolType,
      ownership_type: r.ownershipType,
      is_reporting: r.onSchoolup,
    }));
    const inserted = await sql<{ jurisdiction_id: string; ges_code: string }[]>`
      insert into dim_jurisdiction ${sql(chunk)}
      returning jurisdiction_id::text as jurisdiction_id, ges_code`;
    for (const row of inserted) schools.set(row.ges_code, row.jurisdiction_id);
  }

  const inserting = new Set(toInsert.map((r) => r.emisSchoolId));
  const toUpdate = rows.filter((r) => !inserting.has(r.emisSchoolId));
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK).map((r) => ({
      ges_code: r.emisSchoolId,
      parent_id: districts.get(districtKey(r.regionName, r.districtName))!,
      name: r.name,
      school_type: r.schoolType,
      ownership_type: r.ownershipType,
      is_reporting: r.onSchoolup,
    }));
    // ONE statement per chunk, driven by a single jsonb parameter. `jsonb_to_recordset` rather than a
    // VALUES list or parallel `unnest` arrays: the parameter count stays at 1 regardless of chunk size,
    // and the column types are declared once, here, instead of being inferred from JS values (which is
    // where a `boolean` quietly becomes something else).
    await sql`
      update dim_jurisdiction d set
        parent_id      = v.parent_id,
        name           = v.name,
        school_type    = v.school_type::ov_school_type,
        ownership_type = v.ownership_type::ov_ownership_type,
        is_reporting   = v.is_reporting
      from jsonb_to_recordset(${sql.json(chunk)}::jsonb)
        as v(ges_code text, parent_id uuid, name text, school_type text,
             ownership_type text, is_reporting boolean)
      where d.level = 'SCHOOL' and d.ges_code = v.ges_code`;
  }

  return { nationalId, regions, districts, schools };
}

/**
 * THE SPINE ASSERTION (see the header). Walks every SCHOOL node's ancestry and raises if any school
 * in the index fails to reach the national node, or reaches a DIFFERENT national node. Run after the
 * refresh, inside the run — a broken spine must fail the run, not publish a smaller country.
 */
export async function assertSpineIntact(
  sql: postgres.Sql,
  index: JurisdictionIndex,
): Promise<void> {
  const ids = [...index.schools.values()];
  if (ids.length === 0) return;
  const rows = await sql<
    { jurisdiction_id: string; root_id: string | null; depth: number }[]
  >`
    with recursive up as (
      select j.jurisdiction_id as leaf, j.jurisdiction_id, j.parent_id, j.level, 1 as depth
        from dim_jurisdiction j
       where j.jurisdiction_id = any(${ids}::uuid[])
      union all
      select u.leaf, p.jurisdiction_id, p.parent_id, p.level, u.depth + 1
        from up u join dim_jurisdiction p on p.jurisdiction_id = u.parent_id
    )
    select leaf::text as jurisdiction_id,
           max(case when level = 'NATIONAL' then jurisdiction_id::text end) as root_id,
           max(depth) as depth
      from up group by leaf`;

  const broken = rows.filter((r) => r.root_id === null);
  if (broken.length > 0) {
    throw new Error(
      `dim_jurisdiction spine is broken: ${broken.length} school node(s) do not reach a NATIONAL ` +
        `ancestor (first: ${broken[0]!.jurisdiction_id}). Every roll-up and the RLS subtree predicate ` +
        "walk parent_id, so these schools would be silently missing from every total.",
    );
  }
  const wrongRoot = rows.filter((r) => r.root_id !== index.nationalId);
  if (wrongRoot.length > 0) {
    throw new Error(
      `dim_jurisdiction has more than one NATIONAL node: ${wrongRoot.length} school(s) roll up to ` +
        `${wrongRoot[0]!.root_id} instead of ${index.nationalId}. The country would be split in two, ` +
        "each half internally consistent.",
    );
  }
  const missing = ids.filter((id) => !rows.some((r) => r.jurisdiction_id === id));
  if (missing.length > 0) {
    throw new Error(
      `dim_jurisdiction spine is incomplete: ${missing.length} school node(s) returned no ancestry row.`,
    );
  }
}

// ── dim_period ──────────────────────────────────────────────────────────────────────────────────

export interface PeriodSpec {
  academicYear: string;
  term: number;
  startsOn?: string | null;
  endsOn?: string | null;
  isCurrent?: boolean;
}

/** `${academicYear}|${term}` → period_id. The key the operational→global mapping resolves through. */
export type PeriodIndex = Map<string, string>;

export function periodKey(academicYear: string, term: number): string {
  return `${academicYear}|${term}`;
}

/**
 * Upsert the TERM rows of `dim_period`. Select-then-insert (no UNIQUE on
 * (academic_year, term, period_type) in the schema), and `is_current` is rewritten every run so
 * exactly the specs marked current are current — a stale `is_current` would point every "this term"
 * surface at last term.
 */
export async function refreshPeriods(
  sql: postgres.Sql,
  specs: PeriodSpec[],
): Promise<PeriodIndex> {
  const index: PeriodIndex = new Map();
  for (const spec of specs) {
    const existing = await sql<{ period_id: string }[]>`
      select period_id::text as period_id from dim_period
       where academic_year = ${spec.academicYear}
         and term = ${spec.term}
         and period_type = 'TERM'
       limit 1`;
    let periodId = existing[0]?.period_id;
    if (!periodId) {
      const inserted = await sql<{ period_id: string }[]>`
        insert into dim_period (academic_year, term, period_type, starts_on, ends_on, is_current)
        values (${spec.academicYear}, ${spec.term}, 'TERM',
                ${spec.startsOn ?? null}, ${spec.endsOn ?? null}, ${spec.isCurrent ?? false})
        returning period_id::text as period_id`;
      periodId = inserted[0]!.period_id;
    } else {
      await sql`
        update dim_period
           set starts_on = ${spec.startsOn ?? null},
               ends_on   = ${spec.endsOn ?? null},
               is_current = ${spec.isCurrent ?? false}
         where period_id = ${periodId}::uuid`;
    }
    index.set(periodKey(spec.academicYear, spec.term), periodId);
  }
  return index;
}
