import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load local dev env for drizzle-kit (db:generate / db:push / db:studio).
config({ path: ".env.local" });

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://omnischools:omnischools@localhost:55432/omnischools_dev",
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
