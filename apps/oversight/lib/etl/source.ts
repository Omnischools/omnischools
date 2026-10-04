import type postgres from "postgres";

/**
 * THE OPERATIONAL SOURCE READER for `facilities_snapshot` (scope §3 "credentials — the blocker nobody
 * built").
 *
 * ═══ WHAT IS REAL HERE AND WHAT IS STOOD IN ══════════════════════════════════════════════════════
 * REAL: the QUERY. Every column, table and predicate below uses the OPERATIONAL names — in particular
 * `academic_period.period_number` (smallint) and `academic_period.product_line`, NOT a convenience
 * `term` column, because operational Postgres has no such column and a query naming one would fail on
 * prod with `column p.term does not exist`. The `(school_id, period_id)` grain, the per-school
 * `academic_period` join, the CHECK-constrained categorical values and the nullable optional-detail
 * columns are all as they really are. `period_number as term` in the SELECT below is an output ALIAS,
 * which is the one safe direction: it renames on the way out, never on the way in.
 *
 * The stand-in omits two `academic_period` columns the ETL does not read (`closed_at`,
 * `closed_by_user_id`); the subset rule and its reasoning are in
 * `db/seed/demo/demo-source-schema.sql`'s header. Omissions are safe here; renames are not.
 *
 * STOOD IN: the CONNECTION AND THE CREDENTIAL. The cross-tenant operational reader does not exist
 * yet — it is scope task H1, a new `oversight_etl` role with an explicit SELECT allow-list of
 * aggregation sources only, read-only, used in a per-school loop with `app.current_school` set, and
 * hard-denied on `staff_compensation` / `vlc_pastoral_*` / `sickbay_*` / `ref_user.email`.
 * `oversight_readback` CANNOT substitute for it (six-table allow-list, tenant RLS, 5-second statement
 * timeout — see `scripts/populate-operational-school-ids.ts` and `prod-paste-0103`).
 *
 * So the demo reads an operational-SHAPED stand-in in the analytics database
 * (`db/seed/demo/demo-source-schema.sql`). `schemaName` is the seam: in real operation this function
 * is called with `schemaName = "public"` on an `oversight_etl` connection, once per school inside
 * `withEtlSchool()`-style GUC scoping, and nothing else about the pipeline changes.
 *
 * ═══ `product_line` — THE NAMED GAP, NOT A SILENT MAPPING ════════════════════════════════════════
 * `academic_period.product_line` is NOT NULL and one of SENIOR | BASIC | SENIOR_F3, and it changes what
 * `period_number` MEANS: a term on a BASIC row, a SEMESTER on a SENIOR row (Basic = 3 terms, Senior =
 * 2 semesters — apps/web `ref_academic_period_config.period_count`), and on SENIOR_F3 a Form-3 calendar
 * with an early post-WASSCE vacation.
 *
 * SHS schools FILE FACILITIES CENSUSES TOO, so their rows really are in the source — and
 * `period_number = 1` for a SENIOR school is Semester 1, which is not analytics `dim_period` term 1.
 * Mapping it there would file half an academic year under a third of one, and the error would be
 * invisible: the fact row would look perfectly well-formed.
 *
 * So this function reads EVERY product line for the requested `(academic_year, period_number)` and
 * partitions them: rows on the mapped line are returned, and rows on any other line are reported in
 * `skippedProductLines` — a named, counted gap the pipeline carries into the run's `error_text` and the
 * period outcome. The alternative (filtering them away in SQL) would make the SHS estate silently
 * absent from every infrastructure figure, which is the same defect as mis-mapping it, only quieter.
 *
 * Closing the gap properly is the Q3 ruling (scope §7.3): it needs a decision on what a SENIOR
 * semester maps to in `dim_period`, which is Kofi's, not this slice's.
 *
 * ⚠ `caterer_name` AND `captured_by` ARE NOT SELECTED. They exist in the source and must never cross
 * the boundary: `captured_by` names the staff member who keyed the census, `caterer_name` a third-party
 * GSFP supplier. `lib/oversight/infrastructure.ts` documents the read-side exclusion; this is the
 * upstream half of it, and it is an explicit allow-list rather than a `select *` minus two columns, so
 * a new person-identifying column added operationally is absent here by default.
 */

/** Exactly the operational `facilities_snapshot` columns the transform needs, plus the period keys. */
export interface FacilitiesSnapshotSourceRow {
  schoolId: string;
  periodId: string;
  academicYear: string;
  /** Operational `academic_period.period_number`. A term on BASIC, a semester on SENIOR. */
  periodNumber: number;
  /** Operational `academic_period.product_line` — SENIOR | BASIC | SENIOR_F3. Never ignored. */
  productLine: string;

  classroomsTotal: number;
  classroomsGood: number;
  classroomsRepair: number;

  waterSource: string;
  electricitySource: string;
  latrinesBoys: number;
  latrinesGirls: number;
  latrinesStaff: number;
  latrineType: string;
  handwashing: boolean;

  hasLibrary: boolean;
  hasIctLab: boolean;
  internet: boolean;
  hasKitchen: boolean;
  gsfpParticipating: boolean;

  libraryBookCount: number | null;
  computersTotal: number | null;
  computersWorking: number | null;
  studentDesksUsable: number | null;
  studentDesksBroken: number | null;
  teacherDesks: number | null;
  chalkboards: number | null;
  whiteboards: number | null;
  projectors: number | null;

  /** The census VINTAGE — becomes the fact row's `as_of_date` (see `stampProvenance`). */
  capturedAt: string;
}

export interface FacilitiesSourceQuery {
  /** `"demo_source"` for the demo; `"public"` on an `oversight_etl` operational connection. */
  schemaName: string;
  academicYear: string;
  /** Operational `academic_period.period_number` — NOT a "term" column; there is no such column. */
  periodNumber: number;
  /**
   * The ONE product line whose `period_number` this run is prepared to map onto `dim_period`. BASIC,
   * until Q3 rules on what a SENIOR semester is. Rows on any other line come back in
   * `skippedProductLines` rather than being filtered away in SQL — see the named-gap note above.
   */
  productLine: string;
  /** The inclusion set's operational tenant uuids. Never unbounded — one run, one known set. */
  operationalSchoolIds: string[];
}

/** Census rows this run will not map, grouped by the line that made them unmappable. */
export interface SkippedProductLine {
  productLine: string;
  operationalSchoolIds: string[];
}

export interface FacilitiesSourceResult {
  rows: FacilitiesSnapshotSourceRow[];
  skippedProductLines: SkippedProductLine[];
}

/** The product line the slice can map. Basic = 3 terms, which is what `dim_period` TERM models. */
export const MAPPED_PRODUCT_LINE = "BASIC";

export async function readFacilitiesSnapshots(
  sql: postgres.Sql,
  query: FacilitiesSourceQuery,
): Promise<FacilitiesSourceResult> {
  if (query.operationalSchoolIds.length === 0)
    return { rows: [], skippedProductLines: [] };
  // `schemaName` is interpolated as an IDENTIFIER (sql(...)), never as a string literal, and it comes
  // from the pipeline's own configuration rather than from any request.
  //
  // THE JOIN CANNOT FAN OUT, and that is a structural property rather than a hope: `academic_period`
  // has `period_id` as its PRIMARY KEY and `(school_id, period_id)` as `academic_period_tenant_uk`, so
  // joining on BOTH columns matches at most one row. `facilities_snapshot` is itself one row per
  // `(school_id, period_id)` (`uniq_facilities_snapshot_term`). One census row in, at most one row out
  // — which is what lets `schools_reporting = 1` be asserted rather than counted.
  const rows = await sql<Record<string, unknown>[]>`
    select f.school_id::text        as school_id,
           f.period_id::text        as period_id,
           p.academic_year          as academic_year,
           p.period_number          as period_number,
           p.product_line           as product_line,
           f.classrooms_total, f.classrooms_good, f.classrooms_repair,
           f.water_source, f.electricity_source,
           f.latrines_boys, f.latrines_girls, f.latrines_staff,
           f.latrine_type, f.handwashing,
           f.has_library, f.has_ict_lab, f.internet, f.has_kitchen, f.gsfp_participating,
           f.library_book_count, f.computers_total, f.computers_working,
           f.student_desks_usable, f.student_desks_broken, f.teacher_desks,
           f.chalkboards, f.whiteboards, f.projectors,
           f.captured_at
      from ${sql(query.schemaName)}.facilities_snapshot f
      join ${sql(query.schemaName)}.academic_period p
        on p.school_id = f.school_id and p.period_id = f.period_id
     where p.academic_year = ${query.academicYear}
       and p.period_number = ${query.periodNumber}
       and f.school_id = any(${query.operationalSchoolIds}::uuid[])
     order by f.school_id`;

  // DELIBERATELY NOT FILTERED IN SQL — see the product_line note in the header. Every line is read and
  // then partitioned here, so the unmapped ones are a counted gap instead of an absence.
  const mapped: FacilitiesSnapshotSourceRow[] = [];
  const skipped = new Map<string, string[]>();

  for (const r of rows) {
    const productLine = r.product_line as string;
    const schoolId = r.school_id as string;
    if (productLine !== query.productLine) {
      const bucket = skipped.get(productLine);
      if (bucket) bucket.push(schoolId);
      else skipped.set(productLine, [schoolId]);
      continue;
    }
    mapped.push(toSourceRow(r));
  }

  return {
    rows: mapped,
    skippedProductLines: [...skipped.entries()]
      .map(([productLine, operationalSchoolIds]) => ({
        productLine,
        operationalSchoolIds,
      }))
      .sort((a, b) => a.productLine.localeCompare(b.productLine)),
  };
}

function toSourceRow(r: Record<string, unknown>): FacilitiesSnapshotSourceRow {
  return {
    schoolId: r.school_id as string,
    periodId: r.period_id as string,
    academicYear: r.academic_year as string,
    periodNumber: Number(r.period_number),
    productLine: r.product_line as string,
    classroomsTotal: Number(r.classrooms_total),
    classroomsGood: Number(r.classrooms_good),
    classroomsRepair: Number(r.classrooms_repair),
    waterSource: r.water_source as string,
    electricitySource: r.electricity_source as string,
    latrinesBoys: Number(r.latrines_boys),
    latrinesGirls: Number(r.latrines_girls),
    latrinesStaff: Number(r.latrines_staff),
    latrineType: r.latrine_type as string,
    handwashing: r.handwashing as boolean,
    hasLibrary: r.has_library as boolean,
    hasIctLab: r.has_ict_lab as boolean,
    internet: r.internet as boolean,
    hasKitchen: r.has_kitchen as boolean,
    gsfpParticipating: r.gsfp_participating as boolean,
    libraryBookCount: r.library_book_count === null ? null : Number(r.library_book_count),
    computersTotal: r.computers_total === null ? null : Number(r.computers_total),
    computersWorking: r.computers_working === null ? null : Number(r.computers_working),
    studentDesksUsable:
      r.student_desks_usable === null ? null : Number(r.student_desks_usable),
    studentDesksBroken:
      r.student_desks_broken === null ? null : Number(r.student_desks_broken),
    teacherDesks: r.teacher_desks === null ? null : Number(r.teacher_desks),
    chalkboards: r.chalkboards === null ? null : Number(r.chalkboards),
    whiteboards: r.whiteboards === null ? null : Number(r.whiteboards),
    projectors: r.projectors === null ? null : Number(r.projectors),
    capturedAt: (r.captured_at as Date).toISOString(),
  };
}
