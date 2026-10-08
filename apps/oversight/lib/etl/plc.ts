import type postgres from "postgres";
import type {
  PlcAnnualPointsRow,
  PlcGroupRow,
  PlcProgrammeRow,
  PlcSessionAggregateRow,
} from "./plc-source";
import type { NtcCpdSchoolSummary, NtcSourceSex } from "./ntc-cpd-source";
import { stampProvenance, type Provenance } from "./run";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `plc_*` (operational) + the NTC seam → `fact_plc_participation` — THE SEVENTH ARM: TEACHER CPD.
 *
 * Kofi's `CPD-SURFACING-RULING.md` (C1–C9) is the authority for WHERE EVERY FIGURE COMES FROM;
 * `fact_plc_participation`'s own ~140-line doc comment in `db/schema/fact.ts` is the authority for
 * what each column MEANS, and every invariant it states is binding here. Where this module makes a
 * call the ruling left open it says so in as many words and names the escalation.
 *
 * This slice adds NO fact-schema change and NO migration: the table already exists (migration 0001),
 * so the §6 prod-paste-0006 re-run rule is not triggered and `pnpm db:generate` must still report no
 * schema changes.
 *
 * ── ⚠ THE FIRST ARM WITH **TWO PERIOD CUTS** ────────────────────────────────────────────────────
 * Every arm before this one writes at one grain. This one writes at two, in ONE pass, because the two
 * cuts are two halves of one question about the same teachers:
 *     TERM   rows: sessions_held / sessions_expected / attendance_events / attendance_expected /
 *            plc_participation_rate / teachers_in_plc. The CPD columns are NULL.
 *     ANNUAL rows: cpd_points_* (incl. the three NTC category totals and their teacher counts) /
 *            teachers_meeting_cpd_threshold / annual_plc_target / ntc_cpd_target. The session
 *            columns are NULL.
 *     BOTH   carry `teacher_headcount` and `schools_running_plc_count`.
 * They are DIFFERENT `period_id`s, never two rows on one period, so `(jurisdiction_id, period_id,
 * sex)` still separates them — and each cut gets its OWN bounded delete batch in `writePlcFactsTx`.
 *
 * ── ⚠ `teacher_headcount` IS PINNED, STRUCTURALLY, TO fact_staffing.teachers_on_roll ────────────
 * On BOTH cuts (the schema's ETL CONTRACT: an ANNUAL row that leaves it NULL is a defect, not a valid
 * row). The pin is the staffing arm's own in-memory figure for the same school and academic year,
 * passed in as `teachersOnRoll` — the same technique the staffing arm uses to pin itself to the
 * enrolment arm's rows, for the same reason: ONE NUMBER rather than two numbers and a hope. PLC
 * coverage and the CPD-target rate therefore divide the SAME roll that PTR and the vacancy figures
 * divide, instead of quietly counting a different set of people.
 *
 * The consequence is that this arm RUNS FOR THE CURRENT ACADEMIC YEAR ONLY, like staffing and
 * enrolment, and for exactly the same reason: in the demo `teachers_on_roll` is DERIVED from the
 * roster, the roster carries no period, and there is therefore no honest roll for a past year. On a
 * non-current year the arm is a clean no-op — zero rows, EMPTY delete scope — so that year keeps
 * whatever it had (stale-but-honest). THE TERM ROWS OF THAT YEAR USE THAT YEAR'S ROLL TOO: a term
 * cut with a different denominator from its own year's annual cut would make the two sub-panels of one
 * dashboard disagree about how many teachers the school has.
 *
 * ── ⚠ THE SEX-INVARIANT COLUMNS ARE COPIED, NEVER APPORTIONED ───────────────────────────────────
 * `schools_running_plc_count`, `sessions_held`, `sessions_expected`, `annual_plc_target` and
 * `ntc_cpd_target` are properties of the SCHOOL, not of the teachers in it. The IDENTICAL value is
 * written on the MALE, the FEMALE and the ALL row — copied, never halved — which is why the schema
 * says they are read with `sex = 'ALL'` ONLY: summing them under the `sex IN ('MALE','FEMALE')` split
 * returns EXACTLY 2×, and the derived session-coverage rate still looks right because the doubling
 * cancels. That is what makes this the dangerous one, and `assertPlcInvariants` checks the repetition
 * rather than trusting it.
 *
 * ── ⚠ THE SEX SPLIT OF THE *PLC* MEASURES IS A DEMO APPORTIONMENT, AND HERE IS THE SEAM ─────────
 * The operational PLC module records WHICH USER attended, and nothing about that user. A teacher's SEX
 * lives on the global `ref_user`/staff estate, which this arm's allow-list deliberately does not read
 * (no identity column crosses the boundary — see `lib/etl/plc-source.ts`). So today the sexed PLC
 * columns are APPORTIONED from the school's ALL figure by a deterministic per-school share, exactly as
 * the staffing arm GENERATES its demo PTR band inside `lib/` rather than pretending to measure it:
 *   · the share comes from the demo's own mulberry32, seeded per (school, academic year), so a re-run
 *     is byte-identical and a reviewer can reason about one school;
 *   · MALE + FEMALE = ALL BY CONSTRUCTION, because the split is computed FROM the ALL figure (one of
 *     the two sexes is the remainder) rather than drawn independently;
 *   · the shares are PLAUSIBILITY WEIGHTS, NOT MEASUREMENTS — the same posture `SCHOOL_LEVEL_BANDS`
 *     takes. They must not be cited as a figure about Ghana's teaching workforce.
 * THE SEAM FOR THE REAL THING is `lib/etl/plc-source.ts`: when a staff-sex source exists, the group
 * and session reads GROUP BY it and return sexed rows, and this module stops apportioning. Nothing
 * else changes — the fact columns, the invariants and every dashboard are already sexed.
 * ⚠ The NTC-sourced columns are NOT apportioned: they arrive sexed FROM the source and their ALL is
 * the SUM of the two. Only the PLC-operational half is apportioned, and only until the staff estate
 * can be read.
 *
 * ── ⚠ ATTENDANCE IS PRESENT-BY-DEFAULT: THE EVENTS ARE A SUBTRACTION ────────────────────────────
 *       attendance_expected = Σ over active PLCs (active members × sessions that PLC HELD)
 *       attendance_events   = attendance_expected − the non-present rows
 * The DENOMINATOR IS SESSIONS **HELD**, NOT SESSIONS EXPECTED, and that is a deliberate ruling rather
 * than an oversight: session DELIVERY is already measured by `sessions_held ÷ sessions_expected`, so
 * folding non-delivery into the participation rate would count the same failure twice in two metrics,
 * and — worse — would make the SEX SPLIT of a teacher-attendance figure partly a statement about the
 * school's cadence, which has no sex. A school that held nothing therefore has `attendance_expected =
 * 0` and a NULL rate (a rate with no denominator is not 0.00), while its session coverage is 0% — two
 * figures saying two different true things.
 *
 * ── ⚠ THE MANDATORY SPLIT (C7) — THE SUBTLE ONE ─────────────────────────────────────────────────
 *       cpd_points_mandatory_total = the OBSERVED PLC points (the floor) + the NCPD topup FROM the
 *                                   NTC source
 * NTC's Mandatory class is fed by school-based/PLC provision AND by National-Centre-for-PD provision;
 * Omnischools observes only the first (`plc_cpd_ledger` → attended + reflection). So Mandatory is a
 * SPLIT: a real-shape floor plus a stand-in topup. The build MUST keep `mandatory >= the observed PLC
 * points`, so the demo stays internally consistent with the real PLC feed and so a later real NTC feed
 * can only ADD the NCPD half rather than contradict the floor. `assertPlcInvariants` enforces it on
 * every row. With NO NTC source, Mandatory is populated as the schema's explicitly permitted
 * PLC-ONLY PARTIAL — which this module states, here and in the run report, rather than leaving the
 * reader to guess.
 *
 * ── ⚠ THE RECONCILIATION (C8) AND THE TWO DATA STATES (C1) ──────────────────────────────────────
 *   NTC SOURCE PRESENT (demo):  mandatory + specialised + recommended = cpd_points_total, and
 *                               cpd_points_total / _mean / _teacher_count are the ALL-CATEGORY
 *                               figures. The genuinely observed PLC points remain available as a
 *                               labelled subset (the reader surfaces "of which PLC-earned: X").
 *   NTC SOURCE ABSENT (live):   specialised / recommended / their teacher counts /
 *                               teachers_meeting_cpd_threshold / ntc_cpd_target stay **NULL — never
 *                               0** (the ⚠ SOURCING GATE), and `cpd_points_total` falls back to the
 *                               PLC-only subtotal.
 * ONE CODE PATH, TWO DATA STATES. The transform NEVER invents an NTC figure: with no source there is
 * nothing to write, and that is the whole of C1.
 *
 * ── `source = OPERATIONAL_AGG` ON EVERY ROW (C4), AND `as_of_date` IS NEVER `now()` ─────────────
 * No new `ov_source` member is minted by this slice (the reasoning is in `lib/etl/ntc-cpd-source.ts`:
 * `source` is row-level and the ANNUAL row is mixed-provenance, so it could not mark the NTC columns
 * anyway). The vintage is the DATA's:
 *     TERM   max `plc_session.session_date` in the window, else the term's `ends_on`.
 *     ANNUAL max `plc_cpd_ledger.settled_at` in the year, else the ANNUAL `ends_on`.
 * So a re-run over unchanged registers is byte-identical except `etl_run_id`, a closed term is
 * immutable, and an open one is an honestly stamped moving snapshot.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Raised for a school this ETL refuses to produce PLC rows for. Isolated by `computePerSchool`. */
export class PlcTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlcTransformError";
  }
}

/** `ov_sex`'s members, in the order the rows are emitted. ALL is stored BESIDE the split. */
export const OV_SEXES = ["MALE", "FEMALE", "ALL"] as const;
export type OvSex = (typeof OV_SEXES)[number];

/** One `fact_plc_participation` row, ready to insert. Column-for-column with `db/schema/fact.ts`. */
export interface FactPlcParticipationRow {
  jurisdictionId: string;
  /** The TERM period for a participation row, the ANNUAL period for a CPD row. Never both. */
  periodId: string;
  sex: OvSex;
  /** ⚠ SEX-INVARIANT 0/1: the IDENTICAL value on all three sex rows. Read with sex='ALL' ONLY. */
  schoolsRunningPlcCount: number;
  /** BOTH cuts. The pin — fact_staffing.teachers_on_roll for this school and year. */
  teacherHeadcount: number;
  // ---- TERM cut (NULL on an ANNUAL row) ----
  /** ⚠ SEX-INVARIANT (a session is held once, not once per sex). */
  sessionsHeld: number | null;
  /** ⚠ SEX-INVARIANT. NULL — not 0 — when the school configured no PLC programme at all. */
  sessionsExpected: number | null;
  attendanceEvents: number | null;
  attendanceExpected: number | null;
  /** numeric(5,2) PERCENT as a STRING. NULL when `attendance_expected` is 0 (no denominator). */
  plcParticipationRate: string | null;
  teachersInPlc: number | null;
  // ---- ANNUAL cut (NULL on a TERM row) ----
  /** numeric(7,2) string. All-category in the demo state; the PLC-only subtotal when NTC is absent. */
  cpdPointsTotal: string | null;
  /** The MEAN's denominator ONLY — teachers with any CPD points. NOT the coverage denominator. */
  cpdPointsTeacherCount: number | null;
  /** numeric(5,2) string = total ÷ teacher_count. NULL when the count is 0. */
  cpdPointsMean: string | null;
  /** ⚠ NTC-SOURCED: NULL (never 0) when no NTC source exists. Invariant: ≤ teacher_headcount. */
  teachersMeetingCpdThreshold: number | null;
  /** ⚠ SEX-INVARIANT scalar. The SCHOOL'S OWN PLC target. NULL when never configured. COMPARE, never SUM. */
  annualPlcTarget: string | null;
  /** ⚠ SEX-INVARIANT scalar, NTC-SOURCED: NULL when no NTC source exists. COMPARE, never SUM. */
  ntcCpdTarget: string | null;
  /** SPLIT: the observed PLC floor + the NCPD topup. Always ≥ the observed PLC points. */
  cpdPointsMandatoryTotal: string | null;
  /** ⚠ NTC-SOURCED: NULL, never 0. */
  cpdPointsSpecialisedTotal: string | null;
  /** ⚠ NTC-SOURCED: NULL, never 0. */
  cpdPointsRecommendedTotal: string | null;
  /** SPLIT (PLC floor + NTC view). These three OVERLAP and are never summed to each other. */
  cpdMandatoryTeacherCount: number | null;
  /** ⚠ NTC-SOURCED: NULL, never 0. */
  cpdSpecialisedTeacherCount: number | null;
  /** ⚠ NTC-SOURCED: NULL, never 0. */
  cpdRecommendedTeacherCount: number | null;
  source: Provenance["source"];
  asOfDate: string;
  etlRunId: string;
}

/** ONE declared TERM of the current academic year, with this school's own session aggregates. */
export interface PlcTermInput {
  periodId: string;
  /** 1 | 2 | 3 — a TERM cut is always numbered. */
  term: number;
  startsOn: string;
  endsOn: string;
  /** Per-PLC sessions + non-present deductions inside this window. EMPTY = held nothing this term. */
  sessions: PlcSessionAggregateRow[];
}

/** Everything the builder reads about ONE school. Assembled by the pipeline; no DB in this module. */
export interface PlcSchoolSource {
  /** NULL = the school never configured a PLC programme. NOT coalesced to the upstream defaults. */
  programme: PlcProgrammeRow | null;
  /** The school's ACTIVE PLCs with their active cohort sizes. EMPTY = this school runs no PLC. */
  groups: PlcGroupRow[];
  /**
   * DISTINCT teachers in ANY active PLC — `teachers_in_plc`.
   *
   * ⚠ NOT Σ `groups[].activeMembers`, and the difference is the whole reason this is a separate
   * figure: a teacher in two PLCs appears in two per-PLC counts and is ONE teacher in a PLC. The
   * per-PLC counts are still needed, because `attendance_expected` is per-PLC (members × that PLC's
   * own sessions), so both grains are read and neither is derived from the other.
   */
  distinctMembers: number;
  /** NULL = the school's teachers earned no PLC points in the year (a real, measured zero). */
  annualPoints: PlcAnnualPointsRow | null;
  /** NULL = THE SOURCING GATE IS CLOSED for this school. Every NTC column stays NULL. */
  ntc: NtcCpdSchoolSummary | null;
}

export interface PlcTarget {
  jurisdictionId: string;
  emisSchoolId: string;
  etlRunId: string;
  /** Part of the per-school seed, so a future multi-year run cannot file identical figures twice. */
  academicYear: string;
  annualPeriodId: string;
  /** The ANNUAL period's `ends_on` — the `as_of_date` FALLBACK when the school earned no points. */
  annualEndsOn: string;
  /** ⚠ THE PIN. `fact_staffing.teachers_on_roll` for this school and year. Not adjustable. */
  teachersOnRoll: number;
  /** The declared TERMS of this academic year. EMPTY is legal (an ANNUAL-only declaration). */
  terms: PlcTermInput[];
}

/** What one term's participation came to, as the run reports it. Counts only — no averaged rate. */
export interface PlcTermSummary {
  periodId: string;
  term: number;
  asOfDate: string;
  sessionsHeld: number;
  /** NULL when the school configured no programme — the denominator genuinely does not exist. */
  sessionsExpected: number | null;
  attendanceEvents: number;
  attendanceExpected: number;
  teachersInPlc: number;
  teacherHeadcount: number;
  /**
   * Sessions held by a PLC the GROUP read did not return — an ARCHIVED one. Counted here and in NO
   * fact column: see the note at the tally's own site in `buildSchoolPlcRows`.
   */
  orphanSessions: number;
}

/** What the ANNUAL cut came to. Both provenance halves are reported APART, never pooled. */
export interface PlcAnnualSummary {
  periodId: string;
  asOfDate: string;
  teacherHeadcount: number;
  /** The GENUINELY OBSERVED PLC points, in exact hundredths. Real shape, demo volume, un-chipped. */
  plcPointsHundredths: number;
  /** All-category total in hundredths when NTC is sourced; the PLC-only subtotal when it is not. */
  cpdPointsTotalHundredths: number;
  /** NULL when the sourcing gate is closed — NEVER 0. */
  teachersMeetingCpdThreshold: number | null;
  /** TRUE when this school's NTC columns were populated FROM the seam. The demo signature. */
  ntcSourced: boolean;
}

/** One school's whole PLC outcome: the rows to write, plus everything that is NOT a row. */
export interface SchoolPlcResult {
  jurisdictionId: string;
  emisSchoolId: string;
  rows: FactPlcParticipationRow[];
  /** TRUE when the school has ≥1 ACTIVE PLC. FALSE is a MEASUREMENT, and it writes a 0 row. */
  runsPlc: boolean;
  terms: PlcTermSummary[];
  annual: PlcAnnualSummary;
  /**
   * How many NTC-sourced teacher counts had to be CLAMPED to this school's own roll. Reported rather
   * than silent: see `clampToRoll`.
   */
  ntcCountsClamped: number;
  /** The demo apportionment this school's sexed PLC figures used. Reported so it is inspectable. */
  femaleSharePerMille: number;
}

// ── exact arithmetic: integer hundredths in, numeric literals out ───────────────────────────────

/** numeric(7,2) holds ±99,999.99 → 9,999,999 hundredths. The write-time bound for the point totals. */
export const MAX_POINTS_HUNDREDTHS = 9_999_999;
/** numeric(5,2) holds ±999.99 → 99,999 hundredths. The bound for the mean and the two targets. */
export const MAX_SMALL_HUNDREDTHS = 99_999;

/**
 * `round(total / n)`, HALF AWAY FROM ZERO — the rule Postgres `round(numeric)` uses, in integers.
 *
 * The float form (`Math.round(total / n)`) rounds exact-half cases the other way, and
 * `tests/etl-plc.test.ts` re-asserts stored values against Postgres's own `round()`, so a float
 * helper here is a latent flake that real data trips.
 */
function divideRound(total: number, n: number): number {
  if (!Number.isInteger(total))
    throw new PlcTransformError(`${String(total)} is not an integer — hundredths are exact.`);
  if (n <= 0)
    throw new PlcTransformError(
      `cannot divide by ${String(n)} — a figure with no denominator is NULL, not 0.00.`,
    );
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const whole = Math.floor(abs / n);
  const rem = abs - whole * n;
  return sign * (rem * 2 >= n ? whole + 1 : whole);
}

/** Exact hundredths → the string a `numeric(_,2)` column takes. Never via a float. */
export function pointsOf(hundredths: number): string {
  if (!Number.isInteger(hundredths))
    throw new PlcTransformError(`${String(hundredths)} hundredths is not an integer.`);
  const sign = hundredths < 0 ? "-" : "";
  const abs = Math.abs(hundredths);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * A stored RATE as a numeric(5,2) PERCENT string, re-derived from the row's OWN two counts.
 *
 * Byte-identical in rounding to `attendanceRateOf` (`lib/etl/attendance.ts`) and therefore to
 * Postgres `round(100.0 * num / den, 2)` on every input, including the exact-half cases a float
 * rounds the other way. It THROWS on a zero denominator rather than returning "0.00": the caller
 * stores NULL there, because a rate with no denominator is not a measurement of zero.
 */
export function plcRateOf(numerator: number, denominator: number): string {
  if (denominator <= 0)
    throw new PlcTransformError(
      `plc_participation_rate is undefined for attendance_expected ${String(denominator)} — the ` +
        "row stores NULL there, because 0.00 would read as 'nobody attended' rather than 'no " +
        "session was held to attend'.",
    );
  if (numerator < 0 || !Number.isInteger(numerator) || !Number.isInteger(denominator))
    throw new PlcTransformError(
      `plc_participation_rate needs two non-negative integer counts, got ${String(numerator)}/` +
        String(denominator),
    );
  const scaled = numerator * 10_000;
  let whole = Math.floor(scaled / denominator);
  let rem = scaled - whole * denominator;
  if (rem >= denominator) {
    whole += 1;
    rem -= denominator;
  }
  const basisPoints = rem * 2 >= denominator ? whole + 1 : whole;
  return `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}`;
}

// ── the deterministic demo apportionment ────────────────────────────────────────────────────────

/**
 * mulberry32 — byte-identical to `makeRng` in `scripts/seed-demo-data.ts` and to `makeStaffingRng`,
 * and deliberately COPIED rather than imported: `lib/` must not depend on `scripts/`, and the demo
 * seed's PRNG is a shipped convention rather than a shared utility. `tests/etl-plc.test.ts` asserts
 * the copies agree on a table of seeds, so a drift in either fails a test instead of silently
 * re-rolling every sexed figure in the country.
 */
export function makePlcRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The PLC arm's OWN seed constant — distinct from `STAFFING_SEED` and from the generator's fee /
 * attendance salts, so this arm's draws cannot shift any other arm's bytes. Changing it re-rolls every
 * sexed PLC figure, which makes it a deliberate, reviewable edit.
 */
export const PLC_SEED = 0x504c_4344; // "PLCD"

/** A PER-SCHOOL STABLE SEED: FNV-1a over (emis id, academic year), mixed with `PLC_SEED`. */
export function plcSeed(emisSchoolId: string, academicYear: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${emisSchoolId}\u0000${academicYear}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return (h ^ PLC_SEED) >>> 0;
}

/**
 * THE DEMO SEX-APPORTIONMENT WINDOW for the TEACHING WORKFORCE, as a share of FEMALE staff.
 *
 * ⚠ A PLAUSIBILITY WEIGHT, NOT A MEASUREMENT (the `SCHOOL_LEVEL_BANDS` posture). Ghana's teaching
 * workforce is roughly 40% female overall with a wide per-school spread and a strong level gradient
 * (KG/primary much more female, SHS much less). The window below spans that spread so the equity
 * panel shows the KIND of variation the real data shows, rather than one credible-looking number
 * repeated 431 times. It must not be cited as a figure about Ghana.
 */
const FEMALE_SHARE_LO = 0.28;
const FEMALE_SHARE_HI = 0.58;
/** How far a school's PLC-membership share may sit from its staff share. A demo tilt, both ways. */
const MEMBERSHIP_TILT = 0.1;
/** How far one sex's PARTICIPATION fraction may sit from the school's own. The equity signal's size. */
const PARTICIPATION_TILT = 0.08;
/** How far the female share of PLC POINTS may sit from the membership share. */
const POINTS_TILT = 0.08;

const clamp01 = (p: number): number => (p < 0 ? 0 : p > 1 ? 1 : p);
const tilt = (draw: number, amplitude: number): number => (draw * 2 - 1) * amplitude;
/** Shares are carried in PER MILLE so the split is integer arithmetic end to end. */
const perMille = (p: number): number => Math.round(clamp01(p) * 1000);

/**
 * ONE SCHOOL'S APPORTIONMENT SHARES, drawn in a FIXED ORDER from the per-school stream.
 *
 * The order is part of the contract: a PRNG is a stream, so re-ordering these four draws re-rolls
 * every sexed figure in the country.
 */
export interface PlcSexShares {
  /** Female share of TEACHER HEADCOUNT, per mille. */
  headPerMille: number;
  /** Female share of PLC MEMBERSHIP (and therefore of `attendance_expected`), per mille. */
  membershipPerMille: number;
  /** Female share of PLC POINTS and of the points teacher count, per mille. */
  pointsPerMille: number;
  /**
   * How far the FEMALE participation FRACTION sits from the school's own overall fraction, in
   * hundredths of a proportion. This — not a share of the events — is what makes the sexed
   * participation RATES differ, which is the whole point of the girls'-access frame (ruling C14/E-CPD-5).
   */
  participationTilt: number;
}

export function plcSexShares(emisSchoolId: string, academicYear: string): PlcSexShares {
  const rng = makePlcRng(plcSeed(emisSchoolId, academicYear));
  const head = FEMALE_SHARE_LO + rng() * (FEMALE_SHARE_HI - FEMALE_SHARE_LO);
  const membership = clamp01(head + tilt(rng(), MEMBERSHIP_TILT));
  const participationTilt = tilt(rng(), PARTICIPATION_TILT);
  const points = clamp01(membership + tilt(rng(), POINTS_TILT));
  return {
    headPerMille: perMille(head),
    membershipPerMille: perMille(membership),
    pointsPerMille: perMille(points),
    participationTilt,
  };
}

/**
 * SPLIT AN ALL FIGURE INTO (MALE, FEMALE) SO THE TWO SUM BACK TO IT EXACTLY.
 *
 * FEMALE is rounded and MALE is THE REMAINDER — never the other way round and never both rounded,
 * because two independent roundings sum to ALL ± 1 and the additive roll-up would then be off by one
 * per school, which at national scale is a visible, unexplainable discrepancy between the ALL row and
 * the split.
 *
 * `femaleCap` / `maleCap` bound each sex (e.g. a sexed teacher count may not exceed that sex's
 * headcount). They are applied AFTER the rounding and the remainder is re-derived, so the sum is
 * preserved. A total that exceeds `femaleCap + maleCap` is a defect in the caller, not a rounding
 * question, and throws.
 */
export function splitBySex(
  total: number,
  sharePerMille: number,
  caps?: { female: number; male: number },
): { male: number; female: number } {
  if (!Number.isInteger(total) || total < 0)
    throw new PlcTransformError(
      `cannot split ${String(total)} across the sexes — it must be a non-negative integer.`,
    );
  if (caps && total > caps.female + caps.male)
    throw new PlcTransformError(
      `cannot split ${String(total)} across the sexes within caps ${String(caps.female)}/` +
        `${String(caps.male)} — the total exceeds both sexes' room, which is an arithmetic defect ` +
        "in the caller rather than a rounding question.",
    );
  let female = divideRound(total * sharePerMille, 1000);
  if (caps) {
    const lo = Math.max(0, total - caps.male);
    const hi = Math.min(total, caps.female);
    if (female < lo) female = lo;
    if (female > hi) female = hi;
  } else if (female > total) female = total;
  return { male: total - female, female };
}

/**
 * CLAMP AN NTC-SOURCED TEACHER COUNT TO THIS SCHOOL'S OWN ROLL, and say so.
 *
 * ⚠ WHY A CLAMP IS THE RIGHT ANSWER HERE AND NOWHERE ELSE IN THIS ETL. The schema states a binding
 * single-row invariant: `teachers_meeting_cpd_threshold ≤ teacher_headcount`, and every per-category
 * coverage rate divides by `teacher_headcount` — so a sourced count above the roll would publish a
 * compliance rate above 100%, which is the kind of figure that gets screenshotted. But the two numbers
 * come from different authorities: NTC counts against ITS OWN roll of licensed teachers at that school,
 * which is not the roll this warehouse derives. Refusing the school would lose its whole CPD row over
 * somebody else's bookkeeping; writing the raw figure would break a stated invariant. So the row is
 * clamped to the denominator it will be divided by, and every clamp is COUNTED and reported
 * (`ntcCountsClamped`) so a systematic mismatch between the two rolls is visible rather than absorbed.
 */
function clampToRoll(
  value: number,
  roll: number,
  clamped: { n: number },
): number {
  if (value <= roll) return value;
  clamped.n += 1;
  return roll;
}

// ── the transform ───────────────────────────────────────────────────────────────────────────────

/** How many sessions ONE PLC's cadence called for in ONE term. WEEKLY = every week, BIWEEKLY = half. */
export function expectedSessionsFor(
  weeksPerSemester: number,
  overrideFrequency: string | null,
): number {
  if (!Number.isInteger(weeksPerSemester) || weeksPerSemester <= 0)
    throw new PlcTransformError(
      `weeks_per_semester ${String(weeksPerSemester)} is not a positive integer, so the cadence ` +
        "calls for no definite number of sessions and session coverage would divide by nothing.",
    );
  // NULL = inherit the programme cadence, which is weekly (the programme carries a session DAY, not a
  // frequency — apps/web/db/schema/plc.ts). An unknown value is refused rather than defaulted: a new
  // operational frequency must be an explicit ETL change, not a silent weekly.
  if (overrideFrequency === null || overrideFrequency === "WEEKLY") return weeksPerSemester;
  if (overrideFrequency === "BIWEEKLY") return Math.ceil(weeksPerSemester / 2);
  throw new PlcTransformError(
    `plc.override_frequency "${overrideFrequency}" is neither WEEKLY nor BIWEEKLY — the ETL has no ` +
      "cadence rule for it, and guessing one would publish a session-coverage denominator nobody set.",
  );
}

/**
 * ONE SEX'S ANNUAL CPD ARITHMETIC — all in exact integer HUNDREDTHS for the points, counts for the
 * rest. `null` on a field means THE SOURCING GATE IS CLOSED for it, and NULL is the written value;
 * it never degrades to 0.
 */
interface AnnualSexFigures {
  /** All-category when the gate is open; the PLC-only subtotal when it is closed. */
  total: number;
  /** The MEAN's denominator — teachers with ANY CPD points. Never the coverage denominator. */
  teacherCount: number;
  /** THE SPLIT: the observed PLC floor + the NCPD topup. Never below the floor. */
  mandatory: number;
  specialised: number | null;
  recommended: number | null;
  mandatoryTeachers: number;
  specialisedTeachers: number | null;
  recommendedTeachers: number | null;
  threshold: number | null;
}

/** The four sexed figures a TERM row needs, already summing to their ALL. */
interface TermSexed {
  teachersInPlc: number;
  attendanceExpected: number;
  attendanceEvents: number;
  teacherHeadcount: number;
}

/**
 * ONE SCHOOL'S PLC ROWS — BOTH CUTS, every sex. PURE: no DB, no clock, no `Math.random()`, so the
 * same source + the same target produce the same rows, which is what makes the idempotency test
 * meaningful rather than accidental.
 *
 * It FAILS LOUDLY rather than coercing, and the failure costs ONE SCHOOL rather than the run
 * (`computePerSchool`).
 *
 * ⚠ A SCHOOL WITH NO PLC IS STILL COMPUTED, AND THAT IS DELIBERATE. `schools_running_plc_count` is
 * the NUMERATOR of "N of Y schools run a PLC"; the Y is the number of ROWS. If a PLC-less school wrote
 * no row it would leave both the numerator and the denominator, and every tier would report 100% of
 * schools running a PLC. So a school with no active PLC gets a real row with
 * `schools_running_plc_count = 0` — a measurement — while a school the arm could not compute at all
 * keeps its prior rows (stale-but-honest) by being absent from the delete scope.
 */
export function buildSchoolPlcRows(
  source: PlcSchoolSource,
  target: PlcTarget,
): SchoolPlcResult {
  const { emisSchoolId, jurisdictionId } = target;
  const roll = target.teachersOnRoll;
  if (!Number.isInteger(roll) || roll < 0)
    throw new PlcTransformError(
      `${emisSchoolId}: teacher_headcount is PINNED to fact_staffing.teachers_on_roll and that pin ` +
        `resolved to ${String(roll)}, which is not a non-negative integer. The schema's ETL ` +
        "contract requires the column on BOTH cuts — an ANNUAL row without it makes " +
        "'% of staff meeting the CPD target' a rate with no denominator on its own row.",
    );

  const shares = plcSexShares(emisSchoolId, target.academicYear);
  const headcount = splitBySex(roll, shares.headPerMille);
  const headcountOf: Record<OvSex, number> = {
    MALE: headcount.male,
    FEMALE: headcount.female,
    ALL: roll,
  };
  const clamped = { n: 0 };

  // ── the SEX-INVARIANT school properties, computed ONCE and COPIED onto all three rows ──────────
  const runsPlc = source.groups.length > 0;
  const schoolsRunningPlcCount = runsPlc ? 1 : 0;
  const programme = source.programme;

  // ── THE TERM CUT ──────────────────────────────────────────────────────────────────────────────
  const rows: FactPlcParticipationRow[] = [];
  const termSummaries: PlcTermSummary[] = [];
  for (const term of target.terms) {
    const sessionsByPlc = new Map(term.sessions.map((s) => [s.plcId, s]));
    let sessionsHeld = 0;
    let attendanceExpected = 0;
    let nonPresentEvents = 0;
    let lastSessionDate: string | null = null;
    let sessionsExpected = programme === null ? null : 0;
    for (const group of source.groups) {
      // THE EXPECTATION comes from the school's OWN cadence, never from a constant this ETL picked.
      // With no programme row there is no configured cadence, so the denominator does not exist and
      // the column stays NULL — 0 would read as "it was supposed to hold none".
      if (programme !== null && sessionsExpected !== null)
        sessionsExpected +=
          expectedSessionsFor(programme.weeksPerSemester, group.overrideFrequency);
      const held = sessionsByPlc.get(group.plcId);
      if (!held) continue;
      sessionsHeld += held.sessionsHeld;
      // PER-PLC, because the cohort differs per PLC: a 20-member group that met twice expects 40
      // attendances, and pooling the school's members against the school's sessions would charge
      // every teacher for every other group's Fridays.
      attendanceExpected += group.activeMembers * held.sessionsHeld;
      nonPresentEvents += held.nonPresentEvents;
      if (lastSessionDate === null || held.lastSessionDate > lastSessionDate)
        lastSessionDate = held.lastSessionDate;
    }
    // ⚠ A SESSION OF A PLC THE GROUP READ DID NOT RETURN. The session read is windowed and the group
    // read is not, so a session belonging to an ARCHIVED PLC can exist with no group beside it. Its
    // sessions are deliberately NOT counted: an archived PLC's Fridays are history, and counting them
    // against a cadence that no longer exists would publish held-without-expected coverage above 100%.
    // It is not silently dropped either — the tally below makes it visible per school.
    const orphanSessions = term.sessions
      .filter((s) => !source.groups.some((g) => g.plcId === s.plcId))
      .reduce((t, s) => t + s.sessionsHeld, 0);

    const attendanceEvents = attendanceExpected - nonPresentEvents;
    if (attendanceEvents < 0)
      // Unreachable while `uniq_plc_session_attendance` holds (≤1 non-present row per member per
      // session) — which is exactly why it is asserted rather than assumed: a source that lost that
      // UNIQUE would publish a negative participation rate.
      throw new PlcTransformError(
        `${emisSchoolId}: term ${String(term.term)} deducted ${String(nonPresentEvents)} ` +
          `non-present event(s) from an expectation of ${String(attendanceExpected)}. ` +
          "attendance_events is a SUBTRACTION (the PLC register is present-by-default), so a " +
          "negative result means the source has lost uniq_plc_session_attendance.",
      );

    const sexed = splitTermSexed(
      {
        teachersInPlc: source.distinctMembers,
        attendanceExpected,
        attendanceEvents,
        teacherHeadcount: roll,
      },
      shares,
      headcountOf,
      emisSchoolId,
    );
    // THE TERM'S VINTAGE — the latest session the school actually held in the window, else the term's
    // own close. NEVER `now()`.
    const asOfDate = lastSessionDate ?? term.endsOn;
    const provenance = stampProvenance(target.etlRunId, asOfDate);
    for (const sex of OV_SEXES) {
      const s = sexed[sex];
      rows.push({
        jurisdictionId,
        periodId: term.periodId,
        sex,
        // ⚠ COPIED, NEVER APPORTIONED. Identical on all three rows.
        schoolsRunningPlcCount,
        teacherHeadcount: s.teacherHeadcount,
        sessionsHeld,
        sessionsExpected,
        attendanceEvents: s.attendanceEvents,
        attendanceExpected: s.attendanceExpected,
        // RE-DERIVED from THIS ROW's own two counts, never apportioned from the ALL rate — which is
        // what makes the sexed rates genuinely differ and makes the parity frame readable.
        plcParticipationRate:
          s.attendanceExpected > 0
            ? plcRateOf(s.attendanceEvents, s.attendanceExpected)
            : null,
        teachersInPlc: s.teachersInPlc,
        // The ANNUAL cut's columns are NULL on a TERM row. All seventeen of them, explicitly.
        cpdPointsTotal: null,
        cpdPointsTeacherCount: null,
        cpdPointsMean: null,
        teachersMeetingCpdThreshold: null,
        annualPlcTarget: null,
        ntcCpdTarget: null,
        cpdPointsMandatoryTotal: null,
        cpdPointsSpecialisedTotal: null,
        cpdPointsRecommendedTotal: null,
        cpdMandatoryTeacherCount: null,
        cpdSpecialisedTeacherCount: null,
        cpdRecommendedTeacherCount: null,
        ...provenance,
      });
    }
    termSummaries.push({
      periodId: term.periodId,
      term: term.term,
      asOfDate,
      sessionsHeld,
      sessionsExpected,
      attendanceEvents,
      attendanceExpected,
      teachersInPlc: source.distinctMembers,
      teacherHeadcount: roll,
      orphanSessions,
    });
  }

  // ── THE ANNUAL CUT ────────────────────────────────────────────────────────────────────────────
  //
  // 1 · THE OBSERVED PLC POINTS — the floor under Mandatory and the only CPD figure this product
  //     genuinely measures. A school whose teachers earned nothing has a REAL 0, not an absence.
  const plcPointsAll = source.annualPoints?.pointsHundredths ?? 0;
  const plcTeachersAll = source.annualPoints?.teachersWithPoints ?? 0;
  if (plcPointsAll < 0 || !Number.isInteger(plcPointsAll))
    throw new PlcTransformError(
      `${emisSchoolId}: PLC points summed to ${String(plcPointsAll)} hundredths — the ledger's two ` +
        "arms are CHECKed non-negative upstream, so this is a source defect.",
    );
  if (plcTeachersAll > roll)
    // The ledger's members are staff of this school, and `teachers_on_roll` is this warehouse's own
    // count of them, so the two can legitimately differ (a non-teaching member of staff may sit in a
    // PLC). It is tallied as a clamp rather than refused, for the reason `clampToRoll` gives.
    clamped.n += 1;
  const plcPoints = splitBySex(plcPointsAll, shares.pointsPerMille);
  const plcTeachers = splitBySex(Math.min(plcTeachersAll, roll), shares.pointsPerMille, {
    female: headcountOf.FEMALE,
    male: headcountOf.MALE,
  });
  const plcPointsOf: Record<OvSex, number> = {
    MALE: plcPoints.male,
    FEMALE: plcPoints.female,
    ALL: plcPointsAll,
  };
  const plcTeachersOf: Record<OvSex, number> = {
    MALE: plcTeachers.male,
    FEMALE: plcTeachers.female,
    ALL: plcTeachers.male + plcTeachers.female,
  };

  // 2 · THE NTC HALF — read FROM THE SEAM or not at all. The transform invents nothing (C1).
  const ntc = source.ntc;
  // ⚠ THE GATE IS PER **SCHOOL**, NOT PER SEX ROW, and that distinction is load-bearing. A school the
  // extract covers for one sex only (a single-sex staff, or an incomplete return) must not end up
  // with a populated FEMALE row beside a NULL MALE one: the ALL row would then be neither the sum of
  // the split nor absent, and the reader's discriminated status has no value for "half sourced". So a
  // COVERED school's missing sex row contributes ZERO — which is the true statement for a school with
  // no male teachers and the only coherent one for an incomplete return — while an UNCOVERED school
  // (no `ntc` summary at all) has every NTC column NULL on all three rows.
  const ntcSourced = ntc !== null;
  // The statutory total is the SAME number for every school and both sexes in a given year, so two
  // disagreeing sex rows are a source defect rather than a figure to average. Refused by name.
  const targets = [ntc?.bySex.MALE?.cpdTargetHundredths, ntc?.bySex.FEMALE?.cpdTargetHundredths]
    .filter((t): t is number => typeof t === "number");
  if (targets.length === 2 && targets[0] !== targets[1])
    throw new PlcTransformError(
      `${emisSchoolId}: the NTC extract states two different statutory CPD targets for ` +
        `${target.academicYear} (${pointsOf(targets[0]!)} vs ${pointsOf(targets[1]!)}). ` +
        "ntc_cpd_target is a national POLICY VARIABLE, identical for every school and both sexes in " +
        "a year, so there is nothing to reconcile.",
    );
  const ntcTargetHundredths = targets[0] ?? null;
  /** Per-sex NTC figures, already clamped to that sex's roll. NULL only when the SCHOOL is uncovered. */
  const ntcOf = (sex: NtcSourceSex) => {
    if (!ntc) return null;
    const row = ntc.bySex[sex];
    const cap = headcountOf[sex];
    if (!row)
      return {
        specialised: 0,
        recommended: 0,
        ncpd: 0,
        mandatoryTeachers: 0,
        specialisedTeachers: 0,
        recommendedTeachers: 0,
        threshold: 0,
      };
    return {
      specialised: row.specialisedHundredths,
      recommended: row.recommendedHundredths,
      ncpd: row.ncpdHundredths,
      mandatoryTeachers: clampToRoll(row.mandatoryTeachers, cap, clamped),
      specialisedTeachers: clampToRoll(row.specialisedTeachers, cap, clamped),
      recommendedTeachers: clampToRoll(row.recommendedTeachers, cap, clamped),
      threshold: clampToRoll(row.teachersMeetingThreshold, cap, clamped),
    };
  };
  const ntcMale = ntcOf("MALE");
  const ntcFemale = ntcOf("FEMALE");

  /** One sex's whole ANNUAL arithmetic. ALL is assembled from the two sexed results, never drawn. */
  const annualFor = (sex: OvSex): AnnualSexFigures => {
    const plcPts = plcPointsOf[sex];
    const plcTch = plcTeachersOf[sex];
    if (sex === "ALL") {
      const male = annualFor("MALE");
      const female = annualFor("FEMALE");
      // ⚠ ADDITIVE COLUMNS ARE SUMMED FROM THE SPLIT so the ALL row and the split agree EXACTLY —
      // the property every roll-up in C12 rests on. The MEAN is NOT summed: it is re-derived from the
      // ALL row's own total and count, because the average of two means is not a mean.
      const total = male.total + female.total;
      const teacherCount = male.teacherCount + female.teacherCount;
      return {
        total,
        teacherCount,
        mandatory: male.mandatory + female.mandatory,
        specialised:
          male.specialised === null || female.specialised === null
            ? null
            : male.specialised + female.specialised,
        recommended:
          male.recommended === null || female.recommended === null
            ? null
            : male.recommended + female.recommended,
        mandatoryTeachers: male.mandatoryTeachers + female.mandatoryTeachers,
        specialisedTeachers:
          male.specialisedTeachers === null || female.specialisedTeachers === null
            ? null
            : male.specialisedTeachers + female.specialisedTeachers,
        recommendedTeachers:
          male.recommendedTeachers === null || female.recommendedTeachers === null
            ? null
            : male.recommendedTeachers + female.recommendedTeachers,
        threshold:
          male.threshold === null || female.threshold === null
            ? null
            : male.threshold + female.threshold,
      };
    }
    const n = sex === "MALE" ? ntcMale : ntcFemale;
    if (!n) {
      // ⚠ THE SOURCING GATE, CLOSED. Specialised, Recommended, their teacher counts and the
      // threshold stay NULL — NEVER 0. Mandatory IS populated, as the schema's explicitly permitted
      // PLC-ONLY PARTIAL (the ETL states it is one: see this module's header and the run report), and
      // `cpd_points_total` falls back to the PLC-only subtotal.
      return {
        total: plcPts,
        teacherCount: plcTch,
        mandatory: plcPts,
        specialised: null,
        recommended: null,
        mandatoryTeachers: plcTch,
        specialisedTeachers: null,
        recommendedTeachers: null,
        threshold: null,
      };
    }
    // ⚠ THE MANDATORY SPLIT (C7): the OBSERVED PLC floor + the NCPD topup FROM the source. By
    // construction `mandatory >= plcPts`, which is the invariant that keeps the demo consistent with
    // the real PLC feed and lets a later real NTC feed only ever ADD to the floor.
    const mandatory = plcPts + n.ncpd;
    // ⚠ THE THREE CATEGORY TEACHER COUNTS OVERLAP (one teacher can earn in two classes), so their
    // union is NOT their sum and is NOT recoverable from counts at all. The MEAN's denominator must
    // be at least the largest of them and at most the roll, so the tightest figure the data permits
    // is the maximum — and Mandatory's own count is itself floored at the PLC-observed count.
    const mandatoryTeachers = Math.max(n.mandatoryTeachers, plcTch);
    const teacherCount = Math.min(
      Math.max(mandatoryTeachers, n.specialisedTeachers, n.recommendedTeachers),
      headcountOf[sex],
    );
    return {
      total: mandatory + n.specialised + n.recommended,
      teacherCount,
      mandatory,
      specialised: n.specialised,
      recommended: n.recommended,
      mandatoryTeachers,
      specialisedTeachers: n.specialisedTeachers,
      recommendedTeachers: n.recommendedTeachers,
      threshold: n.threshold,
    };
  };

  // THE ANNUAL VINTAGE — the latest frozen award in the year, else the year's own close. NEVER now().
  const annualAsOf = source.annualPoints?.lastSettledAt ?? target.annualEndsOn;
  const annualProvenance = stampProvenance(target.etlRunId, annualAsOf);
  const annualAll = annualFor("ALL");
  for (const sex of OV_SEXES) {
    const a = annualFor(sex);
    rows.push({
      jurisdictionId,
      periodId: target.annualPeriodId,
      sex,
      schoolsRunningPlcCount,
      teacherHeadcount: headcountOf[sex],
      // The TERM cut's columns are NULL on an ANNUAL row.
      sessionsHeld: null,
      sessionsExpected: null,
      attendanceEvents: null,
      attendanceExpected: null,
      plcParticipationRate: null,
      teachersInPlc: null,
      cpdPointsTotal: pointsOf(a.total),
      cpdPointsTeacherCount: a.teacherCount,
      // THE MEAN DIVIDES BY `cpd_points_teacher_count`, NOT BY `teacher_headcount` — the schema is
      // explicit: it is the mean among teachers who earned ANY points. NULL when nobody did, because
      // 0.00 would be a mean over an empty set.
      cpdPointsMean: a.teacherCount > 0 ? pointsOf(divideRound(a.total, a.teacherCount)) : null,
      teachersMeetingCpdThreshold: a.threshold,
      // ⚠ SEX-INVARIANT scalars, COPIED. NULL — never 0 — when never configured / not sourced.
      annualPlcTarget: programme?.annualPlcTarget ?? null,
      ntcCpdTarget: ntcTargetHundredths === null ? null : pointsOf(ntcTargetHundredths),
      cpdPointsMandatoryTotal: pointsOf(a.mandatory),
      cpdPointsSpecialisedTotal: a.specialised === null ? null : pointsOf(a.specialised),
      cpdPointsRecommendedTotal: a.recommended === null ? null : pointsOf(a.recommended),
      cpdMandatoryTeacherCount: a.mandatoryTeachers,
      cpdSpecialisedTeacherCount: a.specialisedTeachers,
      cpdRecommendedTeacherCount: a.recommendedTeachers,
      ...annualProvenance,
    });
  }

  const result: SchoolPlcResult = {
    jurisdictionId,
    emisSchoolId,
    rows,
    runsPlc,
    terms: termSummaries,
    annual: {
      periodId: target.annualPeriodId,
      asOfDate: annualAsOf,
      teacherHeadcount: roll,
      plcPointsHundredths: plcPointsAll,
      cpdPointsTotalHundredths: annualAll.total,
      teachersMeetingCpdThreshold: annualAll.threshold,
      ntcSourced,
    },
    ntcCountsClamped: clamped.n,
    femaleSharePerMille: shares.headPerMille,
  };
  assertPlcInvariants(result, { emisSchoolId, plcPointsOf, annualPeriodId: target.annualPeriodId });
  return result;
}

/** Split one term's four sexed figures so each sums back to its ALL, within the per-sex headcaps. */
function splitTermSexed(
  all: TermSexed,
  shares: PlcSexShares,
  headcountOf: Record<OvSex, number>,
  emisSchoolId: string,
): Record<OvSex, TermSexed> {
  // ⚠ `teachers_in_plc` IS NOT CAPPED AT THE HEADCOUNT, and the omission is deliberate. A PLC's
  // cohort is STAFF, and `teachers_on_roll` is this warehouse's count of TEACHERS, so a school whose
  // non-teaching staff join a PLC can legitimately show coverage above 100%. Capping it would silently
  // rewrite a measured membership to fit a derived denominator; the demo generator instead draws
  // cohorts that fit the roll, so the case is reachable only from real data — where it is true.
  const members = splitBySex(all.teachersInPlc, shares.membershipPerMille);
  const expected = splitBySex(all.attendanceExpected, shares.membershipPerMille);
  const head = splitBySex(all.teacherHeadcount, shares.headPerMille);
  if (head.female !== headcountOf.FEMALE || head.male !== headcountOf.MALE)
    throw new PlcTransformError(
      `${emisSchoolId}: the term cut's headcount split disagrees with the annual cut's — both must ` +
        "come from the SAME pinned roll and the SAME share, or the two sub-panels of one dashboard " +
        "would divide different denominators.",
    );
  // ⚠ THE EVENTS ARE DERIVED FROM A SEXED *FRACTION*, NOT FROM A SHARE OF THE TOTAL. A share would
  // make both sexes' rates equal the school's own and the parity frame would show a flat gap on every
  // school in Ghana. A tilted fraction, bounded by each sex's own expectation, produces a real gap
  // while keeping MALE + FEMALE = ALL exactly — the female figure is bounded and the male one is the
  // remainder, so neither sex can exceed its expectation and neither rate can exceed 100%.
  const overall = all.attendanceExpected > 0 ? all.attendanceEvents / all.attendanceExpected : 0;
  const femaleFraction = clamp01(overall + shares.participationTilt);
  let femaleEvents = divideRound(
    Math.round(expected.female * femaleFraction * 1000),
    1000,
  );
  const lo = Math.max(0, all.attendanceEvents - expected.male);
  const hi = Math.min(all.attendanceEvents, expected.female);
  if (femaleEvents < lo) femaleEvents = lo;
  if (femaleEvents > hi) femaleEvents = hi;
  const sexedOf = (
    sex: OvSex,
  ): TermSexed =>
    sex === "ALL"
      ? all
      : {
          teachersInPlc: sex === "FEMALE" ? members.female : members.male,
          attendanceExpected: sex === "FEMALE" ? expected.female : expected.male,
          attendanceEvents:
            sex === "FEMALE" ? femaleEvents : all.attendanceEvents - femaleEvents,
          teacherHeadcount: sex === "FEMALE" ? head.female : head.male,
        };
  return { MALE: sexedOf("MALE"), FEMALE: sexedOf("FEMALE"), ALL: all };
}

/**
 * THE ARITHMETIC SELF-CHECK, per school, before anything is written.
 *
 * Nine claims, every one of them something a reader will rely on and none of them expressible as a
 * table CHECK (each spans several rows, or restates a formula the schema states in prose):
 *   1. every grain key (period_id, sex) appears EXACTLY ONCE, and each period carries all three sexes;
 *   2. the SEX-INVARIANT columns are REPEATED IDENTICALLY across the three sex rows — the check that
 *      catches an apportioned `sessions_held`, which would halve the national session count while
 *      leaving the coverage rate looking right;
 *   3. the ADDITIVE columns satisfy MALE + FEMALE = ALL, exactly (the roll-up's whole basis);
 *   4. the stored rates are the rates their OWN row's counts imply, so a stale or borrowed figure
 *      cannot ship, and the MEAN divides by `cpd_points_teacher_count` while coverage divides by
 *      `teacher_headcount`;
 *   5. ⚠ THE SOURCING GATE: the five NTC-sourced columns are either ALL non-null or ALL null on a
 *      given row — a half-populated NTC row is the one state neither the gate nor the reader's
 *      discriminated status can express — and when null they are NULL rather than 0;
 *   6. ⚠ THE MANDATORY FLOOR (C7): `cpd_points_mandatory_total >= the observed PLC points`;
 *   7. ⚠ THE RECONCILIATION (C8): when all three categories are populated,
 *      mandatory + specialised + recommended = cpd_points_total, exactly. When they are not, the
 *      identity is NOT asserted and the total is the PLC-only subtotal;
 *   8. `teachers_meeting_cpd_threshold <= teacher_headcount` on the SAME row (the schema's own
 *      invariant, which is only checkable because the headcount is on both cuts);
 *   9. `attendance_events <= attendance_expected`, `teacher_headcount` present on BOTH cuts, and every
 *      numeric literal fits its column — a `numeric field overflow` from the INSERT names no school.
 * A failure here is a defect in `buildSchoolPlcRows`, not in the data, so it names the school and the
 * row.
 */
export function assertPlcInvariants(
  result: SchoolPlcResult,
  context: {
    emisSchoolId: string;
    /** The genuinely observed PLC points per sex — the floor claim 6 is checked against. */
    plcPointsOf: Record<OvSex, number>;
    annualPeriodId: string;
  },
): void {
  const { emisSchoolId } = context;
  const fail = (message: string): never => {
    throw new PlcTransformError(`${emisSchoolId}: ${message}`);
  };
  const seen = new Set<string>();
  const byPeriod = new Map<string, Map<OvSex, FactPlcParticipationRow>>();
  for (const row of result.rows) {
    const key = `${row.periodId}\u0000${row.sex}`;
    if (seen.has(key))
      fail(
        `duplicate (period_id, sex) row for ${row.periodId}/${row.sex}. ` +
          "fact_plc_participation HAS a grain UNIQUE, so this would be rejected at the INSERT — " +
          "which names a constraint rather than a school, hence this check.",
      );
    seen.add(key);
    if (!(OV_SEXES as readonly string[]).includes(row.sex))
      fail(`row ${row.periodId} carries sex "${String(row.sex)}", which is not an ov_sex member.`);
    if (row.source !== "OPERATIONAL_AGG")
      // C4: this slice mints NO new ov_source value. The demo state is recognised by the table-level
      // signature (a non-null NTC column on an OPERATIONAL_AGG row), never by a throwaway enum member.
      fail(
        `row ${row.periodId}/${row.sex} carries source "${String(row.source)}". Every ` +
          "fact_plc_participation row is OPERATIONAL_AGG — its spine genuinely is an operational " +
          "aggregate, and no new ov_source value is minted by this slice.",
      );
    if (!Number.isInteger(row.teacherHeadcount) || row.teacherHeadcount < 0)
      fail(
        `row ${row.periodId}/${row.sex} has teacher_headcount ${String(row.teacherHeadcount)}. ` +
          "The schema's ETL contract requires it on BOTH cuts: without it the CPD-target rate has " +
          "no on-roll denominator on its own row and the threshold invariant is VACUOUSLY true.",
      );
    if (row.schoolsRunningPlcCount !== 0 && row.schoolsRunningPlcCount !== 1)
      fail(
        `row ${row.periodId}/${row.sex} has schools_running_plc_count ` +
          `${String(row.schoolsRunningPlcCount)} — it is a 0/1 per-school count, not a tally.`,
      );
    let group = byPeriod.get(row.periodId);
    if (!group) {
      group = new Map();
      byPeriod.set(row.periodId, group);
    }
    group.set(row.sex, row);

    const isAnnual = row.periodId === context.annualPeriodId;
    if (isAnnual) {
      if (row.sessionsHeld !== null || row.attendanceEvents !== null || row.teachersInPlc !== null)
        fail(`ANNUAL row ${row.sex} carries TERM-cut columns; the two cuts are different period_ids.`);
      // CLAIM 5 — THE SOURCING GATE, all-or-nothing.
      const ntcColumns = [
        ["cpd_points_specialised_total", row.cpdPointsSpecialisedTotal],
        ["cpd_points_recommended_total", row.cpdPointsRecommendedTotal],
        ["cpd_specialised_teacher_count", row.cpdSpecialisedTeacherCount],
        ["cpd_recommended_teacher_count", row.cpdRecommendedTeacherCount],
        ["teachers_meeting_cpd_threshold", row.teachersMeetingCpdThreshold],
      ] as const;
      const populated = ntcColumns.filter(([, v]) => v !== null).map(([name]) => name);
      if (populated.length !== 0 && populated.length !== ntcColumns.length)
        fail(
          `ANNUAL row ${row.sex} populates ${populated.length} of ${ntcColumns.length} ` +
            `NTC-sourced columns (${populated.join(", ")}). They come from ONE source row, so a ` +
            "half-populated NTC row is a state neither the sourcing gate nor the reader's " +
            "discriminated status can express.",
        );
      // CLAIM 6 — THE MANDATORY FLOOR (C7).
      const mandatory = hundredthsOf(row.cpdPointsMandatoryTotal, "cpd_points_mandatory_total", fail);
      const floor = context.plcPointsOf[row.sex];
      if (mandatory < floor)
        fail(
          `ANNUAL row ${row.sex} stores cpd_points_mandatory_total ${row.cpdPointsMandatoryTotal} ` +
            `but the GENUINELY OBSERVED PLC points are ${pointsOf(floor)}. Mandatory is a SPLIT — ` +
            "the observed PLC floor PLUS the NCPD topup — so it can never be below the floor, or a " +
            "later real NTC feed would contradict the PLC feed it is supposed to extend.",
        );
      // CLAIM 7 — THE RECONCILIATION (C8), only when all three categories are populated.
      const total = hundredthsOf(row.cpdPointsTotal, "cpd_points_total", fail);
      if (row.cpdPointsSpecialisedTotal !== null && row.cpdPointsRecommendedTotal !== null) {
        const sum =
          mandatory +
          hundredthsOf(row.cpdPointsSpecialisedTotal, "cpd_points_specialised_total", fail) +
          hundredthsOf(row.cpdPointsRecommendedTotal, "cpd_points_recommended_total", fail);
        if (sum !== total)
          fail(
            `ANNUAL row ${row.sex}: mandatory + specialised + recommended = ${pointsOf(sum)} but ` +
              `cpd_points_total is ${row.cpdPointsTotal}. The schema's load-bearing identity holds ` +
              "whenever the categories are populated, and it must hold EXACTLY — which is why every " +
              "figure is carried in integer hundredths rather than as a float.",
          );
      } else if (total !== floor)
        fail(
          `ANNUAL row ${row.sex}: with no NTC source, cpd_points_total must fall back to the ` +
            `PLC-only subtotal ${pointsOf(floor)}, got ${row.cpdPointsTotal}.`,
        );
      // CLAIM 8 — the schema's own single-row invariant.
      if (
        row.teachersMeetingCpdThreshold !== null &&
        row.teachersMeetingCpdThreshold > row.teacherHeadcount
      )
        fail(
          `ANNUAL row ${row.sex} has ${String(row.teachersMeetingCpdThreshold)} teacher(s) meeting ` +
            `the CPD threshold out of a headcount of ${String(row.teacherHeadcount)} — a ` +
            "compliance rate above 100%.",
        );
      // CLAIM 4 — the MEAN is re-derived from THIS row's own total and ITS OWN denominator, and that
      // denominator is cpd_points_teacher_count, NOT teacher_headcount.
      const count = row.cpdPointsTeacherCount;
      if (count === null || !Number.isInteger(count) || count < 0)
        fail(`ANNUAL row ${row.sex} has cpd_points_teacher_count ${String(count)}.`);
      const expectedMean = count! > 0 ? pointsOf(divideRound(total, count!)) : null;
      if (row.cpdPointsMean !== expectedMean)
        fail(
          `ANNUAL row ${row.sex} stores cpd_points_mean ${String(row.cpdPointsMean)} but its own ` +
            `total ÷ cpd_points_teacher_count implies ${String(expectedMean)}. The mean's ` +
            "denominator is the teachers who EARNED points, never teacher_headcount — dividing by " +
            "the headcount would understate every school that has non-participants.",
        );
      for (const [name, value, max] of [
        ["cpd_points_total", row.cpdPointsTotal, MAX_POINTS_HUNDREDTHS],
        ["cpd_points_mandatory_total", row.cpdPointsMandatoryTotal, MAX_POINTS_HUNDREDTHS],
        ["cpd_points_specialised_total", row.cpdPointsSpecialisedTotal, MAX_POINTS_HUNDREDTHS],
        ["cpd_points_recommended_total", row.cpdPointsRecommendedTotal, MAX_POINTS_HUNDREDTHS],
        ["cpd_points_mean", row.cpdPointsMean, MAX_SMALL_HUNDREDTHS],
        ["annual_plc_target", row.annualPlcTarget, MAX_SMALL_HUNDREDTHS],
        ["ntc_cpd_target", row.ntcCpdTarget, MAX_SMALL_HUNDREDTHS],
      ] as const) {
        if (value === null) continue;
        if (!/^-?\d+\.\d{2}$/.test(value))
          fail(`ANNUAL row ${row.sex} ${name} "${value}" is not a numeric(_,2) literal.`);
        if (Math.abs(hundredthsOf(value, name, fail)) > max)
          fail(
            `ANNUAL row ${row.sex} ${name} ${value} does not fit its column — the INSERT would ` +
              "raise `numeric field overflow` with no school named.",
          );
      }
    } else {
      if (row.cpdPointsTotal !== null || row.teachersMeetingCpdThreshold !== null)
        fail(`TERM row ${row.sex} carries ANNUAL-cut columns; the two cuts are different period_ids.`);
      const events = row.attendanceEvents;
      const expected = row.attendanceExpected;
      if (events === null || expected === null || events < 0 || expected < 0)
        fail(
          `TERM row ${row.sex} has attendance ${String(events)}/${String(expected)} — both counts ` +
            "are required on a TERM row and neither may be negative.",
        );
      if (events! > expected!)
        fail(
          `TERM row ${row.sex} has ${String(events)} attendance event(s) against an expectation of ` +
            `${String(expected)} — a participation rate above 100%. The events are a SUBTRACTION ` +
            "from the expectation (present-by-default), so this is arithmetically impossible.",
        );
      // CLAIM 4 — the rate is the rate THIS ROW's own counts imply, and NULL (not 0.00) with no
      // denominator.
      const expectedRate = expected! > 0 ? plcRateOf(events!, expected!) : null;
      if (row.plcParticipationRate !== expectedRate)
        fail(
          `TERM row ${row.sex} stores plc_participation_rate ${String(row.plcParticipationRate)} ` +
            `but its own counts imply ${String(expectedRate)} — the rate is RE-DERIVED per row and ` +
            "never apportioned from the ALL row's rate.",
        );
      if (row.sessionsExpected !== null && row.sessionsHeld !== null && row.sessionsExpected < 0)
        fail(`TERM row ${row.sex} has a negative sessions_expected.`);
    }
  }

  for (const [periodId, group] of byPeriod) {
    const male = group.get("MALE");
    const female = group.get("FEMALE");
    const all = group.get("ALL");
    // CLAIM 1 — all three sexes on every period. The ALL row is stored BESIDE the split, so a missing
    // one makes a single-figure read silently return nothing rather than obviously fail.
    if (!male || !female || !all)
      fail(
        `period ${periodId} has ${group.size} of 3 sex rows. ALL is stored BESIDE MALE and FEMALE, ` +
          "so all three are always written.",
      );
    // CLAIM 2 — THE SEX-INVARIANT COLUMNS ARE COPIED, NOT APPORTIONED. This is the check that catches
    // the error the schema wrote twenty lines about: an apportioned sessions_held halves the national
    // session count while the coverage rate still reads correctly, so nothing in the output signals it.
    for (const [name, pick] of [
      ["schools_running_plc_count", (r: FactPlcParticipationRow) => r.schoolsRunningPlcCount],
      ["sessions_held", (r: FactPlcParticipationRow) => r.sessionsHeld],
      ["sessions_expected", (r: FactPlcParticipationRow) => r.sessionsExpected],
      ["annual_plc_target", (r: FactPlcParticipationRow) => r.annualPlcTarget],
      ["ntc_cpd_target", (r: FactPlcParticipationRow) => r.ntcCpdTarget],
    ] as const) {
      if (pick(male!) !== pick(all!) || pick(female!) !== pick(all!))
        fail(
          `period ${periodId}: ${name} differs across the sex rows (` +
            `MALE ${String(pick(male!))}, FEMALE ${String(pick(female!))}, ALL ${String(pick(all!))}). ` +
            "It is SEX-INVARIANT and must be the IDENTICAL value on all three rows — copied, never " +
            "apportioned. Summing it under the MALE/FEMALE split returns exactly 2×, and the derived " +
            "rate still looks right because the doubling cancels.",
        );
    }
    // CLAIM 3 — MALE + FEMALE = ALL on every ADDITIVE column, exactly.
    for (const [name, pick] of [
      ["teacher_headcount", (r: FactPlcParticipationRow) => r.teacherHeadcount],
      ["teachers_in_plc", (r: FactPlcParticipationRow) => r.teachersInPlc],
      ["attendance_events", (r: FactPlcParticipationRow) => r.attendanceEvents],
      ["attendance_expected", (r: FactPlcParticipationRow) => r.attendanceExpected],
      ["cpd_points_teacher_count", (r: FactPlcParticipationRow) => r.cpdPointsTeacherCount],
      [
        "teachers_meeting_cpd_threshold",
        (r: FactPlcParticipationRow) => r.teachersMeetingCpdThreshold,
      ],
      ["cpd_mandatory_teacher_count", (r: FactPlcParticipationRow) => r.cpdMandatoryTeacherCount],
      [
        "cpd_specialised_teacher_count",
        (r: FactPlcParticipationRow) => r.cpdSpecialisedTeacherCount,
      ],
      [
        "cpd_recommended_teacher_count",
        (r: FactPlcParticipationRow) => r.cpdRecommendedTeacherCount,
      ],
    ] as const) {
      const a = pick(all!);
      const m = pick(male!);
      const f = pick(female!);
      if (a === null || m === null || f === null) {
        if (a !== null || m !== null || f !== null)
          fail(
            `period ${periodId}: ${name} is NULL on some sex rows and not others — a column is ` +
              "absent for the whole measure or for none of it.",
          );
        continue;
      }
      if (m + f !== a)
        fail(
          `period ${periodId}: ${name} MALE ${String(m)} + FEMALE ${String(f)} = ${String(m + f)}, ` +
            `but the ALL row says ${String(a)}. Every additive column must reconcile EXACTLY, or a ` +
            "tier figure read with sex='ALL' disagrees with the same figure read as a split.",
        );
    }
    for (const [name, pick] of [
      ["cpd_points_total", (r: FactPlcParticipationRow) => r.cpdPointsTotal],
      ["cpd_points_mandatory_total", (r: FactPlcParticipationRow) => r.cpdPointsMandatoryTotal],
      ["cpd_points_specialised_total", (r: FactPlcParticipationRow) => r.cpdPointsSpecialisedTotal],
      ["cpd_points_recommended_total", (r: FactPlcParticipationRow) => r.cpdPointsRecommendedTotal],
    ] as const) {
      const a = pick(all!);
      const m = pick(male!);
      const f = pick(female!);
      if (a === null || m === null || f === null) {
        if (a !== null || m !== null || f !== null)
          fail(`period ${periodId}: ${name} is NULL on some sex rows and not others.`);
        continue;
      }
      const sum =
        hundredthsOf(m, name, fail) + hundredthsOf(f, name, fail);
      if (sum !== hundredthsOf(a, name, fail))
        fail(
          `period ${periodId}: ${name} MALE ${m} + FEMALE ${f} = ${pointsOf(sum)}, but the ALL row ` +
            `says ${a}. The points totals are additive and must reconcile EXACTLY.`,
        );
    }
  }
}

/** A numeric(_,2) literal back to exact integer hundredths. Never through a float multiplication. */
function hundredthsOf(
  literal: string | null,
  column: string,
  fail: (message: string) => never,
): number {
  if (literal === null)
    return fail(
      `${column} is NULL where the invariants require a figure — a column that is NULL for some ` +
        "rows of a measure and populated for others is the one state no reader can express.",
    );
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(literal);
  if (!match) return fail(`${column} "${literal}" is not a numeric(_,2) literal.`);
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 100 + Number(match[3]));
}

// ── the write ───────────────────────────────────────────────────────────────────────────────────

/**
 * ONE PERIOD's computed rows, with the DELETE SCOPE stated explicitly. ONE BATCH PER CUT: the TERM
 * periods and the ANNUAL period are different `period_id`s, so a school that was computed for the
 * year has its annual row refreshed and each of its terms refreshed independently.
 *
 * The scope is "every school this run SUCCESSFULLY COMPUTED FOR THIS PERIOD" — which INCLUDES a school
 * that computed to `schools_running_plc_count = 0` (it runs no PLC, and that is a measurement). It
 * EXCLUDES a school whose compute failed and a school the arm did not run for at all — in particular
 * every school in a NON-CURRENT academic year, where the arm has no pinned roll. Those keep their
 * prior rows: stale-but-honest, as everywhere else in this pipeline.
 */
export interface PlcWriteBatch {
  periodId: string;
  /** SCHOOL-level jurisdiction ids successfully computed FOR THIS PERIOD. THE DELETE BOUND. */
  jurisdictionIds: string[];
  rows: FactPlcParticipationRow[];
}

export interface PlcWriteResult {
  deleted: number;
  inserted: number;
  perPeriod: { periodId: string; deleted: number; inserted: number }[];
}

/**
 * DELETE-BY-(PERIOD, JURISDICTION ∈ SCOPE)-THEN-INSERT, PER PERIOD, inside the caller's transaction.
 * The inherited properties — bounded delete, ONE transaction for the whole run, delete-then-insert
 * rather than upsert — hold verbatim; read `writeEnrolmentFactsTx`'s header for the argument.
 *
 * ⚠ UNLIKE THE SIX ARMS BEFORE IT, `fact_plc_participation` **HAS** A GRAIN UNIQUE —
 * `fact_plc_participation_jurisdiction_period_sex_idx` over (jurisdiction_id, period_id, sex), one of
 * the three additive-domain tables that deviate from the PK-only original eight. So a duplicate cannot
 * silently insert: the INSERT raises. The POST-INSERT ASSERTION below is kept anyway, for two reasons
 * that are not symmetry:
 *   · it names the SCHOOL and the GRAIN in prose, where the index names a constraint — and a run that
 *     fails at 3am should say what went wrong, not which btree noticed;
 *   · it is PERIOD-WIDE, so it also re-scans rows this run's scope did NOT cover. The unique index
 *     makes a duplicate unreachable TODAY; it would stop being unreachable the moment a future slice
 *     re-grained the table or added a `source` column to the key (exactly what happened to
 *     `fact_performance_exam`), and this is the check that would catch that rather than discover it.
 * It is NULL-safe on `sex` only in the trivial sense — `sex` is NOT NULL — so the key needs no
 * `coalesce` subtlety, unlike the fees writer's nullable `stage`.
 */
export async function writePlcFactsTx(
  tx: postgres.TransactionSql,
  batches: PlcWriteBatch[],
): Promise<PlcWriteResult> {
  const perPeriod: PlcWriteResult["perPeriod"] = [];
  let totalDeleted = 0;
  let totalInserted = 0;

  for (const batch of batches) {
    const { periodId, jurisdictionIds, rows: rowsToWrite } = batch;

    let deleted = 0;
    if (jurisdictionIds.length > 0) {
      const removed = await tx`
        delete from fact_plc_participation
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
        sex: r.sex,
        schools_running_plc_count: r.schoolsRunningPlcCount,
        teacher_headcount: r.teacherHeadcount,
        sessions_held: r.sessionsHeld,
        sessions_expected: r.sessionsExpected,
        attendance_events: r.attendanceEvents,
        attendance_expected: r.attendanceExpected,
        plc_participation_rate: r.plcParticipationRate,
        teachers_in_plc: r.teachersInPlc,
        cpd_points_total: r.cpdPointsTotal,
        cpd_points_teacher_count: r.cpdPointsTeacherCount,
        cpd_points_mean: r.cpdPointsMean,
        teachers_meeting_cpd_threshold: r.teachersMeetingCpdThreshold,
        annual_plc_target: r.annualPlcTarget,
        ntc_cpd_target: r.ntcCpdTarget,
        cpd_points_mandatory_total: r.cpdPointsMandatoryTotal,
        cpd_points_specialised_total: r.cpdPointsSpecialisedTotal,
        cpd_points_recommended_total: r.cpdPointsRecommendedTotal,
        cpd_mandatory_teacher_count: r.cpdMandatoryTeacherCount,
        cpd_specialised_teacher_count: r.cpdSpecialisedTeacherCount,
        cpd_recommended_teacher_count: r.cpdRecommendedTeacherCount,
        source: r.source,
        as_of_date: r.asOfDate,
        etl_run_id: r.etlRunId,
      }));
      const result = await tx`insert into fact_plc_participation ${tx(chunk)}`;
      inserted += result.count;
    }

    // THE DUPLICATE ASSERTION OVER THE FULL GRAIN — see the header. Inside the transaction, so
    // tripping it rolls the WHOLE RUN (all seven arms) back.
    const dupes = await tx<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, sex
          from fact_plc_participation
         where period_id = ${periodId}::uuid
         group by jurisdiction_id, period_id, sex
        having count(*) > 1
      ) d`;
    if ((dupes[0]?.n ?? 0) > 0)
      throw new Error(
        `fact_plc_participation has ${dupes[0]!.n} duplicated grain key(s) ` +
          `(jurisdiction_id, period_id, sex) for period ${periodId}. A duplicate DOUBLES every ` +
          "additive roll-up above it — teachers_in_plc, the attendance counts, the points totals and " +
          "the threshold count — while leaving every derived rate looking perfectly right, because " +
          "the doubling cancels in Σnum ÷ Σden.",
      );

    perPeriod.push({ periodId, deleted, inserted });
    totalDeleted += deleted;
    totalInserted += inserted;
  }

  return { deleted: totalDeleted, inserted: totalInserted, perPeriod };
}

/** The standalone form — its OWN transaction. The pipeline uses the `…Tx` form instead, so that all
 *  SEVEN arms of one run are ONE transaction (see `lib/etl/pipeline.ts` step 5c). */
export async function writePlcFacts(
  sql: postgres.Sql,
  batches: PlcWriteBatch[],
): Promise<PlcWriteResult> {
  return (await sql.begin(async (tx) =>
    writePlcFactsTx(tx as unknown as postgres.TransactionSql, batches),
  )) as unknown as PlcWriteResult;
}
