import { sql } from "drizzle-orm";
import {
  rowsOf,
  withJurisdiction,
  type JurisdictionLevel,
  type JurisdictionScope,
} from "@/lib/db/rls";
import { ok, unavailable, type Reading } from "./reading";
import type { Exam } from "./performance";

/**
 * THE PER-CHILD ROLL-UP behind the regions/districts breakdown table (increment I slice 3).
 *
 * Wells's SLICE-3-ROLLUP-RULING is binding on this module. The shape, in one paragraph:
 *
 * ═══ A FIXED-DEPTH, LEVEL-PINNED, LEFT-JOINED UPWARD SELF-JOIN ═══════════════════════════════════
 * Every `fact_*` table carries exactly ONE jurisdiction column and it is the SCHOOL node
 * (db/schema/fact.ts: "District, regional and national figures are NOT stored — they are roll-ups
 * summed up the dim_jurisdiction tree at query time"). So a per-child figure has to attribute each
 * school's row upward. The spine is a closed, level-strict, exactly-4-deep tree, so school→district is
 * always 1 hop and school→region always 2: there is nothing for a recursive descent to discover, and
 * a `WITH RECURSIVE` would duplicate the tree walk that the RLS predicate (`ov_in_subtree`) is already
 * doing per row. Hence two equality joins, and ONE `child_id` chosen by a bound `child_level`.
 *
 * ⚠ EVERY ANCESTOR HOP IS `LEFT JOIN`, NEVER `JOIN`. THIS IS THE DEFECT THIS MODULE IS MOST LIKELY TO
 * HAVE. `dim_jurisdiction` is RLS-scoped by the same `ov_in_subtree` predicate as the facts
 * (db/sql/policies.sql), and that predicate admits the current node and its DESCENDANTS — so an
 * officer's own ANCESTORS are invisible to them. With an INNER join on the region hop, a DISTRICT
 * officer's query returns ZERO ROWS, and every national-only test still passes, because at national
 * the predicate short-circuits. It fails as a blank table, not as an error. The region hop is joined
 * unconditionally (one query text for three tiers) and only *selected* when the tier needs it, so the
 * unneeded hop must be allowed to produce nulls. `lib/oversight/jurisdiction.ts` is the existing proof
 * of the behaviour: it left-joins the parent node and documents that the label may come back null.
 *
 * ⚠ EVERY HOP PINS `level`. There is no CHECK and no DB constraint making `parent_id` level-strict
 * (lib/etl/dimensions.ts says in as many words that no DB constraint can catch a broken chain, and
 * `assertSpineIntact` does not assert depth = 4). A school mis-parented straight onto a region is
 * therefore a state this query must survive. With the level pin it lands in the `child_id IS NULL`
 * UNATTRIBUTED BUCKET — visible, countable, reconcilable. Without it, that school's enrolment is
 * attributed to a *region* row inside a *district* breakdown: a wrong number that looks right.
 *
 * ⚠ THE UNATTRIBUTED BUCKET IS NEVER SILENTLY DROPPED. It is returned as `unattributed` and the
 * surface renders it. Filtering it would make Σchildren < total, which is the one failure this grain
 * cannot afford (db/schema/fact.ts Principle 5). `reconciled` below is that invariant, checked.
 *
 * ═══ THE TOTAL ROW COMES FROM THE SAME SCAN ══════════════════════════════════════════════════════
 * `group by grouping sets ((child_id, child_name), ())`. The `()` set yields one extra row — the
 * officer's own subtree total — computed from the identical scan, so it cannot disagree with the rows
 * above it the way a second query could (different plan, different moment).
 *
 * ═══ RATES ARE Σnum ÷ Σden, PER CHILD. NEVER avg(stored rate) ════════════════════════════════════
 * `qualification_rate` is absent from the allow-list below ON PURPOSE (the structural version of the
 * rule — lib/oversight/performance.ts). Averaging stored rates weights a 12-candidate school equally
 * with a 600-candidate one, and per child that is WORSE than at national scale: a child's rate is
 * itself a roll-up of fewer, more unequal schools, and the error is largest in exactly the small
 * children the rank cards are about.
 *
 * ═══ ONE PERIOD PER MEASURE, RESOLVED ONCE AT THE OFFICER'S SCOPE AND PASSED IN ═══════════════════
 * Never resolved per child: `getLatestExamCohortPeriod` is tier-sensitive by design (a region whose
 * schools have no rows for the newest national sitting resolves to its OWN latest sitting), so a
 * per-child resolution would rank children against DIFFERENT sittings — a ranking with no referent.
 * The caller passes the two period ids it already resolved for the KPI strip above the table.
 *
 * ═══ `child_level` IS A DISPLAY-DEPTH SELECTOR, NOT A CEILING ════════════════════════════════════
 * RLS has already bounded the visible fact rows before the `case` is evaluated. A district officer who
 * somehow passed `'REGION'` gets `r` = null for every row (their region is invisible) and reads an
 * unattributed-only table: fail-closed-ish, zero disclosure. Do NOT "harden" it into a second
 * hand-written copy of the ceiling, and do NOT put `scope.jurisdictionId` into this SQL
 * (lib/db/rls.ts, lib/oversight/enrolment.ts).
 *
 * ═══ NO NEW DB OBJECT ════════════════════════════════════════════════════════════════════════════
 * `GROUPING SETS`, CTEs, self-joins, `CASE` and a bound parameter cast to `jurisdiction_level` are all
 * plain SELECT syntax. Nothing is created, nothing is granted, so prod-paste-0006 is NOT triggered. A
 * VIEW was rejected by the ruling for exactly that reason (§4): a new view in `public` arrives covered
 * by neither the blanket grant nor the blanket revoke, and the failure mode is silence.
 */

/** The tier a breakdown row is ONE OF — one level below the officer's own node. */
export type ChildLevel = "REGION" | "DISTRICT" | "SCHOOL";

/**
 * NATIONAL → regions, REGION → districts, DISTRICT → schools.
 *
 * A total function, including SCHOOL, which cannot occur: `ov_resolve_officer` refuses to build a
 * session on a SCHOOL node (db/sql/policies.sql) and the write-side trigger restates it. It maps to
 * `SCHOOL` anyway so a relaxed guard degrades to the fact's own grain (a one-row-per-school table of
 * the one school) rather than to `undefined` in a SQL cast.
 */
export function childLevelFor(level: JurisdictionLevel): ChildLevel {
  switch (level) {
    case "NATIONAL":
      return "REGION";
    case "REGION":
      return "DISTRICT";
    case "DISTRICT":
    case "SCHOOL":
      return "SCHOOL";
  }
}

/**
 * ONE ROW OF THE BREAKDOWN — a child jurisdiction, the unattributed bucket, or the tier total.
 *
 * EVERY MEASURE IS NULLABLE, and none of them is ever a `coalesce`d zero. The fact-driven and
 * register-driven buckets need not be the same set: a child whose schools filed nothing for the
 * pinned period appears in the register query and not in the fact query, and "no return filed" is not
 * "0 pupils" (the `lib/oversight/coverage.ts` / `enrolment.ts` precedent, binding here).
 */
export interface BreakdownRow {
  /** The child jurisdiction's node id. `null` on the unattributed bucket and on the total row. */
  childId: string | null;
  /**
   * The child's own `dim_jurisdiction.name`, taken through the LEFT-joined alias the `case` selected.
   *
   * Nullable, and a null is honest: it means the hop was mis-levelled, never that a name was withheld.
   * `dim_jurisdiction`'s policy is the same predicate as the fact's, so the worst case is a missing
   * label — never a SIBLING's name.
   */
  name: string | null;
  /** Σ headcount, `sex='ALL'`, `class_form is null`, one ANNUAL period. Null = no return filed. */
  enrolment: number | null;
  /** Schools that FILED enrolment for the pinned academic year — not "schools that exist" (see coverage.ts). */
  schoolsFiling: number | null;
  /**
   * Σ headcount, sex='FEMALE', class_form is null, on the SAME ANNUAL period as `enrolment` — the
   * girls'-share numerator, carried on the row like candidates/qualified behind wassceRate so the share
   * reconciles through `sumOf` with no special fact-side pass. Null = no enrolment row filed; an all-boys
   * school files a real 0 (the ETL writes FEMALE wherever it writes ALL).
   */
  femaleEnrolment: number | null;
  /** ΣfemaleEnrolment ÷ Σenrolment, 0..1. Null when either side is absent — never a 0/0, never clamped. */
  girlsShare: number | null;
  /** Σ candidates for the pinned sitting — the ranking WEIGHT, deliberately visible. */
  candidates: number | null;
  qualified: number | null;
  /** Σqualified ÷ Σcandidates, 0..1. Null when no cohort: 0/0 is not "every candidate failed". */
  wassceRate: number | null;
  /** Register side — `count(*) filter (where on_schoolup)`. NULL at the DISTRICT tier (see §3). */
  schoolsReporting: number | null;
  schoolsRegistered: number | null;
  /** reporting ÷ registered, 0..1. Null at the DISTRICT tier and when the register names none. */
  coverageRatio: number | null;
  /**
   * Σ enrolment_total ÷ Σ teachers_on_roll over the child's schools — the WEIGHTED PTR, never
   * avg(stored ptr). Null when no staffing row was filed for the child (not a "0 teachers" claim).
   * LOWER is better (fewer pupils per teacher), which the surface inverts; the number itself is
   * unsigned pupils-per-teacher.
   */
  ptr: number | null;
  /**
   * The two SUMS the child's PTR is `ratio()`'d from — carried on the row (like `candidates`/`qualified`
   * behind `wassceRate`) so PTR reconciles through `sumOf` exactly as every additive measure does, with
   * no special fact-side pass. Null when the child filed no staffing row (never a 0). A caller may also
   * show the roll the ratio divides from these.
   */
  staffEnrolment: number | null;
  teachers: number | null;
  /**
   * The two SUMMABLE pupil-day counts the child's attendance rate is `ratio()`'d from — carried on the
   * row like `candidates`/`qualified` behind `wassceRate`, so attendance reconciles through `sumOf` with
   * no special fact-side pass. fact_attendance is a FLOW at TERM grain (lib/etl/attendance.ts): a
   * pupil-day in term 1 and one in term 2 are two pupil-days, so these sum across schools exactly as the
   * additive measures do. Null when the child filed no attendance row (never a "0 days" claim).
   */
  presentDays: number | null;
  enrolledDays: number | null;
  /**
   * Σpresent_days ÷ Σenrolled_days over the child's schools — the WEIGHTED attendance rate, never
   * avg(stored attendance_rate) (the stored rate column is deliberately never selected). HIGHER is
   * better. Null when no attendance row was filed: 0/0 is not "nobody showed up".
   */
  attendanceRate: number | null;
  /**
   * ═══ THE TEACHER-ESTABLISHMENT COMPONENTS — PUBLIC-ONLY, AND THE DENOMINATOR IS NARROWER ═════════
   *
   * Σ teaching_posts_established over the child's schools that HAVE an establishment. GES sets an
   * establishment for PUBLIC schools only, so `teaching_posts_established` (and therefore `vacancies`)
   * is NULL for every PRIVATE/MISSION school (STAFFING-PTR-DOMAIN-RULING §4) and every sum here is
   * taken over `teaching_posts_established IS NOT NULL` ONLY (§6 corollary, AC-17; Kofi V4). Those
   * schools are VISIBLY EXCLUDED — null, never a 0 folded into the denominator — which is why this
   * measure has its own row count and its own `schoolsWithEstablishment`, and is NOT the PTR/enrolment
   * school count. Null when the child has no public-establishment school at all: that is genuine
   * ABSENCE ("GES sets no establishment here"), never "0 posts".
   */
  postsEstablished: number | null;
  /**
   * The TWO-SIDED DECOMPOSITION of the signed `vacancies` column, split by sign at the school grain
   * and then summed — Σ GREATEST(vacancies, 0), "posts unfilled".
   *
   * ⚠ A LONE NET Σ(vacancies) IS BANNED ABOVE SINGLE-SCHOOL GRAIN (Kofi V1/V3). Ghana's real
   * distribution is shortage in the rural north and surplus in the urban south (the gradient
   * `establishmentFactor` in lib/etl/staffing.ts bakes in), so one net figure cancels the two and can
   * read as "roughly balanced" while hiding the exact equity story. The two gross magnitudes are
   * therefore carried SEPARATELY, as summable components on the row, the same discipline
   * `candidates`/`qualified` follow behind `wassceRate`. Both are spatial sums over school rows in ONE
   * ANNUAL period (roll-up-safe, §6), and neither is floored in the read — the split happens per
   * school, where the sign is honest, before anything is added up.
   */
  vacancyShortage: number | null;
  /** Σ GREATEST(−vacancies, 0) — "teachers over establishment". The surplus half, never discarded. */
  vacancySurplus: number | null;
  /**
   * shortage − surplus ≡ Σ vacancies, SIGNED: positive = net short, negative = net over establishment.
   *
   * Derived from the two gross magnitudes rather than summed from the signed column, so the read
   * cannot produce a net without also producing the decomposition that qualifies it. A surface may
   * show it ONLY labelled "net" and BESIDE the two magnitudes (V2); at single-school grain the signed
   * value stands alone honestly, because there is no population to cancel across.
   */
  vacancyNet: number | null;
  /**
   * Σvacancies ÷ Σteaching_posts_established over the child's public-establishment schools — the
   * normalised, roll-up-safe VACANCY RATE (a signed fraction: positive = net-short, negative =
   * net-over). This is the dispersion measure the equity read hangs on (V3), and it is a Σ÷Σ per child,
   * never the mean of per-school rates. Null when the child has no public establishment (never a 0/0).
   */
  vacancyRate: number | null;
  /**
   * `count(distinct school) FILTER (WHERE teaching_posts_established IS NOT NULL)` — the HONEST
   * "Across N public schools with a GES establishment" denominator (V4/V5), and the two-state gate
   * between UNAVAILABLE and a true net-zero (V12/V13): 0 here means there is no GES establishment in
   * the child at all, which is absence, not "0 posts unfilled".
   */
  schoolsWithEstablishment: number | null;
  // NOTE: there is deliberately no `isHome` here, and no `scope.jurisdictionId` anywhere in this
  // module. Lucy's gold-tinted home row is a comparison between a child id and the officer's own node,
  // which is PRESENTATION — and keeping every `scope.*` field out of the read means the static guard
  // "no module writes a ceiling of its own" reads the same for this file as for the slice-1 four.
}

export interface ChildBreakdown {
  childLevel: ChildLevel;
  /** One row per child WITH a resolved child id, ranked by `wassceRate` desc (see `rankChildren`). */
  children: BreakdownRow[];
  /** The `child_id IS NULL` bucket — mis-levelled hops. Rendered, never filtered. */
  unattributed: BreakdownRow | null;
  /** The `()` grouping-set row: the officer's own subtree total, from the SAME scan as the children. */
  total: BreakdownRow;
  /** True when the register side was read at all (NATIONAL and REGION tiers only — §3). */
  hasCoverage: boolean;
}

/**
 * THE RANK-CARD CANDIDATE FLOOR — Wells §5, and an OWNER-MOVABLE DEMO PRESENTATION THRESHOLD.
 *
 * A rate ranking needs a denominator floor, and the rank CARDS need it more than the table does: a
 * district with 7 candidates and 7 credits is 100% and would be named "Strongest district" on a
 * 7-child cohort. 30 is the ruling's number, chosen as a cohort size at which a single candidate moves
 * the rate by ~3pp. It governs the SUPERLATIVE CLAIM, not the data — the table still lists every
 * child, with its candidate count visible, which is why `candidates` is in the payload and not hidden.
 * It is NOT a privacy rule and NOT small-cell suppression (nothing here is sexed; see §5).
 */
export const RANK_CARD_MIN_CANDIDATES = 30;

/** Null-last ordering, so a child with no cohort sorts below one with a measured 0%. */
function byRateDesc(a: BreakdownRow, b: BreakdownRow): number {
  if (a.wassceRate === null && b.wassceRate === null) {
    return (a.name ?? "").localeCompare(b.name ?? "");
  }
  if (a.wassceRate === null) return 1;
  if (b.wassceRate === null) return -1;
  if (a.wassceRate !== b.wassceRate) return b.wassceRate - a.wassceRate;
  // Coverage is the ruling's secondary display AND its tiebreak (§5).
  const coverage = (b.coverageRatio ?? -1) - (a.coverageRatio ?? -1);
  if (coverage !== 0) return coverage;
  return (a.name ?? "").localeCompare(b.name ?? "");
}

/** `Σnum ÷ Σden`, or null — never a zero laundered out of a 0/0. */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** The GROUPING SETS discriminator: 0 on a child row (including the null bucket), 3 on the total. */
const TOTAL_GROUPING = 3;

interface FactBucket {
  childId: string | null;
  name: string | null;
  enrolment: number | null;
  schoolsFiling: number | null;
  candidates: number | null;
  qualified: number | null;
  /** Σ fact_staffing.enrolment_total over the child. Null = no staffing row filed. */
  staffEnrolment: number | null;
  /** Σ fact_staffing.teachers_on_roll over the child — the PTR denominator. Null = none filed. */
  teachers: number | null;
  /** Σ fact_attendance.present_days over the child. Null = no attendance row filed. */
  presentDays: number | null;
  /** Σ fact_attendance.enrolled_days over the child — the attendance denominator. Null = none filed. */
  enrolledDays: number | null;
  /** Σ fact_enrolment.headcount, sex='FEMALE', class_form is null. Null = no enrolment row filed. */
  femaleEnrolment: number | null;
  /** Σ teaching_posts_established over PUBLIC-establishment rows only. Null = the child has none. */
  postsEstablished: number | null;
  /** Σ GREATEST(vacancies, 0) over those same rows — posts unfilled. Null = the child has none. */
  vacancyShortage: number | null;
  /** Σ GREATEST(−vacancies, 0) over those same rows — teachers over establishment. */
  vacancySurplus: number | null;
  /** count(distinct school) with a non-null establishment — the honest public-only denominator. */
  schoolsWithEstablishment: number | null;
}

interface RegisterBucket {
  childId: string | null;
  name: string | null;
  reporting: number;
  registered: number;
}

export async function getChildBreakdown(
  scope: JurisdictionScope,
  args: {
    childLevel: ChildLevel;
    /** The ONE TERM period the ATTENDANCE column is of (a flow). Null ⇒ that column is simply absent. */
    termPeriodId: string | null;
    /** The ONE sitting the WASSCE columns are of. Null ⇒ those columns are simply absent. */
    examPeriodId: string | null;
    /**
     * The ONE ANNUAL period the ENROLMENT, GIRLS'-SHARE, PTR and TEACHER-ESTABLISHMENT columns are of.
     * Null ⇒ those columns are absent. All are STOCKS and hang off the SAME `dim_period` ANNUAL row the
     * ETL writes against —
     * enrolment and staffing by construction share it (`fact_staffing.enrolment_total` is enrolment's own
     * headcount roll, lib/etl/staffing.ts), which is why one id drives all three and never two that could
     * silently describe different years. See lib/oversight/enrolment.ts and lib/oversight/ptr.ts.
     */
    annualPeriodId: string | null;
    exam: Exam;
  },
): Promise<Reading<ChildBreakdown>> {
  const { childLevel, termPeriodId, examPeriodId, annualPeriodId, exam } = args;
  try {
    return await withJurisdiction(scope, async (tx) => {
      /**
       * QUERY 1 — THE FACT SIDE. One statement, one ancestry walk, one `()` total row.
       *
       * The three fact tables (enrolment, exam, staffing) are UNION ALL'd into a per-school `facts` CTE
       * BEFORE the ancestor join, so the level-pinned upward walk is written exactly ONCE instead of
       * copy-pasted per measure — and so the enrolment, WASSCE and PTR totals come from the SAME scan as
       * their own child rows (Wells trap 5). `measure` separates them again in the `filter (where …)`
       * clauses, which is also what keeps "no rows" distinguishable from "a measured zero". Each arm
       * carries every measure column, zero-filled where it does not apply, so the UNION's arms line up.
       *
       * A NULL period id compares as NULL and matches nothing, so an unresolved period contributes no
       * rows rather than needing a second query text.
       *
       * `attributed` exists so `child_id` / `child_name` are plain columns by the time `grouping()`
       * needs them — `grouping()` takes grouping EXPRESSIONS, and positional group-by cannot be passed
       * to it.
       *
       * EXPLICIT COLUMN ALLOW-LIST throughout (the house precedent): `qualification_rate`,
       * `attendance_rate` and every other stored rate are structurally out of reach, and a column added
       * to a fact table later cannot arrive here unasked. `parent_id` is NEVER selected into the
       * payload — it is readable on a visible row and may NAME an invisible node, so ancestry is taken
       * only through the joined alias, which contributes nothing when RLS filters it away (§2).
       */
      const factResult = await tx.execute(sql`
        with facts as (
          select fe.jurisdiction_id          as jurisdiction_id,
                 'ENROLMENT'::text           as measure,
                 fe.headcount::bigint        as headcount,
                 0::bigint                   as candidates,
                 0::bigint                   as qualified,
                 0::bigint                   as staff_enrolment,
                 0::bigint                   as teachers,
                 0::bigint                   as present_days,
                 0::bigint                   as enrolled_days,
                 0::bigint                   as female_headcount,
                 0::bigint                   as posts_established,
                 0::bigint                   as vacancy_shortage,
                 0::bigint                   as vacancy_surplus
            from fact_enrolment fe
           -- ANNUAL, not TERM: enrolment is a STOCK (headcount on roll), the SAME dim_period row
           -- fact_staffing and fact_infrastructure hang off, and the only period the ETL ever writes
           -- enrolment against (lib/etl/enrolment.ts). A TERM pin matches zero rows and blanks the column.
           where fe.period_id = ${annualPeriodId}::uuid
             -- Both mandatory: the ALL row sits beside MALE/FEMALE (×3) and a null class_form IS the
             -- stage total, with the per-form rows beside it (×2). See lib/oversight/enrolment.ts.
             and fe.sex = 'ALL'::ov_sex
             and fe.class_form is null
          union all
          select fpe.jurisdiction_id,
                 'EXAM'::text,
                 0::bigint,
                 fpe.candidates::bigint,
                 fpe.qualified::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint
            from fact_performance_exam fpe
           where fpe.period_id = ${examPeriodId}::uuid
             and fpe.exam = ${exam}::exam
             -- Mandatory, and the dangerous one: without it the RATE still looks right (the factor
             -- cancels) while the candidate count is 3× the real cohort — so three copies of a thin
             -- cohort would silently satisfy the rank-card floor.
             and fpe.sex = 'ALL'::ov_sex
          union all
          -- STAFFING — the PTR arm. fact_staffing is ANNUAL grain and has NO sex column, so it pins the
          -- SAME ANNUAL period as enrolment (one dim_period row; fs.enrolment_total IS enrolment's own
          -- headcount roll, lib/etl/staffing.ts) and carries no sex filter. enrolment_total and teachers_on_roll are summed as
          -- the PTR numerator/denominator; the per-child ratio is Σ÷Σ in TS below, never avg(stored ptr)
          -- (the stored ptr column is deliberately never selected). See lib/oversight/ptr.ts.
          select fs.jurisdiction_id,
                 'STAFFING'::text,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 fs.enrolment_total::bigint,
                 fs.teachers_on_roll::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint
            from fact_staffing fs
           where fs.period_id = ${annualPeriodId}::uuid
          union all
          -- ATTENDANCE — the attendance-rate arm. fact_attendance is a FLOW at TERM grain and has NO sex
          -- column (lib/etl/attendance.ts), so it is the ONE arm on termPeriodId (enrolment, staffing and
          -- the female arm are all ANNUAL stocks). It carries no sex filter. class_form IS NULL keeps only
          -- the per-stage totals (the per-form rows sit beside
          -- them, ETL writes both); summing over stages is the school's total pupil-days. present_days and
          -- enrolled_days are the summable numerator/denominator; the per-child rate is Σ÷Σ in TS below,
          -- never avg(stored attendance_rate) (the stored rate column is deliberately never selected).
          select fa.jurisdiction_id,
                 'ATTENDANCE'::text,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 fa.present_days::bigint,
                 fa.enrolled_days::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint
            from fact_attendance fa
           where fa.period_id = ${termPeriodId}::uuid
             and fa.class_form is null
          union all
          -- ENROLMENT_FEMALE -- the girls-share NUMERATOR. Same table, same period parameter and the same
          -- two mandatory filters as the ENROLMENT arm above, with sex = FEMALE instead of ALL. The period
          -- parameter is deliberately the IDENTICAL binding, not a copy of the same value: numerator and
          -- denominator of a share can then never be pinned to different periods, and the one place the
          -- enrolment grain is stated moves both arms at once. Both filters stay mandatory for the reasons
          -- the ENROLMENT arm states: the FEMALE row sits beside MALE and ALL, and a null class_form IS the
          -- stage total with the per-form rows beside it. Dropping either multiplies the numerator and can
          -- push the share above 1. The ETL writes FEMALE wherever it writes ALL, with ALL = MALE + FEMALE
          -- asserted strictly per school, so an all-boys school files a real zero here and never an absence.
          select fe.jurisdiction_id,
                 'ENROLMENT_FEMALE'::text,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 fe.headcount::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint
            from fact_enrolment fe
           where fe.period_id = ${annualPeriodId}::uuid
             and fe.sex = 'FEMALE'::ov_sex
             and fe.class_form is null
          union all
          -- ESTABLISHMENT -- the TEACHER-VACANCY arm, and a PARALLEL arm to STAFFING rather than more
          -- columns on it, because its DENOMINATOR IS DIFFERENT. fact_staffing carries a staffing row for
          -- every school, but GES sets a teaching_posts_established only for PUBLIC ones, so
          -- establishment and vacancies are NULL for every PRIVATE/MISSION school
          -- (STAFFING-PTR-DOMAIN-RULING §4). The is not null predicate below IS the §6/AC-17 read rule
          -- made structural: every establishment/vacancy sum is over public rows ONLY, and the arm's own
          -- row count + count(distinct …) give the honest "Across N public schools with a GES
          -- establishment" denominator, which is NARROWER than the PTR/enrolment school count and must be
          -- stated as such (Kofi V4/V5). Private and mission schools are thereby VISIBLY EXCLUDED: they
          -- contribute no row here, so an all-private child comes back NULL — absence — and never a false
          -- "0 posts unfilled".
          --
          -- ⚠ THE SIGN IS SPLIT HERE, AT SCHOOL GRAIN, AND NEVER FLOORED. vacancies is stored SIGNED
          -- (positive = shortage / posts unfilled; negative = surplus / teachers over establishment, the
          -- urban-south case), so greatest(vacancies,0) and greatest(-vacancies,0) are the two GROSS
          -- magnitudes of Kofi V1's two-sided decomposition. A lone Σ(vacancies) at tier grain cancels
          -- north shortage against south surplus and is BANNED, which is why this arm emits the two
          -- magnitudes and the net is derived from them in TS below — the read cannot produce a net
          -- without the decomposition that qualifies it. (Postgres greatest ignores NULLs, so a
          -- defective row with an establishment but a null vacancies contributes 0 to both sides rather
          -- than nulling the sum; the ETL forbids that state — vacancies is NULL iff establishment is.)
          select fs.jurisdiction_id,
                 'ESTABLISHMENT'::text,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 0::bigint,
                 fs.teaching_posts_established::bigint,
                 greatest(fs.vacancies, 0)::bigint,
                 greatest(-fs.vacancies, 0)::bigint
            from fact_staffing fs
           where fs.period_id = ${annualPeriodId}::uuid
             and fs.teaching_posts_established is not null
        ),
        attributed as (
          select case ${childLevel}::jurisdiction_level
                   when 'REGION'   then r.jurisdiction_id
                   when 'DISTRICT' then d.jurisdiction_id
                   when 'SCHOOL'   then s.jurisdiction_id
                 end                      as child_id,
                 case ${childLevel}::jurisdiction_level
                   when 'REGION'   then r.name
                   when 'DISTRICT' then d.name
                   when 'SCHOOL'   then s.name
                 end                      as child_name,
                 f.jurisdiction_id        as jurisdiction_id,
                 f.measure                as measure,
                 f.headcount              as headcount,
                 f.candidates             as candidates,
                 f.qualified              as qualified,
                 f.staff_enrolment        as staff_enrolment,
                 f.teachers               as teachers,
                 f.present_days           as present_days,
                 f.enrolled_days          as enrolled_days,
                 f.female_headcount       as female_headcount,
                 f.posts_established      as posts_established,
                 f.vacancy_shortage       as vacancy_shortage,
                 f.vacancy_surplus        as vacancy_surplus
            from facts f
            -- The fact's OWN node. INNER is correct here and only here: the fact row is visible, so its
            -- SCHOOL row is visible too (same predicate, same argument).
            join      dim_jurisdiction s on s.jurisdiction_id = f.jurisdiction_id
                                        and s.level = 'SCHOOL'
            -- ⚠ LEFT, and LEVEL-PINNED, on every ancestor hop. See the module note: an INNER join here
            -- returns zero rows for a district officer and passes every national-only test.
            left join dim_jurisdiction d on d.jurisdiction_id = s.parent_id
                                        and d.level = 'DISTRICT'
            left join dim_jurisdiction r on r.jurisdiction_id = d.parent_id
                                        and r.level = 'REGION'
        )
        select child_id::text                                            as child_id,
               child_name                                                as child_name,
               grouping(child_id, child_name)::int                       as grp,
               sum(headcount) filter (where measure = 'ENROLMENT')::bigint       as enrolment,
               count(*) filter (where measure = 'ENROLMENT')::int                as enrolment_rows,
               count(distinct jurisdiction_id)
                 filter (where measure = 'ENROLMENT')::int                       as schools_filing,
               sum(candidates) filter (where measure = 'EXAM')::bigint           as candidates,
               sum(qualified) filter (where measure = 'EXAM')::bigint            as qualified,
               count(*) filter (where measure = 'EXAM')::int                     as exam_rows,
               sum(staff_enrolment) filter (where measure = 'STAFFING')::bigint  as staff_enrolment,
               sum(teachers) filter (where measure = 'STAFFING')::bigint         as teachers,
               count(*) filter (where measure = 'STAFFING')::int                 as staffing_rows,
               sum(present_days) filter (where measure = 'ATTENDANCE')::bigint   as present_days,
               sum(enrolled_days) filter (where measure = 'ATTENDANCE')::bigint  as enrolled_days,
               count(*) filter (where measure = 'ATTENDANCE')::int               as attendance_rows,
               sum(female_headcount) filter (where measure = 'ENROLMENT_FEMALE')::bigint as female_enrolment,
               count(*)              filter (where measure = 'ENROLMENT_FEMALE')::int    as female_rows,
               sum(posts_established) filter (where measure = 'ESTABLISHMENT')::bigint   as posts_established,
               sum(vacancy_shortage) filter (where measure = 'ESTABLISHMENT')::bigint    as vacancy_shortage,
               sum(vacancy_surplus)  filter (where measure = 'ESTABLISHMENT')::bigint    as vacancy_surplus,
               count(*)              filter (where measure = 'ESTABLISHMENT')::int       as establishment_rows,
               count(distinct jurisdiction_id)
                 filter (where measure = 'ESTABLISHMENT')::int                           as schools_with_establishment
          from attributed
         group by grouping sets ((child_id, child_name), ())
      `);

      const factRows = rowsOf(factResult);
      let factTotal: FactBucket | null = null;
      const factBuckets = new Map<string | null, FactBucket>();
      for (const row of factRows) {
        const enrolmentRows = Number(row.enrolment_rows);
        const examRows = Number(row.exam_rows);
        const staffingRows = Number(row.staffing_rows);
        const attendanceRows = Number(row.attendance_rows);
        const femaleRows = Number(row.female_rows);
        // The ESTABLISHMENT arm's OWN row count, separate from `staffing_rows`: a child can have
        // staffing rows (every school files one) and NO establishment row (all-private/mission). That
        // difference is exactly the UNAVAILABLE-vs-0 distinction (Kofi V12), so it needs its own count.
        const establishmentRows = Number(row.establishment_rows);
        const bucket: FactBucket = {
          childId: (row.child_id as string | null) ?? null,
          name: (row.child_name as string | null) ?? null,
          // `null` not `0` when nothing was filed — the whole point of the row-count columns.
          enrolment: enrolmentRows === 0 ? null : Number(row.enrolment),
          schoolsFiling: enrolmentRows === 0 ? null : Number(row.schools_filing),
          candidates: examRows === 0 ? null : Number(row.candidates),
          qualified: examRows === 0 ? null : Number(row.qualified),
          staffEnrolment: staffingRows === 0 ? null : Number(row.staff_enrolment),
          teachers: staffingRows === 0 ? null : Number(row.teachers),
          presentDays: attendanceRows === 0 ? null : Number(row.present_days),
          enrolledDays: attendanceRows === 0 ? null : Number(row.enrolled_days),
          femaleEnrolment: femaleRows === 0 ? null : Number(row.female_enrolment),
          // `null` not `0` when no PUBLIC-establishment row was filed: an all-private/mission child has
          // no GES establishment, which is ABSENCE, not "0 posts unfilled / fully staffed" (Kofi V12).
          postsEstablished:
            establishmentRows === 0 ? null : Number(row.posts_established),
          vacancyShortage: establishmentRows === 0 ? null : Number(row.vacancy_shortage),
          vacancySurplus: establishmentRows === 0 ? null : Number(row.vacancy_surplus),
          schoolsWithEstablishment:
            establishmentRows === 0 ? null : Number(row.schools_with_establishment),
        };
        if (Number(row.grp) === TOTAL_GROUPING) factTotal = bucket;
        else factBuckets.set(bucket.childId, bucket);
      }

      /**
       * QUERY 2 — THE REGISTER SIDE, a plain `group by` on a key the table ALREADY CARRIES.
       *
       * `ref_emis_school_register` is the only table that denormalises the ancestry: it carries both
       * `district_id` and `region_id` (db/schema/ref.ts). So the coverage columns need no walk at all —
       * this is `lib/oversight/coverage.ts` with a `group by` added, which is the right shape wherever
       * the column exists, and it exists on exactly this one table.
       *
       * ⚠ OMITTED ENTIRELY AT THE DISTRICT TIER (§3). The register is keyed on `emis_school_id` and
       * carries NO school-node uuid, so when the child is a school there is nothing to group by.
       * Bridging it would need `join dim_jurisdiction on ges_code = emis_school_id`, and
       * `dim_jurisdiction(level, ges_code)` has NO UNIQUE INDEX — a duplicate `ges_code` would fan out
       * and silently inflate the coverage counts. Not worth it, and not asked for.
       *
       * The child NAME is left-joined by PRIMARY KEY off the grouped id, level-pinned, so a child that
       * is in the register and filed no facts is still labelable. By PK, so it cannot fan out; LEFT and
       * level-pinned for the same two reasons as the fact side; and `dim_jurisdiction`'s own policy
       * means an out-of-subtree node yields a null label rather than a name.
       */
      let registerTotal: RegisterBucket | null = null;
      const registerBuckets = new Map<string | null, RegisterBucket>();
      const hasCoverage = childLevel !== "SCHOOL";
      if (hasCoverage) {
        const registerResult = await tx.execute(sql`
          with attributed as (
            select case ${childLevel}::jurisdiction_level
                     when 'REGION'   then reg.region_id
                     when 'DISTRICT' then reg.district_id
                   end                as child_id,
                   reg.on_schoolup    as on_schoolup
              from ref_emis_school_register reg
          )
          select a.child_id::text                                as child_id,
                 c.name                                          as child_name,
                 grouping(a.child_id, c.name)::int               as grp,
                 count(*) filter (where a.on_schoolup)::int       as reporting,
                 count(*)::int                                   as registered
            from attributed a
            left join dim_jurisdiction c on c.jurisdiction_id = a.child_id
                                        and c.level = ${childLevel}::jurisdiction_level
           group by grouping sets ((a.child_id, c.name), ())
        `);
        for (const row of rowsOf(registerResult)) {
          const bucket: RegisterBucket = {
            childId: (row.child_id as string | null) ?? null,
            name: (row.child_name as string | null) ?? null,
            reporting: Number(row.reporting),
            registered: Number(row.registered),
          };
          if (Number(row.grp) === TOTAL_GROUPING) registerTotal = bucket;
          else registerBuckets.set(bucket.childId, bucket);
        }
      }

      // An aggregate always returns a row, so a missing total row means the read itself is unstateable.
      if (factTotal === null) return unavailable<ChildBreakdown>();

      /**
       * THE MERGE — a FULL OUTER merge on `child_id`, each absent measure kept NULL.
       *
       * Row set = register children ∪ fact children (Wells §8.2): a region that is in the register but
       * filed no enrolment appears with its coverage columns and a null enrolment / null rate, which is
       * the design's muted `—` cell and never a fake 0%. At the DISTRICT tier the register side is
       * absent, so there the row set is fact-driven only.
       */
      const merge = (
        childId: string | null,
        fact: FactBucket | undefined,
        register: RegisterBucket | undefined,
      ): BreakdownRow => ({
        childId,
        // The fact side's label first because it comes off the alias the `case` selected; the register
        // side's is the same column on the same node, read for children with no facts at all.
        name: fact?.name ?? register?.name ?? null,
        enrolment: fact?.enrolment ?? null,
        schoolsFiling: fact?.schoolsFiling ?? null,
        // Σfemale ÷ Σenrolment, per child — the girls' share, carried alongside its numerator so it
        // reconciles through `sumOf` like every additive measure. Null when no enrolment row was filed
        // (never a 0/0); NOT clamped — a share above 1 would mean a lost filter, and hiding it hides that.
        femaleEnrolment: fact?.femaleEnrolment ?? null,
        girlsShare:
          fact?.femaleEnrolment != null && fact.enrolment != null
            ? ratio(fact.femaleEnrolment, fact.enrolment)
            : null,
        candidates: fact?.candidates ?? null,
        qualified: fact?.qualified ?? null,
        wassceRate:
          fact?.candidates != null && fact.qualified != null
            ? ratio(fact.qualified, fact.candidates)
            : null,
        schoolsReporting: register?.reporting ?? null,
        schoolsRegistered: register?.registered ?? null,
        coverageRatio:
          register === undefined ? null : ratio(register.reporting, register.registered),
        // Σenrolment ÷ Σteachers, per child — the weighted PTR, never avg(stored ptr). Null when the
        // child filed no staffing row (not a "0 teachers" claim), consistent with every other measure.
        staffEnrolment: fact?.staffEnrolment ?? null,
        teachers: fact?.teachers ?? null,
        ptr:
          fact?.staffEnrolment != null && fact.teachers != null
            ? ratio(fact.staffEnrolment, fact.teachers)
            : null,
        // Σpresent ÷ Σenrolled, per child — the weighted attendance rate, never avg(stored rate). Null
        // when the child filed no attendance row (not a "0%" claim), consistent with every other measure.
        presentDays: fact?.presentDays ?? null,
        enrolledDays: fact?.enrolledDays ?? null,
        attendanceRate:
          fact?.presentDays != null && fact.enrolledDays != null
            ? ratio(fact.presentDays, fact.enrolledDays)
            : null,
        // THE TEACHER-ESTABLISHMENT COMPONENTS, PUBLIC-ONLY (Kofi V1/V4). The two gross magnitudes ride
        // on the row like `candidates`/`qualified` behind `wassceRate`, so the per-child column, the
        // comparison benchmark and the "Teacher establishment" panel all fold from ONE staffing scan and
        // cannot disagree (V11). `vacancyNet` is DERIVED from the two magnitudes — shortage − surplus ≡
        // Σ vacancies — so no surface can obtain a net without the decomposition that qualifies it.
        postsEstablished: fact?.postsEstablished ?? null,
        vacancyShortage: fact?.vacancyShortage ?? null,
        vacancySurplus: fact?.vacancySurplus ?? null,
        schoolsWithEstablishment: fact?.schoolsWithEstablishment ?? null,
        vacancyNet:
          fact?.vacancyShortage != null && fact.vacancySurplus != null
            ? fact.vacancyShortage - fact.vacancySurplus
            : null,
        // Σvacancies ÷ Σestablished, per child — the normalised, roll-up-safe vacancy rate (signed).
        // Null when the child has no public establishment: never a 0/0, and never a floored magnitude.
        vacancyRate:
          fact?.vacancyShortage != null &&
          fact.vacancySurplus != null &&
          fact.postsEstablished != null
            ? ratio(fact.vacancyShortage - fact.vacancySurplus, fact.postsEstablished)
            : null,
      });

      const childIds = new Set<string>();
      for (const id of factBuckets.keys()) if (id !== null) childIds.add(id);
      for (const id of registerBuckets.keys()) if (id !== null) childIds.add(id);

      const children = [...childIds]
        .map((id) => merge(id, factBuckets.get(id), registerBuckets.get(id)))
        .sort(byRateDesc);

      /**
       * The unattributed bucket: a fact row whose level-pinned hop found no ancestor, and/or a register
       * row that names no region/district. Both mean "visible, but not attributable to a child", and
       * both must be SHOWN — see the module note. Null when neither side produced one.
       */
      const unattributedFact = factBuckets.get(null);
      const unattributedRegister = registerBuckets.get(null);
      const unattributed =
        unattributedFact === undefined && unattributedRegister === undefined
          ? null
          : merge(null, unattributedFact, unattributedRegister);

      const total = merge(null, factTotal, registerTotal ?? undefined);

      /**
       * Σchildren = total, OR SAY SO (Wells trap 6). The unattributed bucket is the only legitimate
       * source of a gap and it is included in the sum, so a mismatch here is not a data state — it is
       * this module being wrong. Degrading the TABLE (one `unavailable` reading → the surface's warn
       * banner) is the honest answer; a total that is not the sum of the rows above it is the one
       * defect this surface cannot ship with.
       */
      const rows = unattributed === null ? children : [...children, unattributed];
      const sumOf = (pick: (row: BreakdownRow) => number | null): number =>
        rows.reduce((acc, row) => acc + (pick(row) ?? 0), 0);
      // PTR is a RATIO, not additive, so it is reconciled through its two COMPONENTS — the same
      // `Σ children + unattributed = () total` grouping-sets invariant the other measures lean on. The
      // components ride on the row now (like candidates/qualified behind wassceRate), so this is the
      // identical `sumOf` form, no second fact-side pass.
      const reconciles =
        sumOf((r) => r.enrolment) === (total.enrolment ?? 0) &&
        sumOf((r) => r.femaleEnrolment) === (total.femaleEnrolment ?? 0) &&
        sumOf((r) => r.candidates) === (total.candidates ?? 0) &&
        sumOf((r) => r.qualified) === (total.qualified ?? 0) &&
        sumOf((r) => r.staffEnrolment) === (total.staffEnrolment ?? 0) &&
        sumOf((r) => r.teachers) === (total.teachers ?? 0) &&
        sumOf((r) => r.presentDays) === (total.presentDays ?? 0) &&
        sumOf((r) => r.enrolledDays) === (total.enrolledDays ?? 0) &&
        // The PUBLIC-ONLY establishment sums reconcile the same way. Vacancies is a SIGNED column and
        // its tier figure is a DECOMPOSITION, not one number, so the invariant is checked on each gross
        // magnitude SEPARATELY: a net-only check would pass even if shortage and surplus had been
        // swapped or cancelled on the way up, which is the exact failure this surface exists to prevent.
        sumOf((r) => r.postsEstablished) === (total.postsEstablished ?? 0) &&
        sumOf((r) => r.vacancyShortage) === (total.vacancyShortage ?? 0) &&
        sumOf((r) => r.vacancySurplus) === (total.vacancySurplus ?? 0) &&
        (!hasCoverage ||
          (sumOf((r) => r.schoolsRegistered) === (total.schoolsRegistered ?? 0) &&
            sumOf((r) => r.schoolsReporting) === (total.schoolsReporting ?? 0)));
      if (!reconciles) return unavailable<ChildBreakdown>();

      return ok({ childLevel, children, unattributed, total, hasCoverage });
    });
  } catch {
    // Fail-soft in the LIB, per the `Reading` precedent: the breakdown degrades to a banner and the
    // page — including the KPI strip above it — still renders.
    return unavailable<ChildBreakdown>();
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * DERIVED READS OF THE SAME ROW SET — no second query (Lucy §4.4 / §4.5).
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

export interface RankEnds {
  strongest: BreakdownRow;
  weakest: BreakdownRow;
}

/**
 * Best and worst child BY THE ACTIVE SORT, among children clearing the candidate floor.
 *
 * Fewer than two children clear it ⇒ no rank cards at all, rather than ranking what is left
 * (Wells §5). Nothing is concealed by this: the table still lists every child with its candidate count.
 */
export function rankEnds(breakdown: ChildBreakdown): RankEnds | null {
  const eligible = breakdown.children.filter(
    (row) =>
      row.wassceRate !== null &&
      row.candidates !== null &&
      row.candidates >= RANK_CARD_MIN_CANDIDATES,
  );
  if (eligible.length < 2) return null;
  // `children` is already sorted by the active sort, and `filter` preserves order.
  return { strongest: eligible[0]!, weakest: eligible[eligible.length - 1]! };
}

/**
 * THE TIER'S TEACHER-ESTABLISHMENT READING — the two-sided decomposition, folded from the SAME scan.
 *
 * Every field is the officer's own subtree total over PUBLIC-establishment rows for the one ANNUAL
 * period, taken straight off `breakdown.total`, which is the `()` grouping-set row. That is what makes
 * the panel's shortage/surplus/net, the breakdown total-row cell and the comparison benchmark the same
 * figures by construction rather than by coincidence (Kofi V11).
 */
export interface TeacherEstablishment {
  /** Σ teaching_posts_established over the subtree's public-establishment schools. */
  postsEstablished: number;
  /** Σ GREATEST(vacancies, 0) — posts unfilled. Shown as its OWN magnitude, never netted away. */
  shortage: number;
  /** Σ GREATEST(−vacancies, 0) — teachers over establishment. Likewise its own magnitude. */
  surplus: number;
  /** shortage − surplus ≡ Σ vacancies. Signed, and only ever shown labelled "net", beside the two. */
  net: number;
  /** net ÷ postsEstablished — the signed vacancy rate. Null if the establishment sum is 0. */
  vacancyRate: number | null;
  /** The honest "Across N public schools with a GES establishment" denominator. Always ≥ 1 here. */
  schoolsWithEstablishment: number;
}

/**
 * The tier reading, or `null` for GENUINELY UNAVAILABLE (Kofi V12) — not 0.
 *
 * `null` means the subtree contains NO school with a GES establishment (an all-private/mission tier),
 * so there is no figure to state; the surface says so. It is deliberately NOT the same state as a true
 * NET-ZERO (V13), which has a real public denominator and real shortage/surplus magnitudes that cancel,
 * and which this function returns normally with `net === 0` so the caller can render the decomposition
 * and the word "balanced". Nothing here `coalesce`s absence into a false "0 posts unfilled".
 */
export function teacherEstablishmentOf(
  breakdown: ChildBreakdown,
): TeacherEstablishment | null {
  const t = breakdown.total;
  if (
    t.schoolsWithEstablishment === null ||
    t.schoolsWithEstablishment === 0 ||
    t.postsEstablished === null ||
    t.vacancyShortage === null ||
    t.vacancySurplus === null
  ) {
    return null;
  }
  /**
   * THE NET AND THE RATE ARE READ OFF THE TOTAL ROW, NOT RECOMPUTED (Kofi V11, structurally — Dex N8).
   *
   * `vacancyNet` and `vacancyRate` are already derived once, for every row including the `()` total,
   * where the row is built above. Re-deriving them here (`shortage − surplus`, `ratio(net, posts)`)
   * made V11 — "the panel, the table's total-row cell and the comparison benchmark are one set of
   * figures" — a property that happened to hold because two expressions matched, rather than one that
   * cannot fail. Now there is ONE derivation with two readers.
   *
   * The non-null assertions are discharged by the gate above: `vacancyNet` is non-null exactly when
   * `vacancyShortage` and `vacancySurplus` are, which the five-way check has just established.
   * `vacancyRate` stays NULLABLE — it is null on a zero establishment sum, which is the honest 0/0.
   */
  return {
    postsEstablished: t.postsEstablished,
    shortage: t.vacancyShortage,
    surplus: t.vacancySurplus,
    net: t.vacancyNet!,
    vacancyRate: t.vacancyRate,
    schoolsWithEstablishment: t.schoolsWithEstablishment,
  };
}

export interface Spread {
  min: number;
  max: number;
  /**
   * The WEIGHTED mean — the tier total's own rate, NOT the unweighted mean of the children's rates.
   * The no-averaging rule does not stop applying because the number is going on a chart.
   */
  mean: number | null;
}

/**
 * min/max/weighted-mean of ONE measure across the children. Null when there is no spread.
 *
 * The measure is not necessarily a 0..1 proportion: `ptr` is a ratio on its own scale, and `vacancyRate`
 * is a SIGNED rate that crosses zero (hence `VACANCY_AXIS`, which is symmetric about it). Each caller
 * states its own axis; this fold only compares numbers.
 */
export function spreadOf(
  breakdown: ChildBreakdown,
  pick: (row: BreakdownRow) => number | null,
): Spread | null {
  const values = breakdown.children
    .map(pick)
    .filter((value): value is number => value !== null);
  // One child is not a spread; zero-width bars would be a visual claim about a range that is not one.
  if (values.length < 2) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: pick(breakdown.total),
  };
}
