import { join } from "node:path";

/**
 * Where `global-setup.ts` leaves the two connection strings for `env.ts` to pick up.
 *
 * A file, not `process.env`: vitest's global setup runs in the main process while test modules are
 * imported in workers, and `lib/env.ts` parses `process.env` at import time. Writing the URLs to a
 * known path and having the per-file setup read them synchronously before any test module is
 * imported is the only ordering that reliably works across pool types.
 */
export const TEST_DB_CONFIG_PATH = join(
  process.cwd(),
  "node_modules",
  ".oversight-test-db.json",
);

export interface TestDbConfig {
  analyticsUrl: string;
  operationalUrl: string;
  superuserAnalyticsUrl: string;
  superuserOperationalUrl: string;
  /**
   * The analytics DB as the Omnischools PROVISIONER role (increment G) — a third, non-owner role
   * that holds exactly SELECT on `audit_officer_provisioning` and nothing on the officer directory.
   * Needed so a test can assert the provisioning log IS readable in the provisioner role context and
   * is NOT readable through `analyticsUrl` (the app role), which is the whole posture.
   */
  provisionerAnalyticsUrl: string;
  /**
   * A THIRD, EMPTY analytics database (owner connection) for the increment-H ETL tests.
   *
   * Why a separate database rather than the shared one: the demo seed builds Ghana's whole spine —
   * 16 regions, ~73 districts, ~430 schools — and `tests/rls-tier-matrix.test.ts` asserts GLOBAL
   * counts over `dim_jurisdiction` and `fact_enrolment` ("the district officer sees 1 of 2"). Loading
   * a country into the shared fixture DB would turn those measurements into noise, and scoping them
   * defensively would weaken the very assertions that prove the tier matrix.
   *
   * It is built from the SAME migrations as `analyticsUrl` (so the ETL tests exercise the real
   * `fact_infrastructure` columns, the real grain UNIQUE and the real enums), and deliberately WITHOUT
   * `policies.sql` or the §6 analytics seed: the ETL runs as the privileged owner/writer, which is RLS-
   * exempt, so a policy set here would be inert scaffolding, and the §6 fixtures would collide with
   * the generated register.
   */
  demoAnalyticsUrl: string;
}
