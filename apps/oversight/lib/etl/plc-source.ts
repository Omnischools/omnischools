import type postgres from "postgres";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE OPERATIONAL SOURCE READER for TEACHER CPD / PLC (`plc_programme`, `plc`, `plc_membership`,
 * `plc_session`, `plc_session_attendance`, `plc_cpd_ledger`) — the source of
 * `fact_plc_participation`'s PLC-OPERATIONAL columns (Kofi's `CPD-SURFACING-RULING.md` C3).
 *
 * Everything `lib/etl/fees-source.ts` and `lib/etl/source.ts` say about the SEAM holds here
 * unchanged: the QUERIES use the OPERATIONAL names and are real; the CONNECTION and the CREDENTIAL
 * are stood in until the cross-tenant `oversight_etl` role (task H1) exists. `schemaName` is
 * interpolated as an IDENTIFIER and comes from the pipeline's CONFIGURATION, never from a request; in
 * real operation it is `"public"` on an `oversight_etl` connection.
 *
 * ── ⚠ THE ALLOW-LIST, AND WHY THIS ONE IS ABOUT STAFF RATHER THAN CHILDREN ──────────────────────
 * The PLC module carries NO student PII and NO confidential pastoral layer (every `plc_*` table is
 * OPERATIONAL / SHOWN upstream). What it carries instead is a complete record of what every NAMED
 * MEMBER OF STAFF did on their professional-development Fridays — who facilitated, who missed a
 * session and why, and what each of them wrote in their reflection. So the SELECT is a NAMED
 * allow-list, and the denials are listed in `db/seed/demo/demo-source-schema.sql` beside the tables
 * themselves:
 *     plc_programme           school_id · weeks_per_semester · annual_plc_target
 *     plc                     school_id · id · override_frequency · archived_at
 *     plc_membership          school_id · plc_id · user_id   (AGGREGATED ONLY — see below)
 *     plc_session             school_id · plc_id · session_date
 *     plc_session_attendance  school_id · session_id · status   (+ user_id, AGGREGATED ONLY)
 *     plc_cpd_ledger          school_id · attended_pts · reflection_pts · settled_at
 *                                                              (+ user_id, AGGREGATED ONLY)
 *
 * ⚠ NO IDENTITY COLUMN IS EVER PROJECTED. Not one returned row shape below carries a user id, a
 * teacher name, a facilitator, a recorder or a per-teacher row: every interface in this module is a
 * COUNT or a SUM keyed by (school) or (school, plc). `user_id` appears in the SQL in exactly three
 * places and every one of them is INSIDE a `count(distinct …)` — the `attendance_record.student_id`
 * posture, tightened one notch (fees genuinely SELECTS `invoice.student_id` as an opaque group key;
 * this reader never selects an identity column at all). It is aggregated rather than ignored because
 * the module's UNIQUEs are what make a distinct count MEAN something:
 *   `uniq_plc_membership (school_id, plc_id, user_id)`           → a teacher in two PLCs is ONE teacher
 *   `uniq_plc_session_attendance (school_id, session_id, user_id)` → ≤1 non-present event per member
 *   `uniq_plc_cpd_ledger (school_id, session_id, user_id)`        → ≤1 frozen award per member/session
 * `tests/etl-plc.test.ts` asserts both halves: no returned shape carries an identifying field, and
 * every occurrence of `user_id` in this file sits inside a distinct count.
 *
 * ── ⚠ PRESENT-BY-DEFAULT: `attendance_events` IS NOT A COUNT OF ATTENDANCE ROWS ─────────────────
 * This is the one thing in the arm that is easy to get exactly backwards. Upstream (apps/web R383) a
 * `plc_session_attendance` row EXISTS ONLY FOR A MEMBER WHO WAS NOT PRESENT — marking somebody present
 * DELETES their row. So:
 *       attendance_events  =  (active members × sessions held)  −  the NON-PRESENT rows
 * and the rows this reader counts are therefore a DEDUCTION, named `nonPresentEvents` rather than
 * `absences` so no later reader mistakes it for the numerator. LATE IS PRESENT for CPD (R383, and the
 * same ruling `fact_teacher_attendance`'s status mapping states), so a LATE row deducts NOTHING:
 *       PRESENT, LATE            → present (no deduction)
 *       ABSENT, EXCUSED, MEDICAL → deducted
 * All five members are mapped, with no default bucket, so a new operational enum member is an explicit
 * ETL change rather than a silent mis-classification.
 *
 * ── THE WINDOW IS THE TERM'S OWN CIVIL DATES, AND `academic_period_id` IS NEVER JOINED ──────────
 * A session is assigned to the declared TERM whose [starts_on, ends_on] CONTAINS its `session_date`,
 * exactly as an attendance mark is (`lib/etl/attendance-source.ts`). `plc_session` DOES carry an
 * `academic_period_id` upstream, and joining it would reintroduce the Q3 problem — operational
 * `period_number` means a term on a BASIC row and a SEMESTER on a SENIOR one — so an SHS school's
 * Friday PLC would be filed under half a year. Nothing is inferred except from dates.
 *
 * ── WHAT IS WINDOW-DEPENDENT AND WHAT IS NOT (why this is four readers, not one) ─────────────────
 *   `readPlcProgrammes`        per school, window-INDEPENDENT (a cadence is a configuration).
 *   `readPlcGroups`            per (school, PLC), window-INDEPENDENT (membership is an OPEN ROW with
 *                              no period; "active" is `left_at IS NULL`, i.e. as of the read).
 *   `readPlcSessionAggregates` per (school, PLC), WINDOWED — the TERM cut's sessions + attendance.
 *   `readPlcAnnualPoints`      per school, WINDOWED on the ACADEMIC YEAR — the ANNUAL cut's points.
 * Splitting them this way is what lets the pipeline issue the two window-independent reads ONCE for
 * the whole run and the windowed ones once per cut, instead of re-scanning the country per term.
 *
 * ⚠ ACTIVE MEMBERSHIP IS AS-OF-NOW AND THAT IS A STATED LIMITATION. `left_at IS NULL` is the state
 * TODAY, not the state during term 1, because the operational module stores no membership history
 * beyond the single `left_at` stamp. A teacher who left a PLC in January is therefore absent from
 * term 1's denominator as well as term 2's. The alternative — treating `left_at > term.starts_on` as
 * "was a member then" — is not better: it would count a teacher who joined in March as a member in
 * September. Neither is reconstructable from one timestamp, so the arm uses the honest, stated reading
 * (the roster of the PLC as it stands) and the ruling's TERM vintage names the date the figure is as
 * of. Whoever adds membership history should revisit exactly this paragraph.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * The `plc_session_attendance.status` values that DEDUCT from `attendance_events`.
 *
 * Named rather than implied, and exported, so the mapping is reviewable and so the test suite can
 * assert that all five operational members are accounted for. PRESENT and LATE are deliberately
 * ABSENT from this list: Late IS Present for CPD.
 */
export const PLC_NON_PRESENT_STATUSES = ["ABSENT", "EXCUSED", "MEDICAL"] as const;

/** The statuses a row may carry that cost the member nothing. The complement of the list above. */
export const PLC_PRESENT_STATUSES = ["PRESENT", "LATE"] as const;

/** One school's PLC programme configuration. At most one row per school (the operational singleton). */
export interface PlcProgrammeRow {
  schoolId: string;
  /** `plc_programme.weeks_per_semester` — the school's OWN declared cadence length. */
  weeksPerSemester: number;
  /**
   * `plc_programme.annual_plc_target` as a numeric(5,2) STRING, never a float: it is copied onto the
   * fact row under the SAME column name, so a float round-trip could publish 7.9999999 as a target.
   */
  annualPlcTarget: string;
}

/** One ACTIVE PLC group and the size of its active cohort. Window-independent. */
export interface PlcGroupRow {
  schoolId: string;
  /** `plc.id` — a GROUP key, not a person. Used to attribute sessions and expectations to a cadence. */
  plcId: string;
  /** `plc.override_frequency` — NULL means inherit the programme cadence (weekly). */
  overrideFrequency: string | null;
  /** `count(distinct plc_membership.user_id)` over `left_at IS NULL`. A COUNT of teachers. */
  activeMembers: number;
}

/** One PLC's sessions and non-present deductions inside ONE term window. */
export interface PlcSessionAggregateRow {
  schoolId: string;
  plcId: string;
  /** `count(*)` over `plc_session` in the window — "held" = the row exists (manual-open upstream). */
  sessionsHeld: number;
  /**
   * The DEDUCTION, not the numerator: non-present `plc_session_attendance` rows for those sessions.
   * See the header's present-by-default note before using this figure for anything.
   */
  nonPresentEvents: number;
  /** `max(session_date)` in the window — the input to the TERM row's deterministic `as_of_date`. */
  lastSessionDate: string;
}

/** One school's PLC-earned CPD points for ONE academic year. The ONLY CPD points that are observable. */
export interface PlcAnnualPointsRow {
  schoolId: string;
  /**
   * `sum(attended_pts + reflection_pts)` in exact integer HUNDREDTHS of a point.
   *
   * ⚠ HUNDREDTHS, NOT A FLOAT POINT FIGURE, for the reason `lib/etl/fees-source.ts` carries pesewas:
   * both ledger arms are `numeric(5,2)`, so the sum is exact in the database, and the fact columns are
   * `numeric(7,2)`. Carrying the figure through JS as a float would let `0.1 + 0.2` decide a published
   * national CPD total and would round exact-half cases differently from Postgres.
   */
  pointsHundredths: number;
  /**
   * `count(distinct user_id)` over the ledger — teachers who earned ANY PLC points this year.
   *
   * ⚠ This is the MEAN's denominator ONLY (`cpd_points_mean`). It is NOT the coverage denominator:
   * dividing by it would make a teacher who earned nothing all year vanish from both the numerator and
   * the denominator instead of counting as a miss. The coverage denominator is always
   * `teacher_headcount` — see `db/schema/fact.ts`.
   */
  teachersWithPoints: number;
  /** `max(settled_at)` — the award vintage, and the ANNUAL row's deterministic `as_of_date`. */
  lastSettledAt: string;
}

export interface PlcSourceQuery {
  /** `"demo_source"` for the demo; `"public"` on an `oversight_etl` operational connection. */
  schemaName: string;
  /** The inclusion set's operational tenant uuids. Never unbounded — one run, one known set. */
  operationalSchoolIds: string[];
}

export interface PlcWindowedQuery extends PlcSourceQuery {
  /** The window's civil dates, inclusive. A session belongs to the window CONTAINING its date. */
  startsOn: string;
  endsOn: string;
}

/**
 * Every included school's PLC programme configuration. AT MOST ONE ROW PER SCHOOL — the operational
 * table's `school_id UNIQUE` singleton, which is why this is a plain select and not a `distinct on`.
 *
 * A MISSING ROW IS LEGAL AND MEANINGFUL and is NOT coalesced here. Upstream, `coalescePlcProgramme`
 * fills the frozen defaults for the SCHOOL'S OWN screens; this ETL must not, because the fact column
 * `annual_plc_target` would then read 8.00 for a school that never configured a PLC programme at all —
 * a target the school never set, published as if it had. The builder leaves it NULL instead.
 */
export async function readPlcProgrammes(
  sql: postgres.Sql,
  query: PlcSourceQuery,
): Promise<PlcProgrammeRow[]> {
  if (query.operationalSchoolIds.length === 0) return [];
  const rows = await sql<Record<string, unknown>[]>`
    select p.school_id::text          as school_id,
           p.weeks_per_semester       as weeks_per_semester,
           p.annual_plc_target::text  as annual_plc_target
      from ${sql(query.schemaName)}.plc_programme p
     where p.school_id = any(${query.operationalSchoolIds}::uuid[])
     order by p.school_id`;
  return rows.map((r) => ({
    schoolId: r.school_id as string,
    weeksPerSemester: Number(r.weeks_per_semester),
    annualPlcTarget: String(r.annual_plc_target),
  }));
}

/**
 * Every included school's ACTIVE PLC groups, each with the size of its ACTIVE cohort.
 *
 * ACTIVE, twice over and for two different reasons:
 *   `plc.archived_at IS NULL`        — a PLC is SOFT-archived upstream, never deleted (its sessions
 *                                      and ledger rows hang off it), so an archived group must stop
 *                                      counting towards `schools_running_plc_count` and must stop
 *                                      contributing an expectation of sessions nobody will hold.
 *   `plc_membership.left_at IS NULL` — the open-row idiom. See the header's stated as-of limitation.
 *
 * The LEFT JOIN cannot fan out a PLC: the aggregate is grouped by `(school_id, id)`, which is the
 * group's own `plc_tenant_uk`, and `uniq_plc_membership` makes the distinct count a count of PEOPLE.
 * A PLC with NO active members comes back with `activeMembers = 0` rather than not at all — that is a
 * real state (a group whose cohort has all left) and it still contributes to "this school runs a PLC"
 * and to the session expectation, so dropping it would overstate both coverage and participation.
 */
export async function readPlcGroups(
  sql: postgres.Sql,
  query: PlcSourceQuery,
): Promise<PlcGroupRow[]> {
  if (query.operationalSchoolIds.length === 0) return [];
  const rows = await sql<Record<string, unknown>[]>`
    select g.school_id::text               as school_id,
           g.id::text                      as plc_id,
           g.override_frequency            as override_frequency,
           count(distinct m.user_id)::int  as active_members
      from ${sql(query.schemaName)}.plc g
      left join ${sql(query.schemaName)}.plc_membership m
             on m.school_id = g.school_id and m.plc_id = g.id and m.left_at is null
     where g.school_id = any(${query.operationalSchoolIds}::uuid[])
       and g.archived_at is null
     group by g.school_id, g.id, g.override_frequency
     order by g.school_id, g.id`;
  return rows.map((r) => ({
    schoolId: r.school_id as string,
    plcId: r.plc_id as string,
    overrideFrequency: (r.override_frequency as string | null) ?? null,
    activeMembers: Number(r.active_members),
  }));
}

/**
 * DISTINCT teachers in ANY active PLC, per school — the TERM cut's `teachers_in_plc`.
 *
 * ⚠ THIS IS NOT Σ `readPlcGroups().activeMembers`, AND THE DIFFERENCE IS THE POINT. A teacher who
 * belongs to two PLCs appears in two per-PLC counts and is ONE teacher in a PLC, so summing the group
 * counts would overstate PLC coverage at every tier — and because `teacher_headcount` is the
 * denominator, it would overstate it in a way that can exceed 100% and look like a data fault rather
 * than an arithmetic one. BOTH grains are therefore read, and NEITHER is derived from the other:
 *   per-PLC   → `attendance_expected` (a 20-member group that met twice expects 40 attendances)
 *   per-school→ `teachers_in_plc`     (a count of PEOPLE, deduplicated across groups)
 *
 * A school with NO active PLC returns NO ROW (not a zero row): the builder reads that as 0, writes a
 * real `schools_running_plc_count = 0` row for it, and the "N of Y schools run a PLC" denominator
 * stays honest.
 */
export async function readPlcSchoolMemberCounts(
  sql: postgres.Sql,
  query: PlcSourceQuery,
): Promise<{ schoolId: string; distinctMembers: number }[]> {
  if (query.operationalSchoolIds.length === 0) return [];
  const rows = await sql<Record<string, unknown>[]>`
    select g.school_id::text               as school_id,
           count(distinct m.user_id)::int  as distinct_members
      from ${sql(query.schemaName)}.plc g
      join ${sql(query.schemaName)}.plc_membership m
             on m.school_id = g.school_id and m.plc_id = g.id and m.left_at is null
     where g.school_id = any(${query.operationalSchoolIds}::uuid[])
       and g.archived_at is null
     group by g.school_id
     order by g.school_id`;
  return rows.map((r) => ({
    schoolId: r.school_id as string,
    distinctMembers: Number(r.distinct_members),
  }));
}

/**
 * Each PLC's SESSIONS HELD and NON-PRESENT DEDUCTIONS inside ONE declared term window.
 *
 * ONE QUERY, and the fan-out is bounded by the source's own constraints rather than by a DISTINCT:
 * `uniq_plc_session (school_id, plc_id, session_date)` makes the session row unique per day, and
 * `uniq_plc_session_attendance (school_id, session_id, user_id)` makes the child strictly ≤1 per
 * member per session — so `count(distinct s.id)` is the session count and `count(a.id)` over the join
 * is the deduction count. The session count is taken as a DISTINCT over the session id precisely
 * because the LEFT JOIN multiplies the session row by its non-present members; `count(*)` there would
 * report a school with absences as having held more sessions than it did.
 *
 * A PLC with no session in the window returns NO ROW (not a zero row): "held nothing this term" is
 * expressed by the row's absence, and the builder turns that into `sessions_held = 0` against the
 * cadence's own expectation, which is the honest session-coverage signal.
 */
export async function readPlcSessionAggregates(
  sql: postgres.Sql,
  query: PlcWindowedQuery,
): Promise<PlcSessionAggregateRow[]> {
  if (query.operationalSchoolIds.length === 0) return [];
  // `a.status::text` is cast at the boundary because operationally it is an ENUM
  // (`attendance_status`) while the analytics side has no attendance vocabulary of its own — the same
  // discipline the roster read applies to sex and the register read to the mark state.
  const rows = await sql<Record<string, unknown>[]>`
    select s.school_id::text          as school_id,
           s.plc_id::text             as plc_id,
           count(distinct s.id)::int  as sessions_held,
           count(a.id)::int           as non_present_events,
           max(s.session_date)::text  as last_session_date
      from ${sql(query.schemaName)}.plc_session s
      left join ${sql(query.schemaName)}.plc_session_attendance a
             on a.school_id = s.school_id and a.session_id = s.id
            and a.status::text = any(${[...PLC_NON_PRESENT_STATUSES]}::text[])
     where s.school_id = any(${query.operationalSchoolIds}::uuid[])
       and s.session_date >= ${query.startsOn}::date
       and s.session_date <= ${query.endsOn}::date
     group by s.school_id, s.plc_id
     order by s.school_id, s.plc_id`;
  return rows.map((r) => ({
    schoolId: r.school_id as string,
    plcId: r.plc_id as string,
    sessionsHeld: Number(r.sessions_held),
    nonPresentEvents: Number(r.non_present_events),
    lastSessionDate: String(r.last_session_date),
  }));
}

/**
 * Each school's PLC-EARNED CPD POINTS for ONE academic year — the ANNUAL cut's only observable input.
 *
 * THE YEAR IS THE SESSION'S CIVIL DATE, NOT `settled_at`. The two are close (the award is frozen at
 * the session's write-lock) but they are not the same, and the question the fact row answers is "how
 * much CPD did this teacher earn IN THIS ACADEMIC YEAR", which is a property of when the development
 * happened rather than of when the ledger row was written. A session held on the last Friday of the
 * year and settled a week later belongs to the year it was held in.
 *
 * `(sum(attended_pts + reflection_pts) * 100)::bigint` is the exact-hundredths conversion: both arms
 * are `numeric(5,2)`, so the product is an integer by construction and the cast cannot round. The sum
 * happens in Postgres, in numeric, and only the integer crosses into JS.
 *
 * ⚠ THE TOTAL IS `attended + reflection` AND THERE IS NO THIRD ARM, ANYWHERE. That is not a
 * simplification — it is the fact the schema's ⚠ SOURCING GATE is built on. `plc_cpd_ledger` has no
 * category column, so these points are PLC points, which are one part of NTC's Mandatory class; the
 * NCPD half of Mandatory and the Specialised and Recommended classes entirely have NO operational
 * source and come (in the demo) from the separate `lib/etl/ntc-cpd-source.ts` seam.
 */
export async function readPlcAnnualPoints(
  sql: postgres.Sql,
  query: PlcWindowedQuery,
): Promise<PlcAnnualPointsRow[]> {
  if (query.operationalSchoolIds.length === 0) return [];
  const rows = await sql<Record<string, unknown>[]>`
    select l.school_id::text                                   as school_id,
           (sum(l.attended_pts + l.reflection_pts) * 100)::bigint as points_hundredths,
           count(distinct l.user_id)::int                      as teachers_with_points,
           max(l.settled_at)                                   as last_settled_at
      from ${sql(query.schemaName)}.plc_cpd_ledger l
      join ${sql(query.schemaName)}.plc_session s
             on s.school_id = l.school_id and s.id = l.session_id
     where l.school_id = any(${query.operationalSchoolIds}::uuid[])
       and s.session_date >= ${query.startsOn}::date
       and s.session_date <= ${query.endsOn}::date
     group by l.school_id
     order by l.school_id`;
  return rows.map((r) => ({
    schoolId: r.school_id as string,
    pointsHundredths: Number(r.points_hundredths),
    teachersWithPoints: Number(r.teachers_with_points),
    lastSettledAt:
      r.last_settled_at instanceof Date
        ? r.last_settled_at.toISOString()
        : String(r.last_settled_at),
  }));
}
