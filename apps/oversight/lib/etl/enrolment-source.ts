import type postgres from "postgres";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE OPERATIONAL SOURCE READER for the ACTIVE ROSTER (`students` ⋈ `class`) — the sibling of
 * `lib/etl/source.ts`, for the `fact_enrolment` slice (task H9).
 *
 * Everything `lib/etl/source.ts`'s header says about the SEAM applies here unchanged: the QUERY uses
 * operational names and is real; the CONNECTION and the CREDENTIAL are stood in until the
 * cross-tenant `oversight_etl` role (task H1) exists. `schemaName` is interpolated as an IDENTIFIER
 * and comes from the pipeline's configuration, never from a request; in real operation it is `"public"`
 * on an `oversight_etl` connection, called per school inside `withEtlSchool()`-style GUC scoping, and
 * nothing else about the pipeline changes.
 *
 * ── ⚠ THE PII ALLOW-LIST IS THE POINT OF THIS MODULE ───────────────────────────────────────────
 * `students` is the most person-identifying table in the operational estate. This reader SELECTs
 * EXACTLY six columns and no more:
 *     students.sex · students.status · students.class_id · students.current_class_label
 *     class.level  · class.name
 * and it MUST NOT reference `first_name`, `last_name`, `other_names`, `student_code`,
 * `date_of_birth`, `household_id`, `stpshs_ref`, any guardian column, or anything from the health /
 * sickbay / pastoral estate. It is an explicit allow-list rather than `select *` minus the dangerous
 * ones precisely so that a new person-identifying column added operationally tomorrow is absent here
 * BY DEFAULT. `tests/etl-enrolment.test.ts` asserts the forbidden names appear nowhere in this file,
 * and `db/seed/demo/demo-source-schema.sql`'s stand-in does not even carry them — the structural
 * floor under the claim.
 *
 * ── IT COUNTS, IT DOES NOT ENUMERATE ───────────────────────────────────────────────────────────
 * The query returns GROUPED COUNTS, not one row per child. Two reasons, both load-bearing:
 *   · analytics is aggregate-only (`tests/no-individuals-in-analytics.test.ts`), so an individual
 *     row has no legitimate destination and should not cross the boundary even in memory;
 *   · the national roster is ~200k children in the demo and far larger in reality — a per-student
 *     round trip would make the nightly run a data transfer rather than an aggregation.
 * The group key is exactly what the stage mapping needs: (school, class label pair, label fallback,
 * sex) — so `lib/etl/stage.ts` stays pure and is applied to a few thousand groups, not a few hundred
 * thousand students.
 *
 * ── ONLY `status = 'ACTIVE'` COUNTS ────────────────────────────────────────────────────────────
 * Enrolment is the HEADCOUNT ON ROLL. GRADUATED / WITHDRAWN / TRANSFERRED / INACTIVE children are
 * real history and contribute to NO row: counting a graduated cohort would make a school's roll grow
 * for ever, and the enrolment-vs-population rate would climb past 100% with no defect anywhere to
 * point at. The filter is in the WHERE clause — not applied after the fact in TypeScript — so a
 * non-ACTIVE student is never even counted.
 *
 * ── NO `academic_period` JOIN, DELIBERATELY ────────────────────────────────────────────────────
 * `students` carries no period: a roster is the CURRENT state of the school, not a per-term filing.
 * So this reader asks "who is on roll right now?" and the pipeline files the answer under the run's
 * academic year at ANNUAL grain (the period machinery `lib/etl/dimensions.ts` already proved for
 * `fact_infrastructure`). Joining `academic_period` here would be inventing a key the source does not
 * have — and would quietly multiply every child by the number of periods the school has configured.
 *
 * ── THE LEFT JOIN, AND THE class_id-NULL CHILD ────────────────────────────────────────────────
 * LEFT JOIN on `(school_id, class_id)` — the composite, intra-tenant shape of the operational FK, so
 * a cross-tenant class can never be reached even if a uuid collided. It is a LEFT join because
 * `students.class_id` is NULLABLE: a newly admitted child may not be placed yet, and
 * `current_class_label` is the display fallback the school typed. Those children are counted from the
 * label (see `lib/etl/enrolment.ts`); dropping them would make the fact table disagree with the
 * school's own roll, and there is no honest way to notice that from the analytics side.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * One grouped slice of a school's ACTIVE roster. NOT a student — a COUNT of students sharing a class
 * label and a sex.
 */
export interface RosterGroupSourceRow {
  /** Operational tenant uuid (`students.school_id`). */
  schoolId: string;
  /** `class.level` — null when the student has no class, or the class has no level. */
  classLevel: string | null;
  /** `class.name` — null when the student has no class. */
  className: string | null;
  /** `students.current_class_label` — the display fallback, used when there is no class row. */
  currentClassLabel: string | null;
  /** True when the student resolved to a `class` row; false for the class_id-NULL case. */
  hasClass: boolean;
  /** `students.sex` — operationally NOT NULL and MALE|FEMALE only. 'ALL' is SYNTHESISED, never read. */
  sex: string;
  /** How many ACTIVE students share this exact group key. Always ≥ 1. */
  headcount: number;
}

export interface RosterSourceQuery {
  /** `"demo_source"` for the demo; `"public"` on an `oversight_etl` operational connection. */
  schemaName: string;
  /** The inclusion set's operational tenant uuids. Never unbounded — one run, one known set. */
  operationalSchoolIds: string[];
}

export interface RosterSourceResult {
  groups: RosterGroupSourceRow[];
}

/**
 * Read every included school's CURRENT ACTIVE roster, grouped by class label and sex.
 *
 * There is NO academic-year argument, and that absence is the ruling: the roster has no period, so
 * there is nothing to filter it by. The caller files the result under the run's ANNUAL period.
 */
export async function readActiveRosterGroups(
  sql: postgres.Sql,
  query: RosterSourceQuery,
): Promise<RosterSourceResult> {
  if (query.operationalSchoolIds.length === 0) return { groups: [] };
  // `s.sex::text` / `s.status` are cast on the way out because operationally both are ENUMS
  // (apps/web `sex`, `student_status`) while the analytics side has its own `ov_sex` — casting to text
  // at the boundary is what keeps the two vocabularies from being accidentally welded together.
  //
  // `class.active` is NOT filtered on: a child on roll in a class somebody deactivated is still a
  // child on roll, and dropping them would silently shrink the school's headcount. The class row is
  // consulted for its LABEL only.
  const rows = await sql<Record<string, unknown>[]>`
    select s.school_id::text                        as school_id,
           c.level                                  as class_level,
           c.name                                   as class_name,
           s.current_class_label                    as current_class_label,
           (c.id is not null)                       as has_class,
           s.sex::text                              as sex,
           count(*)::int                            as headcount
      from ${sql(query.schemaName)}.students s
      left join ${sql(query.schemaName)}.class c
             on c.school_id = s.school_id and c.id = s.class_id
     where s.status = 'ACTIVE'
       and s.school_id = any(${query.operationalSchoolIds}::uuid[])
     group by s.school_id, c.level, c.name, s.current_class_label, (c.id is not null), s.sex
     order by s.school_id, c.level, c.name, s.current_class_label, s.sex`;

  return {
    groups: rows.map((r) => ({
      schoolId: r.school_id as string,
      classLevel: (r.class_level as string | null) ?? null,
      className: (r.class_name as string | null) ?? null,
      currentClassLabel: (r.current_class_label as string | null) ?? null,
      hasClass: r.has_class as boolean,
      sex: r.sex as string,
      headcount: Number(r.headcount),
    })),
  };
}
