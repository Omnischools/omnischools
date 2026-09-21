import { sql } from "drizzle-orm";
import { withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";

/**
 * SCHOOL FACILITIES CENSUS DETAIL — the NON-GATED drill (Lucy C5).
 *
 * This is infrastructure data about a SCHOOL, not about a person: classrooms, boreholes, latrines,
 * a generator. So it is NOT gated. Concretely, and deliberately:
 *   · no §6 justification gate, no "you are about to leave aggregate view" banner;
 *   · NO `audit_access_log` ROW — nothing here is a named-record access, and writing an audit row
 *     for it would debase the log. A log where most entries are someone checking a latrine count is
 *     a log nobody reads, which is the same as no log;
 *   · no access strip, no R-#### reference;
 *   · it does NOT touch the operational read-back. It reads `fact_infrastructure` in the ANALYTICS
 *     DB under the ordinary jurisdiction RLS — the same boundary as every other aggregate surface.
 *     (That is also what keeps lib/db/readback.ts out of this file's import graph; see the
 *     isolation guard in tests/readback-isolation.test.ts.)
 *
 * ═══ THE HARD EXCLUSION ═════════════════════════════════════════════════════════════════════════
 * `captured_by` and `caterer_name` must NEVER surface here.
 *
 * They are person-identifying: `captured_by` is the school staff member who keyed the census (an
 * operational provenance stamp, and an invitation to ask a named person why their number is odd),
 * and `caterer_name` is a named GSFP supplier, a third party who is not part of any oversight
 * question about a school's facilities.
 *
 * EXCLUDED ≠ WITHHELD, and conflating the two is the specific mistake this comment exists to
 * prevent (Lucy C7's distinction). A WITHHELD field appears on a named record, greyed, with "not
 * released for this reason", because the officer should see what more exists and which reason would
 * unlock it. An EXCLUDED field is ABSENT: there is no reason code on this surface, nothing to
 * unlock, and rendering "Caterer name — withheld" would advertise the existence of a name and
 * invite someone to go looking for the reason that reveals it. There is none.
 *
 * Enforcement is at the QUERY boundary — the SELECT below is an explicit allow-list, so the values
 * never cross into this process. Two further guards make that structural rather than diligent:
 * `assertNoForbiddenCensusFields()` checks the returned object, and the analytics table itself has
 * no such columns (the ETL never carries them across the boundary). All three would have to fail.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Never present on this surface, in any shape, at any tier. Not "withheld" — absent. */
export const FORBIDDEN_CENSUS_FIELDS = Object.freeze([
  "captured_by",
  "capturedBy",
  "caterer_name",
  "catererName",
]);

export class ForbiddenCensusFieldError extends Error {
  readonly code = "FORBIDDEN_CENSUS_FIELD";
  constructor(field: string) {
    super(
      `"${field}" must never reach the Oversight facilities panel. It is excluded at the query boundary, not withheld.`,
    );
    this.name = "ForbiddenCensusFieldError";
  }
}

export function assertNoForbiddenCensusFields(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_CENSUS_FIELDS.includes(key)) throw new ForbiddenCensusFieldError(key);
  }
}

export interface SchoolFacilitiesCensus {
  schoolName: string;
  academicYear: string;
  term: number | null;
  classroomsTotal: number;
  classroomsGood: number;
  classroomsRepair: number;
  latrinesBoys: number;
  latrinesGirls: number;
  latrinesStaff: number;
  hasWater: boolean;
  hasElectricity: boolean;
  hasHandwashing: boolean;
  hasLibrary: boolean;
  hasIctLab: boolean;
  hasInternet: boolean;
  hasKitchen: boolean;
  gsfpParticipating: boolean;
  computersTotal: number | null;
  computersWorking: number | null;
  libraryBookCount: number | null;
  studentDesksUsable: number | null;
  studentDesksBroken: number | null;
  teacherDesks: number | null;
  chalkboards: number | null;
  whiteboards: number | null;
  projectors: number | null;
  /** Lucy C5: "Source · annual census · read-only via the analytics boundary". No R-#### ref. */
  source: string;
  asOfDate: string;
}

/**
 * The explicit column allow-list. Written out rather than `select *` for exactly one reason: a
 * `select *` here would pick up whatever column is added to the fact table next, including one
 * carrying a name, and would do so silently.
 */
export async function getSchoolFacilitiesCensus(
  scope: JurisdictionScope,
  schoolJurisdictionId: string,
  periodId?: string,
): Promise<SchoolFacilitiesCensus | null> {
  return withJurisdiction(scope, async (tx) => {
    const result = await tx.execute(sql`
      select
        dj.name                                as school_name,
        dp.academic_year                       as academic_year,
        dp.term                                as term,
        fi.classrooms_total                    as classrooms_total,
        fi.classrooms_good                     as classrooms_good,
        fi.classrooms_repair                   as classrooms_repair,
        fi.latrines_boys                       as latrines_boys,
        fi.latrines_girls                      as latrines_girls,
        fi.latrines_staff                      as latrines_staff,
        (fi.has_water_count > 0)               as has_water,
        (fi.has_electricity_count > 0)         as has_electricity,
        (fi.has_handwashing_count > 0)         as has_handwashing,
        (fi.has_library_count > 0)             as has_library,
        (fi.has_ict_lab_count > 0)             as has_ict_lab,
        (fi.has_internet_count > 0)            as has_internet,
        (fi.has_kitchen_count > 0)             as has_kitchen,
        (fi.gsfp_participating_count > 0)      as gsfp_participating,
        fi.computers_total                     as computers_total,
        fi.computers_working                   as computers_working,
        fi.library_book_count                  as library_book_count,
        fi.student_desks_usable                as student_desks_usable,
        fi.student_desks_broken                as student_desks_broken,
        fi.teacher_desks                       as teacher_desks,
        fi.chalkboards                         as chalkboards,
        fi.whiteboards                         as whiteboards,
        fi.projectors                          as projectors,
        fi.source::text                        as source,
        fi.as_of_date::text                    as as_of_date
      from fact_infrastructure fi
      join dim_jurisdiction dj on dj.jurisdiction_id = fi.jurisdiction_id
      join dim_period dp       on dp.period_id = fi.period_id
      where fi.jurisdiction_id = ${schoolJurisdictionId}::uuid
        ${periodId ? sql`and fi.period_id = ${periodId}::uuid` : sql``}
      order by dp.academic_year desc, dp.term desc nulls last
      limit 1
    `);

    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Record<string, unknown>[];
    const row = rows[0];
    if (!row) return null;

    assertNoForbiddenCensusFields(row);

    return {
      schoolName: row.school_name as string,
      academicYear: row.academic_year as string,
      term: (row.term as number | null) ?? null,
      classroomsTotal: Number(row.classrooms_total),
      classroomsGood: Number(row.classrooms_good),
      classroomsRepair: Number(row.classrooms_repair),
      latrinesBoys: Number(row.latrines_boys),
      latrinesGirls: Number(row.latrines_girls),
      latrinesStaff: Number(row.latrines_staff),
      hasWater: Boolean(row.has_water),
      hasElectricity: Boolean(row.has_electricity),
      hasHandwashing: Boolean(row.has_handwashing),
      hasLibrary: Boolean(row.has_library),
      hasIctLab: Boolean(row.has_ict_lab),
      hasInternet: Boolean(row.has_internet),
      hasKitchen: Boolean(row.has_kitchen),
      gsfpParticipating: Boolean(row.gsfp_participating),
      computersTotal: row.computers_total === null ? null : Number(row.computers_total),
      computersWorking:
        row.computers_working === null ? null : Number(row.computers_working),
      libraryBookCount:
        row.library_book_count === null ? null : Number(row.library_book_count),
      studentDesksUsable:
        row.student_desks_usable === null ? null : Number(row.student_desks_usable),
      studentDesksBroken:
        row.student_desks_broken === null ? null : Number(row.student_desks_broken),
      teacherDesks: row.teacher_desks === null ? null : Number(row.teacher_desks),
      chalkboards: row.chalkboards === null ? null : Number(row.chalkboards),
      whiteboards: row.whiteboards === null ? null : Number(row.whiteboards),
      projectors: row.projectors === null ? null : Number(row.projectors),
      source: row.source as string,
      asOfDate: row.as_of_date as string,
    };
  });
}
