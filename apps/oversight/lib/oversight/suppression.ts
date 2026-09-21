/**
 * SMALL-CELL SUPPRESSION for sexed, SCHOOL-GRAIN staff facts.
 *
 * Applies to `fact_teacher_attendance` and `fact_plc_participation` — the two analytics tables that
 * break staff measures down by sex at the grain of a single school (db/schema/fact.ts). Everything
 * here is a pure function over denominators; no I/O, so it can be unit-tested exhaustively and
 * reasoned about without a database.
 *
 * ═══ WHY AN AGGREGATE NEEDS SUPPRESSION AT ALL ══════════════════════════════════════════════════
 * The analytics DB holds no individuals (Principle 1, §9) — but a small enough aggregate IS an
 * individual. A school with two female teachers publishes "female teacher attendance rate 50%",
 * and anyone who knows the school knows exactly which of the two people that sentence is about.
 * The privacy boundary is drawn at the named-record gate for records; for aggregates it has to be
 * drawn at the cell size, or the boundary simply moves to wherever the denominator is smallest.
 *
 * ═══ THE RULE ═══════════════════════════════════════════════════════════════════════════════════
 *   1. A sex cell is suppressed when its teacher-headcount denominator is below
 *      `SMALL_CELL_THRESHOLD` (5).
 *   2. If EITHER sex is below the threshold, BOTH are suppressed and only the `ALL` figure is
 *      published. This is COMPLEMENTARY suppression and it is not optional: publishing
 *      `ALL = 24, MALE = 22` states `FEMALE = 2` exactly as loudly as printing it. Suppressing one
 *      cell while publishing its complement and the total is arithmetic, not privacy.
 *   3. A NULL / missing denominator is treated as below the threshold. An unknown headcount is not
 *      a large one, and the ETL leaves `teacher_headcount` NULL where it could not measure
 *      (db/schema/fact.ts's "0 is a measurement, NULL is the truth" rule). Fail closed.
 *
 * ═══ ONE DISCLOSURE SURFACE, NOT TWO ════════════════════════════════════════════════════════════
 * `fact_teacher_attendance` and `fact_plc_participation` describe THE SAME PEOPLE — the same
 * school's teaching staff in the same period, and `fact_plc_participation.teacher_headcount` is
 * pinned to the same population as `fact_staffing.teachers_on_roll`. Suppressing the female cell on
 * one surface while publishing it on the other discloses nothing less than publishing both: a
 * reader who wants the small cell just reads the other table. So the decision is computed ONCE, from
 * the shared denominator, and `applySexedStaffSuppression` is applied to rows from either table
 * with that same decision. This is the single most likely thing to get wrong when a new sexed staff
 * surface is added, which is why the decision object exists at all instead of a per-table helper.
 *
 * ═══ WHERE IT MUST BE APPLIED ═══════════════════════════════════════════════════════════════════
 * EVERY surface that publishes a sexed staff fact at school grain, and every export of one. No such
 * aggregate surface is built in this slice (this increment is the §6 named-record path), so this
 * module ships with its tests and this instruction: the first sexed-staff-fact surface must route
 * its rows through `applySexedStaffSuppression`, and must take its denominators from the school's
 * teacher headcount rather than from the measure it happens to be displaying.
 *
 * ═══ DELIBERATELY NOT INVENTED ══════════════════════════════════════════════════════════════════
 * Whether a small `ALL` denominator should itself be suppressed (a 3-teacher school publishing any
 * staff figure at all) is a policy question with a real cost either way — it would blank the
 * smallest schools' staffing data entirely — and no owner has answered it. The rule as specified
 * publishes `ALL` unconditionally, and that is what is implemented. `allBelowThreshold` is reported
 * on the decision so a surface can show a caveat, and so the day someone answers the question the
 * change is one branch here rather than a hunt through every reader.
 */

export const SMALL_CELL_THRESHOLD = 5;

export type Sex = "MALE" | "FEMALE" | "ALL";

/** Teacher-headcount denominators for one school × period. NULL means "not measured". */
export interface SexDenominators {
  MALE: number | null | undefined;
  FEMALE: number | null | undefined;
  ALL: number | null | undefined;
}

export type SuppressionCause =
  "OK" | "BELOW_THRESHOLD" | "COMPLEMENT_BELOW_THRESHOLD" | "DENOMINATOR_UNKNOWN";

export interface SuppressionDecision {
  publish: ReadonlySet<Sex>;
  suppressed: ReadonlySet<Sex>;
  /** Per-sex explanation, for a caveat line or a debug view. */
  cause: Readonly<Record<Sex, SuppressionCause>>;
  /** True when the school's total teacher headcount is itself below the threshold (see above). */
  allBelowThreshold: boolean;
}

function belowThreshold(n: number | null | undefined): boolean {
  return n === null || n === undefined || !Number.isFinite(n) || n < SMALL_CELL_THRESHOLD;
}

/**
 * Compute the decision ONCE per (school, period) and reuse it for every sexed staff surface in that
 * scope — see "one disclosure surface" above.
 */
export function sexedStaffDisclosureDecision(d: SexDenominators): SuppressionDecision {
  const maleLow = belowThreshold(d.MALE);
  const femaleLow = belowThreshold(d.FEMALE);
  const eitherLow = maleLow || femaleLow;

  const causeFor = (
    low: boolean,
    ownValue: number | null | undefined,
  ): SuppressionCause => {
    if (!eitherLow) return "OK";
    if (low)
      return ownValue === null || ownValue === undefined
        ? "DENOMINATOR_UNKNOWN"
        : "BELOW_THRESHOLD";
    return "COMPLEMENT_BELOW_THRESHOLD";
  };

  const publish = new Set<Sex>(["ALL"]);
  const suppressed = new Set<Sex>();
  if (eitherLow) {
    suppressed.add("MALE");
    suppressed.add("FEMALE");
  } else {
    publish.add("MALE");
    publish.add("FEMALE");
  }

  return {
    publish,
    suppressed,
    cause: {
      MALE: causeFor(maleLow, d.MALE),
      FEMALE: causeFor(femaleLow, d.FEMALE),
      ALL: "OK",
    },
    allBelowThreshold: belowThreshold(d.ALL),
  };
}

export interface SuppressibleRow {
  sex: Sex;
  [key: string]: unknown;
}

export type SuppressedRow<T extends SuppressibleRow> = T & {
  suppressed: boolean;
  suppressionCause: SuppressionCause;
};

/**
 * Apply a decision to rows from EITHER staff-fact table.
 *
 * Suppressed rows keep their `sex` (so the UI can render "Female — suppressed (small cell)" rather
 * than silently dropping a row, which would read as "no female teachers") and have every OTHER key
 * nulled. Nulling rather than deleting keeps the row shape stable for typed consumers; the
 * `suppressed` flag is what a renderer branches on.
 *
 * `measureKeys` defaults to every key except `sex` — suppress-by-default, so a measure added later
 * is suppressed without anyone remembering to add it to a list.
 */
export function applySexedStaffSuppression<T extends SuppressibleRow>(
  rows: readonly T[],
  decision: SuppressionDecision,
  measureKeys?: readonly string[],
): SuppressedRow<T>[] {
  return rows.map((row) => {
    if (!decision.suppressed.has(row.sex)) {
      return { ...row, suppressed: false, suppressionCause: decision.cause[row.sex] };
    }
    const keys = measureKeys ?? Object.keys(row).filter((k) => k !== "sex");
    const blanked: Record<string, unknown> = { ...row };
    for (const key of keys) blanked[key] = null;
    return {
      ...(blanked as T),
      sex: row.sex,
      suppressed: true,
      suppressionCause: decision.cause[row.sex],
    };
  });
}

/** Caveat copy for a surface that suppressed something. Plain, and never an apology for the rule. */
export function suppressionCaveat(decision: SuppressionDecision): string | null {
  if (decision.suppressed.size === 0) return null;
  return `Sex breakdown suppressed — fewer than ${SMALL_CELL_THRESHOLD} teachers in at least one group. The all-staff figure is published; the split is not, because publishing one group beside the total would disclose the other.`;
}
