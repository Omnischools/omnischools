/**
 * THE KPI READ RESULT — a two-state value, so a dashboard card can never print a fabricated number.
 *
 * Every National Overview read returns one of these instead of `T | null`, and the reason is the
 * honesty rule the landing page already follows (see lib/oversight/etl-status.ts): a figure that
 * could not be computed must say so in words. `null` invites `?? 0` at the call site, and a `0` on a
 * regulator's dashboard is indistinguishable from a measured zero — the one failure mode that is
 * worse than a blank, because it is actionable and false.
 *
 * `unavailable` deliberately covers BOTH "the read threw" and "the read returned nothing to state a
 * figure from" (no current period, zero candidates to divide by). From the officer's point of view
 * those are the same fact — we cannot state this number — and splitting them in the UI would mean
 * printing a diagnosis nobody on this surface can act on. The ETL-vintage distinction ("no
 * successful run yet") IS surfaced, and it comes from `getLatestSuccessfulEtlRun`, not from here.
 *
 * Pure: no imports, no DB. Every lib in the dashboard path returns it; no call site constructs the
 * failure case, because the fallback belongs in the lib (etl-status.ts's precedent).
 */
export type Reading<T> =
  { readonly status: "ok"; readonly value: T } | { readonly status: "unavailable" };

export function ok<T>(value: T): Reading<T> {
  return { status: "ok", value };
}

/** The single failure value. Frozen so a caller cannot mutate the shared instance into an `ok`. */
export const UNAVAILABLE: Reading<never> = Object.freeze({
  status: "unavailable" as const,
});

export function unavailable<T>(): Reading<T> {
  return UNAVAILABLE;
}

/** Narrowing helper, so pages read `isOk(r) ? r.value : …` rather than comparing string literals. */
export function isOk<T>(reading: Reading<T>): reading is { status: "ok"; value: T } {
  return reading.status === "ok";
}

/** Rows out of a drizzle `tx.execute`, which returns an array or a `{ rows }` envelope by driver. */
export function rowsOf(result: unknown): Record<string, unknown>[] {
  return (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Record<string, unknown>[];
}
