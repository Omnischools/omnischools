import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { testDbConfig } from "./helpers";

/**
 * prod-paste-0006-analytics-app-role.sql, replayed from empty.
 *
 * WHY THIS TEST EXISTS AT ALL — the file it covers is a HAND-PASTED prod artifact, which is the one
 * category of SQL in this repo that nothing else executes. `pnpm db:policies` applies
 * db/sql/policies.sql (local dev only) and the migrations are applied by drizzle; the
 * `prod-paste-*.sql` files reach a database because a human ran them, so a syntax error or a
 * mis-ordered REVOKE in one of them is discovered on PROD, in the Supabase SQL editor, by the person
 * applying it. This test is the only thing that runs 0006 before then.
 *
 * WHAT IT PINS, in order of how much it would hurt to lose:
 *   1 · THE FILE RUNS. Migrations → policies.sql → prod-paste-0001…0006 on a database built from
 *       scratch, in one transaction, exactly as the SQL editor would.
 *   2 · THE §4 GUARDS NO-OP CLEANLY OFF SUPABASE. This cluster (scripts/test-pg.sh) has no `anon`,
 *       `authenticated` or `service_role`, and `revoke … from <nonexistent role>` is a hard ERROR,
 *       not a warning. Every one of those statements therefore sits behind
 *       `if exists (select 1 from pg_roles …)`. If a future edit adds an unguarded one, the replay
 *       in beforeAll fails here rather than on prod.
 *   3 · THE POSTURE MATCHES THE HARNESS. tests/setup/global-setup.ts grants `ov_app` a specific set
 *       and the whole suite is proven against it; 0006 §3 claims to be that same set, transcribed.
 *       The parity test below compares the two role's ACTUAL privileges table by table, so the claim
 *       cannot drift. Change one without the other and this fails.
 *   4 · §4b DOES NOT BREAK THE APP. Revoking EXECUTE from PUBLIC on our routines is the one mutation
 *       in 0006 that could plausibly lock the app out of its own bootstrap read, so
 *       `ov_resolve_officer()` is called AS the app role after the paste.
 *
 * It builds its OWN database rather than using the suite's analytics DB: 0006 revokes EXECUTE from
 * PUBLIC and creates a cluster-wide role, and doing either to the shared DB would make every other
 * test file's result depend on this one's ordering.
 */

const PP_DB = "oversight_test_pp0006";
const APP_ROLE = "oversight_app";
const PROVISIONER_ROLE = "oversight_provisioner";

/** The harness's own app role, for the parity comparison. */
const HARNESS_APP_ROLE = "ov_app";

const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

/** The tables whose grant posture IS the officer-auth security model. */
const POSTURE_TABLES = [
  "ref_oversight_officer",
  "audit_officer_provisioning",
  "audit_access_log",
  "dim_jurisdiction",
  "fact_enrolment",
  "ref_emis_school_register",
] as const;

function withDb(baseUrl: string, dbName: string, user?: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  if (user) {
    url.username = user;
    url.password = "";
  }
  return url.toString();
}

function connect(url: string): postgres.Sql {
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

function sqlFile(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

/** Drizzle writes `--> statement-breakpoint` between statements; nothing else splits them safely. */
function splitMigration(text: string): string[] {
  return text
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const PROD_PASTE_0006 = sqlFile("db/sql/prod-paste-0006-analytics-app-role.sql");

/** Every privilege `role` actually holds on `table`, as the catalogue sees it. */
async function privilegesOn(
  sql: postgres.Sql,
  role: string,
  table: string,
): Promise<string[]> {
  const held: string[] = [];
  for (const priv of TABLE_PRIVILEGES) {
    const [row] = await sql.unsafe(
      `select has_table_privilege('${role}', 'public.${table}', '${priv}') as ok`,
    );
    if (row.ok) held.push(priv);
  }
  return held;
}

describe("prod-paste-0006 — replayed from empty", () => {
  let adminBase: string;
  let ppAdmin: postgres.Sql;

  beforeAll(async () => {
    adminBase = testDbConfig.superuserAnalyticsUrl;

    const cluster = connect(withDb(adminBase, "postgres"));
    try {
      await cluster.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${PP_DB}' and pid <> pg_backend_pid()`,
      );
      await cluster.unsafe(`drop database if exists ${PP_DB}`);
      await cluster.unsafe(`create database ${PP_DB}`);
      // Cluster-wide, so idempotent creation and no drop: the suite's own roles are handled the
      // same way in tests/setup/global-setup.ts. prod-paste-0005 RAISES rather than installing half
      // a posture if either is absent, so both must exist before the replay.
      for (const role of [APP_ROLE, PROVISIONER_ROLE]) {
        await cluster.unsafe(
          `do $$ begin if not exists (select from pg_roles where rolname = '${role}') then create role ${role} login; end if; end $$`,
        );
      }
    } finally {
      await cluster.end({ timeout: 5 });
    }

    ppAdmin = connect(withDb(adminBase, PP_DB));
    const migrationsDir = join(process.cwd(), "db/migrations");
    for (const file of readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      for (const statement of splitMigration(
        readFileSync(join(migrationsDir, file), "utf8"),
      )) {
        await ppAdmin.unsafe(statement);
      }
    }
    await ppAdmin.unsafe(sqlFile("db/sql/policies.sql"));

    // The pastes, in the order docs/PROVISIONING.md §2a gives. Each runs as ONE statement batch,
    // which is how the Supabase SQL editor runs it — so a block that raises takes the whole file
    // with it, as on prod.
    for (const name of readdirSync(join(process.cwd(), "db/sql"))
      .filter((f) => f.startsWith("prod-paste-"))
      .sort()) {
      await ppAdmin.unsafe(sqlFile("db/sql", name));
    }
  });

  afterAll(async () => {
    await ppAdmin?.end({ timeout: 5 });
    const cluster = connect(withDb(adminBase, "postgres"));
    try {
      await cluster.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${PP_DB}' and pid <> pg_backend_pid()`,
      );
      await cluster.unsafe(`drop database if exists ${PP_DB}`);
    } finally {
      await cluster.end({ timeout: 5 });
    }
  });

  it("applies after the migrations, policies.sql and 0001…0005 (beforeAll is the assertion)", async () => {
    const [row] = await ppAdmin.unsafe(
      `select to_regprocedure('public.ov_resolve_officer(uuid)') is not null as has_resolver,
              to_regclass('public.ref_oversight_officer') is not null as has_directory`,
    );
    expect(row.has_resolver).toBe(true);
    expect(row.has_directory).toBe(true);
  });

  it("is idempotent — a second and third application change nothing", async () => {
    const before = await privilegesOn(ppAdmin, APP_ROLE, "ref_oversight_officer");
    await ppAdmin.unsafe(PROD_PASTE_0006);
    await ppAdmin.unsafe(PROD_PASTE_0006);
    expect(await privilegesOn(ppAdmin, APP_ROLE, "ref_oversight_officer")).toEqual(
      before,
    );
    expect(before).toEqual(["SELECT"]);
  });

  describe("§4 — the Supabase built-in role sweep", () => {
    it("leaves the built-ins holding nothing — whichever kind of cluster this is", async () => {
      // Two shapes, one invariant. On this cluster the three roles do not exist, so the whole of §4
      // is a no-op and the proof of that is simply that beforeAll's replay DID NOT RAISE (an
      // unguarded `revoke … from anon` would have aborted it). If a cluster DOES have them — a
      // Supabase project, or a developer who created them — the invariant is the same and is
      // asserted directly. Written to cover both rather than to assert their absence, so a leaked
      // role degrades this file to a weaker test instead of a red one.
      const present = (
        await ppAdmin.unsafe(
          `select rolname from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname`,
        )
      ).map((r) => r.rolname as string);

      for (const role of present) {
        for (const table of POSTURE_TABLES) {
          expect(
            await privilegesOn(ppAdmin, role, table),
            `${role} still holds privileges on ${table} after prod-paste-0006 §4a`,
          ).toEqual([]);
        }
      }
      expect(present.length === 0 || present.length === 3).toBe(true);
    });

    it("closes the exposure 0005's G5 caught, on a database with the Supabase grant set", async () => {
      // THE CENTRAL CLAIM OF THE FILE, exercised rather than argued. Supabase's project setup issues
      // `grant all on all tables in schema public to anon, authenticated, service_role` plus matching
      // DEFAULT PRIVILEGES. `ALL` includes DELETE and TRUNCATE, which is what made prod-paste-0005's
      // G5 check fail on first application and had to be revoked by hand on two tables. This
      // reproduces that state and proves 0006 is the repeatable fix for it.
      const builtins = ["anon", "authenticated", "service_role"];
      const created: string[] = [];
      try {
        for (const role of builtins) {
          const [row] = await ppAdmin.unsafe(
            `select exists (select 1 from pg_roles where rolname = '${role}') as present`,
          );
          if (!row.present) {
            await ppAdmin.unsafe(`create role ${role} nologin noinherit`);
            created.push(role);
          }
        }
        const roleList = builtins.join(", ");
        await ppAdmin.unsafe(`
          grant all on all tables in schema public to ${roleList};
          grant all on all sequences in schema public to ${roleList};
          grant all on all routines in schema public to ${roleList};
          alter default privileges in schema public grant all on tables to ${roleList};
          alter default privileges in schema public grant all on sequences to ${roleList};
          alter default privileges in schema public grant all on functions to ${roleList};
        `);

        // The exposure, as it would be found on prod: the officer directory erasable by `anon`.
        expect(await privilegesOn(ppAdmin, "anon", "ref_oversight_officer")).toContain(
          "DELETE",
        );
        expect(await privilegesOn(ppAdmin, "anon", "ref_oversight_officer")).toContain(
          "TRUNCATE",
        );
        expect(await privilegesOn(ppAdmin, "service_role", "audit_access_log")).toContain(
          "UPDATE",
        );

        await ppAdmin.unsafe(PROD_PASTE_0006);

        for (const role of builtins) {
          for (const table of POSTURE_TABLES) {
            expect(
              await privilegesOn(ppAdmin, role, table),
              `prod-paste-0006 §4a did not sweep ${role} off ${table}`,
            ).toEqual([]);
          }
        }

        // …and the default privileges are gone too, so the NEXT migration's table starts clean.
        await ppAdmin.unsafe(`create table fact_sweep_probe (id uuid primary key)`);
        try {
          for (const role of builtins) {
            expect(
              await privilegesOn(ppAdmin, role, "fact_sweep_probe"),
              `prod-paste-0006 §4c did not neutralise the DEFAULT PRIVILEGES: a table created after the sweep is still granted to ${role}`,
            ).toEqual([]);
          }
        } finally {
          await ppAdmin.unsafe(`drop table fact_sweep_probe`);
        }
      } finally {
        // Roles are cluster-wide. Drop only the ones this test created, and only after 0006 has
        // removed every ACL entry naming them (which is what makes DROP ROLE possible at all).
        for (const role of created) {
          await ppAdmin.unsafe(`drop owned by ${role}`);
          await ppAdmin.unsafe(`drop role if exists ${role}`);
        }
      }
    });

    it("guards every built-in-role REVOKE behind an `if exists` role check", () => {
      // `revoke … from <nonexistent role>` is an ERROR, so an unguarded statement would break the
      // replay above on this cluster. This asserts the SHAPE as well, because the guard is easy to
      // drop when adding a fourth role to the sweep.
      const sweep = PROD_PASTE_0006.slice(
        PROD_PASTE_0006.indexOf("§4a · revoke the blanket object privileges"),
        PROD_PASTE_0006.indexOf("§4b · and EXECUTE on our routines"),
      );
      expect(sweep).toContain("FOREACH r IN ARRAY builtins");
      expect(sweep).toContain(
        "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN",
      );
      // Every REVOKE in the sweep block is parameterised by the loop variable — never a literal
      // role name, which could not be guarded.
      for (const line of sweep
        .split("\n")
        .filter((l) => l.includes("REVOKE ALL ON ALL"))) {
        expect(line).toContain("FROM %I");
      }
    });

    it("leaves no default privilege that would re-grant a FUTURE table", async () => {
      await ppAdmin.unsafe(`create table fact_future_probe (id uuid primary key)`);
      try {
        const [row] = await ppAdmin.unsafe(
          `select count(*)::int as n
             from pg_default_acl d
             cross join aclexplode(d.defaclacl) a
            where (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace::oid)
              and a.grantee <> 0
              and pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role')`,
        );
        expect(row.n).toBe(0);
        // …and the new table is not automatically readable by the app role either. That is the
        // deliberate choice documented at the foot of §4c: a new table is two steps (migration, then
        // its prod-paste), and an automatic grant would hand the app credential SELECT during the
        // window before the table has a policy.
        expect(await privilegesOn(ppAdmin, APP_ROLE, "fact_future_probe")).toEqual([]);
      } finally {
        await ppAdmin.unsafe(`drop table fact_future_probe`);
      }
    });
  });

  describe("§3 — the app-role posture matches tests/setup/global-setup.ts", () => {
    it("holds exactly the same privileges as the harness role, table by table", async () => {
      const harness = connect(testDbConfig.superuserAnalyticsUrl);
      try {
        for (const table of POSTURE_TABLES) {
          expect(
            await privilegesOn(ppAdmin, APP_ROLE, table),
            `prod-paste-0006 §3 and tests/setup/global-setup.ts disagree about ${table}. One of them was changed without the other, which means either CI is proving a posture prod does not run, or prod runs a posture CI does not prove.`,
          ).toEqual(await privilegesOn(harness, HARNESS_APP_ROLE, table));
        }
      } finally {
        await harness.end({ timeout: 5 });
      }
    });

    it("is SELECT-only on the directory and NOTHING on the provisioning log", async () => {
      expect(await privilegesOn(ppAdmin, APP_ROLE, "ref_oversight_officer")).toEqual([
        "SELECT",
      ]);
      expect(await privilegesOn(ppAdmin, APP_ROLE, "audit_officer_provisioning")).toEqual(
        [],
      );
    });

    it("can INSERT but never UPDATE/DELETE audit_access_log", async () => {
      expect(await privilegesOn(ppAdmin, APP_ROLE, "audit_access_log")).toEqual([
        "SELECT",
        "INSERT",
      ]);
    });

    it("does NOT hold UPDATE on fact_anomaly (triage is increment J)", async () => {
      expect(await privilegesOn(ppAdmin, APP_ROLE, "fact_anomaly")).toEqual(["SELECT"]);
    });
  });

  describe("§4b — revoking EXECUTE from PUBLIC does not lock the app out", () => {
    it("the app role can still call ov_resolve_officer(), and PUBLIC cannot", async () => {
      const [row] = await ppAdmin.unsafe(
        `select has_function_privilege('${APP_ROLE}', 'public.ov_resolve_officer(uuid)', 'EXECUTE') as app_ok,
                has_function_privilege('${APP_ROLE}', 'public.ov_in_subtree(uuid)', 'EXECUTE') as subtree_ok,
                exists (
                  select 1 from pg_proc p
                  join pg_namespace n on n.oid = p.pronamespace
                  cross join aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'EXECUTE'
                    and not exists (select 1 from pg_depend d
                                     where d.classid = 'pg_proc'::regclass
                                       and d.objid = p.oid and d.deptype = 'e')
                ) as any_public_execute`,
      );
      expect(row.app_ok).toBe(true);
      // ov_in_subtree is the USING predicate of every jurisdiction policy and is evaluated as the
      // QUERYING role, so losing this grant would turn every read into `permission denied`.
      expect(row.subtree_ok).toBe(true);
      expect(row.any_public_execute).toBe(false);
    });

    it("the app role actually reads through the bootstrap path, as a non-owner", async () => {
      const app = connect(withDb(adminBase, PP_DB, APP_ROLE));
      try {
        // Zero rows (the directory is empty here) but NOT an error — the distinction this proves is
        // `can call it` vs `permission denied for function ov_resolve_officer`.
        const rows = await app.unsafe(
          `select * from ov_resolve_officer(gen_random_uuid())`,
        );
        expect(rows.length).toBe(0);
        await expect(
          app.unsafe(`select count(*) from audit_officer_provisioning`),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          app.unsafe(
            `update ref_oversight_officer set officer_role = 'NATIONAL_OVERSIGHT'`,
          ),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await app.end({ timeout: 5 });
      }
    });
  });

  describe("V1 — the app role is not RLS-exempt", () => {
    it("is not superuser, not BYPASSRLS, and owns no public table", async () => {
      const [row] = await ppAdmin.unsafe(
        `select (select rolsuper from pg_roles where rolname = '${APP_ROLE}') as super,
                (select rolbypassrls from pg_roles where rolname = '${APP_ROLE}') as bypass,
                (select count(*)::int from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind in ('r','p')
                    and pg_get_userbyid(c.relowner) = '${APP_ROLE}') as owned`,
      );
      expect(row.super).toBe(false);
      expect(row.bypass).toBe(false);
      expect(row.owned).toBe(0);
    });
  });
});
