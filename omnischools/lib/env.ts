import { z } from "zod";

/**
 * Centralised, validated environment access.
 * Most external services are optional in Phase 0/1 (stubbed); only DATABASE_URL
 * is needed for the local Docker Postgres. Validation is permissive so `next build`
 * never fails for an unset optional secret.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Database (local Docker in dev; Supabase Postgres in prod)
  DATABASE_URL: z
    .string()
    .default("postgresql://omnischools:omnischools@localhost:55432/omnischools_dev"),

  // Supabase (wired at deploy; dormant in local dev)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Claude Vision — score-ledger scan extraction (Path B / Item 4). Server-only (NOT
  // NEXT_PUBLIC): the base64 photo is sent to Claude from our own API route, never the
  // client. Absent in dev/CI → the extractor falls back to the deterministic stub.
  ANTHROPIC_API_KEY: z.string().optional(),

  // SMS / email providers (stubbed until credentials exist)
  HUBTEL_CLIENT_ID: z.string().optional(),
  HUBTEL_CLIENT_SECRET: z.string().optional(),
  HUBTEL_SENDER_ID: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  // Observability (dormant unless DSN/key present)
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().optional(),

  // Background-job shared secret (generic HTTP cron — portability)
  CRON_SECRET: z.string().optional(),

  // Dev-only auth shim toggle (real Supabase Auth OTP wired at deploy).
  // Defaults to "false" — FAIL CLOSED. This is the auth kill-switch: when it is on, `authIsLive()` is
  // false, every request resolves to the hardcoded DEV_USER with roles ["ADMIN"], and `getActiveSchool`
  // hands back a real school. It previously defaulted to "true", so a single ABSENT or misspelled env
  // var on prod would have silently granted unauthenticated ADMIN access to a real school's pupil data
  // — even with Supabase fully configured. Every documented path sets this explicitly (.env.example
  // "true", DEPLOY.md "false"), so the default only governs the case where someone forgot; that case
  // must deny, not admit.
  AUTH_DEV_BYPASS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
