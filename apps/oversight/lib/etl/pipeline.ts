import type postgres from "postgres";
import {
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
import {
  MAPPED_PRODUCT_LINE,
  readFacilitiesSnapshots,
  type SkippedProductLine,
} from "./source";
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
 *   2  refresh dimensions — `dim_jurisdiction` spine + `dim_period`, then ASSERT the spine
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
 */

export interface InfrastructureEtlOptions {
  /** The EMIS extract file's contents. Parsed, never trusted. */
  emisExtractText: string;
  /** The terms to compute. `dim_period` rows are upserted for all of them. */
  periods: PeriodSpec[];
  /** `"demo_source"` for the demo; `"public"` on an `oversight_etl` operational connection. */
  sourceSchema: string;
  /**
   * The ONE operational `product_line` whose `period_number` this run maps onto `dim_period`. Defaults
   * to BASIC; see the Q3 note in `lib/etl/dimensions.ts`. Overridable so that whoever lands the SENIOR
   * ruling can run the other line without touching the pipeline.
   */
  productLine?: string;
  policy?: SchoolFailurePolicy;
  nationalName?: string;
}

export interface PeriodOutcome {
  academicYear: string;
  term: number;
  periodId: string;
  /** Census rows read on the MAPPED product line (i.e. candidates for a fact row). */
  sourceRows: number;
  deleted: number;
  inserted: number;
  failures: SchoolFailure[];
  /**
   * Census rows present in the source but on a product line this run cannot map (a SENIOR semester is
   * not a term). A NAMED, COUNTED gap — see the product_line note in `lib/etl/source.ts`.
   */
  skippedProductLines: SkippedProductLine[];
  /**
   * Included schools that filed NO census row at all for this period — on any product line. They are
   * not a failure (a school that has not filed yet is a normal state) but they ARE the difference
   * between the inclusion set and `schools_reporting`, so they are listed rather than left to be
   * inferred from a subtraction. Increment I's coverage card reads this.
   *
   * DISJOINT from `skippedProductLines` by construction, so that
   *   inserted + skippedProductLines + noSourceRow + failures = coverage.included
   * holds exactly. EMIS ids, not tenant uuids — this is reportable, and the tenant uuid is not.
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
    const periodIndex = await refreshPeriods(sql, options.periods);

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
      skippedProductLines: SkippedProductLine[];
      noSourceRow: string[];
    }
    const pending: PendingPeriod[] = [];
    const allFailures: SchoolFailure[] = [];
    let attempted = 0;

    for (const spec of options.periods) {
      const periodId = periodIndex.get(periodKey(spec.academicYear, spec.term));
      if (!periodId)
        throw new Error(
          `dim_period has no TERM row for ${spec.academicYear} term ${spec.term} after the refresh.`,
        );

      // `period_number` is the OPERATIONAL key; for the mapped BASIC line it equals the analytics
      // term by the interim Q3 rule (see `lib/etl/dimensions.ts`). Rows on any other line come back
      // as a named gap rather than being filtered away in SQL.
      const { rows: sourceRows, skippedProductLines } = await readFacilitiesSnapshots(
        sql,
        {
          schemaName: options.sourceSchema,
          academicYear: spec.academicYear,
          periodNumber: spec.term,
          productLine: options.productLine ?? MAPPED_PRODUCT_LINE,
          operationalSchoolIds: inclusion.schools.map((s) => s.operationalSchoolId),
        },
      );
      attempted += sourceRows.length;

      // "No census row AT ALL" — a school seen on a SKIPPED product line HAS filed a census, it is
      // just on a line this run cannot map, and it is already counted in `skippedProductLines`. Keeping
      // the two sets disjoint is what makes the accounting identity exact:
      //   inserted + skipped + noSourceRow + failures = the inclusion set
      // which is the property `tests/etl-infrastructure.test.ts` asserts, and the only way to know no
      // school vanished quietly between the inclusion set and the facts.
      const sawAnyCensus = new Set<string>([
        ...sourceRows.map((r) => r.schoolId),
        ...skippedProductLines.flatMap((s) => s.operationalSchoolIds),
      ]);
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
        skippedProductLines,
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
      term: p.spec.term,
      periodId: p.periodId,
      sourceRows: p.sourceRows,
      deleted: writtenByPeriod.get(p.periodId)?.deleted ?? 0,
      inserted: writtenByPeriod.get(p.periodId)?.inserted ?? 0,
      failures: p.failures,
      skippedProductLines: p.skippedProductLines,
      noSourceRow: p.noSourceRow,
    }));

    // ── step 6 · anomaly hook (increment J — a no-op, by name) ──────────────────────────────────
    await runAnomalyHook(sql, runId);

    // ── step 7 · close ──────────────────────────────────────────────────────────────────────────
    // The unmapped product lines are appended to `error_text` even on a clean SUCCESS: a run that
    // could not map the whole SHS estate is not a failure, but it is not a silent success either.
    const skippedNote = summariseSkippedProductLines(outcomes);
    const errorText =
      verdict.errorText && skippedNote
        ? `${verdict.errorText} · ${skippedNote}`
        : (verdict.errorText ?? skippedNote);
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

/** One line naming the product lines this run could not map, and how many schools that cost. */
function summariseSkippedProductLines(outcomes: PeriodOutcome[]): string | null {
  const byLine = new Map<string, Set<string>>();
  for (const outcome of outcomes) {
    for (const skipped of outcome.skippedProductLines) {
      const bucket = byLine.get(skipped.productLine) ?? new Set<string>();
      for (const id of skipped.operationalSchoolIds) bucket.add(id);
      byLine.set(skipped.productLine, bucket);
    }
  }
  if (byLine.size === 0) return null;
  const parts = [...byLine.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([line, ids]) => `${line}=${ids.size} school(s)`);
  return (
    `UNMAPPED PRODUCT LINES (Q3 open — a SENIOR semester is not a TERM): ${parts.join(", ")}. ` +
    "Their census rows were read and deliberately not mapped; they are absent from fact_infrastructure."
  );
}
