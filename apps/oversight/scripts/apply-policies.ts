import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

// Apply db/sql/policies.sql (jurisdiction RLS + append-only audit guard) to the analytics DB.
// Cross-platform runner, mirroring the operational app's scripts/apply-policies.ts.
config({ path: ".env.local" });

const url =
  process.env.ANALYTICS_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://omnischools:omnischools@localhost:55432/omnischools_analytics_dev";

async function main() {
  const sqlText = readFileSync(join(process.cwd(), "db/sql/policies.sql"), "utf8");
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(sqlText);
    console.log("✓ Oversight RLS policies applied");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ Failed to apply policies:", err);
  process.exit(1);
});
