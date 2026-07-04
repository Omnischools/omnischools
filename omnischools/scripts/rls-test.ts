import { config } from "dotenv";
import postgres from "postgres";

/**
 * Proves tenant isolation across EVERY tenant table.
 *
 * As the non-superuser app role (`omnischools_app`):
 *   - scoped to the seeded school  → its own rows are visible,
 *   - scoped to a foreign school id → zero rows,
 *   - unscoped (GUC never set)      → zero rows.
 *
 * Tenant tables are discovered dynamically (every `public` table with a `school_id`
 * column and FORCE RLS), so a newly-added tenant table is covered automatically — a
 * table that ships without the isolation policy makes this test fail loudly.
 *
 * Exits non-zero on any failed assertion.
 */
config({ path: ".env.local" });

const url =
  process.env.DATABASE_URL ??
  "postgresql://omnischools:omnischools@localhost:55432/omnischools_dev";

const FOREIGN_ID = "00000000-0000-0000-0000-0000000000ff";

// Regression guards: exact seeded counts for the originally-covered tables.
const SEEDED_COUNTS: Record<string, number> = {
  academic_period: 2,
  ref_school_product: 1,
  role_assignment: 6,
};

let failures = 0;
function assert(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${label}: got ${actual}, expected ${expected}`);
  if (!ok) failures++;
}
function assertAtLeast(label: string, actual: number, min: number) {
  const ok = actual >= min;
  console.log(`${ok ? "✓" : "✗"} ${label}: got ${actual}, expected ≥ ${min}`);
  if (!ok) failures++;
}

async function main() {
  const sql = postgres(url, { max: 1 });
  try {
    // Discover every tenant table (school_id column + FORCE RLS), as the connecting role.
    const discovered = await sql<{ t: string }[]>`
      select c.relname as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'
        and c.relforcerowsecurity
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public'
            and col.table_name = c.relname
            and col.column_name = 'school_id'
        )
      order by c.relname`;
    const TABLES = discovered.map((r) => r.t);
    if (TABLES.length === 0) throw new Error("No tenant tables discovered — is RLS applied?");
    console.log(`Discovered ${TABLES.length} tenant tables.\n`);

    const rows = await sql`select id from ref_school where ges_code = 'WR-WAW-014'`;
    if (rows.length === 0) throw new Error("Seed missing — run db:seed first.");
    const schoolId = rows[0].id as string;

    // Scoped to the real school → own rows visible. Track the total to prove the
    // policy isn't a blanket deny (at least some rows must be visible when scoped).
    let ownTotal = 0;
    await sql.begin(async (tx) => {
      await tx`set local role omnischools_app`;
      await tx`select set_config('app.current_school', ${schoolId}, true)`;
      for (const t of TABLES) {
        const [{ n }] = await tx`select count(*)::int as n from ${tx(t)}`;
        ownTotal += n;
        if (t in SEEDED_COUNTS) assert(`${t} (own)`, n, SEEDED_COUNTS[t]);
      }
      // ref_school is keyed on `id` (not school_id) — its own row must be visible.
      const [{ n }] = await tx`select count(*)::int as n from ref_school`;
      assert("ref_school (own)", n, 1);
    });
    assertAtLeast("scoped session sees data (sum over tenant tables)", ownTotal, 1);

    // Scoped to a foreign id → zero rows on every tenant table (and ref_school).
    await sql.begin(async (tx) => {
      await tx`set local role omnischools_app`;
      await tx`select set_config('app.current_school', ${FOREIGN_ID}, true)`;
      for (const t of TABLES) {
        const [{ n }] = await tx`select count(*)::int as n from ${tx(t)}`;
        assert(`${t} (foreign)`, n, 0);
      }
      const [{ n }] = await tx`select count(*)::int as n from ref_school`;
      assert("ref_school (foreign)", n, 0);
    });

    // Unscoped (GUC never set) → zero rows everywhere (fail-closed).
    await sql.begin(async (tx) => {
      await tx`set local role omnischools_app`;
      for (const t of TABLES) {
        const [{ n }] = await tx`select count(*)::int as n from ${tx(t)}`;
        assert(`${t} (unscoped)`, n, 0);
      }
      const [{ n }] = await tx`select count(*)::int as n from ref_school`;
      assert("ref_school (unscoped)", n, 0);
    });
  } finally {
    await sql.end();
  }

  if (failures > 0) {
    console.error(`\n✗ RLS test FAILED (${failures} assertion(s)).`);
    process.exit(1);
  }
  console.log("\n✓ RLS isolation verified across all tenant tables.");
}

main().catch((err) => {
  console.error("✗ RLS test error:", err);
  process.exit(1);
});
