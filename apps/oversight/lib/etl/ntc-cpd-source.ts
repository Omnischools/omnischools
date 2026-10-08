import type postgres from "postgres";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE NTC CPD SOURCE SEAM — the ONE file a real NTC feed replaces (Kofi's `CPD-SURFACING-RULING.md`
 * C1/C2, acceptance criteria 1–3).
 *
 * ── WHAT THIS IS, IN ONE SENTENCE ───────────────────────────────────────────────────────────────
 * `fact_plc_participation`'s NTC columns — `cpd_points_specialised_total`,
 * `cpd_points_recommended_total`, their two teacher counts, `teachers_meeting_cpd_threshold` and
 * `ntc_cpd_target` — have NO operational source in Omnischools, and the schema's ⚠ SOURCING GATE
 * holds them **NULL, never 0** until one exists. This module is that source's SEAM: it reads
 * NTC-portal-SHAPED rows through a schema/connection parameter, exactly as `lib/etl/source.ts` reads
 * the `demo_source` stand-in for `facilities_snapshot`.
 *
 *     SOURCE PRESENT  → the fact builder POPULATES those columns FROM THESE ROWS.
 *     SOURCE ABSENT   → this reader returns NOTHING, and the builder leaves them NULL.
 *
 * ⚠ THE FACT BUILDER NEVER SYNTHESISES AN NTC FIGURE, AND THAT IS THE CENTRAL RULING (C1). The demo
 * does not relax the sourcing gate by letting the transform invent numbers; it relaxes it by giving
 * the transform A SOURCE TO READ FROM. ONE CODE PATH, TWO DATA STATES. The reason the distinction
 * matters is not tidiness: writing 0 where the truth is "we cannot see it" reports every school in
 * Ghana as 0% CPD-compliant, which is false, actionable, and the worst available failure mode for a
 * regulator's dashboard. Zero is a measurement; NULL is the truth.
 *
 * ── HOW THE REAL FEED LANDS: THE SEAM IS THE SCHEMA NAME, AND NOTHING ELSE CHANGES ──────────────
 * `readNtcCpdSummaries(sql, { schemaName, ... })`:
 *   TODAY (demo)     `schemaName = "demo_ntc_source"` — the stand-in in
 *                    `db/seed/demo/demo-source-schema.sql`, written by the demo generator.
 *   LATER (live)     `schemaName = "public"` on a genuine NTC-portal / authoritative-extract
 *                    connection, or a loader that materialises the extract under that name.
 *   LIVE, NO FEED    the schema does not exist → `{ summaries: [], sourcePresent: false }` → the
 *                    sourcing gate stays closed and the columns stay NULL.
 * Nothing else about the pipeline, the fact builder, `getTeacherCpd` or any dashboard changes when the
 * feed arrives. That is the whole point of C2: **swap the data origin, not the analytics.** The claim
 * holds only because the column NAMES below are the ones an NTC extract uses rather than the analytics
 * column names — the `demo_source` header's "omit, never rename" rule applied to somebody else's
 * vocabulary.
 *
 * ── ⚠ THE ABSENCE PROBE IS `to_regclass`, AND IT IS NOT DEFENSIVE PROGRAMMING ───────────────────
 * The gate's CLOSED state has to be a NORMAL, non-throwing outcome, because it is the state the real
 * product is in. A plain `select … from <schema>.ntc_cpd_summary` against a database with no such
 * schema raises `42P01 relation does not exist`, which in this pipeline means a FAILED run that writes
 * nothing for SIX other arms — i.e. "the NTC feed is not connected" would take the whole national
 * dashboard down every night. So the reader asks the catalog FIRST, through `to_regclass`, and reports
 * `sourcePresent: false` rather than throwing.
 *
 * It probes the TABLE, not merely the schema: an empty-but-present schema is a half-built feed, and
 * the honest answer there is still "no source". A PRESENT table with NO ROWS for a school is a
 * different state again and is deliberately NOT the same as absence — see the next note.
 *
 * ── ⚠ PRESENT-BUT-NO-ROW IS *NOT* ZERO EITHER ──────────────────────────────────────────────────
 * A school the extract does not mention gets no `NtcCpdSchoolSummary`, so the builder leaves ITS NTC
 * columns NULL while populating its neighbours'. That is the only honest reading: a national extract
 * that omits a school is not asserting that the school's teachers earned nothing — most likely the
 * school is not on NTC's roll yet, or its licence returns are late. The per-school granularity of the
 * gate is therefore a property of this reader's return shape (a map, not a total), and
 * `tests/etl-plc.test.ts` pins it.
 *
 * ── ⚠ NO NEW `ov_source` VALUE IS MINTED HERE (C4) ──────────────────────────────────────────────
 * Rows sourced through this seam still land on `source = OPERATIONAL_AGG`, because `ov_source` is a
 * ROW-level column and the ANNUAL CPD row is unavoidably MIXED-provenance: its spine (the PLC points
 * composition, `teacher_headcount`, `annual_plc_target`, `schools_running_plc_count`) genuinely IS an
 * operational aggregate while its NTC columns are stand-in-sourced. One row cannot carry two `source`
 * values, so `source` alone could not mark the NTC columns even if a value were added. The demo state
 * is instead recognisable by the TABLE-LEVEL SIGNATURE the gate itself creates: an `OPERATIONAL_AGG`
 * row with NON-NULL Specialised / Recommended / threshold is, by the gate's own logic, only producible
 * from a stand-in today. When the REAL feed is built, that increment should add
 * `ov_source = 'NTC_CPD_EXTRACT'` (a TWO-migration "unsafe use of new value" change) and tag the NTC
 * sub-provenance properly — ruling escalation E-CPD-2, explicitly out of scope here.
 *
 * ── WHAT THIS READER REFUSES TO READ, even though a real extract might carry it ─────────────────
 * No teacher row, no licence number, no name, no per-teacher points. `fact_plc_participation` says in
 * as many words: no user ids, no names, no per-teacher rows — analytics holds aggregates only, and the
 * gated §6 audit route is the only named path. So the shape below is pre-aggregated to
 * (school × academic year × teacher sex), and a future real feed must aggregate BEFORE it reaches this
 * seam rather than after.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The extract's own table name, under whichever schema the seam is pointed at. */
export const NTC_CPD_SUMMARY_TABLE = "ntc_cpd_summary";

/** The sexes the extract carries. There is NO 'ALL' row — the builder synthesises it. See below. */
export const NTC_SOURCE_SEXES = ["MALE", "FEMALE"] as const;
export type NtcSourceSex = (typeof NTC_SOURCE_SEXES)[number];

/**
 * ONE extract row: one (school × academic year × teacher sex) slice of NTC's CPD view of a school.
 *
 * Every POINTS figure is in exact integer HUNDREDTHS of a point, for the reason
 * `lib/etl/plc-source.ts` carries hundredths and `lib/etl/fees-source.ts` carries pesewas: the fact
 * columns are `numeric(7,2)`, the reconciliation `mandatory + specialised + recommended =
 * cpd_points_total` must hold EXACTLY, and a float sum would make it hold only approximately — which
 * on a load-bearing identity is the same as not holding.
 */
export interface NtcCpdSourceRow {
  /** The GES/EMIS school code. TEXT — NTC has never heard of an Omnischools tenant uuid. */
  emisSchoolId: string;
  academicYear: string;
  /** MALE | FEMALE. Validated on the way in, because an unexpected value must not become an ALL row. */
  teacherSex: NtcSourceSex;
  /** `specialised_points` — CPD earned entirely OUTSIDE PLC. Hundredths. */
  specialisedHundredths: number;
  /** `recommended_points` — likewise. Hundredths. */
  recommendedHundredths: number;
  /**
   * `ncpd_points` — ⚠ THE NCPD HALF OF MANDATORY, AND ONLY THAT HALF (C7). Mandatory is fed by two
   * streams, school-based/PLC and National-Centre-for-PD provision, and Omnischools observes only the
   * first. So this is a TOPUP the builder ADDS to the genuinely observed PLC points, which is exactly
   * what makes `cpd_points_mandatory_total >= the observed PLC points` true by construction and what
   * lets a later real feed only ever ADD to the PLC floor instead of contradicting it. Hundredths.
   */
  ncpdHundredths: number;
  /** Teachers with ≥1 MANDATORY point (both streams, in NTC's view). A COVERAGE numerator. */
  mandatoryTeachers: number;
  specialisedTeachers: number;
  recommendedTeachers: number;
  /** Teachers who reached `cpdTargetHundredths` ACROSS ALL CPD — the statutory compliance count. */
  teachersMeetingThreshold: number;
  /** `cpd_target_points` — the NATIONAL statutory total for this year (nominally 20.00). Hundredths. */
  cpdTargetHundredths: number;
}

/**
 * One school's whole NTC slice: the MALE and FEMALE rows, kept APART.
 *
 * ⚠ THE 'ALL' FIGURE IS NOT IN HERE, AND THAT IS DELIBERATE. The extract carries no ALL row, so the
 * builder synthesises it as MALE + FEMALE — which is what makes `MALE + FEMALE = ALL` true BY
 * CONSTRUCTION on every NTC-sourced column rather than true by agreement between two independently
 * generated numbers. It is the same discipline the roster read applies to pupils: operational
 * `demo_source.sex` has no 'ALL' member precisely because ALL is the ETL's synthesis.
 *
 * A school with only ONE sex row is legal (a single-sex staff, or an incomplete return) and is handled
 * by the builder as "the missing sex contributed nothing", which is a real statement about a school
 * with no female teachers and a defensible one about an incomplete return — stated here so the next
 * reader does not mistake it for a silent drop.
 */
export interface NtcCpdSchoolSummary {
  emisSchoolId: string;
  academicYear: string;
  bySex: Partial<Record<NtcSourceSex, NtcCpdSourceRow>>;
}

export interface NtcCpdSourceQuery {
  /**
   * THE SEAM. `"demo_ntc_source"` for the demo; `"public"` on a live NTC-portal/extract connection.
   * Interpolated as an IDENTIFIER and taken from the pipeline's CONFIGURATION, never from a request.
   */
  schemaName: string;
  /** The academic year the ANNUAL cut is being built for. One year per call. */
  academicYear: string;
  /** The inclusion set's EMIS school codes. Never unbounded — one run, one known set. */
  emisSchoolIds: string[];
}

export interface NtcCpdSourceResult {
  /**
   * FALSE means THE SOURCING GATE IS CLOSED: there is no NTC source at all, so every NTC column stays
   * NULL. This is the state the real product is in today, and it is a normal outcome, not an error.
   *
   * ⚠ TRUE WITH AN EMPTY `bySchool` IS A DIFFERENT STATE: the feed exists but mentions none of these
   * schools. The columns still stay NULL per school (absence of a row is not a zero), but the run can
   * honestly report "the feed is connected and covered 0 of 431 schools", which is an actionable
   * coverage problem rather than an unconnected feed.
   */
  sourcePresent: boolean;
  /** EMIS school code → that school's NTC slice. Schools the extract omits are simply not keys. */
  bySchool: Map<string, NtcCpdSchoolSummary>;
}

/** Raised ONLY for a source row this reader refuses to interpret. Never for an ABSENT source. */
export class NtcCpdSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NtcCpdSourceError";
  }
}

/**
 * Is there an NTC source behind the seam at all? Asked of the CATALOG, so the closed gate is a
 * non-throwing outcome. See the header for why this cannot be a try/catch around the real query.
 */
export async function ntcCpdSourcePresent(
  sql: postgres.Sql,
  schemaName: string,
): Promise<boolean> {
  // `to_regclass` takes a TEXT identifier and returns NULL rather than raising when nothing matches —
  // which is exactly the semantics the gate needs. The name is passed as a PARAMETER (a text literal),
  // not interpolated, because here it is data for a catalog lookup rather than an identifier in a
  // FROM clause; `quote_ident` keeps a schema name with unusual characters from changing the meaning.
  const rows = await sql<{ present: boolean }[]>`
    select to_regclass(quote_ident(${schemaName}) || '.' ||
                       quote_ident(${NTC_CPD_SUMMARY_TABLE})) is not null as present`;
  return rows[0]?.present === true;
}

/**
 * Read the NTC CPD extract for ONE academic year, for the run's schools only.
 *
 * Deterministic order (school, sex) so the summaries the builder sees — and therefore the rows written
 * — are identical on every run, which is what makes "a re-run is byte-identical" a property rather
 * than a coincidence.
 */
export async function readNtcCpdSummaries(
  sql: postgres.Sql,
  query: NtcCpdSourceQuery,
): Promise<NtcCpdSourceResult> {
  const empty: NtcCpdSourceResult = { sourcePresent: false, bySchool: new Map() };
  // THE GATE, asked first and answered without throwing. A run with no NTC source is a normal run.
  if (!(await ntcCpdSourcePresent(sql, query.schemaName))) return empty;
  if (query.emisSchoolIds.length === 0) return { sourcePresent: true, bySchool: new Map() };

  const rows = await sql<Record<string, unknown>[]>`
    select n.emis_school_id                      as emis_school_id,
           n.academic_year                       as academic_year,
           n.teacher_sex                         as teacher_sex,
           (n.specialised_points * 100)::bigint  as specialised_hundredths,
           (n.recommended_points * 100)::bigint  as recommended_hundredths,
           (n.ncpd_points * 100)::bigint         as ncpd_hundredths,
           n.mandatory_teachers                  as mandatory_teachers,
           n.specialised_teachers                as specialised_teachers,
           n.recommended_teachers                as recommended_teachers,
           n.teachers_meeting_threshold          as teachers_meeting_threshold,
           (n.cpd_target_points * 100)::bigint   as cpd_target_hundredths
      from ${sql(query.schemaName)}.${sql(NTC_CPD_SUMMARY_TABLE)} n
     where n.academic_year = ${query.academicYear}
       and n.emis_school_id = any(${query.emisSchoolIds}::text[])
     order by n.emis_school_id, n.teacher_sex`;

  const bySchool = new Map<string, NtcCpdSchoolSummary>();
  for (const raw of rows) {
    const row = toSourceRow(raw);
    let summary = bySchool.get(row.emisSchoolId);
    if (!summary) {
      summary = {
        emisSchoolId: row.emisSchoolId,
        academicYear: row.academicYear,
        bySex: {},
      };
      bySchool.set(row.emisSchoolId, summary);
    }
    // The source's own UNIQUE (emis_school_id, academic_year, teacher_sex) makes this unreachable;
    // it is asserted rather than assumed because a duplicated sex row would DOUBLE that school's
    // whole NTC contribution while leaving every figure internally consistent.
    if (summary.bySex[row.teacherSex])
      throw new NtcCpdSourceError(
        `${row.emisSchoolId}: the NTC extract carries two ${row.teacherSex} rows for ` +
          `${row.academicYear}. The source's uniq_ntc_cpd_summary makes that impossible, so the ` +
          "source has lost its constraint — and a duplicated sex row would double this school's " +
          "whole NTC contribution with nothing in the output to signal it.",
      );
    summary.bySex[row.teacherSex] = row;
  }
  return { sourcePresent: true, bySchool };
}

function toSourceRow(r: Record<string, unknown>): NtcCpdSourceRow {
  const sex = String(r.teacher_sex);
  // VALIDATED, not coerced: an unexpected sex value must not silently become an ALL row or be folded
  // into one of the two real ones. The source's CHECK makes this unreachable in the demo; a live feed
  // has no such constraint, which is exactly why the boundary validates.
  if (!(NTC_SOURCE_SEXES as readonly string[]).includes(sex))
    throw new NtcCpdSourceError(
      `the NTC extract carries teacher_sex "${sex}" for ${String(r.emis_school_id)} — the seam ` +
        `accepts ${NTC_SOURCE_SEXES.join("|")} only, because 'ALL' is SYNTHESISED by the fact ` +
        "builder as MALE + FEMALE and must never be readable from a source.",
    );
  const int = (value: unknown, column: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0)
      throw new NtcCpdSourceError(
        `the NTC extract carries ${column} = ${String(value)} for ` +
          `${String(r.emis_school_id)} (${sex}) — every NTC count and point total must be a ` +
          "non-negative integer (points arrive as exact hundredths), and a negative CPD figure is " +
          "not a measurement.",
      );
    return n;
  };
  return {
    emisSchoolId: String(r.emis_school_id),
    academicYear: String(r.academic_year),
    teacherSex: sex as NtcSourceSex,
    specialisedHundredths: int(r.specialised_hundredths, "specialised_points"),
    recommendedHundredths: int(r.recommended_hundredths, "recommended_points"),
    ncpdHundredths: int(r.ncpd_hundredths, "ncpd_points"),
    mandatoryTeachers: int(r.mandatory_teachers, "mandatory_teachers"),
    specialisedTeachers: int(r.specialised_teachers, "specialised_teachers"),
    recommendedTeachers: int(r.recommended_teachers, "recommended_teachers"),
    teachersMeetingThreshold: int(r.teachers_meeting_threshold, "teachers_meeting_threshold"),
    cpdTargetHundredths: int(r.cpd_target_hundredths, "cpd_target_points"),
  };
}
