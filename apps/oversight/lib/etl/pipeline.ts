import type postgres from "postgres";
import {
  annualPeriodSpecs,
  assertSpineIntact,
  periodKey,
  refreshJurisdictions,
  refreshPeriods,
  type JurisdictionIndex,
  type PeriodSpec,
} from "./dimensions";
import { buildInclusionSet, type CoverageFigures } from "./inclusion";
import {
  decomposeFacilitiesSnapshot,
  writeInfrastructureFacts,
  type FactInfrastructureRow,
} from "./infrastructure";
import { loadEmisRegister, parseEmisExtract, type RegisterRow } from "./register";
import { readLatestFacilitiesSnapshots } from "./source";
import {
  closeEtlRun,
  computePerSchool,
  failureVerdict,
  openEtlRun,
  runAnomalyHook,
  type SchoolFailure,
  type SchoolFailurePolicy,
} from "./run";

/**
 * THE RUN SEQUENCE (spec §7 / scope §3), end-to-end for the `fact_infrastructure` slice.
 *
 *   1  open the `etl_run` row (RUNNING)
 *   2  refresh dimensions — `dim_jurisdiction` spine + `dim_period` (TERM rows AND the ANNUAL cut of
 *      each academic year, which is the grain this fact is written at), then ASSERT the spine
 *   3  load the EMIS register (reference delta) — the coverage denominator
 *   4  build the inclusion set — registered ∧ live ∧ mapped
 *   5a COMPUTE every period's facts, per school, isolated — no writes at all
 *   5b TAKE THE VERDICT over the whole run's failures
 *   5c WRITE, once, in ONE transaction across every period — only if the verdict is SUCCESS
 *   6  anomaly hook — a NO-OP (increment J)
 *   7  close the run (SUCCESS / SUCCESS-with-gaps / FAILED)
 *
 * ⚠ WHY 5 IS THREE PHASES AND NOT A LOOP THAT WRITES AS IT GOES. "A FAILED run wrote nothing" is the
 * claim the as-of banner rests on (`lib/oversight/etl-status.ts`): the banner shows the latest SUCCESS
 * run because a FAILED one is assumed not to have touched the data. A loop that wrote each period
 * before the verdict existed would falsify that twice over — a run that breached the failure-rate
 * policy would already have published the surviving schools, and a throw while writing period 2 would
 * leave period 1 committed under a FAILED banner. The verdict also NEEDS all periods first, since the
 * failure RATE is over the whole run's attempted schools. This slice sets the pattern H8–H16 copy, so
 * the ordering is part of the deliverable.
 *
 * Steps 2 and 3 are in that order even though the register is step 2's own input: the extract is
 * PARSED once up front, the spine is built from the parsed region/district names, and the register
 * rows are then written with the resolved jurisdiction uuids (see `lib/etl/register.ts`).
 *
 * ANY step throwing closes the run FAILED with `error_text` and leaves the prior data in place. The
 * only per-school-tolerant step is 5, and its tolerance is the stated `SchoolFailurePolicy`.
 *
 * ⚠ THE GRAIN IS ANNUAL (Kofi's Q3 ruling — the mapping rule and its reasoning are in
 * `lib/etl/dimensions.ts`). `options.periods` still DECLARES the run in terms, because the terms are
 * what the calendar is made of and the TERM rows of `dim_period` are still upserted for the other
 * fact tables; but step 5 loops over the ANNUAL cut of those terms — one period per academic_year —
 * and each school contributes ONE row, decomposed from its latest census in that year on any product
 * line. A BASIC school that filed three term censuses therefore produces one row, not three.
 */

export interface InfrastructureEtlOptions {
  /** The EMIS extract file's contents. Parsed, never trusted. */
  emisExtractText: string;
  /**
   * The terms in the run. `dim_period` TERM rows are upserted for all of them, AND one ANNUAL row per
   * distinct `academicYear` — which is the period `fact_infrastructure` rows are actually written
   * against. A spec with `term: null` is itself an ANNUAL declaration and collapses into that year's
   * single ANNUAL row, so passing the terms or passing the year is the same run.
   */
  periods: PeriodSpec[];
  /** `"demo_source"` for the demo; `"public"` on an `oversight_etl` operational connection. */
  sourceSchema: string;
  policy?: SchoolFailurePolicy;
  nationalName?: string;
}

export interface PeriodOutcome {
  academicYear: string;
  /** ALWAYS null: the grain is the academic YEAR, and `term = null` is what makes a period ANNUAL. */
  term: null;
  /** ALWAYS "ANNUAL". Stated on the outcome so a reader never has to re-derive it from `term`. */
  periodType: "ANNUAL";
  periodId: string;
  /** Census rows selected as authoritative — at most one per school, so also the candidate count. */
  sourceRows: number;
  deleted: number;
  inserted: number;
  failures: SchoolFailure[];
  /**
   * Included schools that filed NO census row ANYWHERE in the academic year — on any product line,
   * for any period number. They are not a failure (a school that has not filed yet is a normal state)
   * but they ARE the difference between the inclusion set and `schools_reporting`, so they are listed
   * rather than left to be inferred from a subtraction. Increment I's coverage card reads this.
   *
   * THE ACCOUNTING IDENTITY, revised by the re-grain (the skipped-product-line term is gone):
   *   inserted + noSourceRow + failures = coverage.included
   * which is the property `tests/etl-infrastructure.test.ts` asserts, and the only way to know no
   * school vanished quietly between the inclusion set and the facts. EMIS ids, not tenant uuids —
   * this is reportable, and the tenant uuid is not.
   */
  noSourceRow: string[];
}

export interface EtlRunReport {
  runId: string;
  status: "SUCCESS" | "FAILED";
  errorText: string | null;
  registerRows: number;
  coverage: CoverageFigures;
  periods: PeriodOutcome[];
}

export async function runInfrastructureEtl(
  sql: postgres.Sql,
  options: InfrastructureEtlOptions,
): Promise<EtlRunReport> {
  // Parsing happens BEFORE the run is opened: a malformed extract is not a failed run, it is a
  // rejected input, and opening a RUNNING row for it would put noise in the banner's history.
  const registerRows: RegisterRow[] = parseEmisExtract(options.emisExtractText);

  const runId = await openEtlRun(sql); // step 1
  try {
    // ── step 2 · dimensions ─────────────────────────────────────────────────────────────────────
    const index: JurisdictionIndex = await refreshJurisdictions(
      sql,
      registerRows,
      options.nationalName,
    );
    await assertSpineIntact(sql, index);
    // The TERM rows AND the ANNUAL cut, in ONE upsert call: the ANNUAL rows are DERIVED from the
    // declared terms (`annualPeriodSpecs`), so "exactly one ANNUAL row per academic_year in the run"
    // cannot be violated by a caller passing two.
    const annualSpecs = annualPeriodSpecs(options.periods);
    const periodIndex = await refreshPeriods(sql, [...options.periods, ...annualSpecs]);

    // ── step 3 · reference delta: the EMIS register ──────────────────────────────────────────────
    await loadEmisRegister(sql, registerRows, (row) => {
      const regionId = index.regions.get(row.regionName);
      const districtId = index.districts.get(
        `${row.regionName}\u0000${row.districtName}`,
      );
      if (!regionId || !districtId)
        throw new Error(
          `${row.emisSchoolId}: region/district did not resolve to a dim_jurisdiction node ` +
            `(${row.regionName} / ${row.districtName}). The dimension refresh is the bug, not the extract.`,
        );
      return { districtId, regionId };
    });

    // ── step 4 · inclusion set + coverage ───────────────────────────────────────────────────────
    const inclusion = await buildInclusionSet(sql, index);
    const jurisdictionOf = new Map(
      inclusion.schools.map((s) => [s.operationalSchoolId, s]),
    );

    // ── step 5a · COMPUTE every period. NOTHING IS WRITTEN IN THIS LOOP. ────────────────────────
    interface PendingPeriod {
      spec: PeriodSpec;
      periodId: string;
      sourceRows: number;
      computed: FactInfrastructureRow[];
      failures: SchoolFailure[];
      noSourceRow: string[];
    }
    const pending: PendingPeriod[] = [];
    const allFailures: SchoolFailure[] = [];
    let attempted = 0;

    // ONE ITERATION PER ACADEMIC YEAR, not per term — the ANNUAL grain.
    for (const spec of annualSpecs) {
      const periodId = periodIndex.get(periodKey(spec.academicYear, null));
      if (!periodId)
        throw new Error(
          `dim_period has no ANNUAL row for ${spec.academicYear} after the refresh.`,
        );

      // Each school's AUTHORITATIVE census for the year: the latest it filed, on ANY product line.
      // At most one row per school comes back, so the ANNUAL grain is the query's property.
      const { rows: sourceRows } = await readLatestFacilitiesSnapshots(sql, {
        schemaName: options.sourceSchema,
        academicYear: spec.academicYear,
        operationalSchoolIds: inclusion.schools.map((s) => s.operationalSchoolId),
      });
      attempted += sourceRows.length;

      // "No census row ANYWHERE IN THE YEAR" — the only remaining non-failure gap. There is no
      // skipped-product-line bucket to be disjoint from any more: a school either filed something in
      // the year (and its latest is above) or it filed nothing at all. That is what makes the revised
      // accounting identity exact:
      //   inserted + noSourceRow + failures = the inclusion set
      // which is the property `tests/etl-infrastructure.test.ts` asserts, and the only way to know no
      // school vanished quietly between the inclusion set and the facts.
      const sawAnyCensus = new Set<string>(sourceRows.map((r) => r.schoolId));
      const noSourceRow = inclusion.schools
        .filter((s) => !sawAnyCensus.has(s.operationalSchoolId))
        .map((s) => s.emisSchoolId);

      // PER-SCHOOL ISOLATION — compute everything first, tally failures, then (in 5c) write the
      // survivors. A try/catch around a per-school INSERT would not isolate anything (the first error
      // aborts the whole transaction); see `computePerSchool`.
      const { computed, failures } = computePerSchool<
        (typeof sourceRows)[number],
        FactInfrastructureRow
      >(
        sourceRows,
        (row) => ({
          emisSchoolId: jurisdictionOf.get(row.schoolId)?.emisSchoolId ?? row.schoolId,
          jurisdictionId: jurisdictionOf.get(row.schoolId)?.jurisdictionId ?? null,
        }),
        (row) => {
          const school = jurisdictionOf.get(row.schoolId);
          if (!school)
            throw new Error(
              `operational school ${row.schoolId} is not in the inclusion set — the source read is ` +
                "not bounded by the inclusion set.",
            );
          return decomposeFacilitiesSnapshot(row, {
            jurisdictionId: school.jurisdictionId,
            periodId,
            emisSchoolId: school.emisSchoolId,
            etlRunId: runId,
          });
        },
      );
      allFailures.push(...failures);
      pending.push({
        spec,
        periodId,
        sourceRows: sourceRows.length,
        computed,
        failures,
        noSourceRow,
      });
    }

    // ── step 5b · THE VERDICT, over the WHOLE run ───────────────────────────────────────────────
    // Before any write, and over every period's failures together, because the policy is a RATE over
    // the run's attempted schools.
    const verdict = failureVerdict(attempted, allFailures, options.policy);

    // ── step 5c · WRITE — once, one transaction, every period; only on SUCCESS ───────────────────
    // A FAILED verdict writes NOTHING. The prior night's data stays exactly as it was: stale, labelled
    // with its own older as-of, and honest. That is what makes the banner's "latest SUCCESS" read
    // correct rather than merely plausible.
    const written =
      verdict.status === "SUCCESS"
        ? await writeInfrastructureFacts(
            sql,
            pending.map((p) => ({ periodId: p.periodId, rows: p.computed })),
          )
        : { deleted: 0, inserted: 0, perPeriod: [] };
    const writtenByPeriod = new Map(written.perPeriod.map((p) => [p.periodId, p]));

    const outcomes: PeriodOutcome[] = pending.map((p) => ({
      academicYear: p.spec.academicYear,
      term: null,
      periodType: "ANNUAL",
      periodId: p.periodId,
      sourceRows: p.sourceRows,
      deleted: writtenByPeriod.get(p.periodId)?.deleted ?? 0,
      inserted: writtenByPeriod.get(p.periodId)?.inserted ?? 0,
      failures: p.failures,
      noSourceRow: p.noSourceRow,
    }));

    // ── step 6 · anomaly hook (increment J — a no-op, by name) ──────────────────────────────────
    await runAnomalyHook(sql, runId);

    // ── step 7 · close ──────────────────────────────────────────────────────────────────────────
    // `error_text` is now the VERDICT's text and nothing else. The unmapped-product-line note that
    // used to be appended here — "the SHS estate is absent and here is why" — has no referent at the
    // ANNUAL grain: every product line is consumed, so a clean run has nothing to confess and
    // `error_text` is null. A SENIOR estate going missing would now be a FAILURE, not a footnote.
    const errorText = verdict.errorText;
    await closeEtlRun(sql, runId, verdict.status, errorText);
    return {
      runId,
      status: verdict.status,
      errorText,
      registerRows: registerRows.length,
      coverage: inclusion.coverage,
      periods: outcomes,
    };
  } catch (err) {
    // A FAILED run leaves the prior night's data in place. Two mechanisms, both needed: the whole
    // run's delete-then-insert is ONE transaction (so a throw during the write rolls the deletes back
    // too), and the write does not happen at all unless the verdict is SUCCESS (step 5c).
    const message = err instanceof Error ? err.message : String(err);
    await closeEtlRun(sql, runId, "FAILED", message);
    throw err;
  }
}
