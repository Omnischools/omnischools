import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load local dev env for drizzle-kit (db:generate / db:migrate / db:studio).
config({ path: ".env.local" });

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.ANALYTICS_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://omnischools:omnischools@localhost:55432/omnischools_analytics_dev",
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
