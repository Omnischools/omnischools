import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

// Apply db/sql/policies.sql (RLS) to the dev database. Cross-platform runner.
config({ path: ".env.local" });

const url =
  process.env.DATABASE_URL ??
  "postgresql://omnischools:omnischools@localhost:55432/omnischools_dev";

async function main() {
  const sqlText = readFileSync(join(process.cwd(), "db/sql/policies.sql"), "utf8");
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(sqlText);
    console.log("✓ RLS policies applied");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ Failed to apply policies:", err);
  process.exit(1);
});
