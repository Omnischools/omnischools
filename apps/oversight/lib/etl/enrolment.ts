import type postgres from "postgres";
import type { RosterGroupSourceRow } from "./enrolment-source";
import { ANALYTICS_STAGES, classFormOf, stageOf, type AnalyticsStage } from "./stage";
import { stampProvenance, type Provenance } from "./run";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `students` ⋈ `class` → `fact_enrolment` — THE TRANSFORM AND THE WRITE (task H9, Kofi's ruling).
 *
 * The second fact slice. It REUSES the first one's proven machinery wholesale — the ETL harness, the
 * dimension refresh, the EMIS register, the inclusion set, the provenance stamper and the ANNUAL
 * period layer are all unchanged — and adds exactly one new thing: an AGGREGATION. That is the whole
 * difference between the two slices, and every decision below follows from it.
 *
 * ── THE GRAIN IS ANNUAL, AND THERE IS NO TERM AND NO EXAM_COHORT ────────────────────────────────
 * One row-set per school per academic_year, `period_type = 'ANNUAL'`, `term IS NULL` — the same
 * `dim_period` row `fact_infrastructure` writes against, resolved by the same
 * `annualPeriodSpecs` / `periodKey(year, null)` helpers. Enrolment is a STOCK (the headcount ON ROLL),
 * so it is summed SPATIALLY (across schools) and NEVER across periods: a child counted in term 1 and
 * again in term 2 is one child, and adding the two invents a pupil. Filing at ANNUAL grain is the
 * STRUCTURAL half of that rule, exactly as it is for infrastructure — a reporting query that forgets
 * its period filter can no longer triple a BASIC school's roll inside one year.
 *
 * The reader does not join `academic_period` at all: a roster has no period (students carry none). It
 * counts the CURRENT ACTIVE roll and this module files it under the run's academic_year.
 *
 * ── WHAT IS WRITTEN: THE BREAKDOWN **AND** THE STAGE TOTALS ─────────────────────────────────────
 * Per (school, period, stage):
 *   · for EVERY present `class_form`:  MALE, FEMALE, ALL                 (the breakdown)
 *   · PLUS `class_form IS NULL`:       MALE, FEMALE, ALL                 (the stage total)
 *
 * This is the ONE place this slice departs from `fact_infrastructure`'s "store the breakdown only,
 * let the reader sum" posture, and the reason is specific: `class_form` IS PER-SCHOOL FREE TEXT. One
 * school's "P4" is another's "Class 4" and a third's "Basic 4"; normalising them (as `lib/etl/stage.ts`
 * does) makes them comparable WITHIN a stage but does not make them SUMMABLE ACROSS SCHOOLS — a
 * district "P4" figure silently omits every school that labels the same children differently. So the
 * STAGE TOTAL is the only roll-up-safe figure, and a figure that must be correct cannot be left to
 * each reader to re-derive. It is MATERIALISED here, and the invariant "stage total = Σ its
 * breakdown" is asserted on every school before the write.
 *
 * ⚠ THE COROLLARY FOR EVERY READER: a roll-up above the school MUST filter
 * `sex = 'ALL' AND class_form IS NULL`. Summing unfiltered double-counts THREE times over — once for
 * the sex split, once for the breakdown-plus-total, and once more if several stages are present. There
 * is no constraint that can express this; `tests/etl-enrolment.test.ts` states it executably, in both
 * directions (the filtered sum matches the hand-computed figure; the unfiltered one does not).
 *
 * ── SEX: 'ALL' IS SYNTHESISED, AND THE INVARIANT IS STRICT EQUALITY ─────────────────────────────
 * Operational `students.sex` is NOT NULL and MALE|FEMALE only, so `sex = 'ALL'` is computed here as
 * MALE + FEMALE — never read, never approximated. For EVERY (jurisdiction, period, stage, class_form)
 * key, INCLUDING the class_form-NULL totals:
 *       headcount(ALL) = headcount(MALE) + headcount(FEMALE)
 * STRICT equality, asserted per school before the write. It is strict rather than ≥ because there is
 * no third category and no unknown-sex bucket to absorb a difference: any gap would mean a child was
 * counted in the total but in neither split (or vice versa), which is a defect in this function.
 *
 * ── ONLY ACTIVE CHILDREN, AND THE TWO TALLIES THAT ARE NOT STAGES ──────────────────────────────
 * The reader filters `status = 'ACTIVE'`. Out-of-scope (Nursery/Creche/Pre-K — below KG) and unmapped
 * (no tier keyword / no usable year number) classes are EXCLUDED from every stage row and TALLIED per
 * school instead. Neither fails the school and neither is bucketed into a real stage — see
 * `lib/etl/stage.ts` for why coercion and silent dropping are both worse than a visible tally.
 *
 * ── THE STAGE COMES FROM THE CLASS LABEL, NOT FROM `school_type` ───────────────────────────────
 * A COMBINED school emits several stages; a register "JHS" school running a Form 1 stream emits SHS.
 * The second case is reported as DRIFT — a named, non-fatal signal that the register and the roster
 * disagree — because the roster is the thing that has children in it. Using `school_type` as the
 * answer would file those children under a stage whose GSS population band describes different ages.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Raised for a roster this ETL refuses to aggregate. Per-school isolated by `computePerSchool`. */
export class EnrolmentTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrolmentTransformError";
  }
}

/** The analytics sex vocabulary (`ov_sex`). MALE/FEMALE are read; ALL is synthesised. */
export const FACT_SEXES = ["MALE", "FEMALE", "ALL"] as const;
export type FactSex = (typeof FACT_SEXES)[number];

/** One `fact_enrolment` row, ready to insert. Column-for-column with `db/schema/fact.ts`. */
export interface FactEnrolmentRow {
  jurisdictionId: string;
  periodId: string;
  stage: AnalyticsStage;
  /** The normalised year-group token, or NULL — and NULL means THE STAGE TOTAL. */
  classForm: string | null;
  sex: FactSex;
  headcount: number;
  source: Provenance["source"];
  asOfDate: string;
  etlRunId: string;
}

/** One school's aggregated roster: the rows to write, plus everything that is NOT a row. */
export interface SchoolEnrolmentResult {
  rows: FactEnrolmentRow[];
  /** Every ACTIVE child the reader returned for this school — rows + the two tallies below. */
  activeHeadcount: number;
  /** ACTIVE children in a below-KG class (Nursery/Creche/Pre-K). In no stage row, never dropped. */
  outOfScopeHeadcount: number;
  /** ACTIVE children whose class label resolved to no stage. In no stage row, never dropped. */
  unmappedHeadcount: number;
  /** The stages this school actually teaches, per its own class labels. */
  stages: AnalyticsStage[];
  /** Stages its register `school_type` does not account for — reported, never fatal. See the header. */
  stageDrift: AnalyticsStage[];
}

/**
 * The stages a register `school_type` leads a reader to EXPECT. Deliberately generous (a PRIMARY
 * school routinely runs an attached KG), because the point of the drift flag is to catch the case a
 * human should look at — a senior stream in a basic school, a basic stream in an SHS — not to
 * second-guess every ordinary school. An unknown school_type expects nothing and so flags nothing:
 * the flag is a hint, and a hint that fires on every row is noise.
 */
const EXPECTED_STAGES: Record<string, readonly AnalyticsStage[]> = {
  KG: ["KG"],
  PRIMARY: ["KG", "PRIMARY"],
  JHS: ["JHS"],
  SHS: ["SHS"],
  COMBINED: ["KG", "PRIMARY", "JHS", "SHS"],
};

interface Bucket {
  MALE: number;
  FEMALE: number;
}

const emptyBucket = (): Bucket => ({ MALE: 0, FEMALE: 0 });

/**
 * THE PURE AGGREGATION. No DB, no clock, no randomness — same groups + same target in, same rows
 * out, which is what makes the idempotency test meaningful.
 *
 * It FAILS LOUDLY rather than coercing, for the same reason the infrastructure transform does: a
 * roster whose sex is outside MALE|FEMALE, or whose headcount is negative, is one nobody can honestly
 * aggregate, and `computePerSchool` exists so refusing it costs ONE school rather than the run.
 */
export function aggregateSchoolRoster(
  groups: RosterGroupSourceRow[],
  target: {
    jurisdictionId: string;
    periodId: string;
    emisSchoolId: string;
    etlRunId: string;
    /** The roster's frozen vintage — see `EtlRunOptions.rosterAsOf` in `lib/etl/pipeline.ts`. */
    asOfDate: string;
    /** The register's `school_type`, used ONLY for the drift flag — never to derive a stage. */
    schoolType?: string | null;
  },
): SchoolEnrolmentResult {
  const { emisSchoolId } = target;

  // stage → class_form → {MALE, FEMALE}. `class_form` NULL is not a key here: the stage total is
  // DERIVED below, so it cannot drift from the breakdown it is supposed to total.
  const byStage = new Map<AnalyticsStage, Map<string, Bucket>>();
  let outOfScopeHeadcount = 0;
  let unmappedHeadcount = 0;
  let activeHeadcount = 0;

  for (const group of groups) {
    if (!Number.isInteger(group.headcount) || group.headcount < 0)
      throw new EnrolmentTransformError(
        `${emisSchoolId}: headcount must be a non-negative integer, got ${String(group.headcount)}.`,
      );
    // 'ALL' MUST NOT ARRIVE FROM THE SOURCE. If it did, synthesising ALL = MALE + FEMALE on top of it
    // would double every figure, and the result would satisfy no invariant we could check afterwards.
    if (group.sex !== "MALE" && group.sex !== "FEMALE")
      throw new EnrolmentTransformError(
        `${emisSchoolId}: students.sex "${group.sex}" is outside MALE|FEMALE — 'ALL' is SYNTHESISED ` +
          "by this transform and must never be read from the source.",
      );
    activeHeadcount += group.headcount;

    // THE LABEL, NOT THE SCHOOL TYPE. `class.level` first, then `class.name`; and for a student with
    // no class at all, `current_class_label` — the display fallback the school typed, which is the
    // only statement of that child's year group that exists.
    const level = group.hasClass ? group.classLevel : group.currentClassLabel;
    const name = group.hasClass ? group.className : null;
    const stage = stageOf(level, name);
    if (stage === "OUT_OF_SCOPE") {
      outOfScopeHeadcount += group.headcount;
      continue;
    }
    if (stage === "UNMAPPED") {
      unmappedHeadcount += group.headcount;
      continue;
    }
    const classForm = classFormOf(level, name);
    if (classForm === null)
      // Unreachable by construction (a resolved stage always carries a token), and asserted anyway:
      // a null token here would be written as a SECOND stage-total row and double the stage.
      throw new EnrolmentTransformError(
        `${emisSchoolId}: stage ${stage} resolved with no class_form token from ` +
          `level="${String(level)}" name="${String(name)}" — the stage-total row would be duplicated.`,
      );

    let forms = byStage.get(stage);
    if (!forms) {
      forms = new Map<string, Bucket>();
      byStage.set(stage, forms);
    }
    let bucket = forms.get(classForm);
    if (!bucket) {
      bucket = emptyBucket();
      forms.set(classForm, bucket);
    }
    bucket[group.sex] += group.headcount;
  }

  const provenance = stampProvenance(target.etlRunId, target.asOfDate);
  const rows: FactEnrolmentRow[] = [];
  const stages: AnalyticsStage[] = [];

  // Stage order is `dim_stage.display_order`, and class_form order is lexical within the stage, so
  // the emitted row order is deterministic — which is what makes "a re-run is byte-identical"
  // meaningful rather than accidental.
  for (const stage of ANALYTICS_STAGES) {
    const forms = byStage.get(stage);
    if (!forms || forms.size === 0) continue;
    stages.push(stage);
    const total = emptyBucket();
    for (const classForm of [...forms.keys()].sort()) {
      const bucket = forms.get(classForm)!;
      total.MALE += bucket.MALE;
      total.FEMALE += bucket.FEMALE;
      rows.push(...sexRows({ ...target, ...provenance, stage, classForm, bucket }));
    }
    // THE STAGE TOTAL — `class_form IS NULL`. Written, not left to the reader, because `class_form` is
    // not summable across schools (see the header).
    rows.push(
      ...sexRows({ ...target, ...provenance, stage, classForm: null, bucket: total }),
    );
  }

  const expected = target.schoolType ? EXPECTED_STAGES[target.schoolType] : undefined;
  const stageDrift = expected ? stages.filter((s) => !expected.includes(s)) : [];

  const result: SchoolEnrolmentResult = {
    rows,
    activeHeadcount,
    outOfScopeHeadcount,
    unmappedHeadcount,
    stages,
    stageDrift,
  };
  assertSchoolInvariants(result, emisSchoolId);
  return result;
}

/** The three rows one (stage, class_form) key produces. ALL is MALE + FEMALE, computed here once. */
function sexRows(input: {
  jurisdictionId: string;
  periodId: string;
  stage: AnalyticsStage;
  classForm: string | null;
  bucket: Bucket;
  source: Provenance["source"];
  asOfDate: string;
  etlRunId: string;
}): FactEnrolmentRow[] {
  const base = {
    jurisdictionId: input.jurisdictionId,
    periodId: input.periodId,
    stage: input.stage,
    classForm: input.classForm,
    source: input.source,
    asOfDate: input.asOfDate,
    etlRunId: input.etlRunId,
  };
  return [
    { ...base, sex: "MALE" as const, headcount: input.bucket.MALE },
    { ...base, sex: "FEMALE" as const, headcount: input.bucket.FEMALE },
    { ...base, sex: "ALL" as const, headcount: input.bucket.MALE + input.bucket.FEMALE },
  ];
}

/**
 * THE ARITHMETIC SELF-CHECK, per school, before anything is written.
 *
 * Three claims, all of them things a reader will rely on and none of them expressible as a table
 * CHECK (each spans several rows):
 *   1. every headcount is a non-negative integer;
 *   2. ALL = MALE + FEMALE for every (stage, class_form) key, INCLUDING the class_form-NULL total;
 *   3. the class_form-NULL total = Σ the stage's class_form rows, per sex.
 * A failure here is a defect in `aggregateSchoolRoster`, not in the data, so it names the key.
 */
export function assertSchoolInvariants(
  result: SchoolEnrolmentResult,
  emisSchoolId: string,
): void {
  const key = (r: FactEnrolmentRow) => `${r.stage}\u0000${r.classForm ?? "\u0001TOTAL"}`;
  const byKey = new Map<string, Map<FactSex, number>>();
  for (const row of result.rows) {
    if (!Number.isInteger(row.headcount) || row.headcount < 0)
      throw new EnrolmentTransformError(
        `${emisSchoolId}: headcount ${String(row.headcount)} on (${row.stage}, ` +
          `${row.classForm ?? "stage total"}, ${row.sex}) is not a non-negative integer.`,
      );
    let sexes = byKey.get(key(row));
    if (!sexes) {
      sexes = new Map<FactSex, number>();
      byKey.set(key(row), sexes);
    }
    if (sexes.has(row.sex))
      throw new EnrolmentTransformError(
        `${emisSchoolId}: duplicate (${row.stage}, ${row.classForm ?? "stage total"}, ${row.sex}) ` +
          "row — a duplicate at this grain silently doubles every roll-up above it.",
      );
    sexes.set(row.sex, row.headcount);
  }

  for (const [k, sexes] of byKey) {
    const male = sexes.get("MALE");
    const female = sexes.get("FEMALE");
    const all = sexes.get("ALL");
    if (male === undefined || female === undefined || all === undefined)
      throw new EnrolmentTransformError(
        `${emisSchoolId}: ${k.replace("\u0000", "/")} is missing one of MALE/FEMALE/ALL — the sex ` +
          "split and its total are written together or not at all.",
      );
    if (all !== male + female)
      throw new EnrolmentTransformError(
        `${emisSchoolId}: ${k.replace("\u0000", "/")} has ALL=${all} but MALE+FEMALE=${male + female}. ` +
          "sex='ALL' is SYNTHESISED as MALE+FEMALE and the equality is strict.",
      );
  }

  // Claim 3 — the stage total really totals its own breakdown, per sex.
  for (const stage of result.stages) {
    for (const sex of FACT_SEXES) {
      const breakdown = result.rows
        .filter((r) => r.stage === stage && r.classForm !== null && r.sex === sex)
        .reduce((t, r) => t + r.headcount, 0);
      const total = result.rows.find(
        (r) => r.stage === stage && r.classForm === null && r.sex === sex,
      );
      if (!total)
        throw new EnrolmentTransformError(
          `${emisSchoolId}: stage ${stage} has breakdown rows but no class_form IS NULL total for ${sex}. ` +
            "The stage total is the only roll-up-safe figure, so its absence is a silent undercount.",
        );
      if (total.headcount !== breakdown)
        throw new EnrolmentTransformError(
          `${emisSchoolId}: stage ${stage} total for ${sex} is ${total.headcount} but its class_form ` +
            `breakdown sums to ${breakdown}.`,
        );
    }
  }
}

// ── the write ───────────────────────────────────────────────────────────────────────────────────

/**
 * One period's computed rows, with the DELETE SCOPE stated explicitly.
 *
 * ⚠ WHY THE SCOPE IS NOT DERIVED FROM `rows` (as `writeInfrastructureFacts` derives it). A school can
 * legitimately compute to ZERO rows — it has a roster, and every class in it is Nursery or unlabelled.
 * If the delete scope were "the jurisdictions that produced rows", that school would keep LAST
 * night's rows for ever: the ETL would be structurally unable to report that a stage emptied out. So
 * the scope is "every school this run SUCCESSFULLY COMPUTED", which includes the computed-to-zero
 * case and still EXCLUDES — deliberately, exactly as the first slice does — a school that dropped out
 * of the inclusion set, a school whose source returned nothing at all, and a school whose compute
 * failed. Those three keep their prior rows: stale-but-honest, never silently emptied.
 */
export interface EnrolmentWriteBatch {
  periodId: string;
  /** SCHOOL-level jurisdiction ids successfully computed this run. THE DELETE BOUND. */
  jurisdictionIds: string[];
  rows: FactEnrolmentRow[];
}

export interface EnrolmentWriteResult {
  deleted: number;
  inserted: number;
  perPeriod: { periodId: string; deleted: number; inserted: number }[];
}

/**
 * DELETE-BY-(PERIOD, JURISDICTION ∈ SCOPE)-THEN-INSERT. The three properties
 * `writeInfrastructureFacts` documents hold here verbatim — bounded delete, ONE transaction for the
 * whole run, delete-then-insert rather than upsert — and are not re-argued; read that header.
 *
 * ⚠ WHAT IS DIFFERENT, AND WHY IT IS THE MOST IMPORTANT TEN LINES IN THIS FILE:
 * `fact_enrolment` IS ONE OF THE PK-ONLY ORIGINAL EIGHT (db/schema/fact.ts) — it has NO grain UNIQUE.
 * A duplicate at the full grain would therefore INSERT HAPPILY and silently DOUBLE every roll-up above
 * it, and the result would be internally consistent at every tier (the doubled total would still equal
 * the doubled split), so no reader and no reviewer could see it. The POST-INSERT DUPLICATE ASSERTION
 * below is the only guard that exists.
 *
 * It must be NULL-SAFE on `class_form`, and that is not a detail: the three stage-total rows
 * (class_form IS NULL, one per sex) are LEGITIMATE and distinct. A naive `group by …, class_form`
 * treats NULLs as equal in GROUP BY (so the three totals group by sex correctly — fine) but the real
 * trap is the opposite one: writing the grain as `coalesce(class_form, '')` would collide a genuine
 * empty-string token with a total. So the key carries `class_form IS NULL` as its own boolean
 * alongside the coalesced text — NULL and '' stay distinguishable, and a genuine duplicate of either
 * is caught.
 */
export async function writeEnrolmentFactsTx(
  tx: postgres.TransactionSql,
  batches: EnrolmentWriteBatch[],
): Promise<EnrolmentWriteResult> {
  const perPeriod: EnrolmentWriteResult["perPeriod"] = [];
  let totalDeleted = 0;
  let totalInserted = 0;

  for (const batch of batches) {
    const { periodId, jurisdictionIds, rows: rowsToWrite } = batch;

    let deleted = 0;
    if (jurisdictionIds.length > 0) {
      const removed = await tx`
        delete from fact_enrolment
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
        stage: r.stage,
        class_form: r.classForm,
        sex: r.sex,
        headcount: r.headcount,
        source: r.source,
        as_of_date: r.asOfDate,
        etl_run_id: r.etlRunId,
      }));
      const result = await tx`insert into fact_enrolment ${tx(chunk)}`;
      inserted += result.count;
    }

    // THE DUPLICATE ASSERTION OVER THE FULL GRAIN — see the header. Inside the transaction, so
    // tripping it rolls the whole run back.
    const dupes = await tx<{ n: number }[]>`
      select count(*)::int as n from (
        select jurisdiction_id, period_id, stage,
               class_form is null as is_stage_total,
               coalesce(class_form, '') as class_form_key,
               sex
          from fact_enrolment
         where period_id = ${periodId}::uuid
         group by jurisdiction_id, period_id, stage, (class_form is null),
                  coalesce(class_form, ''), sex
        having count(*) > 1
      ) d`;
    if ((dupes[0]?.n ?? 0) > 0)
      throw new Error(
        `fact_enrolment has ${dupes[0]!.n} duplicated grain key(s) ` +
          `(jurisdiction_id, period_id, stage, class_form, sex) for period ${periodId}. ` +
          "fact_enrolment has NO grain UNIQUE, so a duplicate inserts happily and silently DOUBLES " +
          "every roll-up above it — and the result stays internally consistent at every tier, which " +
          "is why this assertion exists.",
      );

    perPeriod.push({ periodId, deleted, inserted });
    totalDeleted += deleted;
    totalInserted += inserted;
  }

  return { deleted: totalDeleted, inserted: totalInserted, perPeriod };
}

/** The standalone form — its OWN transaction. The pipeline uses the `…Tx` form instead, so that the
 *  infrastructure and enrolment writes of one run are ONE transaction (see `lib/etl/pipeline.ts`). */
export async function writeEnrolmentFacts(
  sql: postgres.Sql,
  batches: EnrolmentWriteBatch[],
): Promise<EnrolmentWriteResult> {
  return (await sql.begin(async (tx) =>
    writeEnrolmentFactsTx(tx as unknown as postgres.TransactionSql, batches),
  )) as unknown as EnrolmentWriteResult;
}

/**
 * `dim_stage` IS CONFIG, NOT A DIMENSION THIS ETL REFRESHES (OVERSIGHT_ANALYTICS_SPEC §10: seeded by
 * `db/seed/config.ts` at provision time, changed only by a deliberate config edit — a curriculum
 * reform). `fact_enrolment.stage` is a FK to it, so a database that was migrated but never seeded
 * fails the INSERT with a foreign-key violation naming a constraint, hundreds of rows into the run.
 *
 * This asserts it UP FRONT, with the fix in the message. The ETL does NOT insert the rows itself:
 * writing config from the loader is how `dim_stage` would start drifting per environment, and the
 * official ages in it are a GES fact, not something an ETL may invent.
 */
export async function assertStagesSeeded(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ stage: string }[]>`select stage from dim_stage`;
  const have = new Set(rows.map((r) => r.stage));
  const missing = ANALYTICS_STAGES.filter((s) => !have.has(s));
  if (missing.length > 0)
    throw new Error(
      `dim_stage is missing ${missing.join(", ")} — fact_enrolment.stage is a FK to it. ` +
        "dim_stage is CONFIG, seeded by `pnpm db:seed` (db/seed/config.ts) at provision time; this " +
        "ETL deliberately does not write it.",
    );
}
