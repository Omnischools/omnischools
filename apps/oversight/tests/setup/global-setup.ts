import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { TEST_DB_CONFIG_PATH, type TestDbConfig } from "./paths";
import { STAGES } from "../../db/seed/config";

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
/**
 * The increment-H ETL database — same migrations, no policies, no §6 seed. See the `demoAnalyticsUrl`
 * note in tests/setup/paths.ts for why the ETL tests cannot share ANALYTICS_DB.
 */
const DEMO_ANALYTICS_DB = "oversight_test_demo";
const APP_ROLE = "ov_app";
const READBACK_ROLE = "ov_readback";
/**
 * The Omnischools provisioner (increment G). A THIRD analytics role, distinct from the app role,
 * because the officer directory's central property is that the credential the web app runs under
 * cannot grant oversight authority — and "cannot" has to mean a different role, not a different code
 * path. db/sql/policies.sql installs `audit_officer_provisioning`'s read policy `to` this role if it
 * exists, so creating it here is what makes that policy testable at all.
 */
const PROVISIONER_ROLE = "ov_provisioner";

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
    for (const db of [ANALYTICS_DB, OPERATIONAL_DB, DEMO_ANALYTICS_DB]) {
      await admin.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${db}' and pid <> pg_backend_pid()`,
      );
      await admin.unsafe(`drop database if exists ${db}`);
      await admin.unsafe(`create database ${db}`);
    }
    // Roles are cluster-wide, so they survive the database drop above.
    for (const role of [APP_ROLE, READBACK_ROLE, PROVISIONER_ROLE]) {
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

    // ── officer auth (increment G): the grants ARE the security model ─────────────────────────────
    //
    // The blanket `grant select on all tables` above is convenient and dangerously broad as soon as
    // the schema contains tables the app role must not touch, so it is immediately narrowed. These
    // three statements are not test scaffolding — they are the posture PROVISIONING §2a/§4 requires
    // on prod, applied here so the suite proves the real thing.
    //
    // 1 · NO WRITE ON THE DIRECTORY, EVER. This is what makes self-promotion impossible, and it is a
    //     missing GRANT rather than a policy on purpose: a policy can be mis-edited into permitting
    //     an update; a privilege that was never issued cannot. `update ref_oversight_officer set
    //     officer_role = 'NATIONAL_OVERSIGHT' where officer_id = <me>` must fail with `permission
    //     denied for table ref_oversight_officer` — before RLS, before the trigger. (The REVOKE is a
    //     no-op against the SELECT-only grant above; it is here so that widening that grant does not
    //     silently widen this.) SELECT is left in place per Kofi's "SELECT only" and yields ZERO rows
    //     anyway — the table is RLS-enabled with no policy, so ov_resolve_officer() is the only read
    //     path (and the `grant execute on all functions` above is what re-grants it to the app role
    //     after policies.sql revokes EXECUTE from PUBLIC).
    // 2 · NOTHING AT ALL ON THE PROVISIONING LOG. policies.sql already revokes it, but the blanket
    //     grant ran AFTER that file, so it has to be re-revoked here — the ordering trap worth
    //     noticing when the same grant shape is used on prod.
    await analyticsAdmin.unsafe(`
      revoke insert, update, delete on ref_oversight_officer from ${APP_ROLE};
      revoke all on audit_officer_provisioning from ${APP_ROLE};
    `);

    // The provisioner, granted exactly the posture db/sql/prod-paste-0005-officer-directory.sql
    // installs on prod — so a test of the provisioning path exercises the real thing rather than a
    // convenient superuser.
    //
    // NO DELETE on either table (offboarding is `is_active = false`; a deleted directory row orphans
    // every audit entry naming that uid) and NO UPDATE on the provisioning log (a correction is a new
    // row). EXECUTE on ov_officer_node_tier is needed because the write triggers call it as the
    // INVOKER and policies.sql revokes it from PUBLIC — without it every provisioning write fails
    // with `permission denied for function ov_officer_node_tier`.
    //
    // Note the non-obvious part, verified on a replay DB: these GRANTS alone are not enough. RLS
    // gates writes too, so a non-owner INSERT into an RLS-enabled table with no applicable policy
    // fails with `new row violates row-level security policy`. The role-targeted write policies
    // policies.sql installs for this role are what make provisioning possible at all.
    await analyticsAdmin.unsafe(`
      grant usage on schema public to ${PROVISIONER_ROLE};
      grant select, insert on audit_officer_provisioning to ${PROVISIONER_ROLE};
      grant select, insert, update on ref_oversight_officer to ${PROVISIONER_ROLE};
      grant select on dim_jurisdiction to ${PROVISIONER_ROLE};
      grant execute on function ov_officer_node_tier(uuid) to ${PROVISIONER_ROLE};
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

  // ── demo analytics (increment H): the app's migrations ONLY ────────────────────────────────────
  const demoAnalyticsUrl = withDb(base, DEMO_ANALYTICS_DB);
  const demoAdmin = postgres(demoAnalyticsUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
  try {
    const migrationsDir = join(repoAppRoot(), "db/migrations");
    for (const file of readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      for (const statement of splitMigration(
        readFileSync(join(migrationsDir, file), "utf8"),
      )) {
        await demoAdmin.unsafe(statement);
      }
    }
    // dim_stage — CONFIG, not a migration and not something the ETL may write (§10: seeded at
    // provision time by db/seed/config.ts, changed only by a deliberate config edit). `fact_enrolment.
    // stage` is a FK to it, so the increment-H enrolment arm cannot write a single row against a
    // database that was migrated but never seeded — on prod `pnpm db:setup` runs the seed, and this is
    // that one step, kept to the rows the ETL's FK needs.
    //
    // THE VALUES ARE THE SEED'S OWN `STAGES` CONSTANT, imported, not restated here: a hand-copied
    // literal claiming to be "byte-identical to the seed" stops being so the first time the seed is
    // edited, and the test database would then be silently stale against the config the product ships.
    for (const stage of STAGES) {
      await demoAdmin`
        insert into dim_stage (stage, official_age_low, official_age_high, display_order)
        values (${stage.stage}, ${stage.officialAgeLow}, ${stage.officialAgeHigh},
                ${stage.displayOrder})
        on conflict (stage) do nothing`;
    }
  } finally {
    await demoAdmin.end({ timeout: 5 });
  }

  const config: TestDbConfig = {
    analyticsUrl: withDb(base, ANALYTICS_DB, APP_ROLE),
    operationalUrl: withDb(base, OPERATIONAL_DB, READBACK_ROLE),
    provisionerAnalyticsUrl: withDb(base, ANALYTICS_DB, PROVISIONER_ROLE),
    superuserAnalyticsUrl: analyticsAdminUrl,
    superuserOperationalUrl: operationalAdminUrl,
    demoAnalyticsUrl,
  };
  mkdirSync(dirname(TEST_DB_CONFIG_PATH), { recursive: true });
  writeFileSync(TEST_DB_CONFIG_PATH, JSON.stringify(config, null, 2));
}
