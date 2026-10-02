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
}
