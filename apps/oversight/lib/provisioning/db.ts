/*
 * NO `import "server-only"` HERE, deliberately.
 *
 * That marker package is resolvable only inside the Next bundler graph; this module is also imported
 * by the vitest suite (and, for the provisioning modules, by a tsx CLI script), where the import
 * fails outright. The server-side boundary is therefore enforced the way this codebase already
 * enforces the read-back boundary — by an import-graph test with an explicit allow-list
 * (tests/auth-boundaries.test.ts, tests/provisioning-admin-gate.test.ts) plus the ESLint
 * no-restricted-imports rules — which catches a client component importing this at review time
 * rather than at bundle time, and which a test cannot silently lose.
 */
import postgres from "postgres";
import { env } from "@/lib/env";

/**
 * THE PROVISIONER CONNECTION — the only credential in this app that can write authority.
 *
 * A THIRD Postgres client, fully isolated from `lib/db/index.ts` (the app's read-scoped analytics
 * pool) and from `lib/db/readback.ts` (the §6 operational read-back). Same reasoning as that file's
 * header, applied to the write side: the credential the web app serves pages with must not be able
 * to grant someone oversight of a region, and "must not" has to mean a different role rather than a
 * different code path. docs/PROVISIONING.md §4b provisions it; the harness creates it as
 * `ov_provisioner` so the suite tests the real posture rather than a convenient superuser.
 *
 * FOUR PROPERTIES, none of them a convenience:
 *
 *  1. FAIL CLOSED WHEN UNSET. No `PROVISIONER_DATABASE_URL` ⇒ every entry point throws. There is
 *     deliberately NO fallback to `ANALYTICS_DATABASE_URL`: that role has no write grant on either
 *     table, so the fallback would produce `permission denied` from the middle of a provisioning
 *     flow — a failure that reads like a database fault and invites someone to "fix" it by pointing
 *     the variable at the owner connection. An unconfigured capability must be a closed door.
 *  2. NOT THE OWNER. The role is a non-owner with exactly SELECT+INSERT on the provisioning log and
 *     SELECT+INSERT+UPDATE on the directory (never DELETE — offboarding is `is_active = false`).
 *     It therefore needs the role-targeted write POLICIES paste 0005 installs as well as its grants:
 *     RLS gates writes too, and a non-owner INSERT into an RLS-enabled table with no applicable
 *     policy fails. If provisioning writes start failing that way, the paste was not applied — do
 *     not reach for the owner credential instead.
 *  3. TINY POOL, SHORT STATEMENTS. This connection serves an administrator filling in a form, not
 *     traffic. `statement_timeout` as a CONNECTION parameter so it applies to every statement this
 *     client will ever issue, including ones added later by someone who did not read this comment.
 *  4. NOT IMPORTABLE FROM THE AGGREGATE OR OFFICER SURFACES. Nothing under `app/(oversight)` may
 *     touch it; `tests/provisioning-admin-gate.test.ts` walks the import graph (direct allow-list
 *     plus transitive reachability), exactly as tests/readback-isolation.test.ts does for the
 *     read-back.
 */

export const PROVISIONER_STATEMENT_TIMEOUT_MS = 10_000;

export class ProvisionerUnavailableError extends Error {
  readonly code = "PROVISIONER_UNAVAILABLE";
  constructor() {
    super(
      "PROVISIONER_DATABASE_URL is not configured — officer provisioning is unavailable (fail closed). It must point at the dedicated non-owner provisioner role (docs/PROVISIONING.md §4b); it must NEVER be the app's analytics role or the database owner.",
    );
    this.name = "ProvisionerUnavailableError";
  }
}

function resolveUrl(): string | null {
  const raw = env.PROVISIONER_DATABASE_URL?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** Cheap, side-effect-free probe so a surface can render the unavailable state without throwing. */
export function isProvisionerConfigured(): boolean {
  return resolveUrl() !== null;
}

let cached: { url: string; sql: postgres.Sql } | null = null;

/** Lazily created, so `next build` opens no connection and an unset URL errors at USE time. */
export function getProvisionerClient(): postgres.Sql {
  const url = resolveUrl();
  if (!url) throw new ProvisionerUnavailableError();
  if (cached && cached.url === url) return cached.sql;

  const sql = postgres(url, {
    max: 2,
    prepare: false,
    connection: {
      statement_timeout: PROVISIONER_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: 15_000,
      application_name: "oversight-provisioner",
    },
  });
  cached = { url, sql };
  return sql;
}

/** Test/shutdown hook. Drops the pool so the next call re-reads the (possibly changed) URL. */
export async function closeProvisioner(): Promise<void> {
  const current = cached;
  cached = null;
  if (current) await current.sql.end({ timeout: 5 });
}
