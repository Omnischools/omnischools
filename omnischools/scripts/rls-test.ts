import { config } from "dotenv";
import postgres from "postgres";

/**
 * Proves tenant isolation: as the non-superuser app role, a session scoped to school A
 * sees A's rows; scoped to a foreign id (or unscoped) it sees none.
 * Exits non-zero on any failed assertion.
 */
config({ path: ".env.local" });

const url =
  process.env.DATABASE_URL ??
  "postgresql://omnischools:omnischools@localhost:55432/omnischools_dev";

const FOREIGN_ID = "00000000-0000-0000-0000-0000000000ff";
const TABLES = ["academic_period", "role_assignment", "audit_log", "ref_school_product"];

let failures = 0;
function assert(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${label}: got ${actual}, expected ${expected}`);
  if (!ok) failures++;
}

async function main() {
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql`select id from ref_school where ges_code = 'WR-WAW-014'`;
    if (rows.length === 0) throw new Error("Seed missing — run db:seed first.");
    const schoolId = rows[0].id as string;

    // Scoped to the real school → rows visible.
    await sql.begin(async (tx) => {
      await tx`set local role omnischools_app`;
      await tx`select set_config('app.current_school', ${schoolId}, true)`;
      for (const t of TABLES) {
        const [{ n }] = await tx`select count(*)::int as n from ${tx(t)}`;
        if (t === "academic_period") assert(`${t} (own)`, n, 2);
        else if (t === "ref_school_product") assert(`${t} (own)`, n, 1);
        else if (t === "role_assignment") assert(`${t} (own)`, n, 6);
        else assert(`${t} (own ≥ 1)`, n >= 1 ? 1 : 0, 1);
      }
    });

    // Scoped to a foreign id → zero rows.
    await sql.begin(async (tx) => {
      await tx`set local role omnischools_app`;
      await tx`select set_config('app.current_school', ${FOREIGN_ID}, true)`;
      for (const t of TABLES) {
        const [{ n }] = await tx`select count(*)::int as n from ${tx(t)}`;
        assert(`${t} (foreign)`, n, 0);
      }
    });

    // Unscoped (GUC never set) → zero rows.
    await sql.begin(async (tx) => {
      await tx`set local role omnischools_app`;
      for (const t of TABLES) {
        const [{ n }] = await tx`select count(*)::int as n from ${tx(t)}`;
        assert(`${t} (unscoped)`, n, 0);
      }
    });
  } finally {
    await sql.end();
  }

  if (failures > 0) {
    console.error(`\n✗ RLS test FAILED (${failures} assertion(s)).`);
    process.exit(1);
  }
  console.log("\n✓ RLS isolation verified.");
}

main().catch((err) => {
  console.error("✗ RLS test error:", err);
  process.exit(1);
});
