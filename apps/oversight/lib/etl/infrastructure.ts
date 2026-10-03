import type postgres from "postgres";
import type { FacilitiesSnapshotSourceRow } from "./source";
import { stampProvenance, type Provenance } from "./run";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `facilities_snapshot` → `fact_infrastructure` — THE TRANSFORM (scope §1 + §8, task H6).
 *
 * ONE module, on purpose: the decomposition and the write are the two halves of one claim, and a
 * reviewer has to be able to check the whole claim without jumping files.
 *
 * WHY THIS TABLE IS THE FIRST SLICE: the source is ALREADY one row per (school, period) — the
 * operational `uniq_facilities_snapshot_term` — so there is zero grouping and zero aggregation
 * ambiguity. Every invariant is checkable on ONE row. The roll-up is a plain SUM, so
 * "district = Σ its schools" is provable without any weighted-rate reasoning.
 *
 * ── THE DECOMPOSITION RULE ─────────────────────────────────────────────────────────────────────
 * EVERY attribute becomes a COUNT, never a boolean and never a raw category, because a boolean and
 * an enum DO NOT SUM. `has_electricity = true` cannot be added up into a district figure; stored as
 * `has_electricity_count = 1` it makes the district answer a plain `sum()` that reads "N of Y
 * schools". Concretely:
 *   presence booleans   → has_*_count                      (0 or 1 on a school row)
 *   fixed-domain enums  → one 0/1 count per ALLOWED VALUE   (the operational CHECK allow-list, exactly)
 *   physical tallies    → copied (already summable)
 *   schools_reporting   → 1, the "Y" denominator
 *
 * `has_water` / `has_electricity` are DERIVED as `source <> 'NONE'` — the operational census has no
 * separate presence boolean for either, so the derivation is the definition.
 *
 * ── THE SELF-CHECKING PART (and why these are ETL assertions, not DB CHECKs) ────────────────────
 * Exactly ONE member of each categorical family is 1 per school row, so each family SUMS TO
 * `schools_reporting` at every tier. That makes a mis-derived row arithmetically detectable — which is
 * the only reason the families are stored this way rather than as a text column. The assertions live
 * here, not as table CHECKs, for the same reason fact.ts gives for the other invariants: a loader owns
 * the reconciliation, and a CHECK would also have to hold for rows written by future, differently-shaped
 * paths.
 *
 * ── THE HONEST DENOMINATORS ────────────────────────────────────────────────────────────────────
 * The census makes computers, library books and furniture NULLABLE. A roll-up must divide by the
 * schools that ACTUALLY ANSWERED, not by all schools, so each family carries a `*_reporting_count`:
 *   computers_reporting_count      1 iff `computers_total` was answered
 *   library_books_reporting_count  1 iff `library_book_count` was answered
 *   furniture_reporting_count      1 iff ANY of the six furniture columns was answered
 * Furniture is ANY rather than ALL because the census is a form a human fills in: a school that
 * counted its desks and skipped its projectors has answered the furniture question, and demanding all
 * six would silently discard most real returns. The value reads "1,200 computers across 8 of 12
 * reporting schools" — never a silent zero.
 *
 * ── STOCK, NOT FLOW ────────────────────────────────────────────────────────────────────────────
 * Infrastructure is a STOCK. Sum it SPATIALLY (across schools), NEVER across periods: two terms of a
 * school's classroom count are THE SAME CLASSROOMS. There is no constraint that can stop a reader
 * summing two terms, so every read must filter to exactly one `period_id`. See
 * `tests/etl-infrastructure.test.ts` for the executable statement of this rule.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────────────────────────
 * No `school_type` / `ownership_type` (they are slowly-changing DIMENSION attributes on
 * `dim_jurisdiction`; duplicating them onto a fact lets the two drift). No sex and no stage breakdown
 * (a borehole has no sex and belongs to no stage). No `captured_by` and no `caterer_name` — they are
 * not selected by `lib/etl/source.ts` and have no column here; that absence is the structural floor
 * under the read-side exclusion in `lib/oversight/infrastructure.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The operational CHECK allow-lists, mirrored byte-for-byte. Order fixes the column order below. */
export const WATER_SOURCES = ["BOREHOLE", "PIPE", "WELL", "NONE"] as const;
export const ELECTRICITY_SOURCES = ["GRID", "SOLAR", "GENERATOR", "NONE"] as const;
export const LATRINE_TYPES = ["WC", "KVIP", "PIT", "NONE"] as const;

/** Raised for a row this ETL refuses to decompose. Per-school isolated by `computePerSchool`. */
export class InfrastructureTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InfrastructureTransformError";
  }
}

/** One `fact_infrastructure` row, ready to insert. Column-for-column with `db/schema/fact.ts`. */
export interface FactInfrastructureRow {
  jurisdictionId: string;
  periodId: string;
  schoolsReporting: number;

  classroomsTotal: number;
  classroomsGood: number;
  classroomsRepair: number;
  latrinesBoys: number;
  latrinesGirls: number;
  latrinesStaff: number;
  studentDesksUsable: number | null;
  studentDesksBroken: number | null;
  teacherDesks: number | null;
  chalkboards: number | null;
  whiteboards: number | null;
  projectors: number | null;
  computersTotal: number | null;
  computersWorking: number | null;
  libraryBookCount: number | null;

  hasElectricityCount: number;
  hasWaterCount: number;
  hasHandwashingCount: number;
  hasLibraryCount: number;
  hasIctLabCount: number;
  hasInternetCount: number;
  gsfpParticipatingCount: number;
  hasKitchenCount: number;

  waterBoreholeCount: number;
  waterPipeCount: number;
  waterWellCount: number;
  waterNoneCount: number;
  electricityGridCount: number;
  electricitySolarCount: number;
  electricityGeneratorCount: number;
  electricityNoneCount: number;
  latrineWcCount: number;
  latrineKvipCount: number;
  latrinePitCount: number;
  latrineNoneCount: number;

  computersReportingCount: number;
  libraryBooksReportingCount: number;
  furnitureReportingCount: number;

  source: Provenance["source"];
  asOfDate: string;
  etlRunId: string;
}

const bit = (b: boolean): number => (b ? 1 : 0);

/** 1 iff the row's categorical value equals `value`. The whole decomposition of a CHECK family. */
const oneHot = (actual: string, value: string): number => bit(actual === value);

function requireNonNegativeInt(value: number, field: string, emisSchoolId: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new InfrastructureTransformError(
      `${emisSchoolId}: "${field}" must be a non-negative integer, got ${String(value)}.`,
    );
}

/**
 * THE PURE DECOMPOSITION. No DB, no clock, no randomness — given the same source row and the same
 * run id it returns the same object, which is what makes the idempotency test meaningful.
 *
 * It FAILS LOUDLY rather than coercing. A row whose `classrooms_good + classrooms_repair` exceeds its
 * total, or whose `water_source` is outside the allow-list, is a row nobody can honestly aggregate:
 * coercing it would publish a number with no referent, and the per-school isolation in
 * `computePerSchool` exists precisely so that refusing it costs one school rather than the run.
 */
export function decomposeFacilitiesSnapshot(
  source: FacilitiesSnapshotSourceRow,
  target: {
    jurisdictionId: string;
    periodId: string;
    emisSchoolId: string;
    etlRunId: string;
  },
): FactInfrastructureRow {
  const { emisSchoolId } = target;

  // ---- allow-list validation: the operational CHECK families must match ours byte-for-byte ----
  if (!(WATER_SOURCES as readonly string[]).includes(source.waterSource))
    throw new InfrastructureTransformError(
      `${emisSchoolId}: water_source "${source.waterSource}" is outside the allow-list ` +
        `${WATER_SOURCES.join("|")} — the operational CHECK and the analytics column family have drifted.`,
    );
  if (!(ELECTRICITY_SOURCES as readonly string[]).includes(source.electricitySource))
    throw new InfrastructureTransformError(
      `${emisSchoolId}: electricity_source "${source.electricitySource}" is outside the allow-list ` +
        `${ELECTRICITY_SOURCES.join("|")}.`,
    );
  if (!(LATRINE_TYPES as readonly string[]).includes(source.latrineType))
    throw new InfrastructureTransformError(
      `${emisSchoolId}: latrine_type "${source.latrineType}" is outside the allow-list ` +
        `${LATRINE_TYPES.join("|")}.`,
    );

  // ---- physical tallies: the operational CHECKs restated, because this ETL may one day read a
  //      source that lost them (a CSV hand-off, a different tenant's table).
  for (const [field, value] of [
    ["classrooms_total", source.classroomsTotal],
    ["classrooms_good", source.classroomsGood],
    ["classrooms_repair", source.classroomsRepair],
    ["latrines_boys", source.latrinesBoys],
    ["latrines_girls", source.latrinesGirls],
    ["latrines_staff", source.latrinesStaff],
  ] as const) {
    requireNonNegativeInt(value, field, emisSchoolId);
  }
  if (source.classroomsGood + source.classroomsRepair > source.classroomsTotal)
    throw new InfrastructureTransformError(
      `${emisSchoolId}: classrooms_good (${source.classroomsGood}) + classrooms_repair ` +
        `(${source.classroomsRepair}) exceeds classrooms_total (${source.classroomsTotal}).`,
    );
  if (
    source.computersTotal !== null &&
    source.computersWorking !== null &&
    source.computersWorking > source.computersTotal
  )
    throw new InfrastructureTransformError(
      `${emisSchoolId}: computers_working (${source.computersWorking}) exceeds computers_total ` +
        `(${source.computersTotal}).`,
    );

  const provenance = stampProvenance(target.etlRunId, source.capturedAt);

  const row: FactInfrastructureRow = {
    jurisdictionId: target.jurisdictionId,
    periodId: target.periodId,
    // The "Y schools" denominator. Always 1 on a school row — the grain IS one reporting school.
    schoolsReporting: 1,

    classroomsTotal: source.classroomsTotal,
    classroomsGood: source.classroomsGood,
    classroomsRepair: source.classroomsRepair,
    latrinesBoys: source.latrinesBoys,
    latrinesGirls: source.latrinesGirls,
    latrinesStaff: source.latrinesStaff,
    studentDesksUsable: source.studentDesksUsable,
    studentDesksBroken: source.studentDesksBroken,
    teacherDesks: source.teacherDesks,
    chalkboards: source.chalkboards,
    whiteboards: source.whiteboards,
    projectors: source.projectors,
    computersTotal: source.computersTotal,
    computersWorking: source.computersWorking,
    libraryBookCount: source.libraryBookCount,

    // ---- presence booleans → 0/1 counts. The first two are DERIVED from the category. ----
    hasElectricityCount: bit(source.electricitySource !== "NONE"),
    hasWaterCount: bit(source.waterSource !== "NONE"),
    hasHandwashingCount: bit(source.handwashing),
    hasLibraryCount: bit(source.hasLibrary),
    hasIctLabCount: bit(source.hasIctLab),
    hasInternetCount: bit(source.internet),
    gsfpParticipatingCount: bit(source.gsfpParticipating),
    hasKitchenCount: bit(source.hasKitchen),

    // ---- the three CHECK families → one 0/1 count per allowed value ----
    waterBoreholeCount: oneHot(source.waterSource, "BOREHOLE"),
    waterPipeCount: oneHot(source.waterSource, "PIPE"),
    waterWellCount: oneHot(source.waterSource, "WELL"),
    waterNoneCount: oneHot(source.waterSource, "NONE"),
    electricityGridCount: oneHot(source.electricitySource, "GRID"),
    electricitySolarCount: oneHot(source.electricitySource, "SOLAR"),
    electricityGeneratorCount: oneHot(source.electricitySource, "GENERATOR"),
    electricityNoneCount: oneHot(source.electricitySource, "NONE"),
    latrineWcCount: oneHot(source.latrineType, "WC"),
    latrineKvipCount: oneHot(source.latrineType, "KVIP"),
    latrinePitCount: oneHot(source.latrineType, "PIT"),
    latrineNoneCount: oneHot(source.latrineType, "NONE"),

    // ---- honest denominators for the nullable optional-detail families ----
    computersReportingCount: bit(source.computersTotal !== null),
    libraryBooksReportingCount: bit(source.libraryBookCount !== null),
    furnitureReportingCount: bit(
      source.studentDesksUsable !== null ||
        source.studentDesksBroken !== null ||
        source.teacherDesks !== null ||
        source.chalkboards !== null ||
        source.whiteboards !== null ||
        source.projectors !== null,
    ),

    source: provenance.source,
    asOfDate: provenance.asOfDate,
    etlRunId: provenance.etlRunId,
  };

  assertRowInvariants(row, emisSchoolId);
  return row;
}

/**
 * THE ARITHMETIC SELF-CHECK. Each categorical family sums to `schools_reporting`, and the derived
 * presence counts agree with their family's NONE member. A failure here is a defect in the function
 * above, not in the data — so it raises with the computed row in the message.
 */
export function assertRowInvariants(
  row: FactInfrastructureRow,
  emisSchoolId: string,
): void {
  const families: [string, number[], number][] = [
    [
      "water",
      [
        row.waterBoreholeCount,
        row.waterPipeCount,
        row.waterWellCount,
        row.waterNoneCount,
      ],
      row.hasWaterCount,
    ],
    [
      "electricity",
      [
        row.electricityGridCount,
        row.electricitySolarCount,
        row.electricityGeneratorCount,
        row.electricityNoneCount,
      ],
      row.hasElectricityCount,
    ],
    [
      "latrine",
      [
        row.latrineWcCount,
        row.latrineKvipCount,
        row.latrinePitCount,
        row.latrineNoneCount,
      ],
      // Latrine has no derived has_* column; -1 skips the presence cross-check below.
      -1,
    ],
  ];
  for (const [name, counts, presence] of families) {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total !== row.schoolsReporting)
      throw new InfrastructureTransformError(
        `${emisSchoolId}: the ${name} family sums to ${total}, not schools_reporting ` +
          `(${row.schoolsReporting}). Exactly one member must be 1.`,
      );
    // `has_water` / `has_electricity` are defined as `source <> 'NONE'`, i.e. 1 - the NONE member.
    const noneCount = counts[counts.length - 1]!;
    if (presence >= 0 && presence !== row.schoolsReporting - noneCount)
      throw new InfrastructureTransformError(
        `${emisSchoolId}: the derived ${name} presence count (${presence}) disagrees with its ` +
          `NONE member (${noneCount}).`,
      );
  }
}

// ── the write ───────────────────────────────────────────────────────────────────────────────────

/**
 * DELETE-THEN-INSERT, IN ONE TRANSACTION (scope §3 "idempotency", one reviewable path).
 *
 * THREE PROPERTIES, all of them deliberate:
 *
 *  1. THE DELETE IS BOUNDED BY `(period_id, jurisdiction_id ∈ rowsToWrite)` — never period-wide. A
 *     period-wide delete would remove the rows of schools that have since dropped out of the inclusion
 *     set, or whose compute failed this run, and never re-insert them: the district total would simply
 *     SHRINK, with no error and no empty table to notice. A school that failed compute therefore KEEPS
 *     ITS PRIOR ROW — stale-but-honest, the same rule a FAILED run follows.
 *
 *  2. ONE TRANSACTION, so a mid-write failure rolls the DELETE back too and leaves the prior night's
 *     data intact. This is the mechanism behind `etl_run`'s FAILED semantics; `lib/etl/run.ts` only
 *     records the state.
 *
 *  3. DELETE-THEN-INSERT RATHER THAN `on conflict` UPSERT, even though `fact_infrastructure` HAS a
 *     grain UNIQUE and could upsert. One path for all twelve fact tables: the original eight are
 *     PK-only with no conflict target at all (fact.ts:238–241), so upsert is not available there, and
 *     two idempotency idioms in one pipeline is how one of them ends up untested. The grain UNIQUE
 *     still earns its keep — it is what makes a duplicate INSERT raise instead of doubling every
 *     roll-up silently.
 */
export async function writeInfrastructureFacts(
  sql: postgres.Sql,
  periodId: string,
  rowsToWrite: FactInfrastructureRow[],
): Promise<{ deleted: number; inserted: number }> {
  const jurisdictionIds = rowsToWrite.map((r) => r.jurisdictionId);

  return (await sql.begin(async (tx) => {
    let deleted = 0;
    if (jurisdictionIds.length > 0) {
      const removed = await tx`
        delete from fact_infrastructure
         where period_id = ${periodId}::uuid
           and jurisdiction_id = any(${jurisdictionIds}::uuid[])`;
      deleted = removed.count;
    }

    let inserted = 0;
    const CHUNK = 500;
    for (let i = 0; i < rowsToWrite.length; i += CHUNK) {
      const chunk = rowsToWrite.slice(i, i + CHUNK).map((r) => ({
        jurisdiction_id: r.jurisdictionId,
        period_id: r.periodId,
        schools_reporting: r.schoolsReporting,
        classrooms_total: r.classroomsTotal,
        classrooms_good: r.classroomsGood,
        classrooms_repair: r.classroomsRepair,
        latrines_boys: r.latrinesBoys,
        latrines_girls: r.latrinesGirls,
        latrines_staff: r.latrinesStaff,
        student_desks_usable: r.studentDesksUsable,
        student_desks_broken: r.studentDesksBroken,
        teacher_desks: r.teacherDesks,
        chalkboards: r.chalkboards,
        whiteboards: r.whiteboards,
        projectors: r.projectors,
        computers_total: r.computersTotal,
        computers_working: r.computersWorking,
        library_book_count: r.libraryBookCount,
        has_electricity_count: r.hasElectricityCount,
        has_water_count: r.hasWaterCount,
        has_handwashing_count: r.hasHandwashingCount,
        has_library_count: r.hasLibraryCount,
        has_ict_lab_count: r.hasIctLabCount,
        has_internet_count: r.hasInternetCount,
        gsfp_participating_count: r.gsfpParticipatingCount,
        has_kitchen_count: r.hasKitchenCount,
        water_borehole_count: r.waterBoreholeCount,
        water_pipe_count: r.waterPipeCount,
        water_well_count: r.waterWellCount,
        water_none_count: r.waterNoneCount,
        electricity_grid_count: r.electricityGridCount,
        electricity_solar_count: r.electricitySolarCount,
        electricity_generator_count: r.electricityGeneratorCount,
        electricity_none_count: r.electricityNoneCount,
        latrine_wc_count: r.latrineWcCount,
        latrine_kvip_count: r.latrineKvipCount,
        latrine_pit_count: r.latrinePitCount,
        latrine_none_count: r.latrineNoneCount,
        computers_reporting_count: r.computersReportingCount,
        library_books_reporting_count: r.libraryBooksReportingCount,
        furniture_reporting_count: r.furnitureReportingCount,
        source: r.source,
        as_of_date: r.asOfDate,
        etl_run_id: r.etlRunId,
      }));
      const result = await tx`insert into fact_infrastructure ${tx(chunk)}`;
      inserted += result.count;
    }

    // THE POST-INSERT DUPLICATE ASSERTION (scope §3). `fact_infrastructure` has a grain UNIQUE so a
    // duplicate would already have raised — this runs anyway, because it is the assertion the eight
    // PK-only fact tables will need verbatim and the pattern is being set here, in the slice whose
    // job is to set it.
    const dupes = await tx<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id
          from fact_infrastructure
         where period_id = ${periodId}::uuid
         group by jurisdiction_id, period_id
        having count(*) > 1
      ) d`;
    if ((dupes[0]?.n ?? 0) > 0)
      throw new Error(
        `fact_infrastructure has ${dupes[0]!.n} duplicated grain key(s) for period ${periodId}. ` +
          "A duplicate silently DOUBLES every roll-up above it, and the result is internally " +
          "consistent, so it is invisible at every tier.",
      );

    return { deleted, inserted };
  })) as unknown as { deleted: number; inserted: number };
}
