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

/**
 * The tables whose grant posture IS the officer-auth security model, checked by name so that a
 * failure message names the table that matters most.
 *
 * ⚠ NOT the list the §3↔harness parity test uses. That one enumerates EVERY table in `public` from
 * the catalogue, because a hardcoded list is a spot-check: `fact_anomaly` is absent from this array,
 * and `fact_anomaly` is exactly the table §3 and PROVISIONING §1 tell increment J to add
 * `grant update` to in BOTH 0006 and tests/setup/global-setup.ts. Adding it to one side only would
 * have stayed green against a six-table loop that never looks at it.
 */
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

/**
 * Slice one section out of the paste so a block can be run — or a block's ABSENCE from a prefix
 * proven — on its own.
 *
 * WHY SLICING RATHER THAN A SEPARATE FIXTURE. The blocks under test here are gates and advisories
 * whose failure branches are unreachable when the file is applied to a healthy database, which is the
 * only way the suite applies it. A fixture copy would drift from the file the moment anyone edited
 * it, and the drift would be invisible (the copy would still pass). Slicing means the test fails if
 * the banner it anchors on is renamed, which is the correct coupling: these tests are ABOUT where
 * these blocks sit in the file.
 */
function section(from: string, to?: string): string {
  const start = PROD_PASTE_0006.indexOf(from);
  if (start < 0) throw new Error(`prod-paste-0006 no longer contains the anchor ${from}`);
  const end = to ? PROD_PASTE_0006.indexOf(to) : PROD_PASTE_0006.length;
  if (end < 0) throw new Error(`prod-paste-0006 no longer contains the anchor ${to}`);
  return PROD_PASTE_0006.slice(start, end);
}

const ANCHOR_V0 = "-- V0 · THE RLS INVARIANT THAT §3's BLANKET GRANT RESTS ON";
const ANCHOR_S3 = "-- §3 · THE APP-ROLE POSTURE";
const ANCHOR_S4C = "-- ---- §4c · DEFAULT PRIVILEGES";
const ANCHOR_S5 = "-- §5 · VERIFICATION";
const ANCHOR_V4 = "-- ---- V4 · THE SUPABASE BUILT-INS HOLD NOTHING";
const ANCHOR_V5 = "-- ---- V5 · NO DEFAULT PRIVILEGE WILL RE-GRANT";
const ANCHOR_REPORT = "WITH builtins(rolname) AS (";

/** Everything the paste runs BEFORE §3 — the prefix that must already have gated the blanket grant. */
const PREFIX_BEFORE_S3 = PROD_PASTE_0006.slice(0, PROD_PASTE_0006.indexOf(ANCHOR_S3));
const BLOCK_V0 = section(ANCHOR_V0, ANCHOR_S3);
const BLOCK_V4 = section(ANCHOR_V4, ANCHOR_V5);
const BLOCK_4C = section(ANCHOR_S4C, ANCHOR_S5);
/** §6: the final statement of the file. Zero rows = clean. */
const RESIDUAL_REPORT = section(ANCHOR_REPORT);

/** A connection that records RAISE output, so an advisory WARNING can be asserted on. */
function connectCollecting(url: string): {
  sql: postgres.Sql;
  messages: { severity: string; message: string }[];
} {
  const messages: { severity: string; message: string }[] = [];
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    onnotice: (n) =>
      messages.push({ severity: String(n.severity), message: String(n.message) }),
  });
  return { sql, messages };
}

async function rejects(sql: postgres.Sql, text: string): Promise<string> {
  try {
    await sql.unsafe(text);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the SQL to raise, but it succeeded");
}

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

/**
 * The FULL per-table privilege posture of `role`: every table in `public` the catalogue knows
 * about, mapped to every privilege the role holds on it.
 *
 * One round trip rather than `privilegesOn` in a loop, because the parity test calls this on two
 * databases and the table count is ~27 × 7 privileges. Privileges come back sorted alphabetically
 * (not in `TABLE_PRIVILEGES` order) — which is fine and is the point: both sides are sorted the same
 * way, so the comparison is on the SET, and an empty set is `[]` rather than missing.
 */
async function privilegePostureByTable(
  sql: postgres.Sql,
  role: string,
): Promise<Record<string, string[]>> {
  const privs = TABLE_PRIVILEGES.map((p) => `'${p}'`).join(", ");
  const rows = await sql.unsafe(
    `select c.relname::text as relname,
            coalesce((
              select array_agg(g.priv order by g.priv)
                from unnest(array[${privs}]) as g(priv)
               where has_table_privilege('${role}', c.oid, g.priv)
            ), array[]::text[]) as held
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p')
      order by c.relname`,
  );
  return Object.fromEntries(rows.map((r) => [r.relname as string, r.held as string[]]));
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
    it("holds exactly the same privileges as the harness role, on EVERY table in public", async () => {
      /**
       * THE PIN IS ONLY AS WIDE AS THE LIST IT WALKS, so it walks the catalogue instead of a list.
       * This used to compare the six POSTURE_TABLES, which made it a spot-check wearing the words
       * "table by table": `fact_anomaly` was not among them, and `fact_anomaly` is the table §3's
       * "NOT GRANTED, DELIBERATELY" note and PROVISIONING §1 both tell increment J to add
       * `grant update` to in 0006 §3 AND tests/setup/global-setup.ts together. Adding it to
       * global-setup alone — the easy half, because that is the file the suite runs against — would
       * have left this green while prod ran a posture CI no longer proved. Which is the exact
       * failure this test exists to prevent, surviving inside the test meant to prevent it.
       *
       * Enumerating `relkind in ('r','p')` on BOTH databases also pins the table SETS against each
       * other, so a table that exists on one side only is a failure rather than a skipped key.
       */
      const harness = connect(testDbConfig.superuserAnalyticsUrl);
      try {
        const pasted = await privilegePostureByTable(ppAdmin, APP_ROLE);
        const proven = await privilegePostureByTable(harness, HARNESS_APP_ROLE);

        // Not a fixed count — a migration that adds a table should not have to edit this test. But
        // it must not be EMPTY, or two identically-broken databases would compare equal.
        expect(Object.keys(pasted).length).toBeGreaterThanOrEqual(25);
        expect(
          Object.keys(pasted),
          "the 0006 replay database and the harness database do not contain the same tables in `public`, so a per-table privilege comparison would skip whatever is missing from one side. Both are built from db/migrations, so this means a probe table leaked out of a test's `finally`.",
        ).toEqual(Object.keys(proven));

        expect(
          pasted,
          "prod-paste-0006 §3 and tests/setup/global-setup.ts disagree about the app role's privileges on at least one table in `public`. One of them was changed without the other, which means either CI is proving a posture prod does not run, or prod runs a posture CI does not prove. Fix BOTH in the same change (this is what §3's `fact_anomaly` note means by \"add it to §3 AND to tests/setup/global-setup.ts together\").",
        ).toEqual(proven);

        // The pin is only meaningful if the two roles actually hold something, and if the table
        // that motivated widening it is in the comparison at all.
        expect(Object.keys(pasted)).toContain("fact_anomaly");
        expect(pasted["audit_access_log"]).toEqual(["INSERT", "SELECT"]);
        expect(pasted["audit_officer_provisioning"]).toEqual([]);
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

  describe("V0 — the RLS invariant that §3's blanket grant rests on (S-1)", () => {
    /**
     * §3 hands `oversight_app` SELECT on EVERY table in `public`, and the file's header makes
     * re-running §3 mandatory after every migration. That grant is safe for exactly one reason:
     * every relation in `public` has RLS enabled, so the jurisdiction POLICIES decide which rows the
     * app role sees, not the grant. Nothing in the repo asserted that reason until V0 — and nothing
     * in `tests/` looked at `relrowsecurity` at all.
     *
     * The failure mode V0 closes has no signature. A migration lands without its prod-paste, one
     * table ends up `relrowsecurity = false`, §3 is re-run as instructed, and a DISTRICT officer
     * reads that table unscoped — national data, every district. There is no empty panel to notice,
     * because the empty panel IS the RLS.
     */
    it("every table in public has RLS enabled and at least one policy (the invariant itself)", async () => {
      const rows = await ppAdmin.unsafe(
        `select c.relname,
                c.relrowsecurity,
                (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r','p')
          order by c.relname`,
      );
      // Not a fixed count: a migration that adds a table should not have to edit this test, it
      // should have to give the table a policy. But it must not be EMPTY, or the loop below would
      // pass vacuously on a database where the migrations never ran.
      expect(rows.length).toBeGreaterThanOrEqual(25);

      const rlsOff = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
      expect(
        rlsOff,
        `table(s) in public have ROW LEVEL SECURITY DISABLED. §3's blanket \`grant select on all tables\` would hand oversight_app an UNSCOPED read of these — a district officer reading national data, with no empty-panel signature because that signature depends on RLS being on. Give them their policies in a prod-paste (docs/PROVISIONING.md §2a).`,
      ).toEqual([]);

      const noPolicy = rows.filter((r) => r.policies === 0).map((r) => r.relname);
      expect(
        noPolicy,
        `table(s) in public have RLS enabled but ZERO policies. That is fail-closed, not a leak — but it is the exact signature of a migration whose prod-paste was never applied, and it presents as "the panel is empty", whose tempting fix is to disable RLS.`,
      ).toEqual([]);
    });

    it("gates §3: the prefix of the file that runs BEFORE the blanket grant raises on an RLS-off table", async () => {
      // THE PLACEMENT IS THE CONTROL, so the placement is what is tested. The paste is applied as one
      // statement batch (one implicit transaction, exactly as the Supabase SQL editor runs it), so an
      // end-state assertion CANNOT tell a gate from a report — a raise anywhere rolls the grant back
      // either way. What distinguishes them is whether the assertion is in the part of the file that
      // has already run when §3 issues its GRANT. So: take the file text up to §3's banner and run
      // only that. If V0 is ever moved down among V1…V6, this prefix stops raising and this test goes
      // red. (It also matters in practice: the header tells operators to re-run §3 after a migration,
      // and an operator who pastes from the top down reaches V0 first.)
      expect(PROD_PASTE_0006.indexOf(ANCHOR_V0)).toBeLessThan(
        PROD_PASTE_0006.indexOf("GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I"),
      );

      await ppAdmin.unsafe(`create table probe_rls_gate (id uuid primary key)`);
      try {
        const msg = await rejects(ppAdmin, PREFIX_BEFORE_S3);
        expect(msg).toMatch(/V0 FAILED \(GATE ON §3\)/);
        expect(msg).toMatch(/ROW LEVEL SECURITY DISABLED/);
        expect(msg).toMatch(/probe_rls_gate/);

        // …and the whole file refuses too, so nothing is left half-applied and §3's grant never
        // lands on the table that has no policy to scope it.
        expect(await rejects(ppAdmin, PROD_PASTE_0006)).toMatch(/V0 FAILED/);
        expect(
          await privilegesOn(ppAdmin, APP_ROLE, "probe_rls_gate"),
          "V0 raised but the blanket grant still reached the un-protected table",
        ).toEqual([]);
      } finally {
        await ppAdmin.unsafe(`drop table probe_rls_gate`);
      }
      // RESTORE PROVEN, not assumed: the same file now applies, which is what makes the red above a
      // discrimination rather than a permanent failure.
      await ppAdmin.unsafe(PROD_PASTE_0006);
    });

    it("also raises for RLS enabled with ZERO policies, and passes once a policy exists", async () => {
      await ppAdmin.unsafe(
        `create table probe_rls_nopolicy (id uuid primary key);
         alter table probe_rls_nopolicy enable row level security;`,
      );
      try {
        const msg = await rejects(ppAdmin, BLOCK_V0);
        expect(msg).toMatch(/RLS ENABLED but ZERO POLICIES/);
        expect(msg).toMatch(/probe_rls_nopolicy/);

        // The other half of the discrimination: give it a policy and the SAME block passes. Without
        // this, a V0 that raised unconditionally would also be green above.
        await ppAdmin.unsafe(
          `create policy probe_deny on probe_rls_nopolicy for select using (false)`,
        );
        await ppAdmin.unsafe(BLOCK_V0);
      } finally {
        await ppAdmin.unsafe(`drop table probe_rls_nopolicy`);
      }
      await ppAdmin.unsafe(PROD_PASTE_0006);
    });
  });

  describe("V4 — a built-in that can SET ROLE its way out (S-2)", () => {
    /**
     * `has_*_privilege()` answers "what does this role hold, counting what it INHERITS". A membership
     * granted `WITH INHERIT FALSE` — or granted to a NOINHERIT role, which is what `anon`,
     * `authenticated` and `service_role` are on Supabase — confers nothing by inheritance and
     * everything by `SET ROLE`. V4's sweep is blind to it; the MEMBER loop added for S-2 is not.
     */
    it("reports clean privileges yet raises, because the membership is reachable by SET ROLE", async () => {
      const [{ present }] = await ppAdmin.unsafe(
        `select exists (select 1 from pg_roles where rolname = 'anon') as present`,
      );
      if (!present) await ppAdmin.unsafe(`create role anon nologin noinherit`);
      try {
        await ppAdmin.unsafe(`grant postgres to anon with inherit false`);

        // THE BLIND SPOT, ASSERTED FIRST. `postgres` owns every table in `public` and is a superuser;
        // `anon` can now become it at will. Every privilege probe V4's sweep uses still says no.
        // Without this expectation the test below would not be a test of S-2 at all — it would pass
        // just as well against the old block.
        expect(
          await privilegesOn(ppAdmin, "anon", "dim_jurisdiction"),
          "has_table_privilege can see the WITH INHERIT FALSE membership, so S-2's premise is wrong and the extra loop is redundant",
        ).toEqual([]);

        const msg = await rejects(ppAdmin, BLOCK_V4);
        expect(msg).toMatch(/V4 FAILED \(SET ROLE escalation\)/);
        expect(msg).toMatch(/anon can SET ROLE to \[.*postgres.*\]/);

        // …and the whole paste refuses, so this cannot be applied past.
        expect(await rejects(ppAdmin, PROD_PASTE_0006)).toMatch(/SET ROLE escalation/);
      } finally {
        await ppAdmin.unsafe(`revoke postgres from anon`);
        if (!present) {
          await ppAdmin.unsafe(`drop owned by anon`);
          await ppAdmin.unsafe(`drop role if exists anon`);
        }
      }
      // Restored: V4 passes again, and so does the file.
      await ppAdmin.unsafe(BLOCK_V4);
      await ppAdmin.unsafe(PROD_PASTE_0006);
    });
  });

  describe("§3 — EXECUTE ON ALL ROUTINES, not ALL FUNCTIONS (S-3)", () => {
    it("re-grants EXECUTE on a PROCEDURE that §4b revoked from PUBLIC", async () => {
      // `grant execute on all functions` does NOT cover procedures; §4b's `pg_proc` loop DOES. So a
      // migration that added a procedure the app calls would have had EXECUTE revoked from PUBLIC by
      // §4b and never re-granted to the app role by §3 — this file breaking the app by disagreeing
      // with itself. Latent today (there is not one procedure in `public`), fail-closed, and a prod
      // outage the first time it is not latent. This test makes it not latent.
      expect(section(ANCHOR_S3, ANCHOR_S4C)).toContain(
        "GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO %I",
      );

      await ppAdmin.unsafe(
        `create procedure probe_proc() language plpgsql as $p$ begin null; end $p$`,
      );
      try {
        await ppAdmin.unsafe(PROD_PASTE_0006);
        const [row] = await ppAdmin.unsafe(
          `select has_function_privilege('${APP_ROLE}', 'public.probe_proc()', 'EXECUTE') as app_ok,
                  (select count(*)::int
                     from pg_proc p
                     join pg_namespace n on n.oid = p.pronamespace
                     cross join aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where n.nspname = 'public' and p.proname = 'probe_proc'
                      and a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute`,
        );
        // §4b took it off PUBLIC (so `anon` cannot RPC it) and §3 put it back for the app role.
        expect(row.public_execute).toBe(0);
        expect(
          row.app_ok,
          "§4b revoked EXECUTE on a procedure from PUBLIC and §3 did not re-grant it to the app role — `permission denied for procedure` in production",
        ).toBe(true);
      } finally {
        await ppAdmin.unsafe(`drop procedure probe_proc()`);
      }
      await ppAdmin.unsafe(PROD_PASTE_0006);
    });
  });

  describe("§6 — the residual report is a RESULT SET, because RAISE is invisible", () => {
    /**
     * The Supabase SQL editor renders result sets and errors. It does NOT reliably render
     * `RAISE NOTICE` / `RAISE WARNING`. So §1's "0005 is not applied" warnings, §4b's un-revoked
     * routines, §4c's advisory and V5's advisory could all be emitted and silently swallowed — and
     * every one of them is a control over an ABSENCE, which is the one kind of control that has
     * nothing else to show for itself. A control whose only report is an invisible WARNING is not a
     * control. §6 is the visible copy.
     */
    it("the file's last statement is a plain SELECT, not a DO block", () => {
      const tail = PROD_PASTE_0006.trimEnd();
      expect(tail.endsWith(";")).toBe(true);
      // Nothing may follow §6: a trailing DO block would become the editor's last result and hide it.
      expect(PROD_PASTE_0006.indexOf(ANCHOR_REPORT)).toBeGreaterThan(
        PROD_PASTE_0006.lastIndexOf("DO $$"),
      );
      expect(RESIDUAL_REPORT).toMatch(
        /SELECT severity, grantor, objtype, grantee, remediation_statement/,
      );
    });

    it("returns ZERO ROWS on a clean apply — and is the last result set of the paste", async () => {
      // `unsafe` on a multi-statement batch returns one result per statement, so this is literally
      // what the operator sees in the editor after pasting the file.
      const results = (await ppAdmin.unsafe(PROD_PASTE_0006)) as unknown as unknown[][];
      const rendered = results[results.length - 1];
      expect(Array.isArray(rendered)).toBe(true);
      expect(
        rendered,
        "the residual report returned rows on a clean apply, so either a real residual exists or a row source is firing when it should not — zero-rows-is-clean is the only thing that makes this report readable",
      ).toEqual([]);
    });

    it("surfaces a residual that is otherwise only a WARNING, with the statement that closes it", async () => {
      const [{ present }] = await ppAdmin.unsafe(
        `select exists (select 1 from pg_roles where rolname = 'anon') as present`,
      );
      if (!present) await ppAdmin.unsafe(`create role anon nologin noinherit`);
      try {
        await ppAdmin.unsafe(
          `grant delete on fact_fees to anon;
           alter default privileges in schema public grant all on tables to anon;`,
        );
        const rows = await ppAdmin.unsafe(RESIDUAL_REPORT);
        const objtypes = rows.map((r) => r.objtype as string);
        expect(objtypes).toContain("DEFAULT ACL TABLES (public)");
        expect(objtypes).toContain("TABLE DELETE");
        for (const row of rows) {
          expect(["FINDING", "ADVISORY"]).toContain(row.severity);
          expect(String(row.remediation_statement).length).toBeGreaterThan(0);
        }
        expect(
          rows.find((r) => r.objtype === "TABLE DELETE")?.remediation_statement,
        ).toMatch(/REVOKE ALL ON public\.fact_fees FROM anon/);
      } finally {
        await ppAdmin.unsafe(
          `revoke all on fact_fees from anon;
           alter default privileges in schema public revoke all on tables from anon;`,
        );
        if (!present) {
          await ppAdmin.unsafe(`drop owned by anon`);
          await ppAdmin.unsafe(`drop role if exists anon`);
        }
      }
      expect(await ppAdmin.unsafe(RESIDUAL_REPORT)).toEqual([]);
    });

    it("covers V4's SEQUENCE and direct-EXECUTE residuals too, not only tables", async () => {
      /**
       * §6's banner claims the statement is a complete posture check on its own, "including the
       * conditions V0 and V4 assert by raising". It was not. `builtin_residual` is TABLES only and
       * `public_execute` matches `grantee = 0` — so two states V4 fails the whole paste for came
       * back from §6 as ZERO ROWS, i.e. as CLEAN:
       *
       *   · a built-in holding USAGE on a SEQUENCE in `public` — which is `nextval()`, a WRITE,
       *     reachable over PostgREST by a role that is supposed to hold nothing here, and granted
       *     by Supabase's own `grant all on all sequences in schema public` just as much as the
       *     table grants that started this file;
       *   · a DIRECT `grant execute on function … to anon` (grantee ≠ 0) — on `ov_in_subtree`,
       *     which is SECURITY DEFINER and is a jurisdiction-tree membership oracle over the GES
       *     spine.
       *
       * Both row sources are asserted against V4 here rather than in isolation: V4 raising is the
       * standard, and §6 returning the matching row is the claim.
       */
      const [seq] = await ppAdmin.unsafe(
        `select c.relname::text as relname
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'S'
          order by c.relname limit 1`,
      );
      expect(
        seq?.relname,
        "there is no sequence in `public` on this schema, so §6's sequence row source cannot be exercised — grant one on a probe sequence instead of deleting this test",
      ).toBeTruthy();
      const seqName = seq.relname as string;

      const [{ present }] = await ppAdmin.unsafe(
        `select exists (select 1 from pg_roles where rolname = 'anon') as present`,
      );
      if (!present) await ppAdmin.unsafe(`create role anon nologin noinherit`);
      try {
        await ppAdmin.unsafe(
          `grant usage on sequence public.${seqName} to anon;
           grant execute on function public.ov_in_subtree(uuid) to anon;`,
        );

        // V4 fails the paste for both of these. That is what §6 has to match.
        expect(await rejects(ppAdmin, BLOCK_V4)).toMatch(/V4 FAILED/);

        const rows = await ppAdmin.unsafe(RESIDUAL_REPORT);

        const seqRow = rows.find((r) => r.objtype === "SEQUENCE USAGE");
        expect(
          seqRow,
          "§6 returned no row for a Supabase built-in holding USAGE on a sequence, which V4 raises on — the report is narrower than the assertions it claims to mirror",
        ).toBeTruthy();
        expect(seqRow!.severity).toBe("FINDING");
        expect(seqRow!.grantee).toBe("anon");
        expect(String(seqRow!.remediation_statement)).toContain(
          `REVOKE ALL ON SEQUENCE public.${seqName} FROM anon;`,
        );

        const execRow = rows.find(
          (r) => r.objtype === "ROUTINE EXECUTE" && r.grantee === "anon",
        );
        expect(
          execRow,
          "§6 returned no row for a DIRECT `grant execute … to anon`. `public_execute` only matches grantee = 0 (PUBLIC), so this is the case it structurally cannot see",
        ).toBeTruthy();
        expect(execRow!.severity).toBe("FINDING");
        expect(String(execRow!.remediation_statement)).toMatch(
          /REVOKE EXECUTE ON ROUTINE ov_in_subtree\(uuid\) FROM anon;/,
        );

        // The remediation column is load-bearing, not decorative: running exactly what §6 printed
        // must close every finding it printed.
        for (const row of rows) {
          await ppAdmin.unsafe(String(row.remediation_statement));
        }
        expect(await ppAdmin.unsafe(RESIDUAL_REPORT)).toEqual([]);
        await ppAdmin.unsafe(BLOCK_V4);
      } finally {
        await ppAdmin.unsafe(
          `revoke all on sequence public.${seqName} from anon;
           revoke execute on function public.ov_in_subtree(uuid) from anon;`,
        );
        if (!present) {
          await ppAdmin.unsafe(`drop owned by anon`);
          await ppAdmin.unsafe(`drop role if exists anon`);
        }
      }
      expect(await ppAdmin.unsafe(RESIDUAL_REPORT)).toEqual([]);
      await ppAdmin.unsafe(PROD_PASTE_0006);
    });

    it("the `TABLE NOT GRANTED` row source names the role 0006 actually grants to", async () => {
      // THE FALSE-CLEAN MECHANISM, PINNED. §6 cannot parameterise its role name (a result-set column
      // literal is not reachable from a plpgsql DECLARE), so `app_missing_select` carries
      // `exists (select 1 from pg_roles where rolname = 'oversight_app')` as a literal. If that
      // literal ever drifts from the role §3 grants to — which is what the deleted "edit the role
      // name" affordance invited — the source yields zero rows and §6 reports CLEAN while the
      // decay it exists to detect is in place. So: a table the app role cannot read MUST produce a
      // row, with the live role in the `grantee` column.
      await ppAdmin.unsafe(
        `create table probe_not_granted (id uuid primary key);
         alter table probe_not_granted enable row level security;
         create policy probe_deny on probe_not_granted for select using (false);`,
      );
      try {
        const rows = await ppAdmin.unsafe(RESIDUAL_REPORT);
        const row = rows.find((r) => r.objtype === "TABLE NOT GRANTED");
        expect(
          row,
          "§6 did not notice a table the app role holds no SELECT on — either the row source's hardcoded role name has drifted from §3's, or its EXISTS gate is matching nothing",
        ).toBeTruthy();
        expect(row!.severity).toBe("ADVISORY");
        expect(row!.grantee).toBe(APP_ROLE);
        expect(String(row!.remediation_statement)).toMatch(
          new RegExp(`GRANT SELECT ON public\\.probe_not_granted TO ${APP_ROLE};`),
        );
      } finally {
        await ppAdmin.unsafe(`drop table probe_not_granted`);
      }
      expect(await ppAdmin.unsafe(RESIDUAL_REPORT)).toEqual([]);
    });
  });

  describe("the app role name is FIXED, not an edit point", () => {
    /**
     * The §3 banner used to read "⇩⇩ EDIT THE ROLE NAME BELOW IF YOURS DIFFERS ⇩⇩", advertising a
     * single edit point that does not exist: the name is written twelve times in executable code —
     * six plpgsql DECLAREs and six SQL literals in §6, which no DECLARE can reach. A partial rename
     * is therefore the normal outcome, and it is not a loud one. §6's `app_missing_select` is gated
     * on `rolname = 'oversight_app'`, so under a rename that source yields zero rows and §6 reports
     * CLEAN — a false clean against the one contract the file asks the operator to read. Prod uses
     * the default name, so the affordance bought nothing and cost that.
     */
    it("no longer advertises an edit point, and says so where the invitation used to be", () => {
      expect(PROD_PASTE_0006).not.toMatch(/EDIT THE ROLE NAME/i);
      expect(PROD_PASTE_0006).not.toMatch(/keep in sync with/i);
      expect(PROD_PASTE_0006).not.toMatch(/edit it in all of them/i);
      expect(PROD_PASTE_0006).not.toMatch(/carries its own copy of the (role )?name/i);
      // The replacement claim sits in §3's banner, where the invitation was.
      expect(section(ANCHOR_S3, ANCHOR_S4C)).toMatch(
        /THE APP ROLE NAME IS \*\*FIXED\*\* AT `oversight_app`/,
      );
    });

    it("uses one and the same name in every DECLARE and in §6's literals", () => {
      const declared = [
        ...PROD_PASTE_0006.matchAll(/app_role\s+text\s*:=\s*'([^']*)'/g),
      ].map((m) => m[1]);
      expect(
        declared.length,
        "the number of app-role DECLAREs changed; the §3 banner states the count, so update it in the same change",
      ).toBe(6);
      expect([...new Set(declared)]).toEqual([APP_ROLE]);

      // The §6 copies, which are the ones that cannot be a variable.
      expect(RESIDUAL_REPORT).toContain(
        `AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}')`,
      );
      expect(RESIDUAL_REPORT).toContain(`NOT has_table_privilege('${APP_ROLE}'`);
      // EXACT, not a floor: the §3 banner tells a would-be renamer how many occurrences there are
      // and that the §6 ones are unreachable from a DECLARE. A new §6 row source naming the role
      // should make that banner go RED here rather than quietly stale.
      expect(
        [...RESIDUAL_REPORT.matchAll(new RegExp(APP_ROLE, "g"))].length,
        "the number of hardcoded `oversight_app` literals in §6 changed; the §3 banner and the header both state it (six DECLAREs + seven §6 literals = thirteen), so update them in the same change",
      ).toBe(7);
    });
  });

  describe("§4c — the advisory branch: reports what it cannot fix", () => {
    /**
     * §4c's `ELSE` branch — grantor not a member of the pasting role, so ALTER DEFAULT PRIVILEGES is
     * impossible, so WARN and let the paste succeed — is DEAD CODE in CI, and was when the block was
     * written: the suite pastes as the cluster superuser, for whom `pg_has_role(..., 'USAGE')` is
     * true for every grantor alive. The branch that matters on prod (Supabase's own
     * `supabase_admin`-owned default privileges, which `postgres` cannot touch) was the one branch
     * never executed.
     *
     * The role is named `pp_operator`, not `operator`, for two reasons: OPERATOR is a Postgres
     * keyword, and roles are CLUSTER-WIDE, so a generic name could collide with something a
     * developer left behind on a reused cluster.
     */
    it("warns, does not raise, and the un-fixable default privilege still bites", async () => {
      const { sql: operatorConn, messages } = connectCollecting(withDb(adminBase, PP_DB));
      // Roles are cluster-wide — only drop `anon` in the finally if WE created it, so a cluster
      // where `anon` legitimately pre-exists is left untouched (matches the sibling tests).
      const [{ present: anonPreexisted }] = await ppAdmin.unsafe(
        `select exists (select 1 from pg_roles where rolname = 'anon') as present`,
      );
      try {
        await ppAdmin.unsafe(`
          do $$ begin
            if not exists (select from pg_roles where rolname = 'plat_admin') then
              create role plat_admin;
            end if;
            if not exists (select from pg_roles where rolname = 'pp_operator') then
              create role pp_operator;
            end if;
            if not exists (select from pg_roles where rolname = 'anon') then
              create role anon nologin noinherit;
            end if;
          end $$;
          grant create, usage on schema public to plat_admin;
          alter default privileges for role plat_admin in schema public grant all on tables to anon;
        `);
        // The precondition the branch needs and CI never had: the pasting role is NOT a member of
        // the grantor, so §4c can see the default privilege and cannot alter it.
        const [memb] = await ppAdmin.unsafe(
          `select pg_has_role('pp_operator', 'plat_admin', 'USAGE') as inherits,
                  pg_has_role('pp_operator', 'plat_admin', 'MEMBER') as member`,
        );
        expect(memb.inherits).toBe(false);
        expect(memb.member).toBe(false);

        messages.length = 0;
        await operatorConn.unsafe(`set role pp_operator`);
        // SUCCEEDS — the advisory branch must not abort the paste for a condition the operator
        // cannot fix from the SQL editor, or they learn to stop running the file.
        await operatorConn.unsafe(BLOCK_4C);
        await operatorConn.unsafe(`reset role`);

        const warnings = messages.filter((m) => m.severity === "WARNING");
        expect(
          warnings.length,
          "§4c's advisory branch produced no WARNING, so either it did not take the ELSE path or the advisory was empty",
        ).toBeGreaterThan(0);
        const advisory = warnings.map((w) => w.message).join("\n");
        expect(advisory).toMatch(/§4c/);
        expect(advisory).toMatch(/not a member of the grantor/);
        expect(advisory).toMatch(
          /ALTER DEFAULT PRIVILEGES FOR ROLE plat_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon;/,
        );

        // REPORTS BUT CANNOT FIX — the half that makes the WARNING load-bearing rather than
        // cosmetic. A table created by that grantor afterwards is STILL granted to `anon`.
        await ppAdmin.unsafe(
          `set role plat_admin; create table probe_adv (id uuid primary key); reset role;`,
        );
        try {
          expect(
            await privilegesOn(ppAdmin, "anon", "probe_adv"),
            "§4c's advisory branch apparently DID neutralise the default privilege, which would mean the test is not exercising the ELSE path",
          ).toContain("DELETE");
        } finally {
          await ppAdmin.unsafe(`drop table probe_adv`);
        }

        // …and §6 renders the same thing as an ADVISORY row for the same non-member connection,
        // which is the only form of it the Supabase SQL editor will show.
        await operatorConn.unsafe(`set role pp_operator`);
        const rows = await operatorConn.unsafe(RESIDUAL_REPORT);
        await operatorConn.unsafe(`reset role`);
        const acl = rows.filter((r) => String(r.objtype).startsWith("DEFAULT ACL"));
        expect(acl.length).toBe(1);
        expect(acl[0].severity).toBe("ADVISORY");
        expect(acl[0].grantor).toBe("plat_admin");
        expect(acl[0].grantee).toBe("anon");
      } finally {
        await operatorConn.unsafe(`reset role`).catch(() => {});
        await operatorConn.end({ timeout: 5 });
        await ppAdmin.unsafe(
          `alter default privileges for role plat_admin in schema public revoke all on tables from anon`,
        );
        await ppAdmin.unsafe(`revoke create, usage on schema public from plat_admin`);
        const toDrop = anonPreexisted
          ? ["plat_admin", "pp_operator"]
          : ["plat_admin", "pp_operator", "anon"];
        for (const role of toDrop) {
          await ppAdmin.unsafe(`drop owned by ${role}`);
          await ppAdmin.unsafe(`drop role if exists ${role}`);
        }
      }
      // Clean again: no residual, and the paste still applies.
      expect(await ppAdmin.unsafe(RESIDUAL_REPORT)).toEqual([]);
      await ppAdmin.unsafe(PROD_PASTE_0006);
    });
  });
});
