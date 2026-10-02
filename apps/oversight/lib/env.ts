import { z } from "zod";

/**
 * Centralised, validated environment access for the Oversight app.
 *
 * Oversight reads ONLY the analytics database (omnischools-analytics-prod) — never operational
 * Postgres directly, except through the gated named-record path (§6), which is a separate,
 * explicitly-configured connection. Validation is permissive so `next build` never fails for an
 * unset optional secret, and the app is force-dynamic so the build opens no DB connection.
 */
/**
 * Treat an EMPTY/whitespace-only variable as absent before validating it.
 *
 * Applied to every var whose format is validated. The alternative — letting zod reject `""` — turns
 * a blank deployment variable into a module-load crash rather than into the fail-closed "capability
 * unavailable" state each consumer is written to handle. See the note beside the Supabase pair.
 */
function blankToUndefined<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    inner,
  );
}

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
  //
  // STILL `.optional()` IN THE SCHEMA, AND REQUIRED AT RUNTIME INSTEAD — see
  // `supabaseAuthConfig()` below. `next build` imports every route module with NODE_ENV=production,
  // so a `.min(1)` here would make a build fail on a machine that has no deploy secrets, which is
  // how env validation gets deleted. The requirement is enforced where it is meaningful: on the
  // request path, with the bypass off.
  //
  // ⚠ `blankToUndefined` IS LOAD-BEARING, NOT TIDINESS. A plain `.url().optional()` rejects the
  // EMPTY STRING — and "the variable exists but is blank" is the single most common shape of a
  // half-configured deployment (a dashboard env var created and left empty, a `.env` line copied
  // without its value). Zod would then throw at MODULE LOAD, from `schema.parse` below, taking every
  // page in the app down with a stack trace instead of leaving the sign-in surface to refuse
  // politely. Blank must mean "unset", which is what `supabaseAuthConfig()` already treats it as;
  // this makes the schema agree. Found by tests/provisioning-admin-gate.test.ts, which stubs the
  // vars to "" to simulate exactly that deployment.
  NEXT_PUBLIC_SUPABASE_URL: blankToUndefined(z.string().url().optional()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: blankToUndefined(z.string().optional()),

  /**
   * ⚠ `SUPABASE_SERVICE_ROLE_KEY` IS DELIBERATELY ABSENT FROM THIS SCHEMA.
   *
   * The service-role key bypasses RLS and every auth check in the Supabase project. Oversight's
   * whole authorisation model is "the database decides, keyed on the jurisdiction GUCs and the
   * officer directory", so a runtime that holds that key holds a credential capable of reading every
   * named record and minting any officer — the one thing no amount of careful app code can take
   * back. It is not read here, which means no feature module can reach for it even by accident; the
   * only privileged credential in this app is the PROVISIONER connection below, which is a narrow
   * Postgres role rather than a project-wide master key. `tests/no-service-role-key.test.ts`
   * asserts the absence textually, so re-adding it fails the suite rather than review.
   */

  /**
   * The PROVISIONER connection (increment G, docs/PROVISIONING.md §4b). A separate, narrowly-granted
   * analytics role (`ov_provisioner` / `oversight_provisioner`) used ONLY by the Omnischools admin
   * console and `scripts/load-officers.ts` to write the officer directory + the provisioning-audit
   * row. The app's own `ANALYTICS_DATABASE_URL` role has no write grant on either table, which is
   * what makes self-promotion impossible. Unset ⇒ the admin console refuses (fail closed).
   */
  PROVISIONER_DATABASE_URL: z.string().optional(),

  /**
   * The Omnischools staff who may use the admin provisioning console, as a comma-separated list of
   * Supabase auth uids. This is the console's OWN role gate: a GES officer session of any tier —
   * including NATIONAL — is refused, because provisioning is an Omnischools operational capability
   * and not the top of the GES hierarchy. Unset ⇒ nobody may provision (fail closed).
   */
  OVERSIGHT_ADMIN_UIDS: z.string().optional(),

  /**
   * HMAC secret for the two-person approval codes a REGION/NATIONAL provision requires (Kofi R7).
   * Unset ⇒ no approval code can be minted or verified, so REGION/NATIONAL provisioning refuses.
   */
  PROVISIONING_APPROVAL_SECRET: z.string().optional(),

  // ---- Session policy (Kofi R5, Lucy R3 — owner/DPO ratifies the numbers) -------------------
  // Configurable with the recommended defaults baked in, so ratifying a different figure is an env
  // change rather than a code change. Measured from the earliest `amr` timestamp, never `iat`.
  OVERSIGHT_SESSION_MAX_HOURS: z.coerce.number().positive().default(8),
  OVERSIGHT_SESSION_IDLE_MINUTES: z.coerce.number().positive().default(30),
  /** The §6 step-up reuse window (Kofi R6): one AAL2 assertion covers browse→pick→view→export. */
  OVERSIGHT_STEP_UP_WINDOW_MINUTES: z.coerce.number().positive().default(5),

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

/**
 * Thrown when the GES-staff auth is asked for and cannot be given — the same fail-closed shape as
 * `ReadbackUnavailableError` in lib/db/readback.ts, and for the same reason: a missing capability
 * must present as a closed door, not as a quieter one.
 */
export class SupabaseAuthUnavailableError extends Error {
  readonly code = "SUPABASE_AUTH_UNAVAILABLE";
  constructor(missing: readonly string[]) {
    super(
      `GES-staff auth is not configured — missing ${missing.join(", ")}. With AUTH_DEV_BYPASS=false these are REQUIRED: without them no officer session can be verified, so every gated surface refuses (fail closed). Set them on the Oversight project (docs/PROVISIONING.md §4).`,
    );
    this.name = "SupabaseAuthUnavailableError";
  }
}

export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
}

function blankToNull(v: string | undefined): string | null {
  const t = v?.trim();
  return t && t.length > 0 ? t : null;
}

/**
 * The validated Supabase pair, or null. Blank is treated as unset — an env var that exists but is
 * empty is exactly what a half-configured deployment looks like.
 */
export function supabaseAuthConfig(): SupabaseAuthConfig | null {
  const url = blankToNull(env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = blankToNull(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return url && anonKey ? { url, anonKey } : null;
}

export function isSupabaseAuthConfigured(): boolean {
  return supabaseAuthConfig() !== null;
}

/**
 * The RUNTIME requirement the zod schema deliberately does not express (see the note beside the two
 * vars). Called on the auth path, not at module load, so `next build` — which imports every route
 * module with NODE_ENV=production and no deploy secrets — still succeeds.
 */
export function requireSupabaseAuthConfig(): SupabaseAuthConfig {
  const config = supabaseAuthConfig();
  if (config) return config;
  const missing = [
    blankToNull(env.NEXT_PUBLIC_SUPABASE_URL) ? null : "NEXT_PUBLIC_SUPABASE_URL",
    blankToNull(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      ? null
      : "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter((m): m is string => m !== null);
  throw new SupabaseAuthUnavailableError(missing);
}

/** The admin-console allow-list, parsed. Unset/blank ⇒ an EMPTY set: nobody may provision. */
export function adminUids(): ReadonlySet<string> {
  const raw = blankToNull(env.OVERSIGHT_ADMIN_UIDS);
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}
