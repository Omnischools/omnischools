import { sql } from "drizzle-orm";
import { rowsOf, withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";
import { ok, unavailable, type Reading } from "./reading";
import {
  applySexedStaffSuppression,
  sexedStaffDisclosureDecision,
  suppressionCaveat,
  type Sex,
  type SexDenominators,
} from "./suppression";

/**
 * TEACHER CPD & PLC — the read behind the "Teacher CPD & PLC" panel (increment L).
 *
 * CPD-SURFACING-RULING.md (C1–C20) is binding; CPD-SURFACE-MAP.md §10 fixes the props. The shape of
 * this module is the `ptr.ts`/`fees.ts` one: a fail-soft `Reading<T>`, an explicit column allow-list,
 * `withJurisdiction()` with NO app-side jurisdiction `WHERE`, and nothing non-deterministic.
 *
 * ═══ TWO PERIOD CUTS, TWO DIFFERENT period_idS (schema; ETL lib/etl/plc.ts) ══════════════════════
 * `fact_plc_participation` carries BOTH cuts in one table, discriminated by the period it hangs off:
 *   TERM   rows: sessions_held / sessions_expected / attendance_events / attendance_expected /
 *          plc_participation_rate / teachers_in_plc (+ teacher_headcount, schools_running_plc_count).
 *   ANNUAL rows: cpd_points_* incl. the three NTC category totals and their teacher counts /
 *          teachers_meeting_cpd_threshold / annual_plc_target / ntc_cpd_target (+ the same two).
 * So this reader takes BOTH period ids and issues ONE scan per cut. Handing the TERM id to the annual
 * read (or vice versa) returns rows whose cut-specific columns are all NULL — which is why the two
 * parameters are named, and why the panel states the two vintages separately (C16).
 *
 * ═══ EVERY TIER FIGURE IS Σnumerator ÷ Σdenominator, RE-DERIVED — NEVER AN AVG OF CHILD RATES ════
 * `plc_participation_rate` and `cpd_points_mean` are STORED per school, and both are deliberately
 * OUT of the allow-list for the same reason `fact_staffing.ptr` is out of `ptr.ts`'s: the unweighted
 * mean of school rates weights a 40-teacher school the same as a 400-teacher one (C12/C13 ban (a),
 * AC-13). Counts are summed; rates and the mean are divided ONCE, here, after the sums. The one
 * exception is the per-school comparison behind "N of Y schools met their own PLC target", which is a
 * per-ROW predicate (never an aggregate) and is evaluated in SQL on the row that owns both numbers.
 *
 * ═══ THE DENOMINATORS ARE NOT INTERCHANGEABLE (C12/C14, AC-14) ═══════════════════════════════════
 *   cpd_points_mean      = Σcpd_points_total            ÷ Σcpd_points_teacher_count
 *   PLC coverage         = Σteachers_in_plc             ÷ Σteacher_headcount
 *   participation rate   = Σattendance_events           ÷ Σattendance_expected
 *   session coverage     = Σsessions_held               ÷ Σsessions_expected
 *   CPD-threshold rate   = Σteachers_meeting_threshold  ÷ Σteacher_headcount
 *   per-category cover   = Σcpd_<cat>_teacher_count     ÷ Σteacher_headcount
 * `cpd_points_teacher_count` counts only teachers who earned ANY points, so it is the mean's
 * denominator ONLY — using it for a coverage rate would drop every non-participant from both sides.
 *
 * ═══ sex='ALL' FOR TOTALS AND FOR EVERY SEX-INVARIANT COLUMN (AC-15) ═════════════════════════════
 * The ETL REPEATS the identical value on the MALE, FEMALE and ALL rows for `schools_running_plc_count`,
 * `sessions_held`, `sessions_expected`, `annual_plc_target` and `ntc_cpd_target`. Each scan therefore
 * GROUPs BY sex and this module reads those columns from the `ALL` group ONLY — summing them across
 * the MALE/FEMALE split returns EXACTLY 2× (a district with 12 PLC-running schools reporting 24, with
 * a derived session-coverage rate that still looks right because the doubling cancels). Nothing here
 * ever adds two sex groups together: the split is read for the PARITY frame and for nothing else.
 *
 * ═══ THE TWO TARGETS ARE NEVER SUMMED (C13, AC-16) ═══════════════════════════════════════════════
 * `ntc_cpd_target` is a national statutory constant and `annual_plc_target` a per-school scalar, so
 * both are read with `count(distinct …)` + `max(…)`: the value is surfaced only when the subtree
 * agrees on ONE value (the honest "stated threshold"), and is `null` otherwise. `annual_plc_target`
 * reaches the surface only as the COUNT of schools that met their own target — never as a quantity.
 *
 * ═══ NULL IS NEVER COALESCED TO 0 (C10/C11, AC-10/AC-11) ═════════════════════════════════════════
 * Every NTC-touching figure comes back as a discriminated `{status, value?}` — MEASURED / REAL_ZERO /
 * ABSENT / DEMO — built from a `sum(col)` BESIDE a `count(col)` of its non-null rows. `count(col) = 0`
 * is ABSENT ("we cannot see it"); a populated 0 is REAL_ZERO ("we measured none"). There is no
 * `coalesce(<ntc column>, 0)` anywhere in this file, and there must never be: a NULL threshold
 * coalesced to 0 reports every school in the country as 0% CPD-compliant.
 *
 * ═══ THE DEMO/LIVE/ABSENT SWITCH IS RESOLVED ONCE (C5, AC-6) ═════════════════════════════════════
 * `ntcProvenance` is resolved here, once, and propagated to every NTC-derived figure; the surface only
 * reads the stamp. Resolution order, from the merged ETL's contract:
 *   1. any ANNUAL row stamped `source = 'NTC_CPD_EXTRACT'`      → "LIVE"  (the future real feed)
 *   2. else any ANNUAL row with a NON-NULL NTC column           → "DEMO"  (the C5(ii) signature)
 *   3. else                                                     → "ABSENT" (live, no feed)
 * (2) is the C5(ii) table-level signature: the sourcing gate leaves Specialised / Recommended /
 * threshold NULL unless a source supplied them, so their non-nullness is only producible by the demo
 * stand-in today. (1) is the scaffolded switch — `ov_source` has no `NTC_CPD_EXTRACT` member yet
 * (E-CPD-2, a two-migration add that is out of scope here), so the comparison is on `source::text`
 * and the branch is inert until that increment lands. When it does, flipping the stamp to LIVE makes
 * every DEMO chip vanish and swaps the provenance prose, with no other change on any surface.
 *
 * ═══ SMALL-CELL SUPPRESSION — THIS IS `lib/oversight/suppression.ts`'s FIRST CONSUMER ════════════
 * The sexed parity figures are routed through `applySexedStaffSuppression`, with the decision computed
 * ONCE from the SCOPE-AGGREGATED sexed `teacher_headcount` denominators (the module's instruction: take
 * the denominators from the teacher headcount, not from the measure being displayed). Fail-closed on
 * NULL, complementary (either sex under 5 suppresses BOTH; the ALL figure is still published, because
 * publishing one sex beside the total states the other exactly as loudly).
 *
 * ═══ NO SUBTREE `WHERE`, AGGREGATE-ONLY, DETERMINISTIC ═══════════════════════════════════════════
 * RLS (`ov_in_subtree(jurisdiction_id)`) has already bounded the visible rows to the officer's subtree,
 * so Σ over what is visible IS the subtree total and an app-side jurisdiction filter would be a second
 * hand-written copy of the ceiling (the ptr.ts/enrolment.ts/fees.ts precedent, AC-23). The allow-list
 * carries NO teacher user id, name or per-teacher row — analytics holds aggregates only (AC-24). No
 * `now()`, no `random()`, and the table has a grain UNIQUE on (jurisdiction_id, period_id, sex), so a
 * re-read on byte-identical ETL output is byte-identical (AC-25).
 */

/** The four display states (C10/C11). `DEMO` is state 4 — a figure the NTC stand-in supplied. */
export type CpdStatus = "MEASURED" | "REAL_ZERO" | "ABSENT" | "DEMO";

/** Where the NTC-sourced half of the picture came from (C5). Resolved ONCE, propagated everywhere. */
export type NtcProvenance = "DEMO" | "LIVE" | "ABSENT";

/** A discriminated count/points figure. `value` is absent — not 0 — when `status` is ABSENT. */
export interface StatusValue {
  status: CpdStatus;
  value?: number;
}

/** A discriminated re-derived rate. `bySex` is present only on the SEXED metrics (C14). */
export interface StatusRate {
  status: CpdStatus;
  /**
   * Σnum ÷ Σden. Absent when the status is ABSENT.
   *
   * ⚠ NOT ALWAYS A 0..1 FRACTION. Four of the five rates here are fractions of a population (PLC
   * coverage, participation, the CPD-threshold rate, each category coverage), but `pointsMean` is
   * Σcpd_points_total ÷ Σcpd_points_teacher_count — POINTS PER TEACHER, so a 10.18 here is 10.18 pts
   * and NOT 1,018%. The unit is enforced at the component boundary (`CpdUnit` on `ParityRow` in
   * components/oversight/cpd-visuals.tsx, a required prop with no default); carrying the unit on this
   * type instead is deferred until the C17/C18 breakdown-column and comparison-row consumers exist,
   * which is when a second surface could disagree about it.
   */
  rate?: number;
  num?: number;
  den?: number;
  /** The parity split — omitted on sex-invariant metrics, and when suppression bites. */
  bySex?: { female: StatusRate; male: StatusRate };
}

export interface TeacherCpdPanel {
  /** C5 — one source of truth for the NTC half's provenance, propagated to every NTC figure. */
  ntcProvenance: NtcProvenance;

  // ── A · PLC participation (TERM cut) ───────────────────────────────────────────────────────────
  /** "N of Y schools run a PLC" — sex='ALL' only (the column is sex-invariant). Y = rows, N = Σ. */
  schoolsRunning: { count: number; schools: number };
  /** Σteachers_in_plc ÷ Σteacher_headcount. Sexed. */
  plcCoverage: StatusRate;
  /** Σattendance_events ÷ Σattendance_expected. Sexed. */
  participation: StatusRate;
  /** Σsessions_held ÷ Σsessions_expected. SEX-INVARIANT — no `bySex`, ever (AC-18). */
  sessionCoverage: StatusRate;

  // ── B · CPD points & national compliance (ANNUAL cut) ──────────────────────────────────────────
  /**
   * Σcpd_points_total ÷ Σcpd_points_teacher_count — the mean's own denominator (AC-14). Sexed.
   *
   * ⚠ `rate` here is POINTS PER TEACHER, not a 0..1 fraction — the one exception on this type (see
   * `StatusRate.rate`, and the `CpdUnit` guard the surface applies).
   */
  pointsMean: StatusRate;
  /** Σcpd_points_total — the all-category total in the demo, the PLC-only subtotal otherwise (C8). */
  pointsTotal: StatusValue;
  /**
   * C8's un-chipped "of which PLC-earned" subset.
   *
   * ⚠ FORK: in the DEMO state this is NOT derivable from the fact table. The merged ETL folds the
   * observed PLC floor INTO `cpd_points_mandatory_total` (mandatory = PLC floor + NCPD topup) and no
   * column carries the floor on its own, so the honest answer is ABSENT rather than a number this
   * reader would have to invent. In the live-no-feed state `cpd_points_total` IS the PLC-only
   * subtotal (the ETL's documented fallback), so the subset is that figure and is MEASURED.
   */
  plcEarnedPoints: StatusValue;
  mandatory: StatusValue;
  specialised: StatusValue;
  recommended: StatusValue;
  /** The three coverage rates OVERLAP and must never be summed or stacked (C12, AC-17). Sexed. */
  mandatoryCov: StatusRate;
  specialisedCov: StatusRate;
  recommendedCov: StatusRate;
  /** C11's showcase: DEMO | ABSENT | REAL_ZERO | MEASURED, never a coalesced 0. */
  threshold: StatusValue;
  /** Σteachers_meeting_cpd_threshold ÷ Σteacher_headcount (AC-14). Sexed. */
  thresholdRate: StatusRate;
  /** True only when all three categories are populated AND they sum to the total (C8/AC-9). */
  categoriesReconcile: boolean;
  /** The stated statutory threshold ("(20 pts)"). `null` when the subtree does not agree on one. */
  ntcCpdTarget: number | null;
  /** The schools' own PLC target, stated only when the subtree agrees on one value. Never summed. */
  annualPlcTarget: number | null;
  /** "N of Y schools met their own PLC target" — a COUNT (C12/C16), never a summed target. */
  plcTargetMet: { status: CpdStatus; count?: number; schools: number };

  // ── shared framing ────────────────────────────────────────────────────────────────────────────
  /** Σteacher_headcount at sex='ALL' on the ANNUAL cut — the shared on-roll denominator, stated. */
  headcount: number;
  /** Schools with an ANNUAL row in the subtree — the denominator of every B-section count. */
  annualSchools: number;
  /** Of those, how many the NTC source covers. Below `annualSchools` ⇒ a partial-coverage caption. */
  ntcSchools: number;
  /** True when the TERM cut was readable at all — sub-section A renders absences otherwise. */
  termAvailable: boolean;
  /** The suppression caveat when the sex split is withheld as a small cell; `null` when it is not. */
  suppressionCaveat: string | null;
}

/* ─────────────────────────────── row readers (no coalesce on an NTC column) ─────────────────────── */

/** A `bigint`/`numeric` aggregate literal → a finite number, or null for SQL NULL (= absence). */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A `count(...)` is NOT NULL by definition, so an unreadable one is a defect, not an absence. */
function count(value: unknown): number {
  return num(value) ?? 0;
}

/** One aggregate row, one sex. Keys mirror the SELECT's aliases. */
type AggRow = Record<string, unknown>;

/* ─────────────────────────────── the four display states ───────────────────────────────────────── */

/**
 * A PLC-OPERATIONAL rate. Never DEMO (C9: these are real-shape operational aggregates, un-chipped).
 * A missing or zero DENOMINATOR is ABSENT — a rate with no denominator is not 0% (the ETL's own rule:
 * a school that held no session has `attendance_expected = 0` and a NULL rate, while its session
 * coverage is a true 0%).
 */
function plcRate(numerator: number | null, denominator: number | null): StatusRate {
  if (numerator === null || denominator === null || denominator === 0)
    return { status: "ABSENT" };
  return {
    status: numerator === 0 ? "REAL_ZERO" : "MEASURED",
    rate: numerator / denominator,
    num: numerator,
    den: denominator,
  };
}

/** A PLC-OPERATIONAL count. ABSENT only when no row carried the column. */
function plcValue(total: number | null, nonNullRows: number): StatusValue {
  if (nonNullRows === 0 || total === null) return { status: "ABSENT" };
  return { status: total === 0 ? "REAL_ZERO" : "MEASURED", value: total };
}

/**
 * An NTC-DERIVED count/points figure. The provenance stamp decides the chip; `nonNullRows = 0` is the
 * sourcing-gate ABSENT and NEVER a 0 (C10 state 3 / C11). A populated 0 under a LIVE feed is REAL_ZERO
 * — "0 teachers met the national CPD requirement" — which must read differently from absence (C12).
 */
function ntcValue(
  total: number | null,
  nonNullRows: number,
  provenance: NtcProvenance,
): StatusValue {
  if (nonNullRows === 0 || total === null) return { status: "ABSENT" };
  if (provenance === "DEMO") return { status: "DEMO", value: total };
  return { status: total === 0 ? "REAL_ZERO" : "MEASURED", value: total };
}

/** The rate sibling of `ntcValue`. A missing/zero denominator is ABSENT, never 0%. */
function ntcRate(
  numerator: number | null,
  nonNullRows: number,
  denominator: number | null,
  provenance: NtcProvenance,
): StatusRate {
  if (nonNullRows === 0 || numerator === null) return { status: "ABSENT" };
  if (denominator === null || denominator === 0) return { status: "ABSENT" };
  const rate = numerator / denominator;
  if (provenance === "DEMO") return { status: "DEMO", rate, num: numerator, den: denominator };
  return {
    status: numerator === 0 ? "REAL_ZERO" : "MEASURED",
    rate,
    num: numerator,
    den: denominator,
  };
}

/* ─────────────────────────────── the sexed parity frame + suppression ──────────────────────────── */

/**
 * The per-sex measure bundle the suppression module blanks. Every key but `sex` is a measure, so
 * `applySexedStaffSuppression`'s suppress-by-default (`measureKeys` omitted) covers a key added later
 * without anyone remembering to list it.
 */
interface SexedMeasures {
  sex: Sex;
  [key: string]: unknown;
}

/** Numerator/denominator pair for one sexed metric, with its non-null row count for the status. */
interface Pair {
  num: number | null;
  rows: number;
  den: number | null;
}

/** Pull one sexed metric's pair out of a (possibly blanked) suppression row. */
function pairOf(row: SexedMeasures | undefined, key: string): Pair | null {
  if (!row || row.suppressed === true) return null;
  const value = row[key] as Pair | null | undefined;
  return value ?? null;
}

export async function getTeacherCpd(
  scope: JurisdictionScope,
  termPeriodId: string | null,
  annualPeriodId: string | null,
): Promise<Reading<TeacherCpdPanel>> {
  // There is no CPD panel without the ANNUAL cut to pin sub-section B; the TERM cut is optional (its
  // figures render as absences), exactly as the two vintages are stated separately on the surface.
  if (annualPeriodId === null) return unavailable<TeacherCpdPanel>();

  try {
    return await withJurisdiction(scope, async (tx) => {
      /**
       * THE ANNUAL CUT. Explicit column allow-list, GROUPED BY sex so the ALL row and the split come
       * from ONE scan (C19: the panel's figures, any breakdown total row and any comparison benchmark
       * are the same sums). Every NTC column is read as `sum(col)` BESIDE `count(col)` — the pair that
       * lets the status distinguish "we measured 0" from "we cannot see it" without a coalesce.
       *
       * `cpd_points_mean` and `plc_participation_rate` are NOT selected: a tier figure is re-derived
       * from the summed inputs, never averaged from stored per-school rates (AC-13).
       */
      const annualResult = await tx.execute(sql`
        select fpp.sex::text                                            as sex,
               count(distinct fpp.jurisdiction_id)::int                 as schools,
               sum(fpp.schools_running_plc_count)::bigint               as schools_running,
               sum(fpp.teacher_headcount)::bigint                       as headcount,
               count(fpp.teacher_headcount)::int                        as headcount_rows,
               sum(fpp.cpd_points_total)::numeric                       as points_total,
               count(fpp.cpd_points_total)::int                         as points_total_rows,
               sum(fpp.cpd_points_teacher_count)::bigint                as points_teachers,
               sum(fpp.cpd_points_mandatory_total)::numeric             as mandatory,
               count(fpp.cpd_points_mandatory_total)::int               as mandatory_rows,
               sum(fpp.cpd_points_specialised_total)::numeric           as specialised,
               count(fpp.cpd_points_specialised_total)::int             as specialised_rows,
               sum(fpp.cpd_points_recommended_total)::numeric           as recommended,
               count(fpp.cpd_points_recommended_total)::int             as recommended_rows,
               sum(fpp.cpd_mandatory_teacher_count)::bigint             as mandatory_teachers,
               count(fpp.cpd_mandatory_teacher_count)::int              as mandatory_teachers_rows,
               sum(fpp.cpd_specialised_teacher_count)::bigint           as specialised_teachers,
               count(fpp.cpd_specialised_teacher_count)::int            as specialised_teachers_rows,
               sum(fpp.cpd_recommended_teacher_count)::bigint           as recommended_teachers,
               count(fpp.cpd_recommended_teacher_count)::int            as recommended_teachers_rows,
               sum(fpp.teachers_meeting_cpd_threshold)::bigint          as threshold,
               count(fpp.teachers_meeting_cpd_threshold)::int           as threshold_rows,
               -- ⚠ THE TWO TARGETS ARE COMPARED, NEVER SUMMED (C13/AC-16): the distinct count says
               -- whether the subtree agrees on one value, and max() names it. No sum of a target
               -- appears anywhere in this module.
               count(distinct fpp.ntc_cpd_target)::int                  as ntc_target_values,
               max(fpp.ntc_cpd_target)::numeric                         as ntc_target,
               count(distinct fpp.annual_plc_target)::int               as plc_target_values,
               max(fpp.annual_plc_target)::numeric                      as plc_target,
               -- "N of Y schools met their own PLC target" — a PER-ROW predicate on the row that owns
               -- both numbers (never an aggregate comparison, never a summed target).
               count(*) filter (
                 where fpp.annual_plc_target is not null
                   and fpp.cpd_points_mean is not null
               )::int                                                   as plc_target_schools,
               count(*) filter (
                 where fpp.annual_plc_target is not null
                   and fpp.cpd_points_mean is not null
                   and fpp.cpd_points_mean >= fpp.annual_plc_target
               )::int                                                   as plc_target_met,
               -- C5(ii) THE DEMO SIGNATURE: an OPERATIONAL_AGG row whose NTC columns are non-null.
               count(*) filter (
                 where fpp.cpd_points_specialised_total is not null
                    or fpp.cpd_points_recommended_total is not null
                    or fpp.teachers_meeting_cpd_threshold is not null
               )::int                                                   as ntc_rows,
               -- C5(i) THE SCAFFOLDED LIVE SWITCH. ov_source has no NTC_CPD_EXTRACT member yet
               -- (E-CPD-2), so this compares the TEXT and is inert until that increment adds it.
               count(*) filter (where fpp.source::text = 'NTC_CPD_EXTRACT')::int as ntc_extract_rows
          from fact_plc_participation fpp
         where fpp.period_id = ${annualPeriodId}::uuid
           and fpp.sex::text in ('ALL', 'MALE', 'FEMALE')
         group by fpp.sex
      `);

      const annualBySex = new Map<string, AggRow>();
      for (const row of rowsOf(annualResult)) annualBySex.set(String(row.sex), row);
      const annualAll = annualBySex.get("ALL");

      /**
       * THE TERM CUT — the same discipline on the other period id. `sessions_held` /
       * `sessions_expected` are SEX-INVARIANT, so they are read from the ALL group only (summing them
       * across the split returns 2×); `teachers_in_plc` / `attendance_*` / `teacher_headcount` are
       * genuinely sexed and split honestly.
       */
      const termResult =
        termPeriodId === null
          ? null
          : await tx.execute(sql`
              select fpp.sex::text                                  as sex,
                     count(distinct fpp.jurisdiction_id)::int       as schools,
                     sum(fpp.schools_running_plc_count)::bigint     as schools_running,
                     sum(fpp.teacher_headcount)::bigint             as headcount,
                     count(fpp.teacher_headcount)::int              as headcount_rows,
                     sum(fpp.sessions_held)::bigint                 as sessions_held,
                     sum(fpp.sessions_expected)::bigint             as sessions_expected,
                     sum(fpp.attendance_events)::bigint             as attendance_events,
                     count(fpp.attendance_events)::int              as attendance_events_rows,
                     sum(fpp.attendance_expected)::bigint           as attendance_expected,
                     sum(fpp.teachers_in_plc)::bigint               as teachers_in_plc,
                     count(fpp.teachers_in_plc)::int                as teachers_in_plc_rows
                from fact_plc_participation fpp
               where fpp.period_id = ${termPeriodId}::uuid
                 and fpp.sex::text in ('ALL', 'MALE', 'FEMALE')
               group by fpp.sex
            `);

      const termBySex = new Map<string, AggRow>();
      if (termResult !== null)
        for (const row of rowsOf(termResult)) termBySex.set(String(row.sex), row);
      const termAll = termBySex.get("ALL");

      // Neither cut has a row the officer can see → nothing to state. `unavailable`, not an empty
      // panel of zeroes (the `Reading` precedent: the surface shows its own fail-soft note).
      if (annualAll === undefined && termAll === undefined) return unavailable<TeacherCpdPanel>();

      /* ── C5: the ONE provenance resolution, propagated from here on ─────────────────────────── */
      const ntcExtractRows = count(annualAll?.ntc_extract_rows);
      const ntcRows = count(annualAll?.ntc_rows);
      const ntcProvenance: NtcProvenance =
        ntcExtractRows > 0 ? "LIVE" : ntcRows > 0 ? "DEMO" : "ABSENT";

      /* ── small-cell suppression, decided ONCE from the sexed teacher_headcount denominators ──── */
      // The denominators are the SCOPE-AGGREGATED sexed headcounts (Σ over the subtree's school rows),
      // taken from the ANNUAL cut where it is readable and from the TERM cut otherwise — the two are
      // the same pinned roll by ETL construction, and `suppression.ts`'s "one disclosure surface" rule
      // requires ONE decision for both sub-sections. A NULL denominator fails CLOSED inside the module.
      const headcountFor = (sex: string): number | null => {
        const annual = annualBySex.get(sex);
        const fromAnnual = annual && count(annual.headcount_rows) > 0 ? num(annual.headcount) : null;
        if (fromAnnual !== null) return fromAnnual;
        const term = termBySex.get(sex);
        return term && count(term.headcount_rows) > 0 ? num(term.headcount) : null;
      };
      const denominators: SexDenominators = {
        MALE: headcountFor("MALE"),
        FEMALE: headcountFor("FEMALE"),
        ALL: headcountFor("ALL"),
      };
      const decision = sexedStaffDisclosureDecision(denominators);

      /**
       * The sexed metrics, as rows the suppression module can blank. Pairs rather than rates, so a
       * suppressed cell loses the INPUTS too (a published numerator beside a published total is the
       * complement the rule exists to withhold).
       */
      const sexedRows: SexedMeasures[] = (["MALE", "FEMALE"] as const).map((sex) => {
        const a = annualBySex.get(sex);
        const t = termBySex.get(sex);
        const den = headcountFor(sex);
        return {
          sex,
          plcCoverage: {
            num: t ? num(t.teachers_in_plc) : null,
            rows: t ? count(t.teachers_in_plc_rows) : 0,
            den,
          } satisfies Pair,
          participation: {
            num: t ? num(t.attendance_events) : null,
            rows: t ? count(t.attendance_events_rows) : 0,
            den: t ? num(t.attendance_expected) : null,
          } satisfies Pair,
          pointsMean: {
            num: a ? num(a.points_total) : null,
            rows: a ? count(a.points_total_rows) : 0,
            den: a ? num(a.points_teachers) : null,
          } satisfies Pair,
          thresholdRate: {
            num: a ? num(a.threshold) : null,
            rows: a ? count(a.threshold_rows) : 0,
            den,
          } satisfies Pair,
          mandatoryCov: {
            num: a ? num(a.mandatory_teachers) : null,
            rows: a ? count(a.mandatory_teachers_rows) : 0,
            den,
          } satisfies Pair,
          specialisedCov: {
            num: a ? num(a.specialised_teachers) : null,
            rows: a ? count(a.specialised_teachers_rows) : 0,
            den,
          } satisfies Pair,
          recommendedCov: {
            num: a ? num(a.recommended_teachers) : null,
            rows: a ? count(a.recommended_teachers_rows) : 0,
            den,
          } satisfies Pair,
        };
      });
      const suppressed = applySexedStaffSuppression(sexedRows, decision);
      const maleRow = suppressed.find((r) => r.sex === "MALE");
      const femaleRow = suppressed.find((r) => r.sex === "FEMALE");

      /** Attach the parity split to a tier rate, unless suppression withheld it (C14 + suppression). */
      const withParity = (
        parent: StatusRate,
        key: string,
        build: (pair: Pair) => StatusRate,
      ): StatusRate => {
        const female = pairOf(femaleRow, key);
        const male = pairOf(maleRow, key);
        if (female === null || male === null) return parent;
        return { ...parent, bySex: { female: build(female), male: build(male) } };
      };

      /* ── A · the TERM cut ───────────────────────────────────────────────────────────────────── */
      // sex='ALL' ONLY for the sex-invariant columns (AC-15). `schools` is the Y of "N of Y schools".
      const schoolsRunning = {
        count: termAll
          ? count(termAll.schools_running)
          : count(annualAll?.schools_running),
        schools: termAll ? count(termAll.schools) : count(annualAll?.schools),
      };
      const termHeadcount = termAll ? num(termAll.headcount) : null;
      const plcCoverage = withParity(
        plcRate(termAll ? num(termAll.teachers_in_plc) : null, termHeadcount),
        "plcCoverage",
        (p) => plcRate(p.num, p.den),
      );
      const participation = withParity(
        plcRate(
          termAll ? num(termAll.attendance_events) : null,
          termAll ? num(termAll.attendance_expected) : null,
        ),
        "participation",
        (p) => plcRate(p.num, p.den),
      );
      // SEX-INVARIANT — no `bySex`, by construction and not by omission (AC-18).
      const sessionCoverage = plcRate(
        termAll ? num(termAll.sessions_held) : null,
        termAll ? num(termAll.sessions_expected) : null,
      );

      /* ── B · the ANNUAL cut ─────────────────────────────────────────────────────────────────── */
      const headcount = annualAll ? (num(annualAll.headcount) ?? 0) : 0;
      const pointsTotalSum = annualAll ? num(annualAll.points_total) : null;
      const pointsTotalRows = count(annualAll?.points_total_rows);
      const pointsMean = withParity(
        ntcRate(
          pointsTotalSum,
          pointsTotalRows,
          annualAll ? num(annualAll.points_teachers) : null,
          ntcProvenance,
        ),
        "pointsMean",
        (p) => ntcRate(p.num, p.rows, p.den, ntcProvenance),
      );
      const thresholdRate = withParity(
        ntcRate(
          annualAll ? num(annualAll.threshold) : null,
          count(annualAll?.threshold_rows),
          headcount === 0 ? null : headcount,
          ntcProvenance,
        ),
        "thresholdRate",
        (p) => ntcRate(p.num, p.rows, p.den, ntcProvenance),
      );
      const covRate = (key: string, sumKey: string, rowsKey: string): StatusRate =>
        withParity(
          ntcRate(
            annualAll ? num(annualAll[sumKey]) : null,
            count(annualAll?.[rowsKey]),
            headcount === 0 ? null : headcount,
            ntcProvenance,
          ),
          key,
          (p) => ntcRate(p.num, p.rows, p.den, ntcProvenance),
        );

      const mandatorySum = annualAll ? num(annualAll.mandatory) : null;
      const specialisedSum = annualAll ? num(annualAll.specialised) : null;
      const recommendedSum = annualAll ? num(annualAll.recommended) : null;
      const mandatory = ntcValue(mandatorySum, count(annualAll?.mandatory_rows), ntcProvenance);
      const specialised = ntcValue(
        specialisedSum,
        count(annualAll?.specialised_rows),
        ntcProvenance,
      );
      const recommended = ntcValue(
        recommendedSum,
        count(annualAll?.recommended_rows),
        ntcProvenance,
      );
      // C8/AC-9: the reconciliation is checked ONLY when all three categories are populated. In the
      // live-no-feed state it is not asserted at all and the caption is omitted.
      const categoriesReconcile =
        specialised.status !== "ABSENT" &&
        recommended.status !== "ABSENT" &&
        mandatory.status !== "ABSENT" &&
        pointsTotalSum !== null &&
        mandatorySum !== null &&
        specialisedSum !== null &&
        recommendedSum !== null &&
        Math.abs(mandatorySum + specialisedSum + recommendedSum - pointsTotalSum) < 0.01;

      /**
       * ⚠ THE C8 CONDITION IS "ARE THE CATEGORIES POPULATED", NOT "IS THE STAMP DEMO" (Dex B1).
       *
       * Two figures below are honest ONLY while `cpd_points_total` is the PLC-ONLY subtotal — i.e.
       * while the NTC categories are ABSENT, which is exactly the state the schema's sourcing gate
       * produces. The moment the categories ARE populated, the total is the ALL-CATEGORY figure and
       * neither can be stated — and that is true of a real LIVE feed exactly as it is of the demo
       * stand-in. Branching on `ntcProvenance === "DEMO"` would bucket LIVE with the no-feed state and
       * publish a false, un-chipped figure the day the real feed lands, which would also falsify this
       * slice's own C5/AC-6 claim that flipping to LIVE changes nothing else on the surface. So the
       * branch is on the DISCRIMINATED CATEGORY STATUS the reader already computed, never on the stamp.
       */
      const categoriesAbsent =
        specialised.status === "ABSENT" && recommended.status === "ABSENT";

      // The two target SCALARS: stated only when the subtree agrees on one value. NEVER summed.
      const singleTarget = (valuesKey: string, valueKey: string): number | null => {
        if (annualAll === undefined) return null;
        return count(annualAll[valuesKey]) === 1 ? num(annualAll[valueKey]) : null;
      };

      /**
       * B4 — "N of Y schools met their own PLC target", a COUNT.
       *
       * ⚠ FORK: withheld (ABSENT) WHENEVER THE CATEGORIES ARE POPULATED — demo or live alike. The
       * per-school comparison available in the fact table is `cpd_points_mean >= annual_plc_target`,
       * and once the categories are populated `cpd_points_mean` is the ALL-CATEGORY mean (C8) while
       * `annual_plc_target` is a PLC-ONLY target — the schema is explicit that the two are not
       * comparable ("8 PLC points is not 8/20ths of compliance"). Publishing the count anyway would be
       * exactly the substitution C13 forbids, and that reasoning holds identically under a real NTC
       * feed. Only in the categories-absent state are the total/mean the PLC-only subtotal, and only
       * there is the count honest. (The figure returns for good when the ETL exposes the PLC-earned
       * points as their own column — see `plcEarnedPoints`.)
       */
      const plcTargetSchools = count(annualAll?.plc_target_schools);
      const plcTargetMetCount = count(annualAll?.plc_target_met);
      const plcTargetMet: TeacherCpdPanel["plcTargetMet"] =
        !categoriesAbsent || plcTargetSchools === 0
          ? { status: "ABSENT", schools: plcTargetSchools }
          : {
              status: plcTargetMetCount === 0 ? "REAL_ZERO" : "MEASURED",
              count: plcTargetMetCount,
              schools: plcTargetSchools,
            };

      return ok({
        ntcProvenance,
        schoolsRunning,
        plcCoverage,
        participation,
        sessionCoverage,
        pointsMean,
        pointsTotal: ntcValue(pointsTotalSum, pointsTotalRows, ntcProvenance),
        /**
         * C8's real subset. Published ONLY while the categories are absent, because only then is
         * `cpd_points_total` the PLC-only subtotal (see `categoriesAbsent` above). With the categories
         * populated — demo stand-in or real NTC feed — the total is the all-category figure and the
         * PLC floor is not separable from it, so the honest answer is ABSENT rather than the total
         * relabelled as "PLC-earned".
         */
        plcEarnedPoints: categoriesAbsent
          ? plcValue(pointsTotalSum, pointsTotalRows)
          : { status: "ABSENT" },
        mandatory,
        specialised,
        recommended,
        mandatoryCov: covRate("mandatoryCov", "mandatory_teachers", "mandatory_teachers_rows"),
        specialisedCov: covRate(
          "specialisedCov",
          "specialised_teachers",
          "specialised_teachers_rows",
        ),
        recommendedCov: covRate(
          "recommendedCov",
          "recommended_teachers",
          "recommended_teachers_rows",
        ),
        threshold: ntcValue(
          annualAll ? num(annualAll.threshold) : null,
          count(annualAll?.threshold_rows),
          ntcProvenance,
        ),
        thresholdRate,
        categoriesReconcile,
        ntcCpdTarget: singleTarget("ntc_target_values", "ntc_target"),
        annualPlcTarget: singleTarget("plc_target_values", "plc_target"),
        plcTargetMet,
        headcount,
        annualSchools: count(annualAll?.schools),
        ntcSchools: ntcRows,
        termAvailable: termAll !== undefined,
        suppressionCaveat: suppressionCaveat(decision),
      });
    });
  } catch {
    // Fail-soft in the lib (the `Reading` precedent): the panel degrades to its own note, the page —
    // KPI strip, breakdown section, fees section — stands (AC-20).
    return unavailable<TeacherCpdPanel>();
  }
}
