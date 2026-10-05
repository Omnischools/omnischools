import type postgres from "postgres";
import type { FactEnrolmentRow } from "./enrolment";
import type { RegisterOwnership, RegisterSchoolType } from "./register";
import { ANALYTICS_STAGES, type AnalyticsStage } from "./stage";
import { stampProvenance, type Provenance } from "./run";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `fact_enrolment` (in memory) → `fact_staffing` — THE SIXTH ARM: PTR, ESTABLISHMENT, VACANCIES.
 *
 * Kofi's `STAFFING-PTR-DOMAIN-RULING.md` is the DOMAIN authority for every number below; Wells's
 * `STAFFING-ETL-PLAN.md` is the BUILD mechanics. Where the two disagree the ruling wins, and the
 * three places it does are marked ⚠KOFI in the code.
 *
 * ── THE GRAIN IS ANNUAL, ONE ROW PER SCHOOL × ACADEMIC YEAR (ruling §1) ─────────────────────────
 * Staffing is a STOCK — the teachers on a school's roll are the same people across the three terms of
 * a year — so it files against the SAME `dim_period` ANNUAL row (`term IS NULL`,
 * `period_type = 'ANNUAL'`) that `fact_enrolment` and `fact_infrastructure` write against. It is
 * summed SPATIALLY (across schools) and NEVER across periods: adding two academic years'
 * `teachers_on_roll` invents staff. The period is not looked up here at all — step 5a of
 * `lib/etl/pipeline.ts` already holds the ANNUAL `periodId` it upserted in step 2, and this arm reuses
 * it. In particular it must never resolve `dim_period.is_current` without also pinning `period_type`:
 * `is_current` can be true on BOTH the TERM and the ANNUAL row of one academic year.
 *
 * ── THE ENROLMENT PIN IS STRUCTURAL, NOT A RECONCILIATION (ruling §5, plan §2.2 Option A) ────────
 * `enrolment_total` IS the enrolment arm's own published figure, taken from the SAME in-memory
 * `FactEnrolmentRow[]` the same transaction is about to write:
 *       Σ headcount WHERE sex = 'ALL' AND class_form IS NULL, over all stages
 * BOTH filters are mandatory and neither is optional-by-accident here: dropping `sex = 'ALL'` TRIPLES
 * the figure (the ALL row is stored IN ADDITION to MALE/FEMALE) and dropping `class_form IS NULL`
 * roughly DOUBLES it (a null `class_form` IS the stage total, with per-form rows beside it). Deriving
 * from the enrolment arm's rows rather than from a second source makes the pin ONE NUMBER rather than
 * two numbers and a hope — PTR cannot quietly divide a different roll than the enrolment panel shows.
 * Out-of-scope (below-KG) and unmapped children are NOT in it, because they are not in a stage total
 * and therefore not in the figure `fact_enrolment` publishes.
 *
 * A school whose reconciled roll is ZERO emits NO ROW (ruling §5/§6): there is no ratio to compute and
 * a stored `0.00` ptr would be a false measurement where the honest answer is absence. Such a school
 * is also OUT of the delete scope, so it keeps whatever it had — stale-but-honest, as everywhere else.
 *
 * ── GENERATION ORDER (ruling §3). DERIVED, NOT DRAWN, IN THIS ORDER ──────────────────────────────
 *   1  enrolment_total            ← the pin. Not generated.
 *   2  target PTR                 ← drawn from the ruling's per-level bands, right-skewed, with
 *                                   Ghana's real north/south + urban/rural gradient applied.
 *   3  teachers_on_roll           ← max(1, round(enrolment_total ÷ target PTR)). DERIVED, never drawn,
 *                                   which is what lands `ptr` inside the band BY CONSTRUCTION.
 *   4  teaching_posts_established ← the real `ref_ges_teacher_establishment` current vintage when the
 *                                   school has one, else generated. NULL for PRIVATE/MISSION.
 *   5  vacancies                  ← established − teachers_on_roll, SIGNED. NULL iff established NULL.
 *   6  ptr                        ← RE-DERIVED from the two STORED integers, never carried from (2).
 * Step 6 is the whole point of the ordering: the target was an intention, `teachers_on_roll` was
 * rounded to an integer, so storing the target would publish a row whose stated rate does not equal
 * its own numerator ÷ denominator.
 *
 * Every draw comes from the demo's own deterministic mulberry32 seeded from a PER-SCHOOL stable seed
 * (`staffingSeed`), never `Math.random()`: the same school gets the same figures on every run and on
 * every machine, which is what makes "a re-run is byte-identical except etl_run_id" a testable claim
 * rather than an aspiration.
 *
 * ── WHAT THIS TABLE DOES NOT HAVE, AND MUST NEVER GROW ──────────────────────────────────────────
 * NO `sex` COLUMN. `fact_staffing` is not sexed (schema `db/schema/fact.ts`), so the sexed-staff
 * small-cell helper in `lib/oversight/suppression.ts` does NOT apply to it (ruling §7 — it is defined
 * for `fact_teacher_attendance` and `fact_plc_participation` only) and this transform never writes
 * one. A sexed teacher breakdown on a two-teacher school is a disclosure vector; a count of teachers
 * is a school attribute. `teachers_on_roll` is A COUNT OF TEACHERS, NEVER A TEACHER — the named-staff
 * path is the separate gated read-back and nothing here imports it.
 *
 * ── ⚠ THE READ RULE, stated here because the stored column is the loaded gun (ruling §6) ─────────
 *       Any PTR above a single school is Σ enrolment_total ÷ Σ teachers_on_roll. NEVER avg(ptr).
 * `avg(ptr)` weights a 40-pupil one-teacher school equally with a 1,200-pupil school and produces a
 * number that is plausible, stable and wrong, with nothing in the output signalling it. The stored
 * `ptr` is for the SINGLE-SCHOOL no-math card only; the structural form of the rule is to keep `ptr`
 * OUT of every roll-up/tier/breakdown column allow-list (`lib/oversight/performance.ts`'s
 * `qualification_rate` is the precedent). Corollary for the establishment figures: `Σ vacancies` and
 * `Σ teaching_posts_established` are summed ONLY over rows where `teaching_posts_established IS NOT
 * NULL`, and the reader must state that denominator — mixing a NULL establishment into the sum would
 * understate the district establishment.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Raised for a school this ETL refuses to produce a staffing row for. Isolated by `computePerSchool`. */
export class StaffingTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffingTransformError";
  }
}

/** One `fact_staffing` row, ready to insert. Column-for-column with `db/schema/fact.ts`. */
export interface FactStaffingRow {
  jurisdictionId: string;
  periodId: string;
  teachersOnRoll: number;
  /** GES-AUTHORISED POSTS, not a count of people. NULL for PRIVATE/MISSION — see `SCHOOL_LEVEL_BANDS`. */
  teachingPostsEstablished: number | null;
  /** The PIN — `fact_enrolment`'s own published roll for this school and period. */
  enrolmentTotal: number;
  /** `numeric(5,2)` as a STRING, re-derived from the two integers above. Never a float. */
  ptr: string;
  /** SIGNED: negative = surplus (over establishment). NULL iff `teachingPostsEstablished` is NULL. */
  vacancies: number | null;
  source: Provenance["source"];
  asOfDate: string;
  etlRunId: string;
}

/** One school's staffing outcome. `row` is null for the legitimate zero-roll case (ruling §5). */
export interface SchoolStaffingResult {
  jurisdictionId: string;
  emisSchoolId: string;
  /** The pinned roll. Reported even when it is 0 and there is therefore no row. */
  enrolmentTotal: number;
  /** The stage whose band was used — the school's pupil-weighted dominant stage. Null when no row. */
  bandStage: AnalyticsStage | null;
  row: FactStaffingRow | null;
}

// ── the pin ─────────────────────────────────────────────────────────────────────────────────────

/**
 * THE PIN (ruling §5). Σ headcount over `sex = 'ALL' AND class_form IS NULL`, across every stage.
 *
 * Both predicates are expressed HERE, in the one place they cannot be forgotten by a later query
 * author, and both are load-bearing: without the sex filter the figure is ~3× too big, without the
 * class_form filter ~2×, and both wrong figures stay internally consistent at every tier.
 */
export function pinnedEnrolmentTotal(
  rows: readonly FactEnrolmentRow[],
  emisSchoolId: string,
): number {
  let total = 0;
  for (const row of rows) {
    if (!Number.isInteger(row.headcount) || row.headcount < 0)
      throw new StaffingTransformError(
        `${emisSchoolId}: fact_enrolment headcount ${String(row.headcount)} on (${row.stage}, ` +
          `${row.classForm ?? "stage total"}, ${row.sex}) is not a non-negative integer, so the PTR ` +
          "denominator cannot be pinned to it.",
      );
    if (row.sex === "ALL" && row.classForm === null) total += row.headcount;
  }
  return total;
}

/**
 * The school's PUPIL-WEIGHTED DOMINANT stage — the stage carrying the most children on its own stage
 * total. This is the "school level" the ruling's §3 band table is indexed by.
 *
 * ⚠ DELIBERATE DEPARTURE FROM THE PLAN'S INTERIM DEFAULT (plan §3.2 step 2 proposed the HIGHEST stage,
 * with "or a headcount-weighted blend — Kofi to confirm"). The ruling's table resolves it: its PRIMARY
 * row is labelled "PRIMARY (incl. COMBINED basic)", i.e. a combined BASIC school is a PRIMARY-band
 * school, and AC 8 asks for the PUPIL-WEIGHTED mean per level to sit in band. Highest-stage would file
 * a 900-pupil primary school with one 30-pupil JHS stream under the JHS band (12–25) and drag the
 * primary estate's weighted mean out of its own band. Ties break by `ANALYTICS_STAGES` order, so the
 * choice is deterministic.
 */
export function dominantStage(
  rows: readonly FactEnrolmentRow[],
): AnalyticsStage | null {
  let best: AnalyticsStage | null = null;
  let bestCount = -1;
  for (const stage of ANALYTICS_STAGES) {
    const count = rows
      .filter((r) => r.stage === stage && r.sex === "ALL" && r.classForm === null)
      .reduce((t, r) => t + r.headcount, 0);
    if (count > bestCount) {
      best = stage;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : null;
}

// ── the ruled bands and the gradient ────────────────────────────────────────────────────────────

/**
 * ⚠KOFI (ruling §3) — THE DEMO PTR BANDS, by school level. These REPLACE the plan's §0 interim
 * defaults (`KG/PRIMARY [18,42]`, `JHS [14,32]`, `SHS [12,28]`), which were written before the ruling
 * landed.
 *
 * ⚠ THESE ARE PLAUSIBILITY WEIGHTS FOR DEMO DATA, NOT MEASUREMENTS — the same posture
 * `db/seed/demo/ghana.ts` takes about `urbanisation`. They must not be cited as a figure about Ghana.
 * They exist so a dashboard built on dummy data shows the KIND of variation the real EMIS data shows
 * (and so the seeded `PTR-ESC-30` anomaly rule has real material above 30 to fire on), rather than
 * uniform noise clamped to one credible-looking number.
 *
 * GES norms for reference: KG ~1:30, PRIMARY 1:35 (FCUBE), JHS ~1:25, SHS ~1:25.
 */
export const SCHOOL_LEVEL_BANDS: Record<AnalyticsStage, { lo: number; hi: number }> = {
  KG: { lo: 22, hi: 45 },
  // PRIMARY carries COMBINED-basic too (see `dominantStage`). National mean ≈ 38.
  PRIMARY: { lo: 25, hi: 55 },
  // Lower, because JHS teaching is subject-based and a small school still needs a teacher per subject.
  JHS: { lo: 12, hi: 25 },
  // Milder gradient; Free SHS crowding pushes a few to the top of the band.
  SHS: { lo: 15, hi: 28 },
};

/**
 * The five northern/newer regions whose PTR and PTTR genuinely run far above the south's (ruling §3,
 * §9 and the GES EMIS gradient). REGION NAMES, exactly as `ref_emis_school_register.region` /
 * `db/seed/demo/ghana.ts` spell them.
 */
export const NORTHERN_REGIONS: readonly string[] = [
  "Northern",
  "North East",
  "Savannah",
  "Upper East",
  "Upper West",
];

/** The two regions whose basic PTR sits at the bottom of the national distribution (ruling §3). */
export const SOUTHERN_METRO_REGIONS: readonly string[] = ["Greater Accra", "Ashanti"];

/**
 * URBAN-NESS, derived from the MMDA CLASS IN THE DISTRICT'S OWN NAME — the one urban/rural signal the
 * ETL can actually see.
 *
 * The generator's per-school `urban` flag is generator-internal and is NOT in the register (see
 * `DemoSchool.urban` in `scripts/seed-demo-data.ts`: "Not part of the register"), so the arm cannot
 * read it without inventing a column. The district name carries the same driver the generator itself
 * used — `mmdaUrbanShare()` in `db/seed/demo/ghana.ts` reads exactly this classification — so the
 * gradient this produces points the same way as the facilities gradient already on the dashboards.
 * A demo proxy, stated as one.
 */
export function mmdaUrbanWeight(districtName: string): number {
  if (/Metropolitan/i.test(districtName)) return 1;
  if (/Municipal/i.test(districtName)) return 0.45;
  return 0;
}

/**
 * Where in its band this school's target PTR sits, in [0, 1]. Three independent drivers, all of them
 * things a regional roll-up is FOR:
 *
 *  · RIGHT SKEW (`u ** SKEW`) — most schools sit below the band midpoint with a tail reaching the top,
 *    which is the shape of the real distribution and the reason an above-30 PRIMARY tail exists at all.
 *    A symmetric draw would centre the primary estate on 40 and make the weighted mean miss the ruled
 *    35–40 window from above.
 *  · THE NORTH/SOUTH GRADIENT — northern regions up, Greater Accra/Ashanti down, so a regional ranking
 *    is RECOGNISABLE (the first thing MoE/GES sanity-check). Direction matches GES EMIS; magnitude is
 *    a plausibility weight.
 *  · URBAN/RURAL — metros down, ordinary district assemblies up, on top of the region.
 */
const SKEW = 1.6;
const NORTH_SHIFT = 0.22;
const SOUTH_METRO_SHIFT = -0.15;
const URBAN_SHIFT = -0.08;
const RURAL_SHIFT = 0.05;

export function bandPosition(
  draw: number,
  regionName: string,
  districtName: string,
): number {
  const urban = mmdaUrbanWeight(districtName);
  const region = NORTHERN_REGIONS.includes(regionName)
    ? NORTH_SHIFT
    : SOUTHERN_METRO_REGIONS.includes(regionName)
      ? SOUTH_METRO_SHIFT
      : 0;
  const settlement = urban * URBAN_SHIFT + (1 - urban) * RURAL_SHIFT;
  const p = draw ** SKEW + region + settlement;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * How the GENERATED establishment sits against the actual roll — and therefore the SIGN of
 * `vacancies`.
 *
 * ⚠KOFI (ruling §4, ACs 10/12). The plan's `round(teachers_on_roll × (1 + 0..20%))` can only ever
 * produce establishment ≥ roll, i.e. `vacancies ≥ 0` — which, with the plan's `max(0, …)` floor,
 * would erase the SURPLUS half of Ghana's real distribution entirely. The ruling requires both signs
 * and ties them to the same gradient as PTR: SHORTAGE (positive vacancies) in the rural north,
 * SURPLUS (negative vacancies — teachers over establishment) in the urban south. So the multiplier's
 * window SLIDES with `surplusTilt`: an urban Greater Accra school draws from [0.85, 1.00] and is
 * usually over establishment; a rural Savannah school draws from [1.00, 1.20] and is usually under it.
 */
const SURPLUS_FLOOR = 0.15;
const SHORTAGE_CEILING = 0.2;

export function establishmentFactor(
  draw: number,
  regionName: string,
  districtName: string,
): number {
  const urban = mmdaUrbanWeight(districtName);
  const north = NORTHERN_REGIONS.includes(regionName);
  const southMetro = SOUTHERN_METRO_REGIONS.includes(regionName);
  const tiltRaw = urban * 0.6 + (southMetro ? 0.4 : 0) - (north ? 0.5 : 0);
  const tilt = tiltRaw < 0 ? 0 : tiltRaw > 1 ? 1 : tiltRaw;
  const lo = 1 - SURPLUS_FLOOR * tilt;
  const hi = 1 + SHORTAGE_CEILING * (1 - tilt);
  return lo + draw * (hi - lo);
}

// ── the deterministic generator ─────────────────────────────────────────────────────────────────

/**
 * mulberry32 — byte-identical to `makeRng` in `scripts/seed-demo-data.ts`, and deliberately COPIED
 * rather than imported: `lib/` must not depend on `scripts/`, and the demo seed's PRNG is a shipped
 * convention rather than a shared utility. `tests/etl-staffing.test.ts` asserts the two agree on a
 * table of seeds, so a drift in either copy fails a test instead of silently re-rolling the country.
 */
export function makeStaffingRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The staffing arm's own seed constant. Changing it re-rolls every figure — a reviewable edit. */
export const STAFFING_SEED = 0x5354_4146; // "STAF"

/**
 * A PER-SCHOOL STABLE SEED: FNV-1a over `emisSchoolId` and the academic year, mixed with
 * `STAFFING_SEED`. The academic year is in it so a future multi-year run does not file the identical
 * figures under two vintages; the EMIS id is in it so the figures travel with the school rather than
 * with its position in whatever order the source read happened to return.
 */
export function staffingSeed(emisSchoolId: string, academicYear: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${emisSchoolId}\u0000${academicYear}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return (h ^ STAFFING_SEED) >>> 0;
}

// ── ptr ─────────────────────────────────────────────────────────────────────────────────────────

/** `numeric(5,2)` tops out at 999.99 (ruling §7's only generation guard besides `teachers ≥ 1`). */
export const PTR_MAX = 999.99;

/**
 * THE STORED RATE, RE-DERIVED FROM THE ROW'S OWN TWO STORED INTEGERS (ruling §3 / §4.2 doctrine).
 *
 * Integer arithmetic, half away from zero, so this equals Postgres `round(enrolment::numeric /
 * teachers, 2)` on EVERY input — including the exact-half cases a float
 * `Math.round((e / t) * 100) / 100` rounds the other way. The reconciliation test re-asserts the
 * STORED value against that very Postgres expression, so a float helper here would be a latent flake
 * real data trips.
 *
 * It THROWS, named and leading with the EMIS id, rather than letting a `numeric field overflow` escape
 * from the 5c INSERT as a raw Postgres cast error with no school attached. Unreachable in the demo by
 * construction (`teachers_on_roll = max(1, round(e ÷ target))` keeps ptr at ≈ the target PTR, and the
 * bands top out at 55) — which is exactly why it is asserted rather than assumed.
 */
export function ptrOf(
  enrolmentTotal: number,
  teachersOnRoll: number,
  emisSchoolId: string,
): string {
  if (!Number.isInteger(teachersOnRoll) || teachersOnRoll < 1)
    throw new StaffingTransformError(
      `${emisSchoolId}: teachers_on_roll must be an integer ≥ 1 to divide by, got ` +
        `${String(teachersOnRoll)} — ptr is enrolment_total ÷ teachers_on_roll and 0 teachers is not a ` +
        "school with an infinite ratio, it is a school with no ratio.",
    );
  if (!Number.isInteger(enrolmentTotal) || enrolmentTotal < 0)
    throw new StaffingTransformError(
      `${emisSchoolId}: enrolment_total must be a non-negative integer, got ${String(enrolmentTotal)}.`,
    );
  const scaled = enrolmentTotal * 100;
  const whole = Math.floor(scaled / teachersOnRoll);
  const rem = scaled - whole * teachersOnRoll;
  const hundredths = rem * 2 >= teachersOnRoll ? whole + 1 : whole;
  if (hundredths > 99_999)
    throw new StaffingTransformError(
      `${emisSchoolId}: ptr ${enrolmentTotal}/${teachersOnRoll} exceeds numeric(5,2)'s ${PTR_MAX} ` +
        "ceiling, so the INSERT would raise `numeric field overflow` with no school named. A ratio " +
        "this size is not a staffing figure, it is a defect in the roll or the roster.",
    );
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

// ── the transform ───────────────────────────────────────────────────────────────────────────────

export interface StaffingTarget {
  jurisdictionId: string;
  periodId: string;
  emisSchoolId: string;
  etlRunId: string;
  /** The ANNUAL period's academic year — part of the per-school seed. */
  academicYear: string;
  /** The ROSTER'S FROZEN VINTAGE (`options.rosterAsOf`), never `now()`. Ruling AC 21. */
  asOfDate: string;
  /** Register `region` / `district` — the gradient drivers. */
  regionName: string;
  districtName: string;
  /** ⚠KOFI: PUBLIC gets an establishment; PRIVATE and MISSION get NULL. Ruling §4. */
  ownershipType: RegisterOwnership;
  /** Register `school_type`. Reported only — the BAND comes from the roster, never from this. */
  schoolType?: RegisterSchoolType | null;
  /**
   * `ref_ges_teacher_establishment`'s CURRENT VINTAGE for this school (max `as_of_date`), when it has
   * one. REAL loaded data is preferred over a generated number — free fidelity (ruling §4, plan §3.2).
   * Ignored for PRIVATE/MISSION: a non-GES school is not on the payroll establishment at all.
   */
  refPostsEstablished?: number | null;
}

/**
 * BUILD THE ROW FROM THE THREE STORED INTEGERS. Separated from the generation above it so that the
 * internal-consistency arithmetic — signed vacancies, the NULL-iff-NULL rule, and `ptr` re-derived
 * from what is actually stored — is one small function that can be tested directly at its edges
 * (including the numeric(5,2) ceiling, which the generated bands cannot reach).
 */
export function buildStaffingRow(input: {
  jurisdictionId: string;
  periodId: string;
  emisSchoolId: string;
  enrolmentTotal: number;
  teachersOnRoll: number;
  teachingPostsEstablished: number | null;
  etlRunId: string;
  asOfDate: string;
}): FactStaffingRow {
  const { emisSchoolId, teachersOnRoll, teachingPostsEstablished: posts } = input;
  if (posts !== null && (!Number.isInteger(posts) || posts < 0))
    throw new StaffingTransformError(
      `${emisSchoolId}: teaching_posts_established must be a non-negative integer or NULL, got ` +
        `${String(posts)} — it is the GES-AUTHORISED post count, not a count of people, and NULL ` +
        "means 'GES sets no establishment for this school', never 0.",
    );
  const provenance = stampProvenance(input.etlRunId, input.asOfDate);
  return {
    jurisdictionId: input.jurisdictionId,
    periodId: input.periodId,
    teachersOnRoll,
    teachingPostsEstablished: posts,
    enrolmentTotal: input.enrolmentTotal,
    // ⚠KOFI (ruling §4, ACs 10/12): SIGNED, NOT floored at 0. The plan's `max(0, …)` is overruled —
    // a school over establishment (surplus teachers, common in the urban south) yields NEGATIVE
    // vacancies, and flooring would erase that half of the real distribution and leave the national
    // vacancy total unbalanced against reality. NULL — not 0 — when the establishment is unknown: a
    // vacancy count derived from an unknown establishment is unknown, and 0 reads as "fully staffed".
    vacancies: posts === null ? null : posts - teachersOnRoll,
    ptr: ptrOf(input.enrolmentTotal, teachersOnRoll, emisSchoolId),
    ...provenance,
  };
}

/**
 * ONE SCHOOL'S STAFFING ROW, derived from the enrolment arm's own rows. PURE — no DB, no clock, no
 * `Math.random()` — so the same rows + the same target produce the same row, which is what makes the
 * idempotency test meaningful rather than accidental.
 *
 * Returns `row: null` for the ruled zero-roll case. It FAILS LOUDLY (named, leading with the EMIS id)
 * rather than coercing, because `computePerSchool` exists so refusing one school costs one school.
 */
export function deriveSchoolStaffing(
  enrolmentRows: readonly FactEnrolmentRow[],
  target: StaffingTarget,
): SchoolStaffingResult {
  const { emisSchoolId, jurisdictionId } = target;

  // 1 · THE PIN. Not generated, and not adjustable.
  const enrolmentTotal = pinnedEnrolmentTotal(enrolmentRows, emisSchoolId);
  const bandStage = dominantStage(enrolmentRows);
  if (enrolmentTotal === 0 || bandStage === null)
    // Ruling §5/§6: no ratio to compute, so NO ROW — and the caller keeps this school out of the
    // delete scope, so whatever it had last night survives.
    return { jurisdictionId, emisSchoolId, enrolmentTotal, bandStage: null, row: null };

  const rng = makeStaffingRng(staffingSeed(emisSchoolId, target.academicYear));

  // 2 · THE TARGET PTR — the ruled band for this level, positioned by the gradient. The draws are
  //     taken in a FIXED ORDER (band, then establishment) because the PRNG is a stream: re-ordering
  //     them re-rolls every school in the country.
  const band = SCHOOL_LEVEL_BANDS[bandStage];
  const position = bandPosition(rng(), target.regionName, target.districtName);
  const targetPtr = band.lo + position * (band.hi - band.lo);
  if (!(targetPtr > 0))
    throw new StaffingTransformError(
      `${emisSchoolId}: target PTR for band ${bandStage} resolved to ${String(targetPtr)} — the band ` +
        "table is misconfigured and dividing the roll by it would invent a staff count.",
    );

  // 3 · teachers_on_roll — DERIVED from the pin and the target, never drawn. The max(1, …) floor is
  //     what stops a tiny school from being generated with zero teachers and a non-zero roll (not a
  //     plausible school, and a divide-by-zero for the anomaly engine later). Ruling §2: one integer,
  //     head teacher INCLUDED, trained and untrained TOGETHER, ancillary staff excluded.
  const teachersOnRoll = Math.max(1, Math.round(enrolmentTotal / targetPtr));

  // 4 · teaching_posts_established. ⚠KOFI (ruling §4): NULL for PRIVATE and MISSION — they are not on
  //     the GES payroll establishment, so there IS no authorised-post figure, and a demo in which the
  //     column is never null hides the null-handling bug the dashboard would otherwise ship. This is
  //     the ruled rule, NOT the plan's vaguer "a deliberate slice of schools".
  const establishmentDraw = rng();
  const teachingPostsEstablished =
    target.ownershipType !== "PUBLIC"
      ? null
      : typeof target.refPostsEstablished === "number"
        ? assertRefPosts(target.refPostsEstablished, emisSchoolId)
        : Math.max(
            1,
            Math.round(
              teachersOnRoll *
                establishmentFactor(
                  establishmentDraw,
                  target.regionName,
                  target.districtName,
                ),
            ),
          );

  // 5 + 6 · vacancies (signed) and ptr (re-derived from the stored integers) — see `buildStaffingRow`.
  const row = buildStaffingRow({
    jurisdictionId,
    periodId: target.periodId,
    emisSchoolId,
    enrolmentTotal,
    teachersOnRoll,
    teachingPostsEstablished,
    etlRunId: target.etlRunId,
    asOfDate: target.asOfDate,
  });
  return { jurisdictionId, emisSchoolId, enrolmentTotal, bandStage, row };
}

function assertRefPosts(posts: number, emisSchoolId: string): number {
  if (!Number.isInteger(posts) || posts < 0)
    throw new StaffingTransformError(
      `${emisSchoolId}: ref_ges_teacher_establishment.teaching_posts_established is ${String(posts)}, ` +
        "which is not a non-negative integer. The GES establishment file is the authority for this " +
        "column, so a bad vintage fails the school rather than being quietly replaced by a guess.",
    );
  return posts;
}

// ── the reference read ──────────────────────────────────────────────────────────────────────────

/**
 * THE CURRENT ESTABLISHMENT VINTAGE PER SCHOOL — `MAX(as_of_date)`, per `db/schema/ref.ts` (AC-2.3),
 * which is what the table's `UNIQUE (emis_school_id, as_of_date)` makes well-defined.
 *
 * Read ONCE for the whole run on the ordinary analytics (owner) connection: no new object, no new
 * grant, no join inside a per-school loop. An empty table is the normal demo state — nothing is
 * loaded until `pnpm db:load-establishment` runs — and yields an empty map, which is why the
 * generated branch in `deriveSchoolStaffing` is the path the demo actually exercises.
 */
export async function readCurrentEstablishment(
  sql: postgres.Sql,
  emisSchoolIds: string[],
): Promise<Map<string, number>> {
  if (emisSchoolIds.length === 0) return new Map();
  const rows = await sql<{ emis_school_id: string; posts: number }[]>`
    select distinct on (emis_school_id)
           emis_school_id,
           teaching_posts_established::int as posts
      from ref_ges_teacher_establishment
     where emis_school_id = any(${emisSchoolIds}::text[])
     order by emis_school_id, as_of_date desc`;
  return new Map(rows.map((r) => [r.emis_school_id, r.posts]));
}

// ── the write ───────────────────────────────────────────────────────────────────────────────────

/**
 * One period's computed rows, with the DELETE SCOPE stated explicitly.
 *
 * `jurisdictionIds` is the set of schools that successfully produced A ROW this run — NOT the whole
 * period, and NOT every school the arm looked at. Three kinds of school are therefore deliberately
 * OUT of scope and keep their prior rows (stale-but-honest): a school whose compute failed, a school
 * that dropped out of the inclusion set, and a school whose reconciled roll is ZERO. The third is the
 * one difference from `EnrolmentWriteBatch`, and it is the ruling's §5 case made structural: a
 * zero-roll school has no ratio, so deleting its previous honest row and inserting nothing would
 * publish absence as if it were a measurement of emptiness.
 */
export interface StaffingWriteBatch {
  periodId: string;
  /** SCHOOL-level jurisdiction ids that produced a row this run. THE DELETE BOUND. */
  jurisdictionIds: string[];
  rows: FactStaffingRow[];
}

export interface StaffingWriteResult {
  deleted: number;
  inserted: number;
  perPeriod: { periodId: string; deleted: number; inserted: number }[];
}

/**
 * DELETE-BY-(PERIOD, JURISDICTION ∈ SCOPE)-THEN-INSERT. The three inherited properties — bounded
 * delete, ONE transaction for the whole run, delete-then-insert rather than upsert — hold verbatim;
 * read `writeEnrolmentFactsTx`'s header for the argument.
 *
 * ⚠ `fact_staffing` IS ONE OF THE PK-ONLY ORIGINAL EIGHT — NO grain UNIQUE, and this slice
 * deliberately does not add one (a `UNIQUE (jurisdiction_id, period_id)` would force a migration and
 * diverge from the set these writers are written around). So delete-then-insert is forced, there is no
 * `on conflict` target, and THE POST-INSERT DUPLICATE ASSERTION BELOW IS THE ONLY GUARD THAT EXISTS.
 *
 * ⚠ WHY A DUPLICATE IS WORSE HERE THAN ANYWHERE ELSE. A duplicated school doubles BOTH
 * `teachers_on_roll` AND `enrolment_total`, so the Σ÷Σ roll-up PTR is UNCHANGED while the teacher and
 * pupil counts are both 2×. The ratio — the figure a reader checks — looks perfectly right while the
 * establishment, the vacancy total and the headcount beside it are all double. Nothing in the output
 * signals it. The grain has no nullable discriminator, so the key needs no `coalesce`/`IS NULL`
 * subtlety: `(jurisdiction_id, period_id)` is the whole of it.
 */
export async function writeStaffingFactsTx(
  tx: postgres.TransactionSql,
  batches: StaffingWriteBatch[],
): Promise<StaffingWriteResult> {
  const perPeriod: StaffingWriteResult["perPeriod"] = [];
  let totalDeleted = 0;
  let totalInserted = 0;

  for (const batch of batches) {
    const { periodId, jurisdictionIds, rows: rowsToWrite } = batch;

    let deleted = 0;
    if (jurisdictionIds.length > 0) {
      const removed = await tx`
        delete from fact_staffing
         where period_id = ${periodId}::uuid
           and jurisdiction_id = any(${jurisdictionIds}::uuid[])`;
      deleted = removed.count;
    }

    let inserted = 0;
    const CHUNK = 1000;
    for (let i = 0; i < rowsToWrite.length; i += CHUNK) {
      const chunk = rowsToWrite.slice(i, i + CHUNK).map((r) => ({
        jurisdiction_id: r.jurisdictionId,
        period_id: r.periodId,
        teachers_on_roll: r.teachersOnRoll,
        teaching_posts_established: r.teachingPostsEstablished,
        enrolment_total: r.enrolmentTotal,
        ptr: r.ptr,
        vacancies: r.vacancies,
        source: r.source,
        as_of_date: r.asOfDate,
        etl_run_id: r.etlRunId,
      }));
      const result = await tx`insert into fact_staffing ${tx(chunk)}`;
      inserted += result.count;
    }

    // THE DUPLICATE ASSERTION OVER THE FULL GRAIN — see the header. Inside the transaction, so
    // tripping it rolls the whole run back.
    const dupes = await tx<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id
          from fact_staffing
         where period_id = ${periodId}::uuid
         group by jurisdiction_id, period_id
        having count(*) > 1
      ) d`;
    if ((dupes[0]?.n ?? 0) > 0)
      throw new Error(
        `fact_staffing has ${dupes[0]!.n} duplicated grain key(s) (jurisdiction_id, period_id) for ` +
          `period ${periodId}. fact_staffing has NO grain UNIQUE, so a duplicate inserts happily and ` +
          "silently DOUBLES every roll-up above it. Worse than for a plain count: a doubled school " +
          "doubles BOTH teachers_on_roll AND enrolment_total, so the Σ÷Σ roll-up PTR is UNCHANGED " +
          "while the teacher and pupil counts are both 2× — nothing in the output signals it, which " +
          "is why this assertion exists.",
      );

    perPeriod.push({ periodId, deleted, inserted });
    totalDeleted += deleted;
    totalInserted += inserted;
  }

  return { deleted: totalDeleted, inserted: totalInserted, perPeriod };
}

/** The standalone form — its OWN transaction. The pipeline uses the `…Tx` form so that all SIX arms
 *  of one run are ONE transaction (see `lib/etl/pipeline.ts` step 5c). */
export async function writeStaffingFacts(
  sql: postgres.Sql,
  batches: StaffingWriteBatch[],
): Promise<StaffingWriteResult> {
  return (await sql.begin(async (tx) =>
    writeStaffingFactsTx(tx as unknown as postgres.TransactionSql, batches),
  )) as unknown as StaffingWriteResult;
}
