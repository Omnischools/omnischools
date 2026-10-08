import { sql } from "drizzle-orm";
import { rowsOf, withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";
import { childLevelFor } from "./breakdown";
import { ok, unavailable, type Reading } from "./reading";

/**
 * SCHOOL FEES — the per-school billed-fee read behind the district "School fees" panel (increment K).
 *
 * FEES-SURFACING-RULING.md is binding. The one fact that shapes this entire module:
 *
 * ═══ fact_fees IS A DISTRIBUTION — NON-ADDITIVE IN BOTH TIME AND SPACE (ruling F1, ETL fees.ts) ═══
 * `fact_fees` stores only `mean_amount` and `median_amount`; nothing on it is summable. Two schools'
 * means do not add, three terms' medians do not add to a year, and a median cannot be recombined from
 * medians at ANY weighting. So — unlike every other reader in this app — THIS MODULE COMPUTES NO
 * CROSS-SCHOOL AVERAGE OF THE AMOUNT COLUMNS. A "district/regional/national average fee" is a
 * fabrication and is never produced here (ruling F1/F9, Quinn AC-4/AC-5). The only district-level
 * figures are COUNTS of schools (additive — each school is one countable unit, ruling F7) and a
 * CENTRE-LESS range of real per-school figures (ruling F8). That is the whole honest surface.
 *
 * ═══ DISTRICT TIER ONLY (ruling F2 / AC-1,2) ═════════════════════════════════════════════════════
 * `fact_fees` carries rows only at SCHOOL grain. The only tier whose displayed children ARE schools is
 * DISTRICT (`childLevelFor("DISTRICT") === "SCHOOL"`; breakdown.ts). At REGION/NATIONAL the children
 * are districts/regions with no fact_fees rows and no derivable figure, so this read returns
 * `unavailable` there and the surface renders an honest drill-down note — never a fabricated regional
 * mean. The tier gate lives here so a mis-called reader cannot leak amounts (defence in depth; the
 * component gates too).
 *
 * ═══ THE WHOLE-SCHOOL FIGURE IS THE `stage IS NULL` ROW (ruling F4 / AC-7) ════════════════════════
 * Per (school, category) the ETL materialises exactly one `stage IS NULL` all-stages row, computed
 * from the pooled cross-stage distribution. We read THAT row. We never sum or average the per-stage
 * rows to obtain it (means/medians do not recombine — the whole reason the all-stages row exists).
 *
 * ═══ THE DENOMINATOR N IS SCHOOLS REPORTING FEES THIS TERM ═══════════════════════════════════════
 * N = distinct schools with ≥1 `stage IS NULL` fact_fees row for the term. A school with NO fee data at
 * all this term is "we cannot see it", not "charges nothing" (ETL fees.ts: a school with no invoices is
 * not computed and keeps prior rows), so it is OUT of N rather than counted as a false "not billed"
 * everywhere. Per category the three buckets — positive / chargesNothing / notBilled — sum to N
 * (Quinn AC-11). `notBilled` is a REPORTING school with no row for THIS category, distinct from a real
 * billed `0.00` (ruling F7/F12, AC-12).
 *
 * ═══ NO SUBTREE `WHERE`, NO NEW DB OBJECT ═══════════════════════════════════════════════════════
 * RLS (`ov_in_subtree(jurisdiction_id)`) already bounds the visible rows to the officer's subtree, so
 * reading what is visible IS reading the district's schools; an app-side jurisdiction filter would be a
 * second hand-written copy of the ceiling (the enrolment/ptr/breakdown precedent, binding here). The
 * read is a plain SELECT with an explicit column allow-list — nothing is created or granted, so the
 * prod-paste re-run rule is not triggered.
 *
 * ═══ DETERMINISTIC DESPITE NO GRAIN UNIQUE (ruling §11 / AC-26) ══════════════════════════════════
 * `fact_fees` is PK-only — it has no grain UNIQUE (ETL fees.ts write note), so a hypothetical duplicate
 * (jurisdiction_id, fee_category, stage) row would otherwise make the same question return two answers
 * depending on which the engine picked. `DISTINCT ON (jurisdiction_id, fee_category)` with a total
 * `ORDER BY` picks ONE row deterministically, so a re-read on byte-identical data is byte-identical.
 */

/** The six `ov_fee_category` members (db/schema/_enums.ts), in enum/display order. TUITION headlines. */
export const FEE_CATEGORY_ORDER = [
  "TUITION",
  "BOARDING",
  "FEEDING",
  "EXAM",
  "PTA_DUES",
  "OTHER",
] as const;
export type FeeCategory = (typeof FEE_CATEGORY_ORDER)[number];

/** The named (non-OTHER) categories — a school billing ONLY OTHER has an all-uncategorised fee book. */
const NAMED_CATEGORIES = FEE_CATEGORY_ORDER.filter(
  (c): c is Exclude<FeeCategory, "OTHER"> => c !== "OTHER",
);

export type Ownership = "PUBLIC" | "PRIVATE" | "MISSION";
export type SchoolType = "KG" | "PRIMARY" | "JHS" | "SHS" | "COMBINED";

/**
 * The material-skew threshold (ruling F13 / E-FEE-5, owner-movable). A school whose TUITION mean exceeds
 * its median by more than this is a long right tail — a few larger bills pull the average up. Named here
 * so the surface's skew caption and this flag read the same number. 1.15 = mean ≥ 15% above median.
 */
export const FEE_SKEW_RATIO = 1.15;

/** One (school, category) all-stages figure. `zero` is a REAL billed 0.00 (ruling F11), never absence. */
export interface SchoolFeeFigure {
  /** The `median_amount` of the `stage IS NULL` row, in GHS. The primary "typical bill". */
  median: number;
  /** The `mean_amount` of the same row, in GHS. Always shown beside the median (ruling F5/F13). */
  mean: number;
  /** True when this is a real billed 0.00/0.00 row — "charges nothing", NOT absence (ruling F11/F12). */
  zero: boolean;
}

/** One reporting school, with the categories it filed. An ABSENT category key = "not billed" (F12). */
export interface SchoolFeeRow {
  jurisdictionId: string;
  /** `dim_jurisdiction.name`. Nullable only if the join label is withheld (never a sibling's name). */
  name: string | null;
  ownershipType: Ownership | null;
  schoolType: SchoolType | null;
  /** Only the categories this school has a `stage IS NULL` row for. A missing key means NOT BILLED. */
  figures: Partial<Record<FeeCategory, SchoolFeeFigure>>;
  /** Has an OTHER row and NO named-category row — its whole visible fee book is uncategorised (F15). */
  onlyOther: boolean;
}

/** Per-category school-count buckets. The three sum to `SchoolFeesPanel.schoolCount` (ruling F7). */
export interface FeeCategorySummary {
  category: FeeCategory;
  /** Schools whose row bills a positive amount (median > 0 OR mean > 0). */
  positive: number;
  /** Schools with a REAL billed 0.00/0.00 row — the Free-SHS signal (ruling F7/F11). */
  chargesNothing: number;
  /** Reporting schools with NO row for this category — absence, never a false 0 (ruling F7/F12). */
  notBilled: number;
}

/** One endpoint of the centre-less range — a real school's own figure (ruling F8). */
export interface FeeExtreme {
  name: string | null;
  median: number;
}

/** The centre-less per-school range for one category (ruling F8). NO centre/mean — that would be F1. */
export interface FeeRange {
  min: FeeExtreme;
  max: FeeExtreme;
}

export interface SchoolFeesPanel {
  /** N — distinct schools reporting ANY fee this term. The denominator of every §7 count. */
  schoolCount: number;
  /** Per category (only those any school filed), in FEE_CATEGORY_ORDER. TUITION first, OTHER last. */
  summaries: FeeCategorySummary[];
  /** The reporting schools, sorted by name — each a per-school row for the panel's table. */
  schools: SchoolFeeRow[];
  /** TUITION range (by school median) across schools with a TUITION row; null if fewer than two. */
  tuitionRange: FeeRange | null;
  /** True when ≥1 shown TUITION figure has mean ≥ FEE_SKEW_RATIO × median (median > 0) — the skew flag. */
  tuitionSkew: boolean;
}

/** A numeric(10,2) literal → a finite GHS number, or null if it is not a number. */
function amountOf(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getSchoolFees(
  scope: JurisdictionScope,
  termPeriodId: string | null,
): Promise<Reading<SchoolFeesPanel>> {
  // DISTRICT tier only (ruling F2): the children must BE schools, or there are no fact_fees rows to
  // read and no honest figure to derive. Checked before any query so the gate cannot be bypassed.
  if (childLevelFor(scope.level) !== "SCHOOL") return unavailable<SchoolFeesPanel>();
  // A null period matches nothing; there is no fee panel without a term to pin (ruling F20).
  if (termPeriodId === null) return unavailable<SchoolFeesPanel>();

  try {
    return await withJurisdiction(scope, async (tx) => {
      /**
       * The ALL-STAGES rows for the term, one per (school, category), joined to the school's own
       * dimension row for name/ownership/type. Explicit column allow-list (the house precedent): the
       * two amounts, the grain keys, and the three dimension attributes — nothing else, and the
       * per-stage rows are excluded by `stage IS NULL` (ruling F4). INNER join on the school's own node
       * is correct (the fact row is visible, so its SCHOOL row is too — same RLS predicate), and
       * `s.level = 'SCHOOL'` pins it. DISTINCT ON makes the read deterministic despite the missing
       * grain UNIQUE (ruling §11 / AC-26).
       */
      const result = await tx.execute(sql`
        select distinct on (ff.jurisdiction_id, ff.fee_category)
               ff.jurisdiction_id::text  as jurisdiction_id,
               ff.fee_category::text      as fee_category,
               ff.mean_amount             as mean_amount,
               ff.median_amount           as median_amount,
               s.name                     as name,
               s.ownership_type::text     as ownership_type,
               s.school_type::text        as school_type
          from fact_fees ff
          join dim_jurisdiction s on s.jurisdiction_id = ff.jurisdiction_id
                                 and s.level = 'SCHOOL'
         where ff.period_id = ${termPeriodId}::uuid
           and ff.stage is null
         order by ff.jurisdiction_id, ff.fee_category, ff.mean_amount, ff.median_amount
      `);

      const rows = rowsOf(result);
      // No fee rows in this district this term → unavailable, not an empty "all zero" panel (the
      // Reading precedent: nothing to state is `unavailable`, and the surface shows its fail-soft note).
      if (rows.length === 0) return unavailable<SchoolFeesPanel>();

      // Assemble per-school rows. The map's insertion is per (school, category); each school's
      // name/ownership/type come off any of its rows (identical across them by construction).
      const schoolMap = new Map<string, SchoolFeeRow>();
      for (const row of rows) {
        const id = row.jurisdiction_id as string;
        const category = row.fee_category as FeeCategory;
        // A category the enum does not name cannot be shown as any of the six surfaces — skip it rather
        // than invent a bucket. (It cannot occur: fee_category is an ov_fee_category column.)
        if (!FEE_CATEGORY_ORDER.includes(category)) continue;
        const median = amountOf(row.median_amount);
        const mean = amountOf(row.mean_amount);
        // A row whose amounts are unreadable is dropped from the figure set rather than shown as a 0 —
        // a laundered 0 is exactly the false "charges nothing" this surface must never print.
        if (median === null || mean === null) continue;

        let school = schoolMap.get(id);
        if (!school) {
          school = {
            jurisdictionId: id,
            name: (row.name as string | null) ?? null,
            ownershipType: (row.ownership_type as Ownership | null) ?? null,
            schoolType: (row.school_type as SchoolType | null) ?? null,
            figures: {},
            onlyOther: false,
          };
          schoolMap.set(id, school);
        }
        school.figures[category] = { median, mean, zero: median === 0 && mean === 0 };
      }

      // A reporting school with no readable figure at all is not a panel row (nothing to show).
      const schools = [...schoolMap.values()].filter(
        (s) => Object.keys(s.figures).length > 0,
      );
      if (schools.length === 0) return unavailable<SchoolFeesPanel>();

      for (const school of schools) {
        const hasNamed = NAMED_CATEGORIES.some((c) => school.figures[c] !== undefined);
        school.onlyOther = school.figures.OTHER !== undefined && !hasNamed;
      }
      // Sort by name for a stable, human-ordered table (ids break ties so the order is total/byte-stable).
      schools.sort(
        (a, b) =>
          (a.name ?? "").localeCompare(b.name ?? "") ||
          a.jurisdictionId.localeCompare(b.jurisdictionId),
      );

      const schoolCount = schools.length;

      // Per-category COUNT buckets (ruling F7). Only categories at least one school filed appear, in
      // FEE_CATEGORY_ORDER. The three buckets sum to schoolCount by construction: notBilled is the
      // residual of the N reporting schools that have no row for this category.
      const summaries: FeeCategorySummary[] = [];
      for (const category of FEE_CATEGORY_ORDER) {
        let positive = 0;
        let chargesNothing = 0;
        for (const school of schools) {
          const figure = school.figures[category];
          if (figure === undefined) continue;
          if (figure.zero) chargesNothing += 1;
          else positive += 1;
        }
        // No school filed this category anywhere → it is not a row on the panel (not "0 of N").
        if (positive === 0 && chargesNothing === 0) continue;
        summaries.push({
          category,
          positive,
          chargesNothing,
          notBilled: schoolCount - positive - chargesNothing,
        });
      }

      // The TUITION centre-less range (ruling F8), by each school's MEDIAN. Over schools WITH a tuition
      // row (a billed 0.00 counts — GHS 0 is the free-SHS low end of the real spread). Needs ≥2, and
      // carries NO centre: there is no district average to put there.
      const tuitionPoints = schools
        .map((s) => ({ name: s.name, median: s.figures.TUITION?.median }))
        .filter((p): p is FeeExtreme => p.median !== undefined);
      let tuitionRange: FeeRange | null = null;
      if (tuitionPoints.length >= 2) {
        // Min/max are real schools; ties break by name so the endpoint named is deterministic.
        const byValueThenName = (a: FeeExtreme, b: FeeExtreme) =>
          a.median - b.median || (a.name ?? "").localeCompare(b.name ?? "");
        const sorted = [...tuitionPoints].sort(byValueThenName);
        tuitionRange = { min: sorted[0]!, max: sorted[sorted.length - 1]! };
      }

      // The skew flag (ruling F13): any shown billed tuition figure whose mean materially exceeds its
      // median. Derived per rendered data, never hard-coded.
      const tuitionSkew = schools.some((s) => {
        const t = s.figures.TUITION;
        return (
          t !== undefined &&
          !t.zero &&
          t.median > 0 &&
          t.mean >= t.median * FEE_SKEW_RATIO
        );
      });

      return ok({ schoolCount, summaries, schools, tuitionRange, tuitionSkew });
    });
  } catch {
    // Fail-soft in the lib (the `Reading` precedent): the panel degrades to its note, page stands.
    return unavailable<SchoolFeesPanel>();
  }
}
