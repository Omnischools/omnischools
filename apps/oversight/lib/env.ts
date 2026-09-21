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
    .default(
      "postgresql://omnischools:omnischools@localhost:55432/omnischools_analytics_dev",
    ),

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

  /**
   * E3 feature flag — individual drill-down of NON-GES / non-teaching staff at schools whose
   * ownership_type is not PUBLIC (PRIVATE / MISSION).
   *
   * DEFAULT OFF, and it must stay off in production until a DPO writes the lawful-basis position
   * (apps/web/Todo.md "Blocked on"): under the Data Protection Act 2012 (Act 843) an employer's
   * click is not the employee's consent, so a private-school proprietor granting DPO consent may
   * not be a sufficient basis for GES to read that employee's individual record. The consent
   * CAPTURE ships regardless; this flag governs whether Oversight will ACT on it for non-public
   * schools. GES-establishment teachers are unaffected — they are statutory at every ownership
   * type and never touch this flag.
   */
  E3_NON_PUBLIC_STAFF_DRILLDOWN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const env = schema.parse(process.env);
