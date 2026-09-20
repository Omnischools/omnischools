import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";

/**
 * Operational database client (Drizzle + postgres.js).
 * One operational DB for all tenants; isolation enforced by Postgres RLS keyed on
 * `app.current_school` (see lib/db/rls.ts). Connection is lazy — safe to import at build.
 */
const queryClient = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(queryClient, { schema, casing: "snake_case" });
export { schema };

export type Database = typeof db;
/** A Drizzle transaction handle (use inside withSchool / withoutTenantScope). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
