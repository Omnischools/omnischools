/**
 * Postgres error classification — PURE (no driver import), so it is unit-testable and client-safe.
 * Re-exported from `lib/db/rls.ts`, which is where callers import it from.
 *
 * WHY THIS EXISTS. Drizzle wraps every driver failure in a `DrizzleQueryError` whose own `.message` is
 * only `"Failed query: <sql>\nparams: …"` and whose `.code` is `undefined`; the real `PostgresError`
 * — carrying `code` ("23505") and `constraint_name` — hangs off `.cause`. So BOTH of the obvious
 * checks silently never fire against the thrown error:
 *
 *     (err as {code?}).code === "23505"          // ← undefined on the wrapper
 *     String(err.message).includes("duplicate key") // ← wrapper message has no such text
 *
 * Every unique-violation check in this repo was written one of those two ways and was therefore dead:
 * a bunk-race returned a throw instead of "just taken", and an exeat ref-code retry loop could never
 * retry. Always classify through `pgError`/`isUniqueViolation`.
 *
 * Deliberately structural (duck-typed on `.code`/`.constraint_name`/`.cause`) rather than
 * `instanceof DrizzleQueryError`: no Drizzle import, no private API, and it degrades gracefully in
 * BOTH directions — if Drizzle stops wrapping, the fields are found at depth 0; if it adds a layer,
 * the walk absorbs it.
 *
 * ponytail: `constraint_name` is postgres.js's field name (node-postgres uses `.constraint`). `code`
 * is universal, so a driver swap degrades constraint-SPECIFIC messages to the generic branch rather
 * than crashing. Add the alias if a driver swap ever happens.
 */

/** How many `.cause` hops to follow. Real wrap depth is 1; 5 is headroom without unbounded walking. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Unwrap a thrown query error to the underlying Postgres fields, however deeply it was wrapped.
 * Returns empty fields for anything that isn't a Postgres error (never throws, terminates on cycles).
 */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  let cur: unknown = err;
  for (let i = 0; i < MAX_CAUSE_DEPTH && cur != null && typeof cur === "object"; i++) {
    const e = cur as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof e.code === "string") {
      return {
        code: e.code,
        constraint: typeof e.constraint_name === "string" ? e.constraint_name : undefined,
      };
    }
    cur = e.cause;
  }
  return {};
}

/** True when the error is a Postgres unique violation (SQLSTATE 23505), however deeply it was wrapped. */
export function isUniqueViolation(err: unknown): boolean {
  return pgError(err).code === "23505";
}
