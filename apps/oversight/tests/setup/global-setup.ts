import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { TEST_DB_CONFIG_PATH, type TestDbConfig } from "./paths";

/**
 * Provision the two databases the §6 gate needs, from scratch, on every run.
 *
 * ANALYTICS is built from the app's OWN migrations plus db/sql/policies.sql — not from a
 * hand-written fixture schema. That matters: the tests then exercise the real `audit_access_log`
 * columns, the real `access_outcome` enum, the real append-only trigger and the real jurisdiction
 * RLS, so a migration that breaks the gate breaks the suite. A fixture schema would have tested the
 * fixture.
 *
 * OPERATIONAL is a fixture (tests/fixtures/operational-schema.sql) because apps/web's schema is not
 * this app's to migrate, and the consent table does not exist in this repo at all yet — it is being
 * built in another session against the contract in apps/web/Todo.md. The fixture is built to that
 * contract, which is precisely the interface this increment has to meet.
 *
 * The app connects to analytics as `ov_app` (NOT the owner) so RLS actually applies, and to
 * operational as `ov_readback` with the PROVISIONING §4a grant list and nothing more.
 */

const ANALYTICS_DB = "oversight_test_analytics";
const OPERATIONAL_DB = "oversight_test_operational";
const APP_ROLE = "ov_app";
const READBACK_ROLE = "ov_readback";

function repoAppRoot(): string {
  return process.cwd();
}

/** Boot (or reuse) a cluster, unless an external server was supplied. */
function superuserBaseUrl(): string {
  const external = process.env.OVERSIGHT_TEST_DATABASE_URL;
  if (external) return external;
  const script = join(repoAppRoot(), "scripts/test-pg.sh");
  return execFileSync("bash", [script], { encoding: "utf8" }).trim();
}

function withDb(baseUrl: string, dbName: string, user?: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  if (user) {
    url.username = user;
    url.password = "";
  }
  return url.toString();
}

/** Drizzle writes `--> statement-breakpoint` between statements; nothing else splits them safely. */
function splitMigration(text: string): string[] {
  return text
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default async function globalSetup() {
  const base = superuserBaseUrl();
  const admin = postgres(base, { max: 1, prepare: false, onnotice: () => {} });

  try {
    for (const db of [ANALYTICS_DB, OPERATIONAL_DB]) {
      await admin.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${db}' and pid <> pg_backend_pid()`,
      );
      await admin.unsafe(`drop database if exists ${db}`);
      await admin.unsafe(`create database ${db}`);
    }
    // Roles are cluster-wide, so they survive the database drop above.
    for (const role of [APP_ROLE, READBACK_ROLE]) {
      await admin.unsafe(
        `do $$ begin if not exists (select from pg_roles where rolname = '${role}') then create role ${role} login; end if; end $$`,
      );
    }
  } finally {
    await admin.end({ timeout: 5 });
  }

  // ── analytics: the app's real migrations, then the real policies ──────────────────────────────
  const analyticsAdminUrl = withDb(base, ANALYTICS_DB);
  const analyticsAdmin = postgres(analyticsAdminUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
  try {
    const migrationsDir = join(repoAppRoot(), "db/migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const text = readFileSync(join(migrationsDir, file), "utf8");
      for (const statement of splitMigration(text)) {
        await analyticsAdmin.unsafe(statement);
      }
    }
    await analyticsAdmin.unsafe(
      readFileSync(join(repoAppRoot(), "db/sql/policies.sql"), "utf8"),
    );

    // The app role: read everything, and INSERT on the audit log ONLY. Explicitly no UPDATE/DELETE
    // anywhere — policies.sql's own header explains why the absent grant, not the trigger, is what
    // makes a tamper attempt raise.
    await analyticsAdmin.unsafe(`
      grant usage on schema public to ${APP_ROLE};
      grant select on all tables in schema public to ${APP_ROLE};
      grant insert on audit_access_log to ${APP_ROLE};
      grant execute on all functions in schema public to ${APP_ROLE};
    `);
    await analyticsAdmin.unsafe(
      readFileSync(join(repoAppRoot(), "tests/fixtures/analytics-seed.sql"), "utf8"),
    );
  } finally {
    await analyticsAdmin.end({ timeout: 5 });
  }

  // ── operational: the fixture schema (incl. the apps/web consent contract), then the seed ──────
  const operationalAdminUrl = withDb(base, OPERATIONAL_DB);
  const operationalAdmin = postgres(operationalAdminUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
  try {
    await operationalAdmin.unsafe(
      readFileSync(join(repoAppRoot(), "tests/fixtures/operational-schema.sql"), "utf8"),
    );
    await operationalAdmin.unsafe(
      readFileSync(join(repoAppRoot(), "tests/fixtures/operational-seed.sql"), "utf8"),
    );
    await operationalAdmin.unsafe(
      `grant connect on database ${OPERATIONAL_DB} to ${READBACK_ROLE}`,
    );
  } finally {
    await operationalAdmin.end({ timeout: 5 });
  }

  const config: TestDbConfig = {
    analyticsUrl: withDb(base, ANALYTICS_DB, APP_ROLE),
    operationalUrl: withDb(base, OPERATIONAL_DB, READBACK_ROLE),
    superuserAnalyticsUrl: analyticsAdminUrl,
    superuserOperationalUrl: operationalAdminUrl,
  };
  mkdirSync(dirname(TEST_DB_CONFIG_PATH), { recursive: true });
  writeFileSync(TEST_DB_CONFIG_PATH, JSON.stringify(config, null, 2));
}
