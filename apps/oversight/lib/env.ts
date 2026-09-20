import { z } from "zod";

/**
 * Centralised, validated environment access for the Oversight app.
 *
 * Oversight reads ONLY the analytics database (omnischools-analytics-prod) — never operational
 * Postgres directly, except through the gated named-record path (§6), which is a separate,
 * explicitly-configured connection. Validation is permissive so `next build` never fails for an
 * unset optional secret, and the app is force-dynamic so the build opens no DB connection.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // The analytics DB (omnischools-analytics-prod). The app's read-only, RLS-scoped connection.
  ANALYTICS_DATABASE_URL: z
    .string()
    .default("postgresql://omnischools:omnischools@localhost:55432/omnischools_analytics_dev"),

  // The gated named-record read-back to OPERATIONAL Postgres (§6). Separate, scoped, logged.
  // Optional: absent until the compliance surface is wired.
  OPERATIONAL_READBACK_URL: z.string().optional(),

  // Supabase (analytics project — GES staff auth lives here, NOT the school auth project).
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Public site URL (metadata; oversight.omnischools.gh in prod).
  NEXT_PUBLIC_SITE_URL: z.string().default("http://localhost:3100"),

  // Observability (dormant unless set).
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),

  // Dev-only auth shim toggle. FAIL CLOSED (defaults false), mirroring the operational app.
  AUTH_DEV_BYPASS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const env = schema.parse(process.env);
