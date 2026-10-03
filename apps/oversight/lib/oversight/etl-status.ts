import { sql } from "drizzle-orm";
import { withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";

/**
 * THE AS-OF BANNER'S DATA (scope task H20).
 *
 * `etl_run` carries no jurisdiction and no school data, so `db/sql/policies.sql` leaves it readable to
 * every tier (it is on the "no jurisdiction column" list there). The read still goes through
 * `withJurisdiction()` because that is the app's single sanctioned read path — "never run raw SQL on
 * the app connection outside withJurisdiction()" (lib/db/rls.ts) — not because a predicate applies.
 *
 * ONLY `SUCCESS` COUNTS. A RUNNING row is a run in flight and its data is incomplete; a FAILED row
 * wrote nothing, and the data on screen is the PREVIOUS successful run's. So the banner must read the
 * latest SUCCESS, which is exactly the vintage of the numbers beside it. Reading the latest run of ANY
 * status would date tonight's figures to tonight on the very night the pipeline broke — the one night
 * it matters.
 *
 * NULL IS A REAL ANSWER, NOT AN ERROR. An analytics DB with no successful run yet (the state the demo
 * starts from) must say so. The caller renders an honest "No successful run yet" rather than a dash
 * that could equally mean zero, loading, or broken.
 */

export interface EtlRunStatus {
  runId: string;
  /** When the SUCCESS run closed — the vintage the banner prints. */
  finishedAt: Date;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Record<string, unknown>[];
}

/** The latest SUCCESS run, or null when there has never been one. */
export async function getLatestSuccessfulEtlRun(
  scope: JurisdictionScope,
): Promise<EtlRunStatus | null> {
  return withJurisdiction(scope, async (tx) => {
    const result = await tx.execute(sql`
      select run_id::text as run_id, finished_at
        from etl_run
       where status = 'SUCCESS' and finished_at is not null
       order by finished_at desc
       limit 1
    `);
    const row = rowsOf(result)[0];
    if (!row) return null;
    return {
      runId: row.run_id as string,
      finishedAt: new Date(row.finished_at as string),
    };
  });
}

/**
 * The banner's string. Formatted in Accra time with an explicit GMT marker, because the ETL runs at
 * 02:00 GMT and a bare local time on a government tool invites "as of when, where?".
 */
export function formatAsOf(status: EtlRunStatus | null): string {
  if (!status) return "No successful run yet";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Accra",
    hour12: false,
  }).format(status.finishedAt);
}
