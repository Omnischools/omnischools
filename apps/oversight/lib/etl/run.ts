import type postgres from "postgres";

/**
 * `etl_run` LIFECYCLE + THE PROVENANCE STAMPER (scope §3, task H2).
 *
 * ONE run = ONE `run_id` stamped onto every row the run writes. The Oversight as-of banner reads the
 * latest SUCCESS run (`lib/oversight/etl-status.ts`), which is the only reason the lifecycle has to be
 * exactly right: a run that forgets to close leaves the banner reading a stale timestamp forever, and
 * a failed run that closes as SUCCESS makes the banner lie about data that was never written.
 *
 * THE THREE STATES ARE NOT SYMMETRIC (`etl_status` = RUNNING | SUCCESS | FAILED — note FAILED, not
 * "FAILURE"):
 *   RUNNING  opened before any work. Its existence is what makes a crashed run visible as a run that
 *            never finished rather than as a night that never happened.
 *   SUCCESS  closed with `finished_at`. Only this state is readable by the banner.
 *   FAILED   closed with `finished_at` AND `error_text`, and — the load-bearing part — THE PRIOR
 *            NIGHT'S DATA IS LEFT IN PLACE. Stale-but-honest beats empty: a regulator's dashboard
 *            that silently blanks because an upstream query timed out is worse than one that says
 *            "as of two days ago". That property is enforced in `lib/etl/infrastructure.ts` (the
 *            delete and the insert are the same transaction, so a failure rolls the delete back),
 *            not here; this module only records it.
 */

export type EtlStatus = "RUNNING" | "SUCCESS" | "FAILED";

/** Opens a RUNNING row and returns its id. Committed immediately — a crash must leave it visible. */
export async function openEtlRun(sql: postgres.Sql): Promise<string> {
  const rows = await sql<{ run_id: string }[]>`
    insert into etl_run (status) values ('RUNNING') returning run_id::text as run_id`;
  return rows[0]!.run_id;
}

/**
 * Close the run. `errorText` is written on FAILED and — deliberately — may ALSO be written on
 * SUCCESS, where it carries the per-school gap report (see `SchoolFailurePolicy` below). A SUCCESS
 * row with non-null `error_text` means "the run completed and here is what it could not compute",
 * which is the honest encoding of SUCCESS-with-gaps; the alternative is to discard the gap list, and
 * then nobody can tell a complete night from a 97%-complete one.
 */
export async function closeEtlRun(
  sql: postgres.Sql,
  runId: string,
  status: Exclude<EtlStatus, "RUNNING">,
  errorText: string | null = null,
): Promise<void> {
  await sql`
    update etl_run
       set status = ${status}::etl_status, finished_at = now(), error_text = ${errorText}
     where run_id = ${runId}::uuid`;
}

/**
 * PROVENANCE — one stamper, applied in one place (scope §3). Every fact row carries `source`,
 * `as_of_date` and `etl_run_id`, and the reason this is a function rather than three literals at each
 * insert site is that `as_of_date` is the easiest column in the schema to get wrong.
 *
 * `as_of_date` IS THE DATA'S VINTAGE, NOT THE RUN'S CLOCK. For `fact_infrastructure` it is the source
 * census row's `captured_at` — when the school actually answered — because the surfaces print it as
 * "as of …" next to the number. Stamping `now()` would make every figure look freshly measured on
 * every nightly re-run, which is exactly the false confidence provenance exists to prevent. It also
 * makes a re-run of an unchanged period byte-identical except for `etl_run_id`, which is what the
 * idempotency test asserts.
 */
export interface Provenance {
  source: "OPERATIONAL_AGG";
  asOfDate: string;
  etlRunId: string;
}

export function stampProvenance(runId: string, asOfDate: string | Date): Provenance {
  return {
    source: "OPERATIONAL_AGG",
    asOfDate: asOfDate instanceof Date ? asOfDate.toISOString() : asOfDate,
    etlRunId: runId,
  };
}

// ── per-school isolation ────────────────────────────────────────────────────────────────────────

/** One school's compute failure. Named, so the gap report says WHICH school and WHY. */
export interface SchoolFailure {
  emisSchoolId: string;
  jurisdictionId: string | null;
  message: string;
}

export interface IsolatedCompute<T> {
  computed: T[];
  failures: SchoolFailure[];
}

/**
 * PER-SCHOOL COMPUTE ISOLATION (scope §3). One school's malformed source row fails THAT SCHOOL, not
 * the run: 400 schools' figures must not be lost because one census row has `classrooms_good >
 * classrooms_total`.
 *
 * The isolation is around the COMPUTE only, and deliberately happens BEFORE any write. A try/catch
 * around a per-school INSERT inside a shared transaction would not isolate anything — the first
 * error aborts the transaction and every subsequent statement fails with "current transaction is
 * aborted". So: compute everything, tally the failures, then write the survivors in one transaction.
 */
export function computePerSchool<S, T>(
  items: S[],
  identify: (item: S) => { emisSchoolId: string; jurisdictionId: string | null },
  compute: (item: S) => T,
): IsolatedCompute<T> {
  const computed: T[] = [];
  const failures: SchoolFailure[] = [];
  for (const item of items) {
    try {
      computed.push(compute(item));
    } catch (err) {
      failures.push({
        ...identify(item),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { computed, failures };
}

/**
 * THE RUN-FAILURE POLICY (scope §7 Q11 — open for Kofi; this is the slice's stated interim rule).
 *
 * `maxFailureRate` of the inclusion set may fail and the run still closes SUCCESS, with the gap list
 * in `error_text`; above it the run closes FAILED and writes nothing. The default is 1%.
 *
 * WHY NOT ZERO TOLERANCE: one bad census row out of 400 schools would blank the entire national
 * dashboard, which inverts the stale-but-honest principle — it converts a one-school data-quality
 * problem into a total outage.
 * WHY NOT INFINITE TOLERANCE: a systematic defect (an upstream column renamed, an allow-list drifted)
 * fails most schools at once, and a run that quietly published 12% of the country as though it were
 * the country is the worst possible dashboard. The threshold is the line between "a school's row is
 * bad" and "our pipeline is bad", and 1% is low enough that the second always trips it.
 *
 * ⚠ A SCHOOL THAT FAILED COMPUTE KEEPS ITS PRIOR FACT ROW. It is excluded from the delete scope, not
 * deleted-and-not-reinserted — same reasoning as a FAILED run: stale-but-honest, never silently gone.
 */
export interface SchoolFailurePolicy {
  maxFailureRate: number;
}

export const DEFAULT_SCHOOL_FAILURE_POLICY: SchoolFailurePolicy = {
  maxFailureRate: 0.01,
};

export function failureVerdict(
  attempted: number,
  failures: SchoolFailure[],
  policy: SchoolFailurePolicy = DEFAULT_SCHOOL_FAILURE_POLICY,
): { status: "SUCCESS" | "FAILED"; errorText: string | null } {
  if (failures.length === 0) return { status: "SUCCESS", errorText: null };
  const rate = attempted === 0 ? 1 : failures.length / attempted;
  const detail = failures
    .slice(0, 20)
    .map((f) => `${f.emisSchoolId}: ${f.message}`)
    .join("; ");
  const more = failures.length > 20 ? ` (+${failures.length - 20} more)` : "";
  const summary = `${failures.length}/${attempted} schools failed compute (${(rate * 100).toFixed(2)}%) — ${detail}${more}`;
  return rate > policy.maxFailureRate
    ? { status: "FAILED", errorText: summary }
    : { status: "SUCCESS", errorText: `SUCCESS WITH GAPS · ${summary}` };
}

/**
 * STEP 6 OF THE RUN SEQUENCE — the anomaly hook. A NO-OP, on purpose and by name.
 *
 * `fact_anomaly` is increment J, not H (scope §1). The hook exists so the run sequence is complete
 * and the insertion point is unambiguous when J arrives; it is deliberately NOT a partial
 * implementation, because a half-built rule engine in H would be the thing J has to delete first.
 */
// The unused parameters are the deliverable: increment J's engine needs the connection and the run id,
// and declaring them now is what stops the call site from changing when it arrives.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function runAnomalyHook(_sql: postgres.Sql, _runId: string): Promise<void> {
  // Intentionally empty — increment J. Do not grow this function; add the engine as its own module.
}
