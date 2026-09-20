import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";

/**
 * Analytics database client (Drizzle + postgres.js) for Omnischools Oversight.
 *
 * This is the SECOND Postgres — omnischools-analytics-prod — populated nightly by the ETL. The
 * Oversight app reads ONLY this DB (OVERSIGHT_ANALYTICS_SPEC §2). Jurisdiction isolation is
 * enforced by Postgres RLS keyed on `app.current_jurisdiction` / `app.current_level`
 * (see lib/db/rls.ts and db/sql/policies.sql). Connection is lazy — safe to import at build.
 *
 * The app must connect as a NON-OWNER, read-scoped role so RLS actually applies (see policies.sql).
 */
const queryClient = postgres(env.ANALYTICS_DATABASE_URL, { prepare: false });

export const db = drizzle(queryClient, { schema, casing: "snake_case" });
export { schema };

export type Database = typeof db;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
