import type postgres from "postgres";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE OPERATIONAL SOURCE READER for PUPIL ATTENDANCE (`attendance_record` ⋈ `class`) — the source of
 * `fact_attendance` (task H10).
 *
 * Everything `lib/etl/enrolment-source.ts`'s header says about the SEAM applies here unchanged: the
 * QUERY uses operational names and is real; the CONNECTION and the CREDENTIAL are stood in until the
 * cross-tenant `oversight_etl` role (task H1) exists. `schemaName` is interpolated as an IDENTIFIER and
 * comes from the pipeline's configuration, never from a request; in real operation it is `"public"` on an
 * `oversight_etl` connection.
 *
 * ── ⚠ THE ALLOW-LIST IS TIGHTER THAN ENROLMENT'S, AND THE REASON IS CLINICAL ────────────────────
 * Operational `attendance_record` (apps/web/db/schema/attendance.ts) carries, besides the columns below,
 * three things this reader MUST NEVER MENTION — and one it has no use for:
 *     `reason_code`         a structured absence reason: SICK / MEDICAL / FAMILY / TRAVEL / OTHER. That is
 *                           a HEALTH FACT about a named child, and the MEDICAL status plus a sickbay
 *                           reason is the pastoral/clinical estate, not an education statistic.
 *     `note`                the free-detail field beside it ("mother in hospital", "sickle cell crisis").
 *                           Nothing bounds what free text contains, and here it is free text written
 *                           specifically to explain why a child was not in school.
 *     `marked_by_user_id`   the NAMED TEACHER who took the register. An analytics row carrying it would
 *                           make "who marked this class" queryable outside the gated §6 named-record path.
 *     `student_id`          the CHILD. The fact table is aggregate-only, so there is no destination for it
 *                           — and because this reader GROUPS (see below), it is not even needed to count.
 * It also MUST NOT REFERENCE THE `students` TABLE AT ALL. The enrolment reader has to (it needs
 * `sex` and `status`); this one does not: attendance is NOT sex-split (Kofi's H10 grain carries no sex),
 * and the denominator is MARKED DAYS rather than the roll, so no student attribute is read. A join that is
 * not needed is a join that must not exist — `tests/etl-attendance.test.ts` asserts the word `students`
 * appears nowhere in this module, and `db/seed/demo/demo-source-schema.sql`'s stand-in does not carry
 * `note` / `reason_code` / `marked_by_user_id` either, which is the structural floor under the claim.
 *
 * So the SELECT names EXACTLY SIX things:
 *     attendance_record.school_id · .status · .date · .class_id   ·   class.level · class.name
 * an allow-list rather than `select *` minus the dangerous ones, precisely so that a column added
 * operationally tomorrow is absent here BY DEFAULT.
 *
 * ── IT COUNTS, IT DOES NOT ENUMERATE ───────────────────────────────────────────────────────────
 * The query returns GROUPED COUNTS by (school, class label pair, status) — never one row per pupil-day.
 * Two reasons, both load-bearing: analytics is aggregate-only
 * (`tests/no-individuals-in-analytics.test.ts`), so an individual mark has no legitimate destination even
 * in memory; and attendance is the LARGEST table in the operational estate (one row per pupil per civil
 * day — millions per term nationally), so a per-mark round trip would make the nightly run a data
 * transfer rather than an aggregation.
 *
 * ── THE TERM WINDOW IS A CIVIL-DATE WINDOW, AND `academic_period` IS NOT JOINED ─────────────────
 * Each mark is assigned to the DECLARED TERM whose [starts_on, ends_on] contains its `date` — exactly the
 * shape the shipped operational report uses (apps/web/lib/reports/attendance-summary-data.ts:167-170).
 * Operational `academic_period` is deliberately NOT joined, for the same reason the roster read does not
 * join it: that table is PER SCHOOL and its `period_number` means a TERM on a BASIC row and a SEMESTER on
 * a SENIOR one (the Q3 problem, `lib/etl/dimensions.ts`). Joining it would file half a senior year under a
 * third of a basic one — and would also multiply every mark by the number of periods a school has
 * configured. The analytics TERM is the global `dim_period` row, and its own dates are the window.
 *
 * ⚠ A MARK OUTSIDE EVERY DECLARED WINDOW IS NOT READ HERE, AND IS NOT IGNORED EITHER:
 * `countMarksOutsideDeclaredTerms` tallies them so the run REPORTS them. Holiday marking, a mis-keyed
 * date, or a term the run forgot to declare are all real and all invisible if the only treatment is a
 * `where` clause.
 *
 * ── THE JOIN IS INNER, AND ON THE COMPOSITE KEY ────────────────────────────────────────────────
 * `attendance_record.class_id` is NOT NULL (attendance.ts:46) with a composite school-scoped FK, so every
 * mark has a class and an INNER join loses nothing — there is no class_id-NULL fallback to write, unlike
 * the roster's `current_class_label` path. The join is on `(school_id, class_id)`, the intra-tenant shape
 * of the operational FK, so a cross-tenant class can never be reached even if a uuid collided.
 * `class.active` is NOT filtered: a mark taken in a class somebody later deactivated is still a mark, and
 * the class row is consulted for its LABEL only.
 *
 * ── ONE MARK PER PUPIL PER DAY IS THE SOURCE'S OWN GUARANTEE ───────────────────────────────────
 * `uniq_attendance_student_day` — UNIQUE (school_id, student_id, date) (attendance.ts:57) — is what makes
 * `count(*)` a count of PUPIL-DAYS rather than of register edits, and the whole rate rests on it. This
 * reader RELIES on it and does not re-derive it (a `count(distinct (student_id, date))` would both
 * reintroduce `student_id` into the query and hide a source that had lost the constraint). The reliance is
 * written down here because it is invisible in the SQL.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * One grouped slice of a school's marks for ONE term. NOT a pupil and NOT a day — a COUNT of marks
 * sharing a class label and a status.
 */
export interface AttendanceMarkGroupRow {
  /** Operational tenant uuid (`attendance_record.school_id`). */
  schoolId: string;
  /** `class.level` — nullable upstream, which is why the stage mapping is "level first, then name". */
  classLevel: string | null;
  /** `class.name` — NOT NULL upstream; the fallback when `level` says nothing. */
  className: string | null;
  /** `attendance_record.status` — PRESENT | LATE | EXCUSED | MEDICAL | ABSENT. Validated in the transform. */
  status: string;
  /** How many PUPIL-DAYS share this exact group key, inside the term window. Always ≥ 1. */
  marks: number;
  /**
   * `max(date)` within this group, as an ISO date — the input to the deterministic `as_of_date`
   * (max included mark date, never `now()`; see `lib/etl/attendance.ts`).
   */
  lastMarkDate: string;
}

export interface AttendanceSourceQuery {
  /** `"demo_source"` for the demo; `"public"` on an `oversight_etl` operational connection. */
  schemaName: string;
  /** The inclusion set's operational tenant uuids. Never unbounded — one run, one known set. */
  operationalSchoolIds: string[];
  /** The DECLARED TERM's window, inclusive. Civil dates, from the global `dim_period` TERM row. */
  startsOn: string;
  endsOn: string;
}

export interface AttendanceSourceResult {
  groups: AttendanceMarkGroupRow[];
}

/**
 * Read every included school's marks for ONE declared term, grouped by (school, class label, status).
 *
 * ONE TERM PER CALL, and that is the grain: `fact_attendance` is a FLOW measured over a term window, so a
 * read spanning two terms could not be split afterwards (the group key carries no date), and a reader that
 * summed two terms into one row would publish a half-year as a term.
 *
 * Deterministic order (school, level, name, status) so the groups the transform sees — and therefore the
 * rows written — are identical on every run, which is what makes "a re-run is byte-identical" a property
 * rather than a coincidence.
 */
export async function readAttendanceMarkGroups(
  sql: postgres.Sql,
  query: AttendanceSourceQuery,
): Promise<AttendanceSourceResult> {
  if (query.operationalSchoolIds.length === 0) return { groups: [] };
  // `a.status::text` is cast on the way out because operationally it is an ENUM (`attendance_status`)
  // while the analytics side has no attendance vocabulary at all — casting to text at the boundary is
  // what keeps the two from being accidentally welded together, exactly as the roster read does for sex.
  const rows = await sql<Record<string, unknown>[]>`
    select a.school_id::text        as school_id,
           c.level                  as class_level,
           c.name                   as class_name,
           a.status::text           as status,
           count(*)::int            as marks,
           max(a.date)::text        as last_mark_date
      from ${sql(query.schemaName)}.attendance_record a
      join ${sql(query.schemaName)}.class c
             on c.school_id = a.school_id and c.id = a.class_id
     where a.date >= ${query.startsOn}::date
       and a.date <= ${query.endsOn}::date
       and a.school_id = any(${query.operationalSchoolIds}::uuid[])
     group by a.school_id, c.level, c.name, a.status
     order by a.school_id, c.level, c.name, a.status`;

  return {
    groups: rows.map((r) => ({
      schoolId: r.school_id as string,
      classLevel: (r.class_level as string | null) ?? null,
      className: (r.class_name as string | null) ?? null,
      status: r.status as string,
      marks: Number(r.marks),
      lastMarkDate: r.last_mark_date as string,
    })),
  };
}

/**
 * THE TALLY OF MARKS NO DECLARED TERM CLAIMS — the honest treatment of a date-windowed flow.
 *
 * A mark dated outside EVERY declared window contributes to no fact row, and that is correct: there is no
 * period to file it against. What would NOT be correct is for it to vanish — a holiday register, a
 * mis-keyed year, or a term the run simply failed to declare all look identical to a pipeline whose only
 * treatment is a `where` clause, and the last of those is a real gap in the published figures. So the run
 * COUNTS them and reports the number (`EtlRunReport.attendanceOutOfWindowMarks`).
 *
 * It is one cheap counting query over the whole declared calendar rather than a per-term subtraction,
 * because "in no window at all" is not derivable from the per-term reads: the windows may be adjacent,
 * and a subtraction would also have to be bounded by a date range this function deliberately does not
 * impose (there is no lower bound on how old a mis-keyed date can be).
 */
export async function countMarksOutsideDeclaredTerms(
  sql: postgres.Sql,
  query: {
    schemaName: string;
    operationalSchoolIds: string[];
    /** Every declared TERM window of the run. An empty list means every mark is outside. */
    windows: { startsOn: string; endsOn: string }[];
  },
): Promise<number> {
  if (query.operationalSchoolIds.length === 0) return 0;
  const starts = query.windows.map((w) => w.startsOn);
  const ends = query.windows.map((w) => w.endsOn);
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n
      from ${sql(query.schemaName)}.attendance_record a
     where a.school_id = any(${query.operationalSchoolIds}::uuid[])
       and not exists (
             select 1
               from unnest(${starts}::date[], ${ends}::date[]) as w(starts_on, ends_on)
              where a.date >= w.starts_on and a.date <= w.ends_on)`;
  return Number(rows[0]?.n ?? 0);
}
