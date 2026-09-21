import { readFileSync } from "node:fs";
import { TEST_DB_CONFIG_PATH, type TestDbConfig } from "./paths";

/**
 * Runs in every test worker BEFORE any test module is imported, which is what makes it safe for
 * `lib/env.ts` to parse `process.env` at import time.
 *
 * `E3_NON_PUBLIC_STAFF_DRILLDOWN` is pinned to "false" here — the production default — so a test
 * that wants the flag ON has to say so explicitly with `vi.stubEnv` + `vi.resetModules()`. A suite
 * that ran with the flag globally on would silently stop testing the thing the flag exists for.
 */
const config = JSON.parse(readFileSync(TEST_DB_CONFIG_PATH, "utf8")) as TestDbConfig;

const env = process.env as Record<string, string>;
env.ANALYTICS_DATABASE_URL = config.analyticsUrl;
env.OPERATIONAL_READBACK_URL = config.operationalUrl;
env.NODE_ENV = "test";
env.AUTH_DEV_BYPASS = "false";
env.E3_NON_PUBLIC_STAFF_DRILLDOWN = "false";
