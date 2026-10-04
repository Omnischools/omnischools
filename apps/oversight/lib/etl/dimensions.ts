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
 * ═══ PERIOD MAPPING — THE Q3 RULING, AS IMPLEMENTED ══════════════════════════════════════════════
 * Operational `academic_period` is PER SCHOOL (every school has its own uuid for "2025/26 Term 1");
 * analytics `dim_period` is GLOBAL.
 *
 * THE OPERATIONAL SIDE HAS NO `term` COLUMN. It has `period_number` (smallint) and `product_line`
 * (SENIOR | BASIC | SENIOR_F3, NOT NULL), and the LINE is what gives the NUMBER its meaning: Basic
 * runs 3 terms, Senior 2 semesters. `period_number = 1` is therefore not one thing, and mapping a
 * SENIOR semester onto a `dim_period` TERM row would file half an academic year under a third of one.
 *
 * KOFI'S RULING FOR `fact_infrastructure`: do not map the operational period to a term AT ALL. The
 * grain is ANNUAL — one row per school per academic_year —
 *     (school, academic_year) → the dim_period row (academic_year, term = NULL, period_type = 'ANNUAL')
 * and the census chosen for that row is the LATEST one the school filed in the year, across EVERY
 * product line:
 *     ORDER BY captured_at DESC, period_number DESC, product_line DESC LIMIT 1
 * `product_line` therefore stops being a grain key: it survives only inside that selector's
 * tie-break. That removes the SENIOR "named gap" entirely — a SENIOR semester census and a SENIOR_F3
 * one are now just candidates for "latest in the year", so the SHS estate is CONSUMED rather than
 * counted-and-skipped, and a combined (J-S) school with both a 3-term Basic and a 2-semester Senior
 * configuration yields exactly ONE row from its single latest snapshot. Nothing is inferred from
 * dates other than `captured_at` itself.
 *
 * WHY THE LATEST SNAPSHOT IS THE AUTHORITATIVE ONE: infrastructure ACCRUES. A borehole sunk in term 1
 * is still there in term 3, so the newest census in the year is the most complete statement of the
 * school's stock — not an average of the year and not the first return. `as_of_date` is that
 * snapshot's `captured_at`, so the row says which census it is.
 *
 * An included school with NO census row anywhere in the academic_year (on any product line) appears
 * in the period outcome's `noSourceRow` list rather than just failing to show up.
 *
 * Still NOT settled here, and still Kofi's: the EXAM_COHORT cut and SENIOR_F3's early post-WASSCE
 * calendar as they bear on H9/H12. Neither arises for `fact_infrastructure` — a borehole has no exam
 * cohort — and both now meet a proven harness.
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

/**
 * One `dim_period` row to exist after the refresh.
 *
 * `term` IS THE DISCRIMINATOR, and deliberately so rather than a separate `periodType` field that
 * could disagree with it: a numbered term is a TERM row, and `term = null` is the year's ANNUAL cut
 * (`dim.ts`: "1,2,3 — null for ANNUAL / EXAM_COHORT"). Two independent fields would make
 * `{ term: 2, periodType: 'ANNUAL' }` expressible, and that row — a TERM-numbered ANNUAL — is exactly
 * the thing `fact_infrastructure`'s re-grain exists to make impossible.
 */
export interface PeriodSpec {
  academicYear: string;
  /** 1,2,3 for a TERM row; `null` for the academic year's single ANNUAL row. */
  term: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
  isCurrent?: boolean;
}

/** TERM when the spec is numbered, ANNUAL when it is not. The only mapping, in one place. */
export function periodTypeOf(spec: PeriodSpec): "TERM" | "ANNUAL" {
  return spec.term === null ? "ANNUAL" : "TERM";
}

/** `${academicYear}|${term}` → period_id. The key the operational→global mapping resolves through. */
export type PeriodIndex = Map<string, string>;

export function periodKey(academicYear: string, term: number | null): string {
  return `${academicYear}|${term ?? "ANNUAL"}`;
}

/**
 * THE ANNUAL CUT OF A SET OF TERM SPECS — one spec per distinct academic_year, spanning the terms.
 *
 * `fact_infrastructure` is ANNUAL-grained (one row per school per academic_year, Kofi's ruling — see
 * the header), but the run is still DECLARED in terms, because the terms are what the calendar and
 * every other fact table are made of. So the annual rows are DERIVED here rather than hand-listed by
 * each caller: `starts_on` is the earliest term's start, `ends_on` the latest term's end, and
 * `is_current` is true if ANY term of the year is current — i.e. the year containing today.
 *
 * Deriving it is what makes "exactly one ANNUAL row per academic_year in the run" structural: a
 * caller cannot pass two.
 */
export function annualPeriodSpecs(specs: PeriodSpec[]): PeriodSpec[] {
  // Hoisted: these close over nothing in the loop, so re-creating them per spec bought nothing.
  const min = (a: string | null | undefined, b: string | null | undefined) =>
    a && b ? (a < b ? a : b) : (a ?? b ?? null);
  const max = (a: string | null | undefined, b: string | null | undefined) =>
    a && b ? (a > b ? a : b) : (a ?? b ?? null);
  const byYear = new Map<string, PeriodSpec>();
  for (const spec of specs) {
    const soFar = byYear.get(spec.academicYear);
    byYear.set(spec.academicYear, {
      academicYear: spec.academicYear,
      term: null,
      startsOn: min(soFar?.startsOn, spec.startsOn),
      endsOn: max(soFar?.endsOn, spec.endsOn),
      isCurrent: (soFar?.isCurrent ?? false) || (spec.isCurrent ?? false),
    });
  }
  return [...byYear.values()];
}

/**
 * Upsert the `dim_period` rows — TERM and ANNUAL alike. Select-then-insert (no UNIQUE on
 * (academic_year, term, period_type) in the schema), and `is_current` is rewritten every run so
 * exactly the specs marked current are current — a stale `is_current` would point every "this term"
 * surface at last term.
 *
 * The ANNUAL lookup matches on `term IS NULL`, not `term = null` (which is never true): that one
 * detail is the difference between upserting the year's ANNUAL row idempotently and inserting a
 * second one on every single run, each with its own `period_id`, which would split
 * `fact_infrastructure` across indistinguishable duplicate periods.
 */
export async function refreshPeriods(
  sql: postgres.Sql,
  specs: PeriodSpec[],
): Promise<PeriodIndex> {
  const index: PeriodIndex = new Map();
  for (const spec of specs) {
    const periodType = periodTypeOf(spec);
    const existing = await sql<{ period_id: string }[]>`
      select period_id::text as period_id from dim_period
       where academic_year = ${spec.academicYear}
         and term is not distinct from ${spec.term}
         and period_type = ${periodType}::period_type
       limit 1`;
    let periodId = existing[0]?.period_id;
    if (!periodId) {
      const inserted = await sql<{ period_id: string }[]>`
        insert into dim_period (academic_year, term, period_type, starts_on, ends_on, is_current)
        values (${spec.academicYear}, ${spec.term}, ${periodType}::period_type,
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
