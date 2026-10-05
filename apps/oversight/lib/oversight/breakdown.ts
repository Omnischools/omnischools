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
  /** Σ headcount, `sex='ALL'`, `class_form is null`, one TERM period. Null = no return filed. */
  enrolment: number | null;
  /** Schools that FILED enrolment for the pinned term — not "schools that exist" (see coverage.ts). */
  schoolsFiling: number | null;
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
    /** The ONE TERM period the enrolment column is of. Null ⇒ that column is simply absent. */
    termPeriodId: string | null;
    /** The ONE sitting the WASSCE columns are of. Null ⇒ those columns are simply absent. */
    examPeriodId: string | null;
    exam: Exam;
  },
): Promise<Reading<ChildBreakdown>> {
  const { childLevel, termPeriodId, examPeriodId, exam } = args;
  try {
    return await withJurisdiction(scope, async (tx) => {
      /**
       * QUERY 1 — THE FACT SIDE. One statement, one ancestry walk, one `()` total row.
       *
       * The two fact tables are UNION ALL'd into a per-school `facts` CTE BEFORE the ancestor join, so
       * the level-pinned upward walk is written exactly ONCE instead of copy-pasted per measure — and
       * so the enrolment total and the WASSCE total come from the SAME scan as their own child rows
       * (Wells trap 5). `measure` separates them again in the `filter (where …)` clauses, which is also
       * what keeps "no rows" distinguishable from "a measured zero".
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
                 0::bigint                   as qualified
            from fact_enrolment fe
           where fe.period_id = ${termPeriodId}::uuid
             -- Both mandatory: the ALL row sits beside MALE/FEMALE (×3) and a null class_form IS the
             -- stage total, with the per-form rows beside it (×2). See lib/oversight/enrolment.ts.
             and fe.sex = 'ALL'::ov_sex
             and fe.class_form is null
          union all
          select fpe.jurisdiction_id,
                 'EXAM'::text,
                 0::bigint,
                 fpe.candidates::bigint,
                 fpe.qualified::bigint
            from fact_performance_exam fpe
           where fpe.period_id = ${examPeriodId}::uuid
             and fpe.exam = ${exam}::exam
             -- Mandatory, and the dangerous one: without it the RATE still looks right (the factor
             -- cancels) while the candidate count is 3× the real cohort — so three copies of a thin
             -- cohort would silently satisfy the rank-card floor.
             and fpe.sex = 'ALL'::ov_sex
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
                 f.qualified              as qualified
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
               count(*) filter (where measure = 'EXAM')::int                     as exam_rows
          from attributed
         group by grouping sets ((child_id, child_name), ())
      `);

      const factRows = rowsOf(factResult);
      let factTotal: FactBucket | null = null;
      const factBuckets = new Map<string | null, FactBucket>();
      for (const row of factRows) {
        const enrolmentRows = Number(row.enrolment_rows);
        const examRows = Number(row.exam_rows);
        const bucket: FactBucket = {
          childId: (row.child_id as string | null) ?? null,
          name: (row.child_name as string | null) ?? null,
          // `null` not `0` when nothing was filed — the whole point of the row-count columns.
          enrolment: enrolmentRows === 0 ? null : Number(row.enrolment),
          schoolsFiling: enrolmentRows === 0 ? null : Number(row.schools_filing),
          candidates: examRows === 0 ? null : Number(row.candidates),
          qualified: examRows === 0 ? null : Number(row.qualified),
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
      const reconciles =
        sumOf((r) => r.enrolment) === (total.enrolment ?? 0) &&
        sumOf((r) => r.candidates) === (total.candidates ?? 0) &&
        sumOf((r) => r.qualified) === (total.qualified ?? 0) &&
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

export interface Spread {
  min: number;
  max: number;
  /**
   * The WEIGHTED mean — the tier total's own rate, NOT the unweighted mean of the children's rates.
   * The no-averaging rule does not stop applying because the number is going on a chart.
   */
  mean: number | null;
}

/** min/max/weighted-mean of one 0..1 measure across the children. Null when there is no spread. */
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
