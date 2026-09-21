import postgres from "postgres";
import { env } from "@/lib/env";

/**
 * The OPERATIONAL read-back client (OVERSIGHT_ANALYTICS_SPEC §6, docs/PROVISIONING.md §4a).
 *
 * This is a SECOND, fully isolated Postgres client — a different database, a different role, a
 * different pool — from `lib/db/index.ts`'s analytics client. It is the only thread from Oversight
 * back to operational data, and it exists solely to serve the gated named-record path.
 *
 * THREE PROPERTIES ARE LOAD-BEARING. None of them is a convenience:
 *
 *  1. FAIL CLOSED WHEN UNSET. If `OPERATIONAL_READBACK_URL` is missing or blank, every entry point
 *     here THROWS `ReadbackUnavailableError`. There is deliberately NO fallback to
 *     `ANALYTICS_DATABASE_URL` — a fallback would silently point the individual-record surface at
 *     the aggregates database, where it would either find nothing (and look like a data bug) or,
 *     worse, find something. A missing capability must present as a closed door, not a quieter one.
 *     This file must never mention the analytics URL; a test asserts that textually.
 *
 *  2. ISOLATION FROM AGGREGATE CODE. No aggregate surface may import this module. That is enforced
 *     twice: an ESLint `no-restricted-imports` rule scoped to the aggregate directories, and
 *     `tests/readback-isolation.test.ts`, which walks the source tree and fails if any module
 *     outside the gated allow-list imports it. The lint rule catches it in the editor; the test
 *     catches it when someone disables the lint rule.
 *
 *  3. TIMEOUTS ON THE CONNECTION, NOT IN THE QUERY. `statement_timeout` and
 *     `idle_in_transaction_session_timeout` are set as startup parameters, so they apply to every
 *     statement this client will ever issue including ones added later by someone who did not read
 *     this comment. This connection exists to fetch ONE record: a query that runs long is a scan,
 *     not a lookup, and should die rather than quietly export a roster. The idle-in-transaction
 *     limit stops a wedged read-back holding locks on the database that serves live schools.
 *     `default_transaction_read_only` makes "Oversight never writes operational data" structural
 *     rather than merely ungranted — belt to the role's braces.
 */

/** A few seconds: enough for an indexed single-record lookup, not enough for a table scan. */
export const READBACK_STATEMENT_TIMEOUT_MS = 5_000;
/** A wedged read-back must not hold operational locks while live schools are using the DB. */
export const READBACK_IDLE_IN_TX_TIMEOUT_MS = 10_000;

/**
 * Thrown whenever the read-back is asked for and cannot be given. Callers translate this into the
 * user-facing "individual drill-down unavailable" state and — inside the gate — into a LOGGED
 * denial. It is never swallowed and never downgraded to an empty result.
 */
export class ReadbackUnavailableError extends Error {
  readonly code = "READBACK_UNAVAILABLE";
  constructor(
    message = "OPERATIONAL_READBACK_URL is not configured — individual drill-down is unavailable (fail closed). Oversight must NOT fall back to the analytics database for named records.",
  ) {
    super(message);
    this.name = "ReadbackUnavailableError";
  }
}

/**
 * The configured URL, or null. Read through `env` (not `process.env`) so it goes through the same
 * validated surface as everything else; blank is treated as unset, because an env var that exists
 * but is empty is exactly what a half-configured deployment looks like.
 */
function resolveReadbackUrl(): string | null {
  const raw = env.OPERATIONAL_READBACK_URL?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** Cheap, side-effect-free probe so a surface can render the unavailable state without throwing. */
export function isReadbackConfigured(): boolean {
  return resolveReadbackUrl() !== null;
}

let cached: { url: string; sql: postgres.Sql } | null = null;

/**
 * The lazily-created pool. Lazy so `next build` (which imports every route module) never opens a
 * connection to operational Postgres, and so an unset URL is an error at USE time rather than an
 * import-time crash that would take the aggregate surfaces down with it.
 */
export function getReadbackClient(): postgres.Sql {
  const url = resolveReadbackUrl();
  if (!url) throw new ReadbackUnavailableError();
  if (cached && cached.url === url) return cached.sql;

  const sql = postgres(url, {
    // Small: this pool serves one-record lookups from a gate a human walks through, not traffic.
    max: 2,
    prepare: false,
    connection: {
      statement_timeout: READBACK_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: READBACK_IDLE_IN_TX_TIMEOUT_MS,
      default_transaction_read_only: true,
      application_name: "oversight-readback",
    },
  });
  cached = { url, sql };
  return sql;
}

/** postgres.js transaction handle — the only thing gated code is handed. */
export type ReadbackTx = postgres.TransactionSql<Record<string, never>>;

/**
 * Run a unit of work against operational Postgres, scoped to ONE school.
 *
 * `app.current_school` is the GUC the operational tenant RLS keys on, set `local` (transaction
 * scoped) from trusted server code — never from request input that has not been through the gate's
 * jurisdiction check. The read-back therefore reads one school at a time, so the operational tenant
 * boundary holds even against a bug in Oversight's own scoping.
 *
 * EVERYTHING THE GATE DOES OPERATIONALLY HAPPENS IN ONE OF THESE. In particular the consent read
 * and the record projection share a single transaction, so consent cannot be revoked between
 * "we checked" and "we selected" — there is no window, and no cache.
 */
export async function withReadbackSchool<T>(
  schoolId: string,
  fn: (tx: ReadbackTx) => Promise<T>,
): Promise<T> {
  const sql = getReadbackClient();
  return sql.begin(async (tx) => {
    await tx`select set_config('app.current_school', ${schoolId}, true)`;
    return fn(tx as unknown as ReadbackTx);
  }) as unknown as Promise<T>;
}

/** Test/shutdown hook. Drops the pool so the next call re-reads the (possibly changed) URL. */
export async function closeReadback(): Promise<void> {
  const current = cached;
  cached = null;
  if (current) await current.sql.end({ timeout: 5 });
}
