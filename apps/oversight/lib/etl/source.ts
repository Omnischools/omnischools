import type postgres from "postgres";

/**
 * THE OPERATIONAL SOURCE READER for `facilities_snapshot` (scope §3 "credentials — the blocker nobody
 * built").
 *
 * ═══ WHAT IS REAL HERE AND WHAT IS STOOD IN ══════════════════════════════════════════════════════
 * REAL: the QUERY. The column list, the `(school_id, period_id)` grain, the join to the per-school
 * `academic_period` that supplies `(academic_year, term)`, the CHECK-constrained categorical values,
 * the nullable optional-detail columns. The transform in `lib/etl/infrastructure.ts` consumes exactly
 * this shape and would consume the real operational table unchanged.
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
 * ⚠ `caterer_name` AND `captured_by` ARE NOT SELECTED. They exist in the source and must never cross
 * the boundary: `captured_by` names the staff member who keyed the census, `caterer_name` a third-party
 * GSFP supplier. `lib/oversight/infrastructure.ts` documents the read-side exclusion; this is the
 * upstream half of it, and it is an explicit allow-list rather than a `select *` minus two columns, so
 * a new person-identifying column added operationally is absent here by default.
 */

/** Exactly the operational `facilities_snapshot` columns the transform needs, plus the term keys. */
export interface FacilitiesSnapshotSourceRow {
  schoolId: string;
  periodId: string;
  academicYear: string;
  term: number;

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
  term: number;
  /** The inclusion set's operational tenant uuids. Never unbounded — one run, one known set. */
  operationalSchoolIds: string[];
}

export async function readFacilitiesSnapshots(
  sql: postgres.Sql,
  query: FacilitiesSourceQuery,
): Promise<FacilitiesSnapshotSourceRow[]> {
  if (query.operationalSchoolIds.length === 0) return [];
  // `schemaName` is interpolated as an IDENTIFIER (sql(...)), never as a string literal, and it comes
  // from the pipeline's own configuration rather than from any request.
  const rows = await sql<Record<string, unknown>[]>`
    select f.school_id::text        as school_id,
           f.period_id::text        as period_id,
           p.academic_year          as academic_year,
           p.term                   as term,
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
       and p.term = ${query.term}
       and f.school_id = any(${query.operationalSchoolIds}::uuid[])
     order by f.school_id`;

  return rows.map((r) => ({
    schoolId: r.school_id as string,
    periodId: r.period_id as string,
    academicYear: r.academic_year as string,
    term: Number(r.term),
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
  }));
}
