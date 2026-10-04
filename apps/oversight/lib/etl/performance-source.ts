import type postgres from "postgres";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE SOURCE READERS for `fact_performance_exam` (task H14) — the SCHOOL_ENTERED arm's operational
 * read, and the WAEC_EXTRACT arm's explicitly-empty one.
 *
 * Everything `lib/etl/enrolment-source.ts`'s header says about the SEAM applies here unchanged: the
 * QUERY uses operational names and is real; the CONNECTION and the CREDENTIAL are stood in until the
 * cross-tenant `oversight_etl` role (task H1) exists. `schemaName` is interpolated as an IDENTIFIER
 * and comes from the pipeline's configuration, never from a request; in real operation it is `"public"`
 * on an `oversight_etl` connection.
 *
 * ── ⚠ THE ALLOW-LIST: SEVEN COLUMNS, AND NEITHER `note` NOR `captured_by` ───────────────────────
 * Operational `terminal_exam_result` (apps/web/db/schema/terminal-results.ts) is already an AGGREGATE
 * table — one row per school × exam_type × year, no candidate rows, no names, no scores — so the
 * person-identifying surface is small. It is not empty, though, and the two columns that make it up are
 * exactly the two this reader must never mention:
 *     `note`         free text a head teacher typed. Free text is where a name, a phone number or a
 *                    safeguarding remark ends up, and nothing can bound what it contains.
 *     `captured_by`  a `ref_user` id — the NAMED STAFF MEMBER who keyed the figures. An analytics fact
 *                    row that carried it would make "who filed this" queryable outside the gated §6
 *                    named-record path, which is the one route to an individual this product allows.
 * So the SELECT names exactly seven columns:
 *     school_id · exam_type · year · female_candidates · male_candidates · female_passed · male_passed
 * It is an allow-list rather than `select *` minus the dangerous ones precisely so that a column added
 * operationally tomorrow is absent here BY DEFAULT. `tests/etl-performance.test.ts` asserts the two
 * forbidden names appear nowhere in this module, and `db/seed/demo/demo-source-schema.sql`'s stand-in
 * does not even CARRY them — the structural floor under the claim.
 *
 * ── BOUNDED BY THE INCLUSION SET, NEVER UNBOUNDED ──────────────────────────────────────────────
 * `school_id = any(${ids}::uuid[])`, the same bound the roster read carries. An empty id set reads ZERO
 * rows and does not issue the query at all: an unbounded read would return schools that are registered
 * but not live (or not even in the register), and the pipeline would then have rows it cannot resolve
 * to a jurisdiction node.
 *
 * ── THE READ IS GROUPED, AND THE GROUP KEY INCLUDES `exam_type` ────────────────────────────────
 * `uniq_terminal_exam_result_sitting` already makes (school, exam_type, year) unique, so the GROUP BY
 * is an identity today. It is written as an aggregate anyway, for one reason that matters on prod: a
 * source that ever lost that UNIQUE (a CSV hand-off, a restored table) must still yield ONE row per
 * key rather than fanning the transform out into duplicate fact rows.
 *
 * ⚠ `exam_type` IS IN THE GROUP KEY AND MUST STAY THERE. A COMBINED school files BOTH a BECE and a
 * WASSCE row for the same year, and they are DIFFERENT PUPILS: JHS 3 leavers and SHS 3 leavers. Summing
 * the two into one pair of counts would produce a pass rate for a cohort that does not exist, and the
 * number would look entirely plausible. Every read of this table — here and downstream — filters or
 * groups to exactly ONE `exam`.
 *
 * ── WHAT IS NOT READ, AND WHY THE SITTING IS THE REGULAR ONE ───────────────────────────────────
 * There is NO sitting-window column operationally: `terminal_exam_result` holds one row per exam per
 * YEAR, which is the regular May/June sitting. NovDec / private-candidate figures are not captured by
 * Omnischools at all, so nothing here filters them out — there is nothing to filter — and a future
 * NovDec feed would be a NEW source and a NEW ruling, not an extra WHERE clause.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** One school's filed sitting: the four stored leaf counts, their exam and their sitting year. */
export interface TerminalExamSourceRow {
  /** Operational tenant uuid (`terminal_exam_result.school_id`). */
  schoolId: string;
  /** `exam_type` — CHECK-constrained to BECE | WASSCE operationally. Validated again in the transform. */
  examType: string;
  /** `year` — the SITTING CALENDAR year (2026), not an academic year. */
  year: number;
  femaleCandidates: number;
  maleCandidates: number;
  femalePassed: number;
  malePassed: number;
}

export interface TerminalExamSourceQuery {
  /** `"demo_source"` for the demo; `"public"` on an `oversight_etl` operational connection. */
  schemaName: string;
  /** The SITTING CALENDAR year to read. One cohort per call — a sitting is not a range. */
  sittingYear: number;
  /** The inclusion set's operational tenant uuids. Never unbounded — one run, one known set. */
  operationalSchoolIds: string[];
}

export interface TerminalExamSourceResult {
  rows: TerminalExamSourceRow[];
}

/**
 * Read every included school's filed sittings for ONE sitting year, grouped by (school, exam).
 *
 * Deterministic order (school, exam) so the rows the transform sees — and therefore the rows written —
 * are the same on every run, which is what makes "a re-run is byte-identical" a property rather than a
 * coincidence.
 */
export async function readTerminalExamResults(
  sql: postgres.Sql,
  query: TerminalExamSourceQuery,
): Promise<TerminalExamSourceResult> {
  if (query.operationalSchoolIds.length === 0) return { rows: [] };
  const rows = await sql<Record<string, unknown>[]>`
    select t.school_id::text              as school_id,
           t.exam_type                    as exam_type,
           t.year                         as year,
           sum(t.female_candidates)::int  as female_candidates,
           sum(t.male_candidates)::int    as male_candidates,
           sum(t.female_passed)::int      as female_passed,
           sum(t.male_passed)::int        as male_passed
      from ${sql(query.schemaName)}.terminal_exam_result t
     where t.year = ${query.sittingYear}
       and t.school_id = any(${query.operationalSchoolIds}::uuid[])
     group by t.school_id, t.exam_type, t.year
     order by t.school_id, t.exam_type`;

  return {
    rows: rows.map((r) => ({
      schoolId: r.school_id as string,
      examType: r.exam_type as string,
      year: Number(r.year),
      femaleCandidates: Number(r.female_candidates),
      maleCandidates: Number(r.male_candidates),
      femalePassed: Number(r.female_passed),
      malePassed: Number(r.male_passed),
    })),
  };
}

/**
 * The SITTING YEARS present in the source for the included schools — the run's own statement of which
 * cohorts exist, used to refuse a run whose source carries a sitting no EXAM_COHORT period was declared
 * for (`assertExamCohortPeriodsSeeded` in `lib/etl/performance.ts`).
 *
 * It is a separate, cheap read rather than a by-product of the per-year read above, because the whole
 * point is to know about a year BEFORE the run commits to a list of years to loop over.
 */
export async function readTerminalExamSittingYears(
  sql: postgres.Sql,
  query: { schemaName: string; operationalSchoolIds: string[] },
): Promise<number[]> {
  if (query.operationalSchoolIds.length === 0) return [];
  const rows = await sql<{ year: number }[]>`
    select distinct t.year as year
      from ${sql(query.schemaName)}.terminal_exam_result t
     where t.school_id = any(${query.operationalSchoolIds}::uuid[])
     order by year`;
  return rows.map((r) => Number(r.year));
}

// ── the WAEC_EXTRACT arm ────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THE WAEC_EXTRACT ARM IS AN EXPLICITLY-EMPTY, DOCUMENTED PATH — the same discipline
 * `fact_performance_subject` and `fact_teacher_attendance` ship under (db/schema/fact.ts's sourcing
 * gates): the code path exists, is reachable, is tested, and today reads ZERO rows, because the feed it
 * reads does not exist yet.
 *
 * WHAT IT READS. `ref_waec_results_extract` (db/schema/ref.ts) — an ANALYTICS reference table, not an
 * operational one: WAEC results arrive as an official GES–WAEC extract loaded into the analytics
 * database, so this reader does NOT take a source schema. It is EMPTY in every environment today
 * (there is no WAEC loader yet, and no arrangement under which to run one), and may be ABSENT entirely
 * on a database older than migration 0000 — hence the `to_regclass` guard, which is why this returns an
 * empty list rather than raising "relation does not exist".
 *
 * WHAT IT CAN AND CANNOT SAY. The extract carries NO SEX COLUMN (emis_school_id, academic_year, exam,
 * subject, candidates, qualified). So the WAEC arm can only ever write `sex = 'ALL'`, and that asymmetry
 * is permanent until WAEC supplies a sex split:
 *     a `sex IN ('MALE','FEMALE')` read over a WAEC-only cohort returns NOTHING,
 *     while `sex = 'ALL'` is complete.
 * A reader that assumes the split is always present will silently report zero candidates for such a
 * cohort — see the same note in `lib/etl/performance.ts`, and the executable statement of it in
 * `tests/etl-performance.test.ts`.
 *
 * Only the EXAM-LEVEL rows are read (`subject is null`). The subject-grained rows of the same extract
 * belong to `fact_performance_subject`, and summing them here would count a candidate once per subject.
 */
export interface WaecExtractCohortRow {
  emisSchoolId: string;
  academicYear: string;
  exam: string;
  candidates: number;
  qualified: number;
  /** The extract's own vintage (`ref_waec_results_extract.as_of_date`) — WAEC said so on this date. */
  asOfDate: string;
}

export async function readWaecExtractCohort(
  sql: postgres.Sql,
  query: { academicYear: string; emisSchoolIds: string[] },
): Promise<{ rows: WaecExtractCohortRow[] }> {
  if (query.emisSchoolIds.length === 0) return { rows: [] };
  const present = await sql<{ ok: boolean }[]>`
    select to_regclass('public.ref_waec_results_extract') is not null as ok`;
  if (!present[0]?.ok) return { rows: [] };
  const rows = await sql<Record<string, unknown>[]>`
    select w.emis_school_id              as emis_school_id,
           w.academic_year               as academic_year,
           w.exam                        as exam,
           sum(w.candidates)::int        as candidates,
           sum(w.qualified)::int         as qualified,
           max(w.as_of_date)::text       as as_of_date
      from ref_waec_results_extract w
     where w.academic_year = ${query.academicYear}
       and w.subject is null
       and w.emis_school_id = any(${query.emisSchoolIds})
     group by w.emis_school_id, w.academic_year, w.exam
     order by w.emis_school_id, w.exam`;
  return {
    rows: rows.map((r) => ({
      emisSchoolId: r.emis_school_id as string,
      academicYear: r.academic_year as string,
      exam: r.exam as string,
      candidates: Number(r.candidates),
      qualified: Number(r.qualified),
      asOfDate: r.as_of_date as string,
    })),
  };
}
