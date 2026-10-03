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
import { readFacilitiesSnapshots } from "./source";
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
 *   5  compute facts, per school, isolated; then ONE delete-then-insert transaction per period
 *   6  anomaly hook — a NO-OP (increment J)
 *   7  close the run (SUCCESS / SUCCESS-with-gaps / FAILED)
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
  policy?: SchoolFailurePolicy;
  nationalName?: string;
}

export interface PeriodOutcome {
  academicYear: string;
  term: number;
  periodId: string;
  sourceRows: number;
  deleted: number;
  inserted: number;
  failures: SchoolFailure[];
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

    // ── step 5 · facts, per period ──────────────────────────────────────────────────────────────
    const outcomes: PeriodOutcome[] = [];
    const allFailures: SchoolFailure[] = [];
    let attempted = 0;

    for (const spec of options.periods) {
      const periodId = periodIndex.get(periodKey(spec.academicYear, spec.term));
      if (!periodId)
        throw new Error(
          `dim_period has no TERM row for ${spec.academicYear} term ${spec.term} after the refresh.`,
        );

      const sourceRows = await readFacilitiesSnapshots(sql, {
        schemaName: options.sourceSchema,
        academicYear: spec.academicYear,
        term: spec.term,
        operationalSchoolIds: inclusion.schools.map((s) => s.operationalSchoolId),
      });
      attempted += sourceRows.length;

      // PER-SCHOOL ISOLATION — compute everything first, tally failures, then write the survivors.
      // A try/catch around a per-school INSERT would not isolate anything (the first error aborts the
      // whole transaction); see `computePerSchool`.
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

      const { deleted, inserted } = await writeInfrastructureFacts(
        sql,
        periodId,
        computed,
      );
      outcomes.push({
        academicYear: spec.academicYear,
        term: spec.term,
        periodId,
        sourceRows: sourceRows.length,
        deleted,
        inserted,
        failures,
      });
    }

    // ── step 6 · anomaly hook (increment J — a no-op, by name) ──────────────────────────────────
    await runAnomalyHook(sql, runId);

    // ── step 7 · close ──────────────────────────────────────────────────────────────────────────
    const verdict = failureVerdict(attempted, allFailures, options.policy);
    await closeEtlRun(sql, runId, verdict.status, verdict.errorText);
    return {
      runId,
      status: verdict.status,
      errorText: verdict.errorText,
      registerRows: registerRows.length,
      coverage: inclusion.coverage,
      periods: outcomes,
    };
  } catch (err) {
    // A FAILED run leaves the prior night's data in place — the delete and the insert share one
    // transaction, so a failure inside step 5 has already rolled the delete back.
    const message = err instanceof Error ? err.message : String(err);
    await closeEtlRun(sql, runId, "FAILED", message);
    throw err;
  }
}
